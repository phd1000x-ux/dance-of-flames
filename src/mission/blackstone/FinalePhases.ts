export type FinalePhase =
  | "INACTIVE"
  | "AWAIT_LANDING"
  | "DUEL_GROUND"
  | "TRANSITION"
  | "REVEAL"
  | "MOUNT"
  | "REMOUNT"
  | "CHASE"
  | "DUEL_AIR"
  | "RESOLVED";

/** legal successors — RESOLVED is the universal fallback (dragon death, short-circuit) */
export const FINALE_TRANSITIONS: Record<FinalePhase, FinalePhase[]> = {
  INACTIVE: ["AWAIT_LANDING"],
  AWAIT_LANDING: ["DUEL_GROUND", "RESOLVED"],
  DUEL_GROUND: ["TRANSITION", "RESOLVED"],
  TRANSITION: ["REVEAL", "RESOLVED"],
  REVEAL: ["MOUNT", "RESOLVED"],
  MOUNT: ["REMOUNT", "RESOLVED"],
  REMOUNT: ["CHASE", "RESOLVED"],
  CHASE: ["DUEL_AIR", "RESOLVED"],
  DUEL_AIR: ["RESOLVED"],
  RESOLVED: [],
};

export function canTransition(from: FinalePhase, to: FinalePhase): boolean {
  return FINALE_TRANSITIONS[from].includes(to);
}

export class PhaseMachine {
  constructor(private _current: FinalePhase = "INACTIVE") {}
  get current(): FinalePhase {
    return this._current;
  }
  transition(to: FinalePhase): boolean {
    if (!canTransition(this._current, to)) return false;
    this._current = to;
    return true;
  }
  isTerminal(): boolean {
    return this._current === "RESOLVED";
  }
}
