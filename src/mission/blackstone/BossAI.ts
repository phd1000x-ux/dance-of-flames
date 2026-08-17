export interface PathPoint {
  x: number;
  z: number;
}

/** >max → boss slows 10%; <min → boss speeds 10%; inside band → 0 */
export function rubberBandFactor(dist: number, min = 60, max = 90): number {
  if (dist > max) return -0.1;
  if (dist < min) return 0.1;
  return 0;
}

/** Returns the (possibly advanced/wrapped) waypoint index. */
export function advanceWaypoint(px: number, pz: number, path: PathPoint[], idx: number, reachRadius = 25): number {
  const wp = path[idx % path.length];
  const dx = px - wp.x;
  const dz = pz - wp.z;
  if (dx * dx + dz * dz < reachRadius * reachRadius) return (idx + 1) % path.length;
  return idx;
}

export type SweepState = "IDLE" | "TELEGRAPH" | "ATTACK" | "RECOVERY";

/** One flame-sweep cycle: TELEGRAPH → ATTACK → RECOVERY (player window) → IDLE. */
export class FlameSweepSM {
  private _state: SweepState = "IDLE";
  private _t = 0;
  constructor(private opts: { telegraph: number; attack: number; recovery: number }) {}
  get state(): SweepState {
    return this._state;
  }
  get t(): number {
    return this._t;
  }
  start(): boolean {
    if (this._state !== "IDLE") return false;
    this._state = "TELEGRAPH";
    this._t = 0;
    return true;
  }
  /** hard reset — state exits that bypass the cycle (RETURN/STAGGER/flee) must not leave a mid-sweep remnant */
  reset(): void {
    this._state = "IDLE";
    this._t = 0;
  }
  update(dt: number): void {
    if (this._state === "IDLE") return;
    this._t += dt;
    const dur =
      this._state === "TELEGRAPH" ? this.opts.telegraph :
      this._state === "ATTACK" ? this.opts.attack :
      this.opts.recovery;
    if (this._t >= dur) {
      this._t = 0;
      this._state =
        this._state === "TELEGRAPH" ? "ATTACK" :
        this._state === "ATTACK" ? "RECOVERY" : "IDLE";
    }
  }
}
