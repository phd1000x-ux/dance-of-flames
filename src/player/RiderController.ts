import { TransformNode, Vector3 } from "@babylonjs/core";
import type { InputManager } from "../input/InputManager";
import type { PlayerState } from "./PlayerState";
import type { EventBus } from "../core/EventBus";
import type { GameEvents } from "../core/Events";
import type { GroundCamera } from "../camera/GameCameras";
import type { Terrain } from "../world/Terrain";
import { clamp, damp } from "../core/MathUtils";
import { mitigateDamage } from "../combat/DamageCalculator";

export interface GroundEnemyLike {
  pos: Vector3;
  yaw: number;
  hp: number;
  alive: boolean;
  isShielded: boolean;
  staggered: number;
}

/**
 * Arcade ground combat for the rider after the dragon falls:
 * 3-hit light combo, heavy attack, block/parry, dodge roll, sprint, soft lock-on.
 */
export class RiderController {
  pos = new Vector3(0, 0, 0);
  yaw = 0;
  speed = 0;
  alive = true;

  attackState: "none" | "light1" | "light2" | "light3" | "heavy" = "none";
  attackTimer = 0;
  attackHitDone = false;
  comboWindow = 0;
  queuedInput = false;

  blocking = false;
  blockTime = 0; // time since block started (parry window)
  parryFlash = 0;

  dodgeTimer = 0;
  dodgeCooldown = 0;
  dodgeDir = new Vector3(0, 0, 1);
  invulnerable = 0;

  lockTarget: GroundEnemyLike | null = null;
  lockCooldown = 0;

  walkPhase = 0;

  constructor(
    public player: PlayerState,
    public figure: { root: TransformNode; body: TransformNode; swordPivot: TransformNode; shieldMesh: TransformNode },
    private terrain: Terrain,
    private bus: EventBus<GameEvents>
  ) {}

  spawn(pos: Vector3, yaw: number): void {
    this.pos.copyFrom(pos);
    this.pos.y = this.terrain.heightAt(pos.x, pos.z);
    this.yaw = yaw;
    this.invulnerable = 2.5; // brief protection while recovering from the crash
    this.figure.root.setEnabled(true);
    this.sync(0);
  }

  get busy(): boolean {
    return this.attackState !== "none" || this.dodgeTimer > 0;
  }

  update(dt: number, input: InputManager, cam: GroundCamera, enemies: GroundEnemyLike[]): void {
    if (!this.alive) return;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.lockCooldown = Math.max(0, this.lockCooldown - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.parryFlash = Math.max(0, this.parryFlash - dt);

    // camera-relative movement basis
    const fwd = cam.groundForward();
    const right = new Vector3(fwd.z, 0, -fwd.x);
    let mx = 0;
    let mz = 0;
    if (input.isDownCode("KeyW")) mz += 1;
    if (input.isDownCode("KeyS")) mz -= 1;
    if (input.isDownCode("KeyD")) mx += 1;
    if (input.isDownCode("KeyA")) mx -= 1;
    const moveDir = fwd.scale(mz).add(right.scale(mx));
    const moving = moveDir.lengthSquared() > 0.01;

    const stats = this.player.riderStats;
    const moveSpeed = this.player.riderDef.ground.moveSpeed;
    const sprinting = input.isDown("sprint") && moving && this.player.riderStamina > 5;

    // ---- combat inputs ----
    this.blocking = input.isDown("block") && !this.busy;
    if (this.blocking) this.blockTime += dt;
    else this.blockTime = 0;

    if (input.pressed("lockOn") && this.lockCooldown <= 0) {
      this.lockCooldown = 0.3;
      if (this.lockTarget) {
        this.lockTarget = null;
      } else {
        let best: GroundEnemyLike | null = null;
        let bestD = 16;
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = Vector3.Distance(e.pos, this.pos);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        this.lockTarget = best;
      }
    }
    if (this.lockTarget && (!this.lockTarget.alive || Vector3.Distance(this.lockTarget.pos, this.pos) > 22)) {
      this.lockTarget = null;
    }

    if (input.pressed("jump") && this.dodgeCooldown <= 0 && this.player.riderStamina >= this.player.riderDef.ground.dodgeCost) {
      this.player.riderStamina -= this.player.riderDef.ground.dodgeCost;
      this.dodgeTimer = 0.42;
      this.dodgeCooldown = 0.75;
      this.invulnerable = 0.42;
      this.dodgeDir = moving ? Vector3.Normalize(moveDir) : fwd;
      this.bus.emit("sfx", { name: "dodge" });
    }

    if (!this.busy) {
      if (input.pressed("lightAttack")) {
        this.startAttack(dt > 0 ? "light1" : "light1");
      } else if (input.pressed("heavyAttack") && this.player.riderStamina >= 14) {
        this.player.riderStamina -= 14;
        this.startAttack("heavy");
      }
    } else if (input.pressed("lightAttack")) {
      this.queuedInput = true;
    }

    // ---- attack state machine ----
    if (this.attackState !== "none") {
      this.attackTimer -= dt;
      const hitAt = this.attackState === "heavy" ? 0.32 : 0.16;
      const duration = this.attackState === "heavy" ? 0.62 : 0.34;
      if (!this.attackHitDone && this.attackTimer <= duration - hitAt) {
        this.attackHitDone = true;
        this.doHit(this.attackState === "heavy");
      }
      if (this.attackTimer <= 0) {
        if (this.queuedInput && this.attackState !== "heavy" && this.comboWindow > 0) {
          const next = this.attackState === "light1" ? "light2" : this.attackState === "light2" ? "light3" : "light1";
          this.startAttack(next);
        } else {
          this.attackState = "none";
        }
        this.queuedInput = false;
      }
    }

    // ---- movement ----
    let speed = 0;
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      speed = 11;
      this.pos.addInPlace(this.dodgeDir.scale(speed * dt));
      // roll animation
      this.figure.body.rotation.x = (1 - this.dodgeTimer / 0.42) * Math.PI * 2;
    } else {
      speed = this.busy ? moveSpeed * 0.35 : this.blocking ? 2.2 : sprinting ? moveSpeed * 1.65 : moving ? moveSpeed : 0;
      if (sprinting) this.player.riderStamina = Math.max(0, this.player.riderStamina - 11 * dt);
      if (moving && speed > 0) {
        this.pos.addInPlace(Vector3.Normalize(moveDir).scale(speed * dt));
        this.walkPhase += dt * speed * 1.7;
      } else {
        this.walkPhase = damp(this.walkPhase, Math.round(this.walkPhase / Math.PI) * Math.PI, 8, dt);
      }
      this.figure.body.rotation.x = damp(this.figure.body.rotation.x, 0, 10, dt);
    }

    // facing: lock target > movement dir > camera fwd
    let faceYaw = this.yaw;
    if (this.lockTarget) {
      faceYaw = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
    } else if (moving && !this.busy) {
      faceYaw = Math.atan2(moveDir.x, moveDir.z);
    } else if (!this.busy) {
      faceYaw = Math.atan2(fwd.x, fwd.z);
    }
    let dyaw = faceYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yaw += dyaw * Math.min(1, dt * (this.lockTarget ? 14 : 9));

    // terrain & bounds
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > 740) {
      this.pos.x *= 740 / d;
      this.pos.z *= 740 / d;
    }

