import { Color3, PointLight, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EffectsLibrary } from "../../world/EffectsLibrary";
import { DragonRig } from "../../world/DragonRig";
import { VHARAX } from "../../data/wardragon";
import { FlameSweepSM, advanceWaypoint, rubberBandFactor, type PathPoint } from "./BossAI";
import { selectPattern, RETURN_HP, type AirPattern } from "./FinalePatterns";

const CHASE_PATH: (PathPoint & { y: number })[] = [
  { x: 0, z: -60, y: 75 },    // keep
  { x: 0, z: -95, y: 90 },    // spire (Task 13 landmark)
  { x: -170, z: 0, y: 80 },   // west wall sweep
  { x: 0, z: 160, y: 70 },    // over the gatehouse
  { x: 60, z: 330, y: 95 },   // outer cliff
  { x: 240, z: 420, y: 120 }, // open sky
];

const RNG = { range: (a: number, b: number) => a + Math.random() * (b - a) };

export type WarDragonState =
  | "CHASE"
  | "ORBIT"
  | "TELEGRAPH"
  | "ATTACK"
  | "RECOVERY"
  | "POSITIONING"
  | "CHARGE_TEL"
  | "CHARGING"
  | "CLIMB"
  | "DIVE_TEL"
  | "DIVING"
  | "STAGGERED"
  | "FLEEING"
  | "GONE";

export class WarDragon {
  readonly rig: DragonRig;
  readonly maxHp = VHARAX.maxHealth;
  /** staged-finale HP floor — the FINAL_STAGGER/crash threshold (owned by BlackstoneFinale) */
  readonly floor = VHARAX.maxHealth * 0.1;
  hp = VHARAX.maxHealth;
  pos = new Vector3(0, 60, -95);
  yaw = 0;
  roll = 0;
  speed = 40;
  chasePathIndex = 0;
  onSweepHitPlayer: ((dps: number, dt: number) => void) | null = null;
  onChargeNearMiss: ((dist: number) => void) | null = null;
  /** fired ONCE when hp first drops to the RETURN threshold (0.25×max) — finale owns the phase switch */
  onHpFloor: (() => void) | null = null;
  pendingPattern: AirPattern | null = null;
  private state_: WarDragonState = "CHASE";
  private sm = new FlameSweepSM({ telegraph: 1.1, attack: 1.4, recovery: 2.2 });
  private sweepCooldown = 2;
  private orbitAngle = 0;
  private fleeT = 0;
  private pattern: AirPattern = "sweep";
  private patternT = 0;
  private patternRecoveryT = 0;
  private chargeDir = new Vector3();
  private minApproach = Infinity;
  private patternTarget = new Vector3();
  private lastPlayerPos = new Vector3();
  private hpFloorFired = false;
  private returnMode = false;
  private restrictPatterns = false;
  private staggerCenter = new Vector3();
  private staggerAngle = 0;
  private fireLight: PointLight;
  private readonly tmp = new Vector3();

  constructor(private scene: Scene, private effects: EffectsLibrary, private bus: GameEventBus) {
    this.rig = new DragonRig(scene, VHARAX);
    this.rig.setRiderVisible(false); // wild war dragon — no phantom default rider
    this.rig.root.setEnabled(false);
    this.fireLight = new PointLight("vharax-fire", new Vector3(0, 0, 0), scene);
    this.fireLight.diffuse = new Color3(1, 0.45, 0.15);
    this.fireLight.intensity = 0;
    this.fireLight.range = 90;
  }

  get state(): WarDragonState {
    return this.state_;
  }

  get patternState(): string {
    return this.state_;
  }

  startChase(firstPos: Vector3): void {
    this.pos.copyFrom(firstPos);
    this.rig.root.setEnabled(true);
    this.rig.root.position.copyFrom(this.pos);
    this.state_ = "CHASE";
    this.returnMode = false;
    this.restrictPatterns = false;
  }

  startDuel(): void {
    this.state_ = "ORBIT";
    this.sweepCooldown = 2.5;
    this.returnMode = false;
    this.restrictPatterns = false;
  }

  /** staged finale: retreat to a castle-top ring at reduced speed; dive/sweep patterns only */
  startReturn(): void {
    this.state_ = "ORBIT";
    this.sweepCooldown = 2.5;
    this.returnMode = true;
    this.restrictPatterns = true;
    this.pendingPattern = null;
    this.patternRecoveryT = 0;
    this.sm.reset();
  }

