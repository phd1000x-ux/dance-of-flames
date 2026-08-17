export interface DuelHit {
  applied: number;
  clamped: boolean;
  transitionNow: boolean;
}

export type CastellanPattern = "combo" | "shieldBreaker" | "javelin" | "reinforce";

/** Pure duel state: HP floor clamp + one-shot transition + reinforce gate. */
export class CastellanDuel {
  private _hp: number;
  readonly floor: number;
  transitioned = false;
  reinforceFired = false;
  private readonly reinforcePct: number;

  constructor(readonly maxHp: number, opts: { floorPct?: number; reinforcePct?: number } = {}) {
    const floorPct = opts.floorPct ?? 0.4;
    this.reinforcePct = opts.reinforcePct ?? 0.7;
    this._hp = maxHp;
    this.floor = maxHp * floorPct;
  }

  get hp(): number {
    return this._hp;
  }

  damage(n: number): DuelHit {
    if (this.transitioned) return { applied: 0, clamped: true, transitionNow: false };
    if (this._hp - n <= this.floor) {
      const applied = Math.max(0, this._hp - this.floor);
      this._hp = this.floor;
      this.transitioned = true;
      return { applied, clamped: true, transitionNow: true };
    }
    this._hp -= n;
    return { applied: n, clamped: false, transitionNow: false };
  }

  markTransitioned(): void {
    this.transitioned = true;
    this._hp = this.floor;
  }

  restoreHp(hp: number): void {
    // test API: re-arm the transition when HP is set above the floor again
    this._hp = hp;
    this.transitioned = false;
  }

  shouldReinforce(): boolean {
    return !this.reinforceFired && this._hp <= this.maxHp * this.reinforcePct && !this.transitioned;
  }
}

export function selectCastellanPattern(
  rand: () => number,
  dist: number,
  last: CastellanPattern | null,
  reinforceAvailable: boolean
): CastellanPattern {
  if (reinforceAvailable && rand() < 0.35) return "reinforce";
  if (dist > 12) return "javelin";
  const melee: CastellanPattern[] = ["combo", "shieldBreaker"];
  const filtered = last ? melee.filter((m) => m !== last) : melee;
  return filtered[Math.floor(rand() * filtered.length)] ?? "combo";
}
