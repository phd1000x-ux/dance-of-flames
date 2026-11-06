import { Color3, Color4, PointLight, Scene, Vector3 } from "@babylonjs/core";
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
  private corePs: ParticleSystem;
  private impactPs: ParticleSystem;
  /** terrain height for the ground-impact splash (set by MissionScene) */
  heightAt: ((x: number, z: number) => number) | null = null;
  private light: PointLight;
  private flicker = 0;
  private queryTimer = 0;
  firing = false;
  superActive = 0;
  lastBeamHit: Vector3 | null = null;
  /** optional aim override (target assist / lock-on) — falls back to dragon forward */
  aimDir: Vector3 | null = null;

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
    this.firePs = effects.createBreath("fireStream", player.dragonDef.fireColor);
    this.corePs = effects.createBreathCore("fireCore", player.dragonDef.fireColor);
    this.impactPs = effects.createBreathImpact("fireImpact", player.dragonDef.fireColor);
    this.emberPs = effects.createEmbers("fireEmbers");
    this.smokePs = effects.createSmokeColumn("fireSmoke");
    // breath smoke sits right behind the flame on screen: the building-fire
    // column's near-black read as a hole in the fire. Lighter, thinner, rising.
    this.smokePs.color1 = new Color4(0.42, 0.38, 0.34, 0.22);
    this.smokePs.color2 = new Color4(0.5, 0.47, 0.43, 0.16);
    this.smokePs.colorDead = new Color4(0.55, 0.53, 0.5, 0);
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
      const dir = this.aimDir ?? this.ctrl.forward;
      const dirN = Vector3.Normalize(dir);
      const range = stats.fireRange ?? 60;
      const halfAngle = stats.fireCone ?? 0.34;
      let dps = stats.fireDamage ?? 50;
      if (this.player.fireBoostTimer > 0) dps *= 1.5;
      this.onFireHit?.(origin, dirN, range, halfAngle, dps, dt);
      this.updateVisual(origin, dirN, range, particleScale);
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
    const dir = Vector3.Normalize(this.aimDir ?? this.ctrl.forward);
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
    // particles are world-space: add the dragon's own speed so the breath
    // reaches its range instead of bunching on the jaws in level flight
    const carry = Math.max(0, this.ctrl.speed);
    this.firePs.minEmitPower = range * 1.1 + carry;
    this.firePs.maxEmitPower = range * 1.6 + carry;
    this.firePs.emitRate = 300 * particleScale;
    if (!this.firePs.isStarted()) this.firePs.start();

    // white-hot jet at the jaws
    (this.corePs.emitter as Vector3).copyFrom(origin);
    const cs = side.scale(0.06);
    this.corePs.direction1 = dir.subtract(cs);
    this.corePs.direction2 = dir.add(cs);
    this.corePs.minEmitPower = range * 0.6 + carry;
    this.corePs.maxEmitPower = range * 0.8 + carry;
    this.corePs.emitRate = 140 * particleScale;
    if (!this.corePs.isStarted()) this.corePs.start();

    // ground splash where the breath reaches terrain within range
    const hit = this.groundHit(origin, dir, range);
    if (hit) {
      (this.impactPs.emitter as Vector3).copyFrom(hit);
      this.impactPs.emitRate = 110 * particleScale;
      if (!this.impactPs.isStarted()) this.impactPs.start();
    } else {
      this.impactPs.emitRate = 0;
    }

    const mid = origin.add(dir.scale(range * 0.55));
    (this.emberPs.emitter as Vector3).copyFrom(mid);
    this.emberPs.emitRate = 120 * particleScale;
    if (!this.emberPs.isStarted()) this.emberPs.start();

    const end = hit ?? origin.add(dir.scale(range * 0.8));
    (this.smokePs.emitter as Vector3).copyFrom(end);
    this.smokePs.emitRate = 12 * particleScale;
    if (!this.smokePs.isStarted()) this.smokePs.start();

    this.light.position.copyFrom(origin.add(dir.scale(3)));
    this.flicker += 0.37;
    this.light.intensity = 2.4 + Math.sin(this.flicker) * 0.6 + Math.random() * 0.4;
    this.light.range = Math.max(40, range);
  }

  /** first point along the breath that dips below the terrain (coarse march) */
  private groundHit(origin: Vector3, dir: Vector3, range: number): Vector3 | null {
    if (!this.heightAt || dir.y > -0.05) return null;
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const p = origin.add(dir.scale((range * i) / steps));
      const gy = this.heightAt(p.x, p.z);
      if (p.y <= gy + 0.5) return new Vector3(p.x, gy + 0.3, p.z);
    }
    return null;
  }

  private setVisual(rate: number, particleScale: number): void {
    this.firePs.emitRate = rate * particleScale;
    this.corePs.emitRate = rate * 0.6 * particleScale;
    this.impactPs.emitRate = 0;
    this.emberPs.emitRate = rate * 0.4 * particleScale;
    this.smokePs.emitRate = rate * 0.15 * particleScale;
    if (rate === 0) {
      this.light.intensity = Math.max(0, this.light.intensity - 0.4);
      if (this.light.intensity < 0.12) {
        this.firePs.stop();
        this.corePs.stop();
        this.impactPs.stop();
        this.emberPs.stop();
        this.smokePs.stop();
      }
    }
  }

  dispose(): void {
    this.firePs.dispose();
    this.corePs.dispose();
    this.impactPs.dispose();
    this.emberPs.dispose();
    this.smokePs.dispose();
    this.light.dispose();
    void this.scene;
    void mitigateDamage;
  }
}
