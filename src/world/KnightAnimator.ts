import { Vector3 } from "@babylonjs/core";
import type { CharacterModel, HeldWeapon } from "./CharacterAssets";

/**
 * Procedural body animation for the imported ground knight (the source GLB only
 * ships an idle clip). Two ideas keep it from looking robotic:
 *  - gait is phase-driven by distance travelled, with knee flex in the swing
 *    phase, pelvis bob/twist and counter-swinging arms, so feet don't skate;
 *  - attacks are full-body keyframes (arm, elbow, torso, stance) sampled with a
 *    Catmull-Rom spline, so the motion flows through keys instead of stopping
 *    at each one, then everything is damped so state changes never pop.
 */

/** combat pose channels, all radians except step (0..1 stance depth) */
export interface CombatPose {
  /** R_arm about the knight's right axis: + raises forward */
  armX: number;
  /** R_arm about the forward axis: − lifts out/overhead, + sweeps across the body */
  armZ: number;
  /** R_elbow bend */
  elbow: number;
  /** torso yaw, + turns right */
  twist: number;
  /** torso pitch, + leans into the strike */
  lean: number;
  /** stance: left foot forward, knees bent */
  step: number;
  /** off-hand arm raised forward for balance */
  lArm: number;
}

type Key = [t: number, armX: number, armZ: number, elbow: number, twist: number, lean: number, step: number, lArm: number];
const CHANNELS = ["armX", "armZ", "elbow", "twist", "lean", "step", "lArm"] as const;

/** weapon up and ready in front, knees soft, off hand forward */
export const READY: CombatPose = { armX: 0.55, armZ: -0.3, elbow: 0.95, twist: 0.15, lean: 0.06, step: 0.3, lArm: 0.45 };
/** relaxed carry when nothing is happening */
export const RELAXED: CombatPose = { armX: 0, armZ: 0, elbow: 0.15, twist: 0, lean: 0, step: 0, lArm: 0 };
/** guard: haft held across the face, off hand braced */
export const GUARD: CombatPose = { armX: 1.05, armZ: 0.4, elbow: 1.0, twist: -0.2, lean: 0.12, step: 0.55, lArm: 0.8 };

const r = READY;
const ready = (t: number): Key => [t, r.armX, r.armZ, r.elbow, r.twist, r.lean, r.step, r.lArm];

/**
 * Wind-up keys sit late (slow anticipation), the strike spans only ~0.15 of the
 * swing (fast), and a follow-through key past contact lets it carry through.
 * Contact lines up with ATTACK_HIT_AT / ATTACK_DURATION (light ≈0.48, heavy ≈0.57).
 */
export const AXE_SWINGS: Record<string, Key[]> = {
  // forehand diagonal: high right → low left
  light1: [ready(0), [0.34, -0.5, -1.7, 1.25, 0.6, -0.08, 0.35, 0.35], [0.5, 1.3, 0.45, 0.12, -0.55, 0.26, 0.68, 0.15], [0.64, 1.05, 0.8, 0.3, -0.7, 0.28, 0.66, 0.1], ready(1)],
  // backhand rising: low left → high right
  light2: [ready(0), [0.34, 0.9, 1.05, 1.4, -0.65, 0.02, 0.42, 0.25], [0.5, 1.05, -1.2, 0.2, 0.6, 0.14, 0.6, 0.5], [0.64, 0.85, -1.5, 0.35, 0.72, 0.1, 0.58, 0.55], ready(1)],
  // overhead chop finisher
  light3: [ready(0), [0.38, -0.35, -2.3, 1.45, 0.22, -0.22, 0.3, 0.65], [0.52, 1.5, 0.1, 0.1, -0.12, 0.42, 0.78, 0.15], [0.66, 1.25, 0.15, 0.22, -0.06, 0.46, 0.78, 0.1], ready(1)],
  // two-beat heavy: deep coil, crouch, full overhead cleave
  heavy: [ready(0), [0.32, -0.65, -2.35, 1.5, 0.65, -0.3, 0.2, 0.75], [0.47, -0.75, -2.45, 1.55, 0.7, -0.34, 0.22, 0.8], [0.59, 1.75, 0.3, 0.05, -0.4, 0.52, 0.95, 0.0], [0.76, 1.5, 0.35, 0.18, -0.45, 0.56, 0.92, 0.0], ready(1)],
};

/** non-uniform Catmull-Rom (tension 0.7) through the keys; flat at both ends */
export function axeSwingPose(attack: string, t: number): CombatPose {
  const keys = AXE_SWINGS[attack];
  if (!keys) return { ...READY };
  t = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const prev = keys[i - 1], next = keys[i + 2];
  const h = b[0] - a[0];
  const u = h > 0 ? (t - a[0]) / h : 0;
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const tangent = (lo: Key | undefined, hi: Key | undefined, c: number) =>
    lo && hi ? 0.7 * (hi[c] - lo[c]) / (hi[0] - lo[0]) : 0;
  const out = {} as CombatPose;
  CHANNELS.forEach((name, k) => {
    const c = k + 1;
    const m0 = tangent(prev, b, c) * h;
    const m1 = tangent(a, next, c) * h;
    out[name] = h00 * a[c] + h10 * m0 + h01 * b[c] + h11 * m1;
  });
  return out;
}

export interface GaitPose {
  lLeg: number; rLeg: number; lKnee: number; rKnee: number;
  lArm: number; rArm: number; lElbow: number; rElbow: number;
  hipYaw: number; chestYaw: number; lean: number; bob: number;
}

