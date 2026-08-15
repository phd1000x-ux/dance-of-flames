import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import type { InputManager } from "../input/InputManager";
import type { PlayerState } from "./PlayerState";
import type { DragonRig } from "../world/DragonRig";
import type { Terrain } from "../world/Terrain";
import type { GameEvents } from "../core/Events";
import type { EventBus } from "../core/EventBus";
import { clamp, damp, lerp } from "../core/MathUtils";

export type FlightState = "HOVER" | "FLY" | "BOOST" | "DIVE" | "STAGGER" | "DYING";

/**
 * Arcade dragon flight controller with physical weight.
 * Yaw/pitch/roll orientation, speed-based state blending, boost, dodge, terrain & bounds safety.
 */
export class DragonController {
  pos = new Vector3(0, 120, 0);
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 24;
  state: FlightState = "FLY";
  forward = new Vector3(0, 0, 1);

  // dodge / stagger
  dodgeTimer = 0;
  dodgeCooldown = 0;
  dodgeDir = 1; // +1 = right, -1 = left
  invulnerable = 0;
  staggerTimer = 0;

  // camera recenter (Z): level flight
  recenterTimer = 0;

  // user scaling for keyboard turning (settings)
  inputTurnScale = 1;

  // death sequence
  deathTimer = 0;
  deathSpin = 0;

  // animation params out
  flapRate = 6;
  flapAmp = 1;
  sweep = 0;
  jawOpen = 0;

  // tuned per dragon stats at runtime
  private bankAmount = 0.85;

  constructor(
    public player: PlayerState,
    public rig: DragonRig,
    private terrain: Terrain,
    private bus: EventBus<GameEvents>,
    private boundsRadius = 760
  ) {
    this.player = player;
  }

  spawn(pos: Vector3, yaw: number): void {
    this.pos.copyFrom(pos);
    this.yaw = yaw;
    this.pitch = -0.05;
    this.roll = 0;
    this.speed = 30;
    this.state = "FLY";
  }

  get worldForward(): Vector3 {
    return this.forward;
  }

  get velocity(): Vector3 {
    return this.forward.scale(this.speed);
  }

  /** returns damage events: terrain impact damage if any */
  update(dt: number, input: InputManager, firing: boolean): void {
    const stats = this.player.dragonStats;
    const maxSpeed = stats.maxSpeed ?? 40;
    const boostSpeed = stats.boostSpeed ?? 60;
    const accel = stats.acceleration ?? 25;
    const turnRate = stats.turnRate ?? 1.8;
    const climbRate = stats.climbRate ?? 24;
    const diveSpeed = stats.diveSpeed ?? 70;

    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);

    if (this.player.mode === "dying") {
      this.updateDeath(dt);
      this.syncRig(dt);
      return;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      this.state = "STAGGER";
      // tumble forward, sinking
      this.speed = damp(this.speed, 14, 1.2, dt);
      this.pitch = damp(this.pitch, -0.5, 1.5, dt);
      this.roll += dt * 2.4;
      this.integrate(dt);
      this.syncRig(dt);
      return;
    }

    // ---- input ----
    const mouse = input.consumeMouse();
    const lookYaw = input.lookYaw; // smoothed arrow-key axis (-1..1)
    const lookPitch = input.lookPitch;
    const throttling = input.isDown("accelerate") ? 1 : input.isDown("decelerate") ? -0.6 : 0.25;
    const wantBoost = input.isDown("boost") && this.player.boost > 0.03;
    const bankInput = (input.isDown("turnRight") ? 1 : 0) - (input.isDown("turnLeft") ? 1 : 0);
    const verticalInput = (input.isDown("climb") ? 1 : 0) - (input.isDown("descend") ? 1 : 0);

    // dodge / barrel roll — Q = left, E = right
    const dodgeSide = (input.pressed("dodgeRight") ? 1 : 0) - (input.pressed("dodgeLeft") ? 1 : 0);
    if (dodgeSide !== 0 && this.dodgeCooldown <= 0 && this.dodgeTimer <= 0) {
      this.dodgeTimer = 0.55;
      this.dodgeCooldown = 2.2;
      this.dodgeDir = dodgeSide;
      this.invulnerable = 0.55;
      this.bus.emit("sfx", { name: "dodge" });
    }

