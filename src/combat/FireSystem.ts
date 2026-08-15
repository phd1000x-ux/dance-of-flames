import { Color3, PointLight, Scene, Vector3 } from "@babylonjs/core";
import type { PlayerState } from "../player/PlayerState";
import type { DragonController } from "../player/DragonController";
import type { DragonRig } from "../world/DragonRig";
import type { EffectsLibrary } from "../world/EffectsLibrary";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { ParticleSystem } from "@babylonjs/core";
import { mitigateDamage } from "./DamageCalculator";

export interface FireTargetLike {
  pos: Vector3;
  hitRadius: number;
  isBuilding?: boolean;
}

/**
 * Dragon fire breath: gameplay damage pipeline + layered visuals.
 * Cone query → damage w/ falloff → burning status; Super Charge beam on R.
 */
export class FireSystem {
  private firePs: ParticleSystem;
  private emberPs: ParticleSystem;
  private smokePs: ParticleSystem;
  private light: PointLight;
  private flicker = 0;
  private queryTimer = 0;
  firing = false;
  superActive = 0;
  lastBeamHit: Vector3 | null = null;

  // callbacks into combat systems
  onFireHit: ((origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number) => void) | null = null;
  onBeamFire: ((origin: Vector3, dir: Vector3) => void) | null = null;

  constructor(
    private scene: Scene,
    private player: PlayerState,
    private ctrl: DragonController,
    private rig: DragonRig,
    private effects: EffectsLibrary,
    private bus: EventBus<GameEvents>
  ) {
    this.firePs = effects.createFireStream("fireStream", player.dragonDef.fireColor);
    this.emberPs = effects.createEmbers("fireEmbers");
    this.smokePs = effects.createSmokeColumn("fireSmoke");
    this.light = new PointLight("fireLight", new Vector3(0, 0, 0), scene);
    this.light.diffuse = Color3.FromHexString(player.dragonDef.fireColor);
    this.light.intensity = 0;
    this.light.range = 60;
  }

  /** called every frame from mission scene */
  update(dt: number, wantFire: boolean, wantSuper: boolean, particleScale: number): void {
    if (this.player.mode !== "dragon") {
      this.setVisual(0, particleScale);
      return;
    }

    const firing = this.player.fireEnergy.update(dt, wantFire);
    this.firing = firing;

    if (wantSuper && this.player.superCharge >= 100 && this.player.superCooldown <= 0) {
      this.fireSuper();
    }

    if (firing) {
      const stats = this.player.dragonStats;
      const origin = this.rig.headTip.getAbsolutePosition();
      const dir = this.ctrl.forward;
      const range = stats.fireRange ?? 60;
      const halfAngle = stats.fireCone ?? 0.34;
      let dps = stats.fireDamage ?? 50;
      if (this.player.fireBoostTimer > 0) dps *= 1.5;
      this.onFireHit?.(origin, dir, range, halfAngle, dps, dt);
      this.updateVisual(origin, dir, range, particleScale);
      this.queryTimer += dt;
      if (this.queryTimer > 0.5) {
        this.queryTimer = 0;
        this.player.addSuper(2); // passive generation while breathing fire
      }
    } else {
      this.setVisual(0, particleScale);
    }

    if (this.superActive > 0) this.superActive -= dt;
  }

  private fireSuper(): void {
    const stats = this.player.dragonStats;
    this.player.superCharge = 0;
    this.player.superCooldown = stats.superCooldown ?? 14;
    const origin = this.rig.headTip.getAbsolutePosition();
    const dir = this.ctrl.forward;
    this.superActive = 0.9;
    this.onBeamFire?.(origin, dir);
    this.effects.explosion(origin.add(dir.scale(8)), 2.2);
    this.bus.emit("sfx", { name: "superBlast" });
    this.bus.emit("super-used", {});
  }

  private updateVisual(origin: Vector3, dir: Vector3, range: number, particleScale: number): void {
    (this.firePs.emitter as Vector3).copyFrom(origin);
    // orient spread cone along fire direction (world space)
    const side = new Vector3(dir.z, 0, -dir.x).normalize();
    const up = Vector3.Cross(side, dir).normalize();
    const spread = 0.22;
    const s = side.scale(spread);
    const u = up.scale(spread * 0.6);
    this.firePs.direction1 = dir.subtract(s).subtract(u);
    this.firePs.direction2 = dir.add(s).add(u);
    this.firePs.minEmitPower = range * 0.5;
    this.firePs.maxEmitPower = range * 0.95;
    this.firePs.emitRate = 380 * particleScale;
    if (!this.firePs.isStarted()) this.firePs.start();

    const mid = origin.add(dir.scale(range * 0.55));
    (this.emberPs.emitter as Vector3).copyFrom(mid);
    this.emberPs.emitRate = 120 * particleScale;
    if (!this.emberPs.isStarted()) this.emberPs.start();

    const end = origin.add(dir.scale(range * 0.8));
    (this.smokePs.emitter as Vector3).copyFrom(end);
    this.smokePs.emitRate = 26 * particleScale;
    if (!this.smokePs.isStarted()) this.smokePs.start();

    this.light.position.copyFrom(origin.add(dir.scale(3)));
    this.flicker += 0.37;
    this.light.intensity = 1.6 + Math.sin(this.flicker) * 0.5 + Math.random() * 0.3;
    this.light.range = Math.max(40, range);
  }

  private setVisual(rate: number, particleScale: number): void {
    this.firePs.emitRate = rate * particleScale;
    this.emberPs.emitRate = rate * 0.4 * particleScale;
    this.smokePs.emitRate = rate * 0.15 * particleScale;
    if (rate === 0) {
      this.light.intensity = Math.max(0, this.light.intensity - 0.4);
      if (this.light.intensity < 0.12) {
        this.firePs.stop();
        this.emberPs.stop();
        this.smokePs.stop();
      }
    }
  }

  dispose(): void {
    this.firePs.dispose();
    this.emberPs.dispose();
    this.smokePs.dispose();
    this.light.dispose();
    void this.scene;
    void mitigateDamage;
  }
}
