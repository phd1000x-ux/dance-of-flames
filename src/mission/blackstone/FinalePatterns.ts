export type AirPattern = "sweep" | "charge" | "dive";

const WEIGHTS: { above: number; w: Record<AirPattern, number> }[] = [
  { above: 0.7, w: { sweep: 0.6, charge: 0.3, dive: 0.1 } },
  { above: 0.4, w: { sweep: 0.3, charge: 0.45, dive: 0.25 } },
  { above: 0.25, w: { sweep: 0.15, charge: 0.35, dive: 0.5 } },
];

export function selectPattern(hpFrac: number, last: AirPattern | null, rng: { range: (a: number, b: number) => number }): AirPattern {
  const row = WEIGHTS.find((r) => hpFrac > r.above) ?? { w: { sweep: 1, charge: 0, dive: 0 } as Record<AirPattern, number> };
  const order: AirPattern[] = ["charge", "sweep", "dive"];
  const pick = (exclude?: AirPattern): AirPattern => {
    let r = rng.range(0, 1);
    for (const p of order) {
      if (p === exclude) continue;
      r -= row.w[p];
      if (r <= 0) return p;
    }
    return order.filter((p) => p !== exclude && row.w[p] > 0).pop() ?? "sweep";
  };
  const first = pick();
  return first === last ? pick(last) : first;
}

export type AssaultBand = 0 | 1 | 2 | 3;

export function assaultBand(elapsed: number, duration = 75): AssaultBand {
  const remaining = duration - elapsed;
  if (remaining > 45) return 0;
  if (remaining > 20) return 1;
  if (remaining > 5) return 2;
  return 3;
}

export function assaultProfile(band: AssaultBand): { intervalMult: number; eliteBoost: number; musicPeak: number } {
  return [
    { intervalMult: 1.0, eliteBoost: 0, musicPeak: 0.7 },
    { intervalMult: 0.7, eliteBoost: 2, musicPeak: 0.85 },
    { intervalMult: 0.5, eliteBoost: 2, musicPeak: 1.0 },
    { intervalMult: 0.4, eliteBoost: 4, musicPeak: 1.0 },
  ][band];
}

export interface FinaleSnapshot {
  finalePhase: string;
  castellan: { hp: number; transitioned: boolean };
  vharax: { hp: number } | null;
  destroyedBuildings: number[];
  deadBallistae: number[];
  objectiveProgress: { id: string; progress: number; completed: boolean }[];
  player: { dragonHp: number; riderHp: number; mode: string; x: number; y: number; z: number; yaw: number };
  charges: { heal: number; fireBoost: number; armorWard: number };
  time: number;
}

export function validateSnapshot(s: unknown): FinaleSnapshot {
  const o = s as Partial<FinaleSnapshot>;
  const need = <T,>(v: T | undefined, f: string): T => {
    if (v === undefined) throw new Error(`[snapshot] missing ${f}`);
    return v;
  };
  const snap: FinaleSnapshot = {
    finalePhase: need(o.finalePhase, "finalePhase"),
    castellan: need(o.castellan, "castellan"),
    vharax: o.vharax ?? null,
    destroyedBuildings: need(o.destroyedBuildings, "destroyedBuildings"),
    deadBallistae: need(o.deadBallistae, "deadBallistae"),
    objectiveProgress: need(o.objectiveProgress, "objectiveProgress"),
    player: need(o.player, "player"),
    charges: need(o.charges, "charges"),
    time: need(o.time, "time"),
  };
  return snap;
}
