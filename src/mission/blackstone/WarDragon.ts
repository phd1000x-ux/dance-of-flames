import { Color3, PointLight, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EffectsLibrary } from "../../world/EffectsLibrary";
import { DragonRig } from "../../world/DragonRig";
import { VHARAX } from "../../data/wardragon";
import { FlameSweepSM, advanceWaypoint, rubberBandFactor, type PathPoint } from "./BossAI";

const CHASE_PATH: (PathPoint & { y: number })[] = [
  { x: 0, z: -60, y: 75 },    // keep
  { x: 0, z: -95, y: 90 },    // spire (Task 13 landmark)
  { x: -170, z: 0, y: 80 },   // west wall sweep
  { x: 0, z: 160, y: 70 },    // over the gatehouse
  { x: 60, z: 330, y: 95 },   // outer cliff
  { x: 240, z: 420, y: 120 }, // open sky
];

export type WarDragonState = "CHASE" | "ORBIT" | "TELEGRAPH" | "ATTACK" | "RECOVERY" | "FLEEING" | "GONE";

export class WarDragon {
  readonly rig: DragonRig;
  readonly maxHp = VHARAX.maxHealth;
  readonly floor = VHARAX.maxHealth * 0.4;
  hp = VHARAX.maxHealth;
  pos = new Vector3(0, 60, -95);
  yaw = 0;
  roll = 0;
  speed = 40;
  chasePathIndex = 0;
  onSweepHitPlayer: ((dps: number, dt: number) => void) | null = null;
  onResolved: (() => void) | null = null;
  private state_: WarDragonState = "CHASE";
  private sm = new FlameSweepSM({ telegraph: 1.1, attack: 1.4, recovery: 2.2 });
  private sweepCooldown = 2;
  private orbitAngle = 0;
  private fleeT = 0;
  private fireLight: PointLight;
  private readonly tmp = new Vector3();

  constructor(private scene: Scene, private effects: EffectsLibrary, private bus: GameEventBus) {
    this.rig = new DragonRig(scene, VHARAX);
    this.rig.root.setEnabled(false);
    this.fireLight = new PointLight("vharax-fire", new Vector3(0, 0, 0), scene);
    this.fireLight.diffuse = new Color3(1, 0.45, 0.15);
    this.fireLight.intensity = 0;
    this.fireLight.range = 90;
  }

  get state(): WarDragonState {
    return this.state_;
  }

  startChase(firstPos: Vector3): void {
    this.pos.copyFrom(firstPos);
    this.rig.root.setEnabled(true);
    this.rig.root.position.copyFrom(this.pos);
    this.state_ = "CHASE";
  }

  startDuel(): void {
    this.state_ = "ORBIT";
    this.sweepCooldown = 2.5;
  }

  flee(): void {
    if (this.state_ === "GONE") return;
    this.state_ = "FLEEING";
    this.fleeT = 0;
  }

  private resolve(): void {
    if (this.state_ === "GONE") return;
    this.flee();
    this.onResolved?.();
  }