/**
 * One gait sample. phase is the left leg's cycle angle; amount 0..1 fades the
 * whole cycle in/out; run 0..1 blends walk → run (longer reach, higher knees,
 * forward lean, pumping arms). Measured on the knight in root space: leg + =
 * thigh forward, knee − = natural bend, spine − = lean forward, elbow + = bend.
 */
export function gaitPose(phase: number, amount: number, run: number): GaitPose {
  const reach = (0.42 + 0.3 * run) * amount;
  const s = Math.sin(phase), c = Math.cos(phase);
  // knee flexes while the leg swings forward (thigh moving forward = cos > 0)
  const kneeAmp = (0.75 + 0.75 * run) * amount;
  const knee = (x: number) => -(0.06 * amount + kneeAmp * Math.pow(Math.max(0, x), 1.6));
  const armAmp = (0.38 + 0.4 * run) * amount;
  return {
    lLeg: reach * s, rLeg: -reach * s,
    lKnee: knee(c), rKnee: knee(-c),
    lArm: -armAmp * s + 0.05 * amount, rArm: armAmp * s,
    lElbow: (0.25 + 0.7 * run) * amount, rElbow: (0.25 + 0.7 * run) * amount,
    hipYaw: 0.12 * reach * s, chestYaw: -0.2 * reach * s,
    lean: (0.04 + 0.2 * run) * amount,
    // lowest at heel strike (thighs at full reach), highest passing mid-stance
    bob: (0.035 + 0.03 * run) * amount * Math.cos(2 * phase),
  };
}

export interface KnightFrame {
  dt: number;
  /** ground speed (m/s) and its sign along facing (+1 forward, −1 backpedal) */
  speed: number;
  direction: number;
  attack: string; // "none" | light1..3 | heavy
  attackT: number; // 0..1
  blocking: boolean;
  dodging: boolean;
  /** knight faces this way (world), used to aim the guard */
  yaw: number;
}

export class KnightAnimator {
  private phase = 0;
  private gaitAmount = 0;
  private run = 0;
  private combat: CombatPose = { ...RELAXED };
  private readyTimer = 0;
  /** extra root y the animator wants (bob + crouch), applied by the caller */
  rootOffsetY = 0;

  constructor(private model: CharacterModel, private weapon: HeldWeapon | null) {}

  update(f: KnightFrame): void {
    const { dt } = f;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const moving = f.speed > 0.25 && !f.dodging;
    this.gaitAmount += ((moving ? Math.min(1, f.speed / 2.5) : 0) - this.gaitAmount) * k(9);
    this.run += ((moving ? Math.max(0, Math.min(1, (f.speed - 4.5) / 3)) : 0) - this.run) * k(6);
    // one step ≈ 0.7m walking, ≈1.15m running: phase follows distance, so no foot skate
    const stepLen = 0.7 + 0.45 * this.run;
    this.phase += f.direction * dt * Math.PI * f.speed / stepLen;

    const attacking = f.attack !== "none";
    if (attacking || f.blocking) this.readyTimer = 2.5;
    else this.readyTimer = Math.max(0, this.readyTimer - dt);
    const target = attacking ? axeSwingPose(f.attack, f.attackT)
      : f.blocking ? GUARD
      : this.readyTimer > 0 ? READY : RELAXED;
    // swings track their spline tightly; stance changes ease in and out
    const rate = attacking ? 32 : f.blocking ? 20 : 6;
    for (const ch of CHANNELS) this.combat[ch] += (target[ch] - this.combat[ch]) * k(rate);

    const m = this.model;
    const g = gaitPose(this.phase, this.gaitAmount, this.run);
    const p = this.combat;
    // combat stance suppresses the walk's arm swing on the weapon side
    const armed = Math.min(1, Math.abs(p.armX) + Math.abs(p.armZ) + p.step);
    const stance = p.step * (1 - this.gaitAmount * 0.7);

    m.pose("hips_", 0, g.hipYaw + p.twist * 0.25);
    m.pose("spine_", -(g.lean + p.lean * 0.5), g.chestYaw * 0.5 + p.twist * 0.35);
    m.pose("chest_", -p.lean * 0.5, g.chestYaw * 0.5 + p.twist * 0.4);
    m.pose("L_leg_", g.lLeg + stance * 0.45);
    m.pose("R_leg_", g.rLeg - stance * 0.3);
    m.pose("L_knee_", g.lKnee - stance * 0.55);
    m.pose("R_knee_", g.rKnee - stance * 0.45);
    m.pose("R_arm_", p.armX + g.rArm * (1 - armed), 0, p.armZ);
    m.pose("R_elbow_", p.elbow + g.rElbow * (1 - armed) * 0.5);
    m.pose("L_arm_", g.lArm + p.lArm, 0, 0.18 * p.lArm);
    m.pose("L_elbow_", g.lElbow + p.lArm * 0.9);
    m.pose("head_", p.lean * 0.4, -p.twist * 0.6);
    this.rootOffsetY = g.bob - stance * 0.1;

    if (!this.weapon) return;
    if (f.blocking && !attacking) {
      // haft held level across the face, head toward the off side
      const fwd = new Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
      const right = new Vector3(fwd.z, 0, -fwd.x);
      this.weapon.aim(1, dt, right.scale(-0.85).addInPlace(new Vector3(0, 0.45, 0)).addInPlace(fwd.scale(0.25)));
    } else if (attacking || this.readyTimer > 0) {
      // haft continues the forearm, so the head leads every arc
      this.weapon.aim(1, dt, null, "R_elbow_");
    } else {
      this.weapon.aim(0, dt);
    }
  }
}
