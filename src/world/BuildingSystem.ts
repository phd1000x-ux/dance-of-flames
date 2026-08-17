import { Color3, Scene, Vector3 } from "@babylonjs/core";
import type { WorldLayout } from "../world/WorldBuilder";
import { BuildingFactory, BUILDING_SPECS, type BuildingKind } from "../world/BuildingFactory";
import type { SeededRng } from "../core/SeededRng";
import type { Terrain } from "../world/Terrain";
import type { EffectsLibrary } from "../world/EffectsLibrary";
import type { ShadowGenerator } from "@babylonjs/core";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { ParticleSystem } from "@babylonjs/core";
import { DAMAGE_VISUALS, damageStateFor, type DamageState } from "./DamageStates";

export interface BuildingEntity {
  id: number;
  kind: BuildingKind;
  tag: string;
  hp: number;
  maxHp: number;
  pos: Vector3;
  size: { w: number; h: number; d: number };
  collapsed: boolean;
  relicId?: string;
  mesh: import("@babylonjs/core").Mesh;
  rubble: import("@babylonjs/core").Mesh;
  material: import("@babylonjs/core").StandardMaterial;
  root: import("@babylonjs/core").TransformNode;
  burnAccum: number;
  firePs: ParticleSystem | null;
  smokePs: ParticleSystem | null;
  visualState: DamageState;
  baseDiffuse: Color3;
  breachHintShown: boolean;
}

let buildingId = 1;