  update(dt: number, playerPos: Vector3, playerAlive: boolean, terrainHeight: number): void {
    if (this.state_ === "GONE") return;
    if (this.hp <= this.floor && this.state_ !== "FLEEING") this.resolve();

    let target: Vector3;
    let speed = 42;
    if (this.state_ === "CHASE") {
      const wp = CHASE_PATH[this.chasePathIndex];
      target = new Vector3(wp.x, wp.y, wp.z);
      this.chasePathIndex = advanceWaypoint(this.pos.x, this.pos.z, CHASE_PATH, this.chasePathIndex, 28);
      const dist = Vector3.Distance(this.pos, playerPos);
      speed *= 1 + rubberBandFactor(dist);
    } else if (this.state_ === "ORBIT") {
      this.orbitAngle += dt * 0.35;
      target = playerPos.add(new Vector3(Math.cos(this.orbitAngle) * 70, 18, Math.sin(this.orbitAngle) * 70));
      speed = 34;
      this.sweepCooldown -= dt;
      const facing = Vector3.Dot(this.forward(), Vector3.Normalize(playerPos.subtract(this.pos)));
      if (this.sweepCooldown <= 0 && facing > 0.86 && Vector3.Distance(this.pos, playerPos) < 95) {
        this.sm.start();
        this.state_ = "TELEGRAPH";
        this.bus.emit("sfx", { name: "inhale" });
      }
    } else if (this.state_ === "TELEGRAPH" || this.state_ === "ATTACK" || this.state_ === "RECOVERY") {
      target = playerPos;
      speed = 20;
      this.sm.update(dt);
      this.state_ = this.sm.state === "TELEGRAPH" ? "TELEGRAPH" : this.sm.state === "ATTACK" ? "ATTACK" : this.sm.state === "RECOVERY" ? "RECOVERY" : "ORBIT";
      if (this.sm.state === "IDLE") this.sweepCooldown = 3.2;
      if (this.sm.state === "ATTACK" && playerAlive) {
        // flame cone vs player capsule (head + body spheres)
        const origin = this.rig.headTip.getAbsolutePosition();
        const dir = Vector3.Normalize(playerPos.subtract(origin));
        const d = Vector3.Distance(origin, playerPos);
        const coneCos = Math.cos(VHARAX.fireCone);
        if (d < VHARAX.fireRange && Vector3.Dot(dir, this.forward()) > coneCos) {
          this.onSweepHitPlayer?.(VHARAX.fireDamage, dt);
        }
      }
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

    // steering (turn-rate limited)
    this.tmp.copyFrom(target).subtractInPlace(this.pos);
    const wantYaw = Math.atan2(this.tmp.x, this.tmp.z);
    const wantPitch = Math.atan2(this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z));
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 1.6);
    const pitch = Math.max(-0.6, Math.min(0.6, wantPitch)) * 0.5;
    this.roll += (Math.max(-0.7, Math.min(0.7, -dy * 3)) - this.roll) * Math.min(1, dt * 3);
    this.speed += (speed - this.speed) * Math.min(1, dt * 1.5);

    const fwd = this.forward();
    this.pos.addInPlace(fwd.scale(this.speed * dt));
    this.pos.y += Math.sin(pitch) * this.speed * dt;
    this.pos.y = Math.max(this.pos.y, terrainHeight + 12); // never inside terrain/fortress
    this.rig.root.position.copyFrom(this.pos);
    this.rig.root.rotationQuaternion = Quaternion.FromEulerAngles(pitch, this.yaw, this.roll);
    this.rig.animate({ flapRate: 5.2, flapAmp: 0.8, sweep: this.state_ === "CHASE" ? 0.25 : 0.1, jawOpen: this.state_ === "TELEGRAPH" || this.state_ === "ATTACK" ? 1 : 0, dt });

    this.fireLight.position.copyFrom(this.rig.headTip.getAbsolutePosition());
    this.fireLight.intensity = this.state_ === "ATTACK" ? 2.2 : this.state_ === "TELEGRAPH" ? 0.8 : 0;
  }

  forward(): Vector3 {
    return new Vector3(Math.sin(this.yaw) * Math.cos(0), 0, Math.cos(this.yaw));
  }

  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    if (this.state_ === "GONE" || this.state_ === "FLEEING") return;
    const head = this.pos.add(this.forward().scale(4 * VHARAX.scale));
    const tail = this.pos.subtract(this.forward().scale(4 * VHARAX.scale));
    const closest = closestPointOnSegment(origin, head, tail);
    const d = Vector3.Distance(origin, closest);
    if (d > range) return;
    const toDragon = closest.subtract(origin);
    toDragon.y = 0;
    const flat = Vector3.Normalize(toDragon);
    const flatDir = new Vector3(dir.x, 0, dir.z).normalize();
    if (Vector3.Dot(flat, flatDir) < Math.cos(halfAngle + 0.15)) return;
    const falloff = 1 - 0.35 * (d / range);
    this.hp = Math.max(this.floor, this.hp - dps * dt * falloff);
    if (Math.random() < dt * 6) this.bus.emit("sfx", { name: "bossHit" });
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
