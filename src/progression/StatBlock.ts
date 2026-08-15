/** Stat multipliers applied to dragon stats (shop upgrades, relics, rider bonds). */
export type StatBlock = Record<string, number>;

export interface StatModSource {
  /** maps stat name → multiplier (1 = no change) */
  [stat: string]: number;
}

/**
 * Compose final stats: start from base, apply every mod source multiplicatively.
 * Special keys with value 0 act as flags handled elsewhere (e.g. healFlat).
 */
export function computeFinalStats(base: StatBlock, modSources: StatModSource[]): StatBlock {
  const out: StatBlock = { ...base };
  for (const mods of modSources) {
    for (const [stat, mult] of Object.entries(mods)) {
      if (mult === 0) continue; // flag-style values, not multipliers
      out[stat] = (out[stat] ?? 0) * mult;
    }
  }
  return out;
}

export function getStat(stats: StatBlock, key: string, fallback = 0): number {
  const v = stats[key];
  return v === undefined || Number.isNaN(v) ? fallback : v;
}