/** State-based destructible buildings: INTACT → DAMAGED → BURNING → COLLAPSED. */
export class BuildingSystem {
  buildings: BuildingEntity[] = [];
  onDestroyed: ((b: BuildingEntity) => void) | null = null;
  onRelicReveal: ((b: BuildingEntity) => void) | null = null;
  onShakeRequest: ((pos: Vector3, strength: number) => void) | null = null;

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    private effects: EffectsLibrary,
    private bus: EventBus<GameEvents>,
    private rng: SeededRng,
    private shadows: ShadowGenerator | null
  ) {
    void scene;
  }

  spawnFromLayout(layout: WorldLayout): void {
    const factory = new BuildingFactory(this.scene, this.rng);
    for (const b of layout.buildings) {
      const built = factory.create(b.kind, undefined, b.variant);
      built.root.position.set(b.pos.x, b.pos.y + built.size.h / 2 - 0.4, b.pos.z);
      built.root.rotation.y = b.rotY;
      this.shadows?.addShadowCaster(built.mesh);
      built.mesh.receiveShadows = true;
      const entity: BuildingEntity = {
        id: buildingId++,
        kind: b.kind,
        tag: b.tag,
        hp: BUILDING_SPECS[b.kind].hp,
        maxHp: BUILDING_SPECS[b.kind].hp,
        pos: new Vector3(b.pos.x, b.pos.y + built.size.h / 2, b.pos.z),
        size: built.size,
        collapsed: false,
        relicId: b.relicId,
        mesh: built.mesh,
        rubble: built.rubble,
        material: built.material,
        root: built.root,
        burnAccum: 0,
        firePs: null,
        smokePs: null,
        visualState: "INTACT",
        baseDiffuse: built.material.diffuseColor.clone(),
        breachHintShown: false,
      };
      this.buildings.push(entity);
      if (b.hpFraction !== undefined) {
        entity.hp = entity.maxHp * b.hpFraction;
        this.refreshDamageVisuals(entity);
      }
    }
  }

  applyFireDamage(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    const cosCone = Math.cos(halfAngle + 0.12);
    for (const b of this.buildings) {
      if (b.collapsed) continue;
      const radius = Math.max(b.size.w, b.size.d) * 0.55;
      const v = b.pos.subtract(origin);
      const dist = v.length() - radius;
      if (dist > range) continue;
      const cosA = Vector3.Dot(v.scale(1 / Math.max(0.001, v.length())), dir);
      if (cosA > cosCone || v.length() < radius + 6) {
        const falloff = 1 - 0.3 * (Math.max(0, dist) / range);
        b.hp -= dps * Math.max(0.5, falloff) * dt * 1.4; // fire is effective vs buildings
        b.burnAccum += dt;
        this.refreshDamageVisuals(b);
        if (b.hp <= 0) this.collapse(b);
      }
    }
  }

  damageBuilding(b: BuildingEntity, amount: number): void {
    if (b.collapsed) return;
    b.hp -= amount;
    this.refreshDamageVisuals(b);
    if (b.hp <= 0) this.collapse(b);
  }

  refreshDamageVisuals(b: BuildingEntity): void {
    if (b.collapsed) return;
    const state = damageStateFor(Math.max(0, b.hp) / b.maxHp);
    if (state === b.visualState) return;
    b.visualState = state;
    const v = DAMAGE_VISUALS[state];
    b.material.diffuseColor = b.baseDiffuse.scale(v.diffuseScale);
    b.material.emissiveColor = new Color3(v.ember[0], v.ember[1], v.ember[2]);
    if (v.fireRate > 0 && !b.firePs) this.attachFire(b);
    if (b.firePs) b.firePs.emitRate = v.fireRate;
    if (b.smokePs) b.smokePs.emitRate = v.smokeRate;
    if (b.tag === "gatehouse" && state === "CRITICAL" && !b.breachHintShown) {
      b.breachHintShown = true;
      this.bus.emit("hud-hint", { text: "BREACH THE GATE" });
      this.bus.emit("sfx", { name: "objective" });
    }
  }

  private attachFire(b: BuildingEntity): void {
    b.firePs = this.effects.createFireStream(`bfire${b.id}`, "#ff8a3c");
    (b.firePs.emitter as Vector3).copyFrom(b.pos);
    b.firePs.minEmitPower = 2;
    b.firePs.maxEmitPower = 5;
    b.firePs.gravity.set(0, 6, 0);
    b.firePs.start();
    b.smokePs = this.effects.createSmokeColumn(`bsmoke${b.id}`);
    (b.smokePs.emitter as Vector3).set(b.pos.x, b.pos.y + b.size.h * 0.5, b.pos.z);
    b.smokePs.start();
  }

  private collapse(b: BuildingEntity): void {
    if (b.collapsed) return;
    b.collapsed = true;
    b.visualState = "DESTROYED";
    b.mesh.isVisible = false;
    b.rubble.isVisible = true;
    b.rubble.position.y = -b.size.h / 2 + 0.4;
    const isGate = b.tag === "gatehouse";
    if (isGate) b.rubble.position.z -= b.size.d * 0.25;
    this.effects.dust(b.pos.subtract(new Vector3(0, b.size.h / 2, 0)), Math.max(1, b.size.w / 8) * (isGate ? 2 : 1));
    this.effects.explosion(b.pos, Math.max(1, b.size.w / 7) * (isGate ? 1.8 : 1));
    this.bus.emit("sfx", { name: "buildingCollapse" });
    this.onShakeRequest?.(b.pos, Math.min(isGate ? 1.2 : 1.0, b.size.w / 12));
    if (b.firePs) {
      b.firePs.emitRate = 30;
    }
    if (b.smokePs) {
      b.smokePs.emitRate = 26;
    }
    if (b.relicId) {
      this.onRelicReveal?.(b);
    }
    this.onDestroyed?.(b);
    this.bus.emit("building-destroyed", { tag: b.tag, pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z } });
  }

  update(dt: number): void {
    void dt;
    // burning visuals are self-sustaining; collapsed buildings keep smoke briefly then fade
    for (const b of this.buildings) {
      if (b.collapsed) {
        if (b.smokePs && b.smokePs.emitRate > 4) {
          b.smokePs.emitRate = Math.max(4, b.smokePs.emitRate - dt * 2);
          if (b.firePs) b.firePs.emitRate = Math.max(0, b.firePs.emitRate - dt * 3);
        }
      }
    }
  }

  /** simple AABB pushout for rider collision vs intact buildings */
  collideRider(pos: Vector3, radius: number): Vector3 {
    for (const b of this.buildings) {
      if (b.collapsed) continue;
      const dx = pos.x - b.pos.x;
      const dz = pos.z - b.pos.z;
      const hx = b.size.w / 2 + radius;
      const hz = b.size.d / 2 + radius;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        // push out along smaller penetration axis
        const px = hx - Math.abs(dx);
        const pz = hz - Math.abs(dz);
        if (px < pz) pos.x = b.pos.x + Math.sign(dx || 1) * hx;
        else pos.z = b.pos.z + Math.sign(dz || 1) * hz;
      }
    }
    return pos;
  }

  /** nearest intact building positions for minimap/threat overlay */
  intactBuildings(): BuildingEntity[] {
    return this.buildings.filter((b) => !b.collapsed);
  }

  disposeAll(): void {
    for (const b of this.buildings) {
      b.firePs?.dispose();
      b.smokePs?.dispose();
      b.root.dispose(false, true);
      b.material.dispose();
    }
    this.buildings = [];
  }
}
