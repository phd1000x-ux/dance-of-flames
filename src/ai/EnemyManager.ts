import { Color3, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { EnemyDefinition } from "../data/enemies";
import { ENEMIES } from "../data/enemies";
import type { DifficultyDef } from "../data/difficulty";
import type { WorldLayout } from "../world/WorldBuilder";
import { SoldierFactory } from "../world/SoldierFactory";
import type { Terrain } from "../world/Terrain";
import type { ProjectileSystem } from "../combat/ProjectileSystem";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import { SeededRng } from "../core/SeededRng";
import { angleDelta, clamp, damp } from "../core/MathUtils";

export type SoldierState =
  | "idle"
  | "patrol"
  | "alert"
  | "aim"
  | "attack"
  | "meleeWindup"
  | "flee"
  | "burning"
  | "dead";

export interface Soldier {
  id: number;
  def: EnemyDefinition;
  hp: number;
  maxHp: number;
  pos: Vector3;
  yaw: number;
  state: SoldierState;
  stateTime: number;
  cooldown: number;
  tier: 0 | 1 | 2;
  nextAiTick: number;
  aiInterval: number;
  burnTime: number;
  deathTime: number;
  bravery: number;
  staggered: number;
  root: TransformNode;
  mesh: import("@babylonjs/core").Mesh;
  material: StandardMaterial;
  homePos: Vector3;
  baseEmissive: Color3;
  walkPhase: number;
  moveTarget: Vector3 | null;
  isCommander: boolean;
  /** finale boss owns this soldier — generic AI skipped */
  puppeted?: boolean;
  scatterT?: number;
  scatterDir?: { x: number; z: number };
}

export interface BallistaEntity {
  id: number;
  def: EnemyDefinition;
  hp: number;
  maxHp: number;
  pos: Vector3;
  baseYaw: number;
  root: TransformNode;
  turret: TransformNode;
  railMat: StandardMaterial;
  state: "idle" | "aiming" | "telegraph" | "reload";
  cooldown: number;
  telegraphTime: number;
  dead: boolean;
}

export interface CombatContext {
  playerMode: "dragon" | "ground";
  dragonPos: Vector3;
  dragonSpeed: number;
  dragonForward: Vector3;
  dragonAltitude: number;
  riderPos: Vector3 | null;
  riderFwd: Vector3 | null;
  riderInvulnerable: boolean;
  time: number;
}

let nextId = 1;

/** Exact low-arc ballistic launch direction from origin to target at given speed. */
export function ballisticDir(origin: Vector3, target: Vector3, speed: number, gravity = 9.8): Vector3 {
  const delta = target.subtract(origin);
  const h = delta.y;
  const d = Math.hypot(delta.x, delta.z);
  if (d < 0.001) return new Vector3(0, d === 0 ? 1 : delta.y, 0).normalize();
  const v2 = speed * speed;
  const root = v2 * v2 - gravity * (gravity * d * d + 2 * h * v2);
  const dirH = new Vector3(delta.x, 0, delta.z).normalize();
  if (root < 0) {
    // out of range: max-range 45° arc toward target
    return new Vector3(dirH.x * Math.SQRT1_2, Math.SQRT1_2, dirH.z * Math.SQRT1_2);
  }
  const elev = Math.atan((v2 - Math.sqrt(root)) / (gravity * d));
  const cos = Math.cos(elev);
  return new Vector3(dirH.x * cos, Math.sin(elev), dirH.z * cos);
}

/**
 * Enemy soldiers + siege ballistae with LOD-tiered AI scheduling.
 * Tier A (≤24 nearest): full per-frame AI. Tier B: 4 Hz. Tier C: 1 Hz visual sim.
 */
export class EnemyManager {
  soldiers: Soldier[] = [];
  ballistae: BallistaEntity[] = [];
  private rng: SeededRng;
  private tierTimer = 0;
  private factory: SoldierFactory;
  onSoldierDeath: ((s: Soldier, byFire: boolean) => void) | null = null;
  onBallistaDeath: ((b: BallistaEntity, byFire: boolean) => void) | null = null;
  onMeleeHitRider: ((damage: number, fromX: number, fromZ: number) => void) | null = null;

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    private projectiles: ProjectileSystem,
    private bus: EventBus<GameEvents>,
    private difficulty: DifficultyDef,
    seed: number
  ) {
    this.rng = new SeededRng(seed * 31 + 7);
    this.factory = new SoldierFactory(scene);
  }

  spawnFromLayout(layout: WorldLayout): void {
    for (const squad of layout.squads) {
      for (let i = 0; i < squad.count; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(squad.radius * 0.2, squad.radius);
        const x = squad.center.x + Math.cos(a) * r;
        const z = squad.center.z + Math.sin(a) * r;
        this.spawnSoldier(squad.type, new Vector3(x, 0, z));
      }
    }
    for (const b of layout.ballistae) {
      this.spawnBallista(b.pos, b.yaw);
    }
    if (layout.commanderPos) {
      this.spawnSoldier("commander", layout.commanderPos);
    }
  }

  spawnSoldier(typeId: string, pos: Vector3): Soldier {
    const def = ENEMIES[typeId] ?? ENEMIES.swordsman;
    const { root, mesh } = this.factory.createSoldier(def);
    const s: Soldier = {
      id: nextId++,
      def,
      hp: def.hp * this.difficulty.enemyDamage > 0 ? def.hp : def.hp,
      maxHp: def.hp,
      pos: new Vector3(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z),
      yaw: this.rng.range(0, Math.PI * 2),
      state: "patrol",
      stateTime: 0,
      cooldown: this.rng.range(0, 2),
      tier: 2,
      nextAiTick: 0,
      aiInterval: 1,
      burnTime: 0,
      deathTime: 0,
      bravery: def.role === "elite" || def.role === "commander" ? 1 : this.rng.range(0.15, 0.8),
      staggered: 0,
      root,
      mesh,
      material: mesh.material as StandardMaterial,
      homePos: new Vector3(pos.x, 0, pos.z),
      baseEmissive: (mesh.material as StandardMaterial).emissiveColor.clone(),
      walkPhase: this.rng.range(0, Math.PI * 2),
      moveTarget: null,
      isCommander: def.role === "commander",
    };
    root.position.copyFrom(s.pos);
    this.soldiers.push(s);
    return s;
  }

  spawnBallista(pos: Vector3, yaw: number): BallistaEntity {
    const def = ENEMIES.ballista;
    const { root, turret, railGlow } = this.factory.createBallista(def);
    const b: BallistaEntity = {
      id: nextId++,
      def,
      hp: def.hp,
      maxHp: def.hp,
      pos: new Vector3(pos.x, this.terrain.heightAt(pos.x, pos.z), pos.z),
      baseYaw: yaw,
      root,
      turret,
      railMat: railGlow,
      state: "reload",
      cooldown: this.rng.range(2, 5),
      telegraphTime: 0,
      dead: false,
    };
    root.position.copyFrom(b.pos);
    root.rotation.y = yaw;
    this.ballistae.push(b);
    return b;
  }

  aliveSoldierCount(): number {
    return this.soldiers.filter((s) => s.state !== "dead").length;
  }

  // ---------------- fire breath cone query ----------------
  applyFireDamage(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): number {
    let hits = 0;
    const cosCone = Math.cos(halfAngle + 0.06);
    for (const s of this.soldiers) {
      if (s.state === "dead") continue;
      const v = s.pos.add(new Vector3(0, 1.2, 0)).subtract(origin);
      const dist = v.length();
      if (dist > range + 2) continue;
      const cosA = Vector3.Dot(v.scale(1 / Math.max(0.001, dist)), dir);
      if (cosA > cosCone || dist < 6) {
        const falloff = 1 - 0.35 * (dist / range);
        this.damageSoldier(s, dps * Math.max(0.4, falloff) * dt, true);
        if ((s.state as SoldierState) !== "dead" && this.rng.chance(dt * 1.4)) {
          s.burnTime = Math.max(s.burnTime, 2.6);
          s.state = "burning";
          s.stateTime = 0;
          this.factory.setSoldierState(s.mesh, "burning");
        }
        hits++;
      }
    }
    for (const b of this.ballistae) {
      if (b.dead) continue;
      const v = b.pos.add(new Vector3(0, 1.2, 0)).subtract(origin);
      const dist = v.length();
      if (dist > range + 3) continue;
      const cosA = Vector3.Dot(v.scale(1 / Math.max(0.001, dist)), dir);
      if (cosA > cosCone) {
        this.damageBallista(b, dps * dt, true);
        hits++;
      }
    }
    return hits;
  }

  damageSoldier(s: Soldier, amount: number, byFire: boolean): void {
    if (s.state === "dead") return;
    s.hp -= amount;
    // hit flash
    s.material.emissiveColor = new Color3(0.8, 0.2, 0.1);
    if (s.hp <= 0) this.killSoldier(s, byFire);
  }

  private killSoldier(s: Soldier, byFire: boolean): void {
    s.state = "dead";
    s.stateTime = 0;
    this.factory.setSoldierState(s.mesh, "dead");
    this.onSoldierDeath?.(s, byFire);
    this.bus.emit("enemy-killed", { type: s.def.id, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z }, byFire });
  }

  damageBallista(b: BallistaEntity, amount: number, byFire: boolean): void {
    if (b.dead) return;
    b.hp -= amount;
    b.railMat.emissiveColor = new Color3(0.6, 0.2, 0);
    if (b.hp <= 0) {
      b.dead = true;
      b.state = "reload";
      b.root.setEnabled(false);
      this.onBallistaDeath?.(b, byFire);
      this.bus.emit("enemy-killed", { type: "ballista", pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, byFire });
    }
  }

  // ---------------- rider melee query ----------------
  applyMeleeHit(origin: Vector3, fwd: Vector3, range: number, arcCos: number, damage: number, heavy: boolean): { hit: boolean; blocked: boolean } {
    let hit = false;
    let blocked = false;
    for (const s of this.soldiers) {
      if (s.state === "dead") continue;
      const v = s.pos.subtract(origin);
      v.y = 0;
      const dist = v.length();
      if (dist > range + 0.6) continue;
      const cosA = Vector3.Dot(v.scale(1 / Math.max(0.001, dist)), fwd);
      if (cosA < arcCos) continue;
      // shield soldiers block frontal light attacks
      if (s.def.role === "shield" && !heavy) {
        const sFwd = new Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        if (Vector3.Dot(sFwd, v.scale(-1 / dist)) > 0.35) {
          blocked = true;
          continue;
        }
      }
      hit = true;
      this.damageSoldier(s, damage, false);
      if ((s.state as SoldierState) !== "dead") {
        // knockback + stagger for lighter enemies that survived
        const kb = heavy ? 2.4 : 1.2;
        s.pos.addInPlace(v.scale(-kb / Math.max(1, dist)));
        if (s.def.role !== "elite" && s.def.role !== "commander") {
          s.state = "idle";
          s.cooldown = Math.max(s.cooldown, 0.5);
        }
      }
    }
    return { hit, blocked };
  }

  getGroundEnemies() {
    return this.soldiers.filter((s) => s.state !== "dead");
  }

  /** tower/wall collapse: knock down nearby soldiers, destroy nearby ballistae */
  applyCollapseImpact(pos: Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const s of this.soldiers) {
      if (s.state === "dead") continue;
      const dx = s.pos.x - pos.x;
      const dz = s.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const isLeader = s.def.role === "elite" || s.def.role === "commander" || s.puppeted;
      if (isLeader) {
        s.staggered = Math.max(s.staggered, 1.0);
        continue;
      }
      s.staggered = Math.max(s.staggered, 1.2);
      s.hp -= 12;
      const d = Math.max(0.001, Math.sqrt(d2));
      s.scatterT = 1.6;
      s.scatterDir = { x: dx / d, z: dz / d };
      s.state = "alert";
      s.stateTime = 0;
      if (s.hp <= 0) this.killSoldier(s, true);
    }
    for (const b of this.ballistae) {
      if (b.dead) continue;
      const dx = b.pos.x - pos.x;
      const dz = b.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2) this.damageBallista(b, b.hp + 1, true);
    }
  }

  /** Hand the commander to the finale boss (generic AI skipped until released). */
  claimCommander(): Soldier | null {
    const c = this.soldiers.find((s) => s.def.role === "commander" && s.state !== "dead");
    if (c) c.puppeted = true;
    return c ?? null;
  }

  releaseCommander(): void {
    for (const s of this.soldiers) s.puppeted = false;
  }

  // ---------------- main update ----------------
  update(dt: number, ctx: CombatContext): void {
    this.tierTimer += dt;
    if (this.tierTimer > 0.5) {
      this.tierTimer = 0;
      this.reassignTiers(ctx);
    }
    const now = ctx.time;
    for (const s of this.soldiers) {
      if (s.state === "dead") {
        this.updateDead(s, dt);
        continue;
      }
      if (s.puppeted) {
        s.root.position.copyFrom(s.pos);
        s.root.rotation.y = damp(s.root.rotation.y, s.yaw, 12, dt);
        continue;
      }
      // burning dot
      if (s.burnTime > 0) {
        s.burnTime -= dt;
        this.damageSoldier(s, 9 * dt, true);
        if ((s.state as SoldierState) === "dead") continue;
      }
      if (s.scatterT && s.scatterT > 0) {
        s.scatterT -= dt;
        const sp = 8;
        s.pos.x += (s.scatterDir?.x ?? 0) * sp * dt;
        s.pos.z += (s.scatterDir?.z ?? 0) * sp * dt;
        s.pos.y = this.terrain.heightAt(s.pos.x, s.pos.z);
        s.yaw = Math.atan2(s.scatterDir?.x ?? 0, s.scatterDir?.z ?? 0);
        s.root.position.copyFrom(s.pos);
        s.root.rotation.y = s.yaw;
        s.walkPhase += dt * 14;
        continue;
      }
      if (now >= s.nextAiTick) {
        s.aiInterval = s.tier === 0 ? 0 : s.tier === 1 ? 0.25 : 1.0;
        s.nextAiTick = now + s.aiInterval;
        this.updateSoldierAI(s, s.aiInterval === 0 ? dt : s.aiInterval, ctx);
      }
      // smooth facing & walk bob every frame for tier A
      if (s.tier === 0 && (s.state as SoldierState) !== "dead") {
        s.root.position.copyFrom(s.pos);
        s.root.rotation.y = damp(s.root.rotation.y, s.yaw, 12, dt);
        s.walkPhase += dt * 8;
      }
      // emissive flash decay
      if (!s.material.emissiveColor.equals(s.baseEmissive)) {
        s.material.emissiveColor = Color3.Lerp(s.material.emissiveColor, s.baseEmissive, Math.min(1, dt * 8));
      }
    }
    for (const b of this.ballistae) {
      if (!b.dead) this.updateBallista(b, dt, ctx);
      else if (b.railMat.emissiveColor.r > 0.01) {
        b.railMat.emissiveColor = Color3.Lerp(b.railMat.emissiveColor, Color3.Black(), Math.min(1, dt * 8));
      }
    }
  }

  private updateDead(s: Soldier, dt: number): void {
    s.stateTime += dt;
    // fall over
    const fall = Math.min(1, s.stateTime / 0.4);
    s.mesh.rotation.x = (fall * Math.PI) / 2;
    if (s.stateTime > 5) {
      const sink = Math.min(1, (s.stateTime - 5) / 1.5);
      s.root.position.y = s.pos.y - sink * 2.2;
      if (sink >= 1) s.root.setEnabled(false);
    }
  }

  private reassignTiers(ctx: CombatContext): void {
    const targetPos = ctx.playerMode === "dragon" ? ctx.dragonPos : ctx.riderPos ?? ctx.dragonPos;
    const withDist = this.soldiers
      .filter((s) => s.state !== "dead")
      .map((s) => ({ s, d: Vector3.Distance(s.pos, targetPos) }))
      .sort((a, b) => a.d - b.d);
    let aCount = 0;
    for (let i = 0; i < withDist.length; i++) {
      const { s, d } = withDist[i];
      if (d < 90 && aCount < 24) {
        s.tier = 0;
        aCount++;
      } else if (d < 200) {
        s.tier = 1;
      } else {
        s.tier = 2;
      }
    }
  }

  private updateSoldierAI(s: Soldier, dt: number, ctx: CombatContext): void {
    s.stateTime += dt;
    s.cooldown -= dt;
    const targetPos = ctx.playerMode === "dragon" ? ctx.dragonPos : ctx.riderPos;
    if (!targetPos) {
      s.state = "patrol";
      return;
    }
    const toTarget = targetPos.subtract(s.pos);
    toTarget.y = 0;
    const dist = toTarget.length();
    const altDelta = ctx.playerMode === "dragon" ? targetPos.y - s.pos.y : 0;
    const targetYaw = Math.atan2(toTarget.x, toTarget.z);
    const faceTarget = () => {
      s.yaw += angleDelta(s.yaw, targetYaw) * Math.min(1, dt * 6);
    };

    // burning soldiers run wildly
    if (s.state === "burning") {
      if (s.stateTime < 1.6) {
        s.yaw += dt * 10 * (s.id % 2 === 0 ? 1 : -1);
        this.moveForward(s, s.def.moveSpeed * 1.6, dt);
      } else {
        this.killSoldier(s, true);
      }
      return;
    }

    // dragon panic reactions
    if (ctx.playerMode === "dragon") {
      const dragonFast = ctx.dragonSpeed > 26;
      const dragonLow = ctx.dragonAltitude < 26;
      if (dragonLow && dragonFast && dist < 42 && s.state !== "flee" && s.stateTime > 1) {
        if (this.rng.chance(dt * 2.2 * (1 - s.bravery))) {
          s.state = "flee";
          s.stateTime = 0;
        }
      }
      if (s.state === "flee") {
        s.yaw = targetYaw + Math.PI;
        this.moveForward(s, s.def.moveSpeed * 1.5, dt);
        if (s.stateTime > 3.2) {
          s.state = "alert";
          s.stateTime = 0;
        }
        return;
      }
    }

    switch (s.def.role) {
      case "archer": {
        faceTarget();
        if (ctx.playerMode === "ground") {
          // archers shoot at rider from range, flee when close
          if (dist < 14) {
            s.yaw = targetYaw + Math.PI;
            this.moveForward(s, s.def.moveSpeed, dt);
            return;
          }
          if (dist < 46 && s.cooldown <= 0) {
            s.cooldown = s.def.attackCooldown / this.difficulty.aggression;
            this.fireArrow(s, targetPos.add(new Vector3(0, 1, 0)), s.def.damage, 0.12);
          }
          return;
        }
        // vs dragon: volleys when in range (with velocity lead)
        if (dist < s.def.range && altDelta > 4 && s.cooldown <= 0 && s.tier < 2) {
          s.state = "aim";
          s.cooldown = s.def.attackCooldown / this.difficulty.aggression;
          const flightT = dist / 40;
          const lead = ctx.dragonForward.scale(ctx.dragonSpeed * flightT * 0.7);
          const aimError = (1 - this.difficulty.enemyAccuracy) * 14;
          const aimPoint = targetPos
            .add(lead)
            .add(new Vector3((Math.random() - 0.5) * aimError, (Math.random() - 0.5) * aimError * 0.6 + 2, (Math.random() - 0.5) * aimError));
          this.fireArrow(s, aimPoint, s.def.damage, 0.05);
        } else {
          s.state = "alert";
        }
        break;
      }
      case "spear": {
        faceTarget();
        if (ctx.playerMode === "dragon") {
          if (altDelta < 16 && dist < 34 && s.cooldown <= 0) {
            s.cooldown = s.def.attackCooldown * 1.4 / this.difficulty.aggression;
            const origin = s.pos.add(new Vector3(0, 1.6, 0));
            const dir = ballisticDir(origin, targetPos, 26);
            this.projectiles.spawn("spear", origin, dir, 26, s.def.damage, 0.08);
          }
        } else {
          this.meleeBehavior(s, dt, dist, targetYaw, ctx);
        }
        break;
      }
      case "shield":
      case "infantry": {
        if (ctx.playerMode === "dragon") {
          if (dist < 30) {
            s.state = "alert";
            faceTarget();
          } else {
            this.patrolBehavior(s, dt);
          }
        } else {
          this.meleeBehavior(s, dt, dist, targetYaw, ctx);
        }
        break;
      }
      case "elite":
      case "commander": {
        if (ctx.playerMode === "dragon") {
          faceTarget();
          if (altDelta < 22 && dist < 44 && s.cooldown <= 0) {
            s.cooldown = 2.6 / this.difficulty.aggression;
            const origin = s.pos.add(new Vector3(0, 1.8, 0));
            const dir = ballisticDir(origin, targetPos, 30);
            this.projectiles.spawn("spear", origin, dir, 30, s.def.damage * 0.7, 0.05);
          }
        } else {
          this.meleeBehavior(s, dt, dist, targetYaw, ctx);
        }
        break;
      }
      default:
        this.patrolBehavior(s, dt);
    }
  }

  private meleeBehavior(s: Soldier, dt: number, dist: number, targetYaw: number, ctx: CombatContext): void {
    if (!ctx.riderPos) return;
    // approach + telegraphed melee
    s.yaw += angleDelta(s.yaw, targetYaw) * Math.min(1, dt * 7);
    if (dist > s.def.range + 0.6) {
      s.state = "attack";
      this.moveForward(s, s.def.moveSpeed * (this.difficulty.aggression * 0.85 + 0.3), dt);
    } else {
      if (s.state !== "meleeWindup" && s.cooldown <= 0) {
        s.state = "meleeWindup";
        s.stateTime = 0;
        // telegraph: red tint
        s.material.emissiveColor = new Color3(0.7, 0.1, 0.05);
      }
      if (s.state === "meleeWindup") {
        const windup = s.def.role === "elite" || s.def.role === "commander" ? 0.8 : 0.55;
        if (s.stateTime >= windup) {
          s.state = "attack";
          s.stateTime = 0;
          s.cooldown = s.def.attackCooldown / this.difficulty.aggression;
          const fromDir = Vector3.Normalize(ctx.riderPos.subtract(s.pos));
          if (dist < s.def.range + 1.2) {
            this.onMeleeHitRider?.(s.def.damage * this.difficulty.enemyDamage, fromDir.x, fromDir.z);
          }
        }
      }
    }
  }

  private patrolBehavior(s: Soldier, dt: number): void {
    s.state = "patrol";
    if (!s.moveTarget || Vector3.Distance(s.pos, s.moveTarget) < 3) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(4, 18);
      s.moveTarget = s.homePos.add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const v = s.moveTarget.subtract(s.pos);
    v.y = 0;
    const d = v.length();
    if (d > 0.5) {
      s.yaw += angleDelta(s.yaw, Math.atan2(v.x, v.z)) * Math.min(1, dt * 4);
      this.moveForward(s, s.def.moveSpeed * 0.45, dt);
    }
  }

  private moveForward(s: Soldier, speed: number, dt: number): void {
    const fwd = new Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    s.pos.addInPlace(fwd.scale(speed * dt));
    s.pos.y = this.terrain.heightAt(s.pos.x, s.pos.z);
    s.root.position.copyFrom(s.pos);
    s.root.rotation.y = s.yaw;
    s.walkPhase += speed * dt * 2.2;
  }

  private fireArrow(s: Soldier, targetPos: Vector3, damage: number, spread: number): void {
    const origin = s.pos.add(new Vector3(0, 1.5, 0));
    const dir = ballisticDir(origin, targetPos, 40);
    this.projectiles.spawn("arrow", origin, dir, 40, damage * this.difficulty.enemyDamage, spread);
  }

  private updateBallista(b: BallistaEntity, dt: number, ctx: CombatContext): void {
    if (ctx.playerMode !== "dragon") {
      // ballistae slowly track grounded rider too (dangerous), but at reduced rate
    }
    const target = ctx.playerMode === "dragon" ? ctx.dragonPos : ctx.riderPos;
    if (!target) return;
    const toT = target.subtract(b.pos.add(new Vector3(0, 1.4, 0)));
    const dist = toT.length();
    if (dist > b.def.range) {
      b.state = "idle";
      b.turret.rotation.y = damp(b.turret.rotation.y, 0, 2, dt);
      return;
    }
    // aim turret
    const desiredYaw = Math.atan2(toT.x, toT.z);
    b.turret.rotation.y = damp(b.turret.rotation.y, angleDelta(b.turret.rotation.y, desiredYaw) + b.turret.rotation.y, 1.6, dt);
    const desiredPitch = clamp(Math.atan2(toT.y, Math.hypot(toT.x, toT.z)), -0.2, 1.2);
    b.turret.rotation.x = damp(b.turret.rotation.x, -desiredPitch, 1.6, dt);

    b.cooldown -= dt;
    const aimOk = Math.abs(angleDelta(b.turret.rotation.y, desiredYaw)) < 0.15;
    if (b.cooldown <= 1.2 && b.state !== "telegraph") {
      b.state = "telegraph";
      this.bus.emit("sfx", { name: "ballistaTelegraph" });
    }
    // telegraph glow
    const glow = clamp(1 - b.cooldown / 1.2, 0, 1);
    if (b.cooldown > 0 && b.cooldown < 1.2) {
      b.railMat.emissiveColor = new Color3(glow * 0.9, glow * 0.35, 0);
    }
    if (b.cooldown <= 0 && aimOk && dist < b.def.range) {
      b.cooldown = b.def.attackCooldown / this.difficulty.aggression;
      b.state = "reload";
      b.railMat.emissiveColor = Color3.Black();
      const origin = b.pos.add(new Vector3(0, 1.9, 0));
      // lead the flying target using its velocity
      const flightT = dist / 95;
      const lead = ctx.playerMode === "dragon"
        ? ctx.dragonForward.scale(ctx.dragonSpeed * flightT * 0.85)
        : new Vector3(0, 0, 0);
      const dir = ballisticDir(origin, target.add(lead), 95);
      this.projectiles.spawn("bolt", origin, dir, 95, b.def.damage * this.difficulty.enemyDamage, 0.02);
      this.bus.emit("sfx", { name: "ballistaFire" });
    }
  }

  disposeAll(): void {
    for (const s of this.soldiers) s.root.dispose(false, true);
    for (const b of this.ballistae) b.root.dispose(false, true);
    this.soldiers = [];
    this.ballistae = [];
    void this.scene;
  }
}