    let yawRate = 0;
    let pitchRate = 0;
    let lateralVel = 0;
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      const spin = (Math.PI * 2) / 0.55;
      yawRate = this.dodgeDir * spin * 0.55;
      this.roll += -this.dodgeDir * spin * dt * 0.9; // roll continues the bank direction
      this.speed = damp(this.speed, Math.min(maxSpeed * 1.15, this.speed + 16), 4, dt);
      // small lateral displacement (sin envelope)
      lateralVel = this.dodgeDir * 9 * Math.sin((1 - this.dodgeTimer / 0.55) * Math.PI);
    } else {
      // roll relaxes to bank target (A/D bank + keyboard-look coordinated bank)
      const rollTarget = -bankInput * this.bankAmount - lookYaw * 0.22;
      const recentering = this.recenterTimer > 0;
      const rollGoal = recentering ? 0 : rollTarget;
      this.roll = damp(this.roll, rollGoal, recentering ? 9 : 6, dt);
      // bank turn + direct A/D response + arrow-key look steering
      const turnScale = this.inputTurnScale;
      yawRate = -this.roll * 1.9 + bankInput * turnRate * 0.45 * turnScale + mouse.dx * 2.6 + lookYaw * 2.4 * turnScale;
      pitchRate = mouse.dy * 2.1 + lookPitch * 1.5 + verticalInput * 0.35;
      if (recentering) {
        this.pitch = damp(this.pitch, 0, 9, dt);
        pitchRate = 0;
      }
      yawRate = clamp(yawRate, -turnRate * 1.6 * Math.max(1, turnScale), turnRate * 1.6 * Math.max(1, turnScale));
      pitchRate = clamp(pitchRate, -turnRate * 1.1, turnRate * 1.1);
    }
    if (this.recenterTimer > 0) this.recenterTimer -= dt;

    this.yaw += yawRate * dt;
    this.pitch = clamp(this.pitch + pitchRate * dt, -1.25, 1.15);

    // ---- speed & states ----
    let targetSpeed = throttling * maxSpeed;
    let newBoost = false;
    if (wantBoost) {
      targetSpeed = boostSpeed;
      newBoost = true;
      this.player.boost = Math.max(0, this.player.boost - dt * 0.16);
      if (this.player.boost <= 0) this.player.boostRegenLocked = true;
    } else if (this.player.boostRegenLocked) {
      this.player.boostRegenLocked = false;
    }
    // dive accelerates
    const diving = this.pitch < -0.35;
    if (diving) targetSpeed = Math.max(targetSpeed, diveSpeed * Math.min(1, -this.pitch / 0.9));
    // climb bleeds speed
    if (this.pitch > 0.45) targetSpeed = Math.min(targetSpeed, maxSpeed * 0.8);

    this.speed = damp(this.speed, targetSpeed, accel / 22, dt);

    // state classification
    if (this.speed < 9) this.state = "HOVER";
    else if (newBoost) this.state = "BOOST";
    else if (diving && this.speed > maxSpeed * 1.05) this.state = "DIVE";
    else this.state = this.speed > maxSpeed * 0.6 ? "FLY" : "FLY";

    // direct vertical control (Space climb / C descend) — works in all flight states
    if (verticalInput !== 0) {
      const vyRate = this.state === "HOVER" ? climbRate * 0.9 : climbRate * 0.62;
      this.pos.y += verticalInput * vyRate * dt;
    } else if (this.state === "HOVER") {
      this.pos.y += -1.6 * dt; // gentle hover sink
    }

    // dodge lateral displacement (world-space side vector)
    if (lateralVel !== 0) {
      const side = new Vector3(this.forward.z, 0, -this.forward.x).normalize();
      this.pos.addInPlace(side.scale(lateralVel * dt));
    }

    this.integrate(dt);

    // wing animation params (low HP → heavier, more labored wingbeats)
    const hpFrac = this.player.dragonHp / Math.max(1, this.player.maxDragonHp);
    const strain = hpFrac < 0.3 ? 1.3 : 1;
    this.flapRate = lerp(7.2, 1.1, clamp(this.speed / (maxSpeed * 1.1), 0, 1)) * strain;
    this.flapAmp = clamp(1.15 - this.speed / 42, 0.18, 1) * (hpFrac < 0.3 ? 1.15 : 1);
    this.sweep = this.state === "DIVE" ? 0.72 : this.state === "BOOST" ? 0.5 : 0.06;
    this.jawOpen = damp(this.jawOpen, firing ? 1 : 0, 10, dt);

    // wingbeat audio on each downstroke (varies with flap intensity + airspeed)
    const flapSin = Math.sin(this.rig.flapPhase);
    if (this.lastFlapSin > 0 && flapSin <= 0 && this.flapAmp > 0.3) {
      this.flapIntensityOut = this.flapAmp * (0.5 + this.speed / (maxSpeed * 2));
      this.bus.emit("sfx", { name: "flapBeat", intensity: this.flapIntensityOut });
    }
    this.lastFlapSin = flapSin;

    this.syncRig(dt);
  }

  private lastFlapSin = 0;
  flapIntensityOut = 0;

  private integrate(dt: number): void {
    const m = Matrix.RotationYawPitchRoll(this.yaw, this.pitch, this.roll);
    Vector3.TransformNormalToRef(new Vector3(0, 0, 1), m, this.forward);
    this.pos.addInPlace(this.forward.scale(this.speed * dt));

    // terrain safety
    const groundY = this.terrain.heightAt(this.pos.x, this.pos.z);
    const minY = groundY + 3.2 * this.player.dragonDef.scale;
    if (this.pos.y < minY) {
      const impactSpeed = -Math.min(0, 0);
      void impactSpeed;
      this.pos.y = minY;
      if (this.pitch < -0.5 && this.speed > 40 && this.player.mode === "dragon") {
        const staggerResist = this.player.dragonStats.staggerResistance ?? 0.5;
        this.bus.emit("player-damaged", { amount: 25, dirX: 0, dirZ: 1, source: "terrain" });
        this.player.damageDragon(25 * (1 - staggerResist * 0.5));
        this.enterStagger(1.1);
      } else {
        this.pitch = Math.max(this.pitch, 0.05);
      }
    }

    // world bounds (soft)
    const d = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z);
    if (d > this.boundsRadius) {
      const k = (d - this.boundsRadius) / 60;
      const pushX = (-this.pos.x / d) * k;
      const pushZ = (-this.pos.z / d) * k;
      this.yaw += (pushX * Math.cos(this.yaw) - pushZ * Math.sin(this.yaw)) * -dt * 2.0;
      this.bus.emit("bounds-warning", { distance: d - this.boundsRadius });
    }
    // altitude ceiling
    if (this.pos.y > 380) {
      this.pos.y = 380;
      this.pitch = Math.min(this.pitch, 0);
    }
  }

  enterStagger(duration: number): void {
    this.staggerTimer = Math.max(this.staggerTimer, duration);
    this.state = "STAGGER";
  }

  /** Z — smoothly level pitch/roll back to stable flight (~0.35s) */
  startRecenter(): void {
    this.recenterTimer = 0.35;
  }

  private updateDeath(dt: number): void {
    // scripted spiral to the ground (2.5–4s)
    this.deathTimer += dt;
    this.deathSpin += dt;
    this.roll += dt * 3.2;
    this.yaw += dt * 1.4;
    this.pitch = damp(this.pitch, -0.9, 1.8, dt);
    this.speed = damp(this.speed, 30, 1.0, dt);
    const m = Matrix.RotationYawPitchRoll(this.yaw, this.pitch, this.roll);
    Vector3.TransformNormalToRef(new Vector3(0, 0, 1), m, this.forward);
    this.pos.addInPlace(this.forward.scale(this.speed * dt));
    const groundY = this.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= groundY + 2.5 * this.player.dragonDef.scale) {
      this.pos.y = groundY + 2.0 * this.player.dragonDef.scale;
    }
  }

  get landed(): boolean {
    const groundY = this.terrain.heightAt(this.pos.x, this.pos.z);
    return this.player.mode === "dying" && this.pos.y <= groundY + 2.6 * this.player.dragonDef.scale;
  }

  get deathProgress(): number {
    return clamp(this.deathTimer / 3.0, 0, 1);
  }

  private syncRig(dt: number): void {
    this.rig.root.position.copyFrom(this.pos);
    this.rig.root.rotationQuaternion = Quaternion.FromEulerAngles(this.pitch, this.yaw, this.roll);
    const maxSpeed = this.player.dragonStats.boostSpeed ?? 60;
    this.rig.animate({
      flapRate: this.state === "DYING" || this.player.mode === "dying" ? 2 : this.flapRate,
      flapAmp: this.player.mode === "dying" ? 0.4 : this.flapAmp,
      sweep: this.player.mode === "dying" ? 0.8 : this.sweep,
      jawOpen: this.jawOpen,
      dt,
      riderRoll: this.roll,
      riderPitchIn: this.pitch,
      riderSpeedT: Math.min(1, this.speed / maxSpeed),
      riderBoost: this.state === "BOOST",
    });
  }
}
