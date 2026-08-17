import { Mesh, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EffectsLibrary } from "../../world/EffectsLibrary";

/**
 * SPIRE BREAKER — the authored finale crash choreography.
 *
 * Time-driven keyframes (advanced by finale dt, wall-clock independent):
 *   t≈1.2  wing hit   — crown detaches: tilt + topple + fall (2.2 s), dust
 *   t≈2.4  body through — explosion ×2.2, dust ×2.5, shake 1.6, vharax hidden
 *   t≈4.5  done       — crown at rest, sequence complete
 *
 * Vharax plunges from its stagger position: clips the crown with a wing,
 * then drives through the tower body before being disabled at the impact.
 */
const T_WING = 1.2;
const T_BODY = 2.4;
const T_DONE = 4.5;
const CROWN_FALL = 2.2;
const CROWN_DRIFT = 14;
const CROWN_TILT = 1.35;

export class SpireBreaker {
  private t = 0;
  private crown: Mesh | null = null;
  private vharaxRoot: TransformNode | null = null;
  private readonly crownHome = new Vector3();
  private readonly plungeStart = new Vector3();
  private readonly wingPos = new Vector3();
  private readonly bodyPos = new Vector3();
  private readonly restPos = new Vector3();
  private wingFired = false;
  private bodyFired = false;
  private done_ = false;
  private detached_ = false;

  constructor(
    private effects: EffectsLibrary,
    private bus: GameEventBus,
    private shake: (s: number) => void
  ) {}

  get detached(): boolean {
    return this.detached_;
  }

  begin(crown: Mesh, spireBaseTop: Vector3, vharaxRoot: TransformNode): void {
    this.crown = crown;
    this.vharaxRoot = vharaxRoot;
    this.crownHome.copyFrom(crown.position);
    this.plungeStart.copyFrom(vharaxRoot.position);
    // wing clip just above the crown mid; body-through down the tower shaft
    this.wingPos.set(spireBaseTop.x + 7, spireBaseTop.y + 13, spireBaseTop.z);
    this.bodyPos.set(spireBaseTop.x, spireBaseTop.y - 22, spireBaseTop.z + 4);
    // crown topples off the tower and comes to rest beside its base
    this.restPos.set(crown.position.x + CROWN_DRIFT, spireBaseTop.y - 42, crown.position.z + 3);
    this.t = 0;
    this.wingFired = false;
    this.bodyFired = false;
    this.done_ = false;
    this.detached_ = false;
    this.bus.emit("sfx", { name: "deepRoar" });
  }

  /** returns true when the sequence is complete */
  update(dt: number): boolean {
    if (this.done_) return true;
    this.t += dt;
    const t = this.t;

    // vharax plunge: stagger position → wing clip → through the tower
    if (this.vharaxRoot && t < T_BODY) {
      const p =
        t < T_WING
          ? Vector3.Lerp(this.plungeStart, this.wingPos, Math.min(1, t / T_WING))
          : Vector3.Lerp(this.wingPos, this.bodyPos, (t - T_WING) / (T_BODY - T_WING));
      const ahead =
        t < T_WING
          ? Vector3.Lerp(this.plungeStart, this.wingPos, Math.min(1, (t + dt) / T_WING))
          : Vector3.Lerp(this.wingPos, this.bodyPos, Math.min(1, (t + dt - T_WING) / (T_BODY - T_WING)));
      const dir = ahead.subtract(p);
      const yaw = dir.lengthSquared() > 1e-6 ? Math.atan2(dir.x, dir.z) : 0;
      const pitch = dir.lengthSquared() > 1e-6 ? Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) : 0;
      this.vharaxRoot.position.copyFrom(p);
      this.vharaxRoot.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0.2);
    }

    if (t >= T_WING && !this.wingFired) {
      this.wingFired = true;
      this.detached_ = true;
      this.effects.dust(this.crownHome.clone(), 1.2);
      this.shake(0.6);
      this.bus.emit("sfx", { name: "collapse" });
    }

    // detached crown: accelerate downward while toppling sideways
    if (this.detached_ && this.crown) {
      const f = Math.min(1, (t - T_WING) / CROWN_FALL);
      this.crown.position.y = this.crownHome.y + (this.restPos.y - this.crownHome.y) * f * f;
      this.crown.position.x = this.crownHome.x + (this.restPos.x - this.crownHome.x) * f;
      this.crown.position.z = this.crownHome.z + (this.restPos.z - this.crownHome.z) * f;
      this.crown.rotation.z = f * CROWN_TILT;
      this.crown.rotation.x = f * 0.3;
    }

    if (t >= T_BODY && !this.bodyFired) {
      this.bodyFired = true;
      this.effects.explosion(this.bodyPos.clone(), 2.2);
      this.effects.dust(new Vector3(this.bodyPos.x, this.bodyPos.y - 18, this.bodyPos.z), 2.5);
      this.shake(1.6);
      this.vharaxRoot?.setEnabled(false);
      this.bus.emit("sfx", { name: "explosion" });
    }

    if (t >= T_DONE) {
      this.done_ = true;
      return true;
    }
    return false;
  }

  /** snap to the end state — force-advance / checkpoint-restore path (breaker-optional) */
  finish(): void {
    if (this.done_) return;
    if (!this.bodyFired) {
      this.bodyFired = true;
      this.vharaxRoot?.setEnabled(false);
    }
    if (this.crown) {
      this.detached_ = true;
      this.crown.position.copyFrom(this.restPos);
      this.crown.rotation.z = CROWN_TILT;
      this.crown.rotation.x = 0.3;
    }
    this.done_ = true;
  }
}