    this.sync(dt);
  }

  private startAttack(state: "light1" | "light2" | "light3" | "heavy"): void {
    this.attackState = state;
    this.attackTimer = state === "heavy" ? 0.62 : 0.34;
    this.attackHitDone = false;
    this.comboWindow = 0.75;
    this.bus.emit("sfx", { name: "swordSwing" });
  }

  private doHit(heavy: boolean): void {
    const dmgStat = this.player.riderStats.swordDamage ?? 26;
    const base = dmgStat * (heavy ? this.player.riderDef.ground.heavyMultiplier : 1);
    const range = heavy ? 3.0 : 2.4;
    const arc = heavy ? 0.9 : 0.62; // cos threshold
    const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.onHitCallback?.(fwd, range, arc, base, heavy);
  }

  /** set by combat system so hits apply to actual enemy entities */
  onHitCallback: ((fwd: Vector3, range: number, arcCos: number, damage: number, heavy: boolean) => void) | null = null;

  /** incoming melee/ranged damage; returns actual damage applied */
  takeHit(amount: number, fromDir: Vector3, sourceType: string): { applied: number; parried: boolean; dodged: boolean } {
    if (this.invulnerable > 0 || this.dodgeTimer > 0) return { applied: 0, parried: false, dodged: true };
    // facing check for block
    const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const facing = Vector3.Dot(fwd, fromDir) < -0.25;
    if (this.blocking && facing) {
      if (this.blockTime < 0.22) {
        // PARRY: negate + flash
        this.parryFlash = 0.3;
        this.bus.emit("sfx", { name: "swordHit" });
        return { applied: 0, parried: true, dodged: false };
      }
      const blockEff = clamp(this.player.riderStats.riderBlock ?? 0.6, 0, 0.9);
      const applied = amount * (1 - blockEff);
      const died = this.player.damageRider(applied);
      if (died) this.die();
      return { applied, parried: false, dodged: false };
    }
    const armor = this.player.riderStats.riderArmor ?? 0;
    const applied = mitigateDamage(amount, armor);
    const died = this.player.damageRider(applied);
    this.bus.emit("melee-hit-rider", { amount: applied });
    this.bus.emit("sfx", { name: "playerHurt" });
    if (died) this.die();
    void sourceType;
    return { applied, parried: false, dodged: false };
  }

  private die(): void {
    this.alive = false;
    this.figure.body.rotation.x = Math.PI / 2;
    this.figure.body.position.y = 0.4;
  }

  private sync(dt: number): void {
    this.figure.root.position.copyFrom(this.pos);
    this.figure.root.rotation.y = this.yaw;
    // walk bob
    this.figure.root.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.08;

    // sword animation by attack phase
    let swordRotX = -0.2;
    let swordRotZ = 0.15;
    if (this.attackState !== "none") {
      const t = 1 - this.attackTimer / (this.attackState === "heavy" ? 0.62 : 0.34);
      const swing = Math.sin(clamp(t * 1.8, 0, 1) * Math.PI);
      if (this.attackState === "light2") {
        swordRotX = -1.6 * swing - 0.2;
        swordRotZ = -0.9 * swing;
      } else if (this.attackState === "light3") {
        swordRotX = -1.9 * swing - 0.2;
        swordRotZ = 1.1 * swing;
      } else if (this.attackState === "heavy") {
        swordRotX = -2.3 * swing - 0.2;
        swordRotZ = 0.2 * swing;
      } else {
        swordRotX = -1.3 * swing - 0.2;
        swordRotZ = 0.5 * swing;
      }
    } else if (this.blocking) {
      swordRotX = -0.5;
      swordRotZ = 1.2;
    }
    this.figure.swordPivot.rotation.x = damp(this.figure.swordPivot.rotation.x, swordRotX, 22, dt);
    this.figure.swordPivot.rotation.z = damp(this.figure.swordPivot.rotation.z, swordRotZ, 22, dt);
    this.figure.shieldMesh.setEnabled(!this.lockTarget || this.blocking);
  }
}
