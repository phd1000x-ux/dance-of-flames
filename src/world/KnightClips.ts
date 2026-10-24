import { Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { CharacterModel, HeldWeapon } from "./CharacterAssets";
import type { KnightFrame } from "./KnightAnimator";
import { ATTACK_DURATION, ATTACK_HIT_AT } from "../player/RiderController";

/**
 * Mixamo motion-capture clips baked onto the knight skeleton by
 * scripts/retarget-mixamo.mjs: per-frame local bone rotations, so playback is
 * just sampling + blending quaternions.
 */
export interface KnightClipData {
  fps: number;
  bones: string[];
  hipHeight: number;
  clips: Record<string, { frames: number; start: number; contact: number; end: number; q: number[]; hipsY: number[] }>;
}

const sceneClips = new WeakMap<object, Promise<KnightClipData>>();
export function loadKnightClips(key: object): Promise<KnightClipData> {
  let p = sceneClips.get(key);
  if (!p) {
    p = fetch("/character-prototype/knight-anims.json").then(r => {
      if (!r.ok) throw new Error(`knight-anims.json ${r.status}`);
      return r.json() as Promise<KnightClipData>;
    });
    sceneClips.set(key, p);
  }
  return p;
}

/** reference ground speeds (m/s) the in-place walk/run cycles look right at */
const WALK_SPEED = 2.2;
const RUN_SPEED = 6.2;
/** how much of the clip before contact the wind-up covers (frames @30fps) */
const WINDUP_FRAMES = 12;
const ATTACK_CLIPS: Record<string, string> = { light1: "slash1", light2: "slash2", light3: "slash3", heavy: "heavy" };

type Pose = Quaternion[];

/** per-frame input; soldiers add burning and their own swing-contact timing */
export type KnightClipInput = KnightFrame & {
  alive: boolean;
  hurt: boolean;
  /** flail in place (looped impact) */
  burning?: boolean;
  /** fraction of attackT where the blow lands (default: the player's gameplay timing) */
  contactT?: number;
  /** false = the caller aims/seats the weapon itself */
  driveWeapon?: boolean;
};

interface Layer { clip: string; time: number; elapsed: number; weight: number; loop: boolean }

export class KnightClipPlayer {
  private readonly nodes: (TransformNode | undefined)[];
  private readonly pose: Pose;
  private readonly scratch: Pose;
  private readonly scratch2: Pose;
  /** cross-fading one-shot/loop "action" layer over locomotion */
  private action: Layer | null = null;
  private fading: Layer | null = null;
  private fadeT = 0;
  private locoPhase = 0;
  private idleTime = 0;
  private lastAttack = "none";
  private hitTimer = 0;
  private readonly hipHeightM: number;
  /** extra root y from the clip's hip bob (m), applied by the caller */
  rootOffsetY = 0;

  /** phase: 0..1 offset into the idle/locomotion cycles, so crowds don't move in lockstep */
  constructor(private model: CharacterModel, private data: KnightClipData, private weapon: HeldWeapon | null, phase = 0) {
    this.nodes = data.bones.map(b => model.node(b));
    this.pose = data.bones.map(() => new Quaternion());
    this.scratch = data.bones.map(() => new Quaternion());
    this.scratch2 = data.bones.map(() => new Quaternion());
    this.locoPhase = phase;
    this.idleTime = phase * (data.clips.idle.frames - 1) / data.fps;
    // knight hip height in meters (model raw units × import scale)
    this.hipHeightM = data.hipHeight * this.rawToMeters();
  }

  /** world meters per raw knight unit: hips→head span in the GLB vs in the scene */
  private rawToMeters(): number {
    const hips = this.model.node("hips_"), head = this.model.node("head_");
    if (!hips || !head || !(head.parent instanceof TransformNode)) return 0.01;
    this.model.root.computeWorldMatrix(true);
    for (const n of this.model.nodes) n.computeWorldMatrix(true);
    let raw = 0, node: TransformNode | null = head;
    // raw chain length = sum of local translations from head up to hips
    while (node && node !== hips) { raw += node.position.length(); node = node.parent instanceof TransformNode ? node.parent : null; }
    const world = Vector3.Distance(head.getAbsolutePosition(), hips.getAbsolutePosition());
    return raw > 0 ? world / raw : 0.01;
  }

  /** clip pose at time (s) into out; loops wrap, one-shots clamp */
  private sample(name: string, time: number, loop: boolean, out: Pose): number {
    const c = this.data.clips[name];
    const n = this.data.bones.length;
    let f = time * this.data.fps;
    f = loop ? ((f % (c.frames - 1)) + (c.frames - 1)) % (c.frames - 1) : Math.max(0, Math.min(c.frames - 1, f));
    const f0 = Math.floor(f), f1 = Math.min(c.frames - 1, f0 + 1), u = f - f0;
    const a = new Quaternion(), b = new Quaternion();
    for (let i = 0; i < n; i++) {
      const o0 = (f0 * n + i) * 4, o1 = (f1 * n + i) * 4;
      a.set(c.q[o0], c.q[o0 + 1], c.q[o0 + 2], c.q[o0 + 3]);
      b.set(c.q[o1], c.q[o1 + 1], c.q[o1 + 2], c.q[o1 + 3]);
      Quaternion.SlerpToRef(a, b, u, out[i]);
    }
    return c.hipsY[f0] * (1 - u) + c.hipsY[f1] * u;
  }

  private blendInto(target: Pose, src: Pose, w: number): void {
    for (let i = 0; i < target.length; i++) Quaternion.SlerpToRef(target[i], src[i], w, target[i]);
  }

  /** gameplay swing progress t (0..1) → clip seconds: wind-up to contact, then follow-through */
  private attackTime(attack: string, t: number, contactT?: number): number {
    const c = this.data.clips[ATTACK_CLIPS[attack]];
    const heavy = attack === "heavy";
    const hit = contactT ?? (heavy ? ATTACK_HIT_AT.heavy : ATTACK_HIT_AT.light) / (heavy ? ATTACK_DURATION.heavy : ATTACK_DURATION.light);
    const from = Math.max(c.start, c.contact - WINDUP_FRAMES), to = c.end;
    const f = t < hit ? from + (c.contact - from) * (t / hit) : c.contact + (to - c.contact) * ((t - hit) / (1 - hit));
    return f / this.data.fps;
  }

  private setAction(clip: string | null, loop: boolean, fade: number): void {
    if ((this.action?.clip ?? null) === clip && clip !== null) return;
    this.fading = this.action;
    this.fadeT = fade;
    this.action = clip ? { clip, time: 0, elapsed: 0, weight: 0, loop } : null;
  }

  update(f: KnightClipInput): void {
    const dt = f.dt;
    // ---- choose the action layer ----
    if (!f.alive) this.setAction("death", false, 0.15);
    else if (f.dodging) this.setAction("roll", false, 0.08);
    else if (f.attack !== "none") {
      const clip = ATTACK_CLIPS[f.attack];
      // a new combo step always restarts, even from the same clip
      if (f.attack !== this.lastAttack) { this.action = null; this.setAction(clip, false, 0.1); }
    } else if (f.burning) this.setAction("hit", true, 0.1);
    else if (f.blocking) this.setAction("block", true, 0.12);
    else if (f.hurt && this.hitTimer <= 0) { this.hitTimer = 0.45; this.action = null; this.setAction("hit", false, 0.06); }
    else if (this.hitTimer <= 0) this.setAction(null, false, 0.2);
    this.lastAttack = f.attack;
    this.hitTimer = Math.max(0, this.hitTimer - dt);

    // ---- locomotion: idle ↔ walk ↔ run, cycles share one normalized phase ----
    const walk = this.data.clips.walk, run = this.data.clips.run;
    const runW = Math.max(0, Math.min(1, (f.speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
    const moveW = f.dodging ? 0 : Math.max(0, Math.min(1, f.speed / 1.2));
    const cycleLen = ((walk.frames - 1) * (1 - runW) + (run.frames - 1) * runW) / this.data.fps;
    const refSpeed = WALK_SPEED + (RUN_SPEED - WALK_SPEED) * runW;
    const rate = Math.max(0.6, Math.min(1.7, f.speed / refSpeed));
    this.locoPhase += f.direction * dt * rate / cycleLen;
    this.idleTime += dt;
    const fps = this.data.fps;
    let hip = this.sample("idle", this.idleTime, true, this.pose);
    if (moveW > 0.001) {
      const hw = this.sample("walk", this.locoPhase * (walk.frames - 1) / fps, true, this.scratch);
      let moving = hw;
      if (runW > 0.001) {
        const hr = this.sample("run", this.locoPhase * (run.frames - 1) / fps, true, this.scratch2);
        this.blendInto(this.scratch, this.scratch2, runW);
        moving = hw * (1 - runW) + hr * runW;
      }
      this.blendInto(this.pose, this.scratch, moveW);
      hip = hip * (1 - moveW) + moving * moveW;
    }

    // ---- action layers (fading-out one first, then the current one) ----
    const step = dt / Math.max(0.01, this.fadeT);
    if (this.fading) {
      this.fading.weight -= step;
      if (this.fading.weight <= 0.01) this.fading = null;
      else { this.advance(this.fading, f, false); hip = this.applyLayer(this.fading, hip); }
    }
    if (this.action) {
      this.action.weight = Math.min(1, this.action.weight + step);
      this.advance(this.action, f, true);
      hip = this.applyLayer(this.action, hip);
    }

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (!n) continue;
      (n.rotationQuaternion ??= new Quaternion()).copyFrom(this.pose[i]);
    }
    this.rootOffsetY = hip * this.hipHeightM;
    if (f.driveWeapon !== false) this.weapon?.aim(0, dt);
  }

  /** attack clips follow the gameplay swing while it lasts, then run on freely */
  private advance(layer: Layer, f: KnightClipInput, current: boolean): void {
    layer.elapsed += f.dt;
    if (current && ATTACK_CLIPS[f.attack] === layer.clip) layer.time = this.attackTime(f.attack, f.attackT, f.contactT);
    else if (layer.clip === "roll") layer.time = this.rollTime(layer.elapsed);
    else layer.time += f.dt;
  }

  private applyLayer(layer: Layer, hip: number): number {
    const h = this.sample(layer.clip, layer.time, layer.loop, this.scratch);
    this.blendInto(this.pose, this.scratch, layer.weight);
    return hip * (1 - layer.weight) + h * layer.weight;
  }

  /** the dive roll's tumble squeezed into the gameplay dodge (0.42s), then its recovery */
  private rollTime(t: number): number {
    const c = this.data.clips.roll;
    const dodge = 0.42;
    const f = t < dodge ? c.start + (c.contact + 8 - c.start) * (t / dodge) : c.contact + 8 + (t - dodge) * this.data.fps * 1.6;
    return Math.min(c.end, f) / this.data.fps;
  }
}