  /** staged finale: near-hover wobble around the spire top — the finishing-blow window */
  startStagger(spireTop: Vector3): void {
    this.state_ = "STAGGERED";
    this.returnMode = false;
    this.pendingPattern = null;
    this.patternRecoveryT = 0;
    this.patternT = 0;
    this.staggerCenter.copyFrom(spireTop);
    this.staggerCenter.y += 10;
    this.staggerAngle = Math.atan2(this.pos.x - spireTop.x, this.pos.z - spireTop.z);
    this.sm.reset();
  }

  flee(): void {
    if (this.state_ === "GONE") return;
    this.state_ = "FLEEING";
    this.fleeT = 0;
    this.pendingPattern = null;
    this.patternRecoveryT = 0;
    this.returnMode = false;
    this.sm.reset();
  }

  private enterPatternRecovery(seconds: number): void {
    this.state_ = "RECOVERY";
    this.patternRecoveryT = seconds;
    this.patternT = 0;
  }

  private returnToOrbit(): void {
    this.state_ = "ORBIT";
    this.sweepCooldown = 3.2;
    this.pendingPattern = null;
  }

  update(dt: number, playerPos: Vector3, playerAlive: boolean, terrainHeight: number): void {
    if (this.state_ === "GONE") return;
    // staged-finale threshold: notify ONCE at the RETURN line — the
    // finale decides what happens; WarDragon no longer auto-resolves at a floor
    if (!this.hpFloorFired && this.hp <= this.maxHp * RETURN_HP) {
      this.hpFloorFired = true;
      this.onHpFloor?.();
    }

    let target: Vector3;
    let speed = 42;
    let directDir: Vector3 | null = null; // set by CHARGING/DIVING — bypasses steering entirely
    if (this.state_ === "CHASE") {
      const wp = CHASE_PATH[this.chasePathIndex];
      target = new Vector3(wp.x, wp.y, wp.z);
      this.chasePathIndex = advanceWaypoint(this.pos.x, this.pos.z, CHASE_PATH, this.chasePathIndex, 28);
      const dist = Vector3.Distance(this.pos, playerPos);
      speed *= 1 + rubberBandFactor(dist);
    } else if (this.state_ === "ORBIT") {
      this.orbitAngle += dt * 0.35;
      if (this.returnMode) {
        // staged finale: castle-top ring over the keep/spire band at reduced speed
        target = new Vector3(Math.cos(this.orbitAngle) * 95, 78, -60 + Math.sin(this.orbitAngle) * 95);
        speed = 30;
      } else {
        target = playerPos.add(new Vector3(Math.cos(this.orbitAngle) * 70, 18, Math.sin(this.orbitAngle) * 70));
        speed = 34;
      }
      this.sweepCooldown -= dt;
      const facing = Vector3.Dot(this.forward(), Vector3.Normalize(playerPos.subtract(this.pos)));
      if (this.sweepCooldown <= 0 && facing > 0.86 && Vector3.Distance(this.pos, playerPos) < 95) {
        this.pattern = selectPattern(this.hp / this.maxHp, this.pattern, RNG);
        // RETURN constrains patterns to dive/sweep — no charges back out of the citadel
        if (this.restrictPatterns && this.pattern === "charge") this.pattern = "dive";
        if (this.pattern === "sweep") {
          // defensive: a non-IDLE sm (stale mid-cycle) must not enter TELEGRAPH
          if (this.sm.start()) {
            this.state_ = "TELEGRAPH";
            this.bus.emit("sfx", { name: "inhale" });
          }
        } else {
          this.pendingPattern = this.pattern;
          this.patternT = 0;
          if (this.pattern === "charge") {
            // line up on the far side of the player, 130 m out along the current approach line
            this.patternTarget.copyFrom(playerPos).addInPlace(Vector3.Normalize(playerPos.subtract(this.pos)).scale(130));
            this.state_ = "POSITIONING";
          } else {
            this.patternTarget.copyFrom(playerPos).addInPlace(new Vector3(0, 34, 0));
            this.state_ = "CLIMB";
          }
        }
      }
    } else if (this.state_ === "POSITIONING") {
      this.patternT += dt;
      target = this.patternTarget;
      speed = 50;
      if (this.patternT > 2.5 || Vector3.Distance(this.pos, this.patternTarget) < 15) {
        this.state_ = "CHARGE_TEL";
        this.patternT = 0;
        this.bus.emit("sfx", { name: "deepRoar" });
      }
    } else if (this.state_ === "CHARGE_TEL") {
      this.patternT += dt;
      target = playerPos;
      speed = 18;
      if (this.patternT > 1.2) {
        this.state_ = "CHARGING";
        this.patternT = 0;
        // aim at a short-lead prediction of the player's position
        const vel = dt > 0 ? playerPos.subtract(this.lastPlayerPos).scale(1 / dt) : new Vector3();
        if (vel.length() > 80) vel.normalize().scaleInPlace(80);
        this.chargeDir = playerPos.add(vel.scale(0.5)).subtract(this.pos);
        if (this.chargeDir.lengthSquared() < 1e-4) this.chargeDir.copyFrom(this.forward());
        this.chargeDir.normalize();
        this.minApproach = Infinity;
      }
    } else if (this.state_ === "CHARGING") {
      this.patternT += dt;
      target = playerPos;
      this.minApproach = Math.min(this.minApproach, Vector3.Distance(this.pos, playerPos));
      directDir = this.chargeDir;
      if (this.patternT > 3 || Vector3.Dot(this.chargeDir, playerPos.subtract(this.pos)) < 0) {
        if (this.minApproach < 12) this.onChargeNearMiss?.(this.minApproach);
        this.enterPatternRecovery(2.5);
      }
    } else if (this.state_ === "CLIMB") {
      this.patternT += dt;
      target = this.patternTarget;
      speed = 44;
      if (this.patternT > 1.5 || Vector3.Distance(this.pos, this.patternTarget) < 8) {
        this.state_ = "DIVE_TEL";
        this.patternT = 0;
        this.bus.emit("sfx", { name: "inhale" });
      }
    } else if (this.state_ === "DIVE_TEL") {
      this.patternT += dt;
      target = playerPos;
      speed = 24;
      if (this.patternT > 0.8) {
        this.state_ = "DIVING";
        this.patternT = 0;
      }
    } else if (this.state_ === "DIVING") {
      this.patternT += dt;
      target = playerPos;
      // homing dive — direction recomputed toward the player's current position each frame
      directDir = Vector3.Normalize(playerPos.subtract(this.pos));
      if (this.patternT > 2 || this.pos.y < playerPos.y - 5) {
        this.enterPatternRecovery(2.0);
      }
    } else if (this.state_ === "TELEGRAPH" || this.state_ === "ATTACK" || this.state_ === "RECOVERY") {
      target = playerPos;
      speed = 20;
      if (this.patternRecoveryT > 0) {
        // pattern-driven recovery — the sweep sm is IDLE here, so it cannot own this state
        this.patternRecoveryT -= dt;
        if (this.patternRecoveryT <= 0) {
          this.patternRecoveryT = 0;
          this.returnToOrbit();
        }
      } else {
        this.sm.update(dt);
        this.state_ = this.sm.state === "TELEGRAPH" ? "TELEGRAPH" : this.sm.state === "ATTACK" ? "ATTACK" : this.sm.state === "RECOVERY" ? "RECOVERY" : "ORBIT";
        if (this.sm.state === "IDLE") this.sweepCooldown = 3.2;
      }
      if (this.state_ === "ATTACK" && playerAlive) {
        // flame cone vs player capsule (head + body spheres)
        const origin = this.rig.headTip.getAbsolutePosition();
        const dir = Vector3.Normalize(playerPos.subtract(origin));
        const d = Vector3.Distance(origin, playerPos);
        const coneCos = Math.cos(VHARAX.fireCone);
        if (d < VHARAX.fireRange && Vector3.Dot(dir, this.forward()) > coneCos) {
          this.onSweepHitPlayer?.(VHARAX.fireDamage, dt);
        }
      }
    } else if (this.state_ === "STAGGERED") {
      // near-hover death wobble: slow circle (radius 25, ~12 m/s) around the spire top
      this.patternT += dt;
      this.staggerAngle += dt * (12 / 25);
      target = new Vector3(
        this.staggerCenter.x + Math.sin(this.staggerAngle) * 25,
        this.staggerCenter.y + Math.sin(this.patternT * 1.7) * 4,
        this.staggerCenter.z + Math.cos(this.staggerAngle) * 25
      );
      speed = 12;
    } else {
      // FLEEING — straight out, despawn past fog
      this.fleeT += dt;
      target = new Vector3(this.pos.x, 200, this.pos.z - 400);
      speed = 70;
      if (this.fleeT > 6) {
        this.state_ = "GONE";
        this.rig.root.setEnabled(false);
        this.fireLight.intensity = 0;
        return;
      }
    }

    // stuck fail-safe: a non-telegraph pattern state that never transitions gets bailed out
    if (
      this.patternT > 4 &&
      (this.state_ === "POSITIONING" || this.state_ === "CHARGING" || this.state_ === "CLIMB" || this.state_ === "DIVING")
    ) {
      this.enterPatternRecovery(1);
      directDir = null;
    }

    let pitch: number;
    if (directDir) {
      // CHARGING/DIVING — direct pos advance, no turn-rate steering
      this.yaw = Math.atan2(directDir.x, directDir.z);
      pitch = Math.max(-1.0, Math.min(1.0, Math.atan2(directDir.y, Math.hypot(directDir.x, directDir.z))));
      this.roll += (0 - this.roll) * Math.min(1, dt * 3);
      this.speed = this.state_ === "CHARGING" ? 70 : 55;
      this.pos.addInPlace(directDir.scale(this.speed * dt));
      this.pos.y = Math.max(this.pos.y, terrainHeight + 12); // never inside terrain/fortress
    } else {
      // steering (turn-rate limited)
      this.tmp.copyFrom(target).subtractInPlace(this.pos);
      const wantYaw = Math.atan2(this.tmp.x, this.tmp.z);
      const wantPitch = Math.atan2(this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z));
      let dy = wantYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 1.6);
      pitch = Math.max(-0.6, Math.min(0.6, wantPitch)) * 0.5;
      this.roll += (Math.max(-0.7, Math.min(0.7, -dy * 3)) - this.roll) * Math.min(1, dt * 3);
      this.speed += (speed - this.speed) * Math.min(1, dt * 1.5);
      const fwd = this.forward();
      this.pos.addInPlace(fwd.scale(this.speed * dt));
      this.pos.y += Math.sin(pitch) * this.speed * dt;
      this.pos.y = Math.max(this.pos.y, terrainHeight + 12); // never inside terrain/fortress
    }

    this.lastPlayerPos.copyFrom(playerPos);
    this.rig.root.position.copyFrom(this.pos);
    // STAGGERED adds a wing-wobble roll bias on top of the steering roll
    const staggerRoll = this.state_ === "STAGGERED" ? Math.sin(this.patternT * 3.1) * 0.28 : 0;
    this.rig.root.rotationQuaternion = Quaternion.FromEulerAngles(pitch, this.yaw, this.roll + staggerRoll);
    const jawOpen =
      this.state_ === "TELEGRAPH" || this.state_ === "ATTACK" || this.state_ === "DIVE_TEL" ? 1 : this.state_ === "CHARGE_TEL" ? 0.2 : 0;
    const wingSweep = this.state_ === "CHASE" ? 0.25 : this.state_ === "DIVING" ? 0.7 : 0.1;
    this.rig.animate({ flapRate: this.state_ === "STAGGERED" ? 2.4 : 5.2, flapAmp: 0.8, sweep: wingSweep, jawOpen, dt });

    this.fireLight.position.copyFrom(this.rig.headTip.getAbsolutePosition());
    this.fireLight.intensity = this.state_ === "ATTACK" ? 2.2 : this.state_ === "TELEGRAPH" ? 0.8 : 0;
  }

  forward(): Vector3 {
    return new Vector3(Math.sin(this.yaw) * Math.cos(0), 0, Math.cos(this.yaw));
  }

  /** returns whether the cone connected — hp may be floor-clamped, so a hit is not an hp delta */
  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): boolean {
    // damage-out is a duel/staged mechanic — player fire only lands in those states
    if (
      this.state_ !== "ORBIT" && this.state_ !== "TELEGRAPH" && this.state_ !== "ATTACK" &&
      this.state_ !== "RECOVERY" && this.state_ !== "STAGGERED"
    ) return false;
    const head = this.pos.add(this.forward().scale(4 * VHARAX.scale));
    const tail = this.pos.subtract(this.forward().scale(4 * VHARAX.scale));
    const closest = closestPointOnSegment(origin, head, tail);
    const d = Vector3.Distance(origin, closest);
    if (d > range) return false;
    const toDragon = closest.subtract(origin);
    toDragon.y = 0;
    const flat = Vector3.Normalize(toDragon);
    const flatDir = new Vector3(dir.x, 0, dir.z).normalize();
    if (Vector3.Dot(flat, flatDir) < Math.cos(halfAngle + 0.15)) return false;
    const falloff = 1 - 0.35 * (d / range);
    this.hp = Math.max(this.floor, this.hp - dps * dt * falloff);
    if (Math.random() < dt * 6) this.bus.emit("sfx", { name: "bossHit" });
    return true;
  }

  dispose(): void {
    this.rig.dispose(); // meshes only — materials are scene-scoped cache-owned
    this.fireLight.dispose();
  }
}

function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Vector3.Dot(ab, ab)));
  return a.add(ab.scale(t));
}
