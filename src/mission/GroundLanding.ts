/** A circle the rider must not land inside (building footprint, castle block). */
export interface LandingObstacle {
  x: number;
  z: number;
  r: number;
}

/** Fight-ready landing distance from the nearest enemy group. */
export const LANDING_FIGHT_RANGE = 45;

/**
 * Where the rider lands after the dragon falls. Pure (unit tested).
 *
 * The dragon often dies far from any infantry (ballistae shoot from range), and
 * landing beside the wreck left the rider ~540 m from the fight with nothing to
 * do. When the nearest live soldier is further than ~60 m, the rider lands
 * LANDING_FIGHT_RANGE from it on the crash-facing side instead — close enough to
 * engage at once, not on top of the squad. Spots must be flat (`ok`) and clear
 * of obstacles; otherwise it falls back to the old near-wreck search.
 */
export function pickLandingSpot(
  crash: { x: number; z: number },
  enemies: readonly { x: number; z: number }[],
  obstacles: readonly LandingObstacle[],
  ok: (x: number, z: number) => boolean,
  rand: () => number
): { x: number; z: number } {
  const clear = (x: number, z: number) =>
    ok(x, z) && obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 3);

  let nearest: { x: number; z: number } | null = null;
  let best = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - crash.x, e.z - crash.z);
    if (d < best) {
      best = d;
      nearest = e;
    }
  }

  if (nearest && best > 60) {
    const base = Math.atan2(crash.z - nearest.z, crash.x - nearest.x);
    // fan out from the crash-facing direction: 0, +s, -s, +2s, ...
    for (let i = 0; i < 24; i++) {
      const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const a = base + k * 0.28;
      for (const r of [LANDING_FIGHT_RANGE, LANDING_FIGHT_RANGE - 12, LANDING_FIGHT_RANGE + 12]) {
        const x = nearest.x + Math.cos(a) * r;
        const z = nearest.z + Math.sin(a) * r;
        if (clear(x, z)) return { x, z };
      }
    }
  }

  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2;
    const r = 8 + rand() * 26;
    const x = crash.x + Math.cos(a) * r;
    const z = crash.z + Math.sin(a) * r;
    if (clear(x, z)) return { x, z };
  }
  return { x: crash.x, z: crash.z };
}

/**
 * Where an on-foot reinforcement squad enters: a ring around the rider, biased
 * toward the battlefield center so squads don't walk in from the mountains.
 */
export function reinforcementSpot(
  rider: { x: number; z: number },
  i: number,
  rand: () => number
): { x: number; z: number } {
  const towardCenter = Math.atan2(-rider.z, -rider.x);
  const a = towardCenter + (rand() - 0.5) * 1.6 + i * 0.35;
  const r = 34 + rand() * 12;
  return { x: rider.x + Math.cos(a) * r, z: rider.z + Math.sin(a) * r };
}
