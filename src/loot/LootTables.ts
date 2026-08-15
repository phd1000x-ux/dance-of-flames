import { SeededRng } from "../core/SeededRng";

export type LootKind = "none" | "coin" | "healSmall" | "healLarge" | "buff";

export interface LootRoll {
  kind: LootKind;
  value?: number;
}

export interface LootOptions {
  /** Multiplier applied to healing drop weights (difficulty). */
  healMod?: number;
  /** Multiplier applied to coin drop weight (difficulty / mission tuning). */
  coinMod?: number;
}

/** Section 32 base weights. */
export function rollLoot(rng: SeededRng, opts: LootOptions = {}): LootRoll {
  const heal = opts.healMod ?? 1;
  const coin = opts.coinMod ?? 1;
  const table = [
    { kind: "none" as LootKind, weight: 25 },
    { kind: "coin" as LootKind, weight: 60 * coin },
    { kind: "healSmall" as LootKind, weight: 10 * heal },
    { kind: "healLarge" as LootKind, weight: 4 * heal },
    { kind: "buff" as LootKind, weight: 1 },
  ];
  return { kind: rng.weighted(table).kind };
}

/** Coin denominations: 1 common, 2, 5 uncommon, 10 rare. */
export function coinValue(rng: SeededRng): number {
  return rng.weighted([
    { weight: 70, value: 1 },
    { weight: 20, value: 2 },
    { weight: 9, value: 5 },
    { weight: 1, value: 10 },
  ]).value;
}
