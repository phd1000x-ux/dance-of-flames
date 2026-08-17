export type DamageState = "INTACT" | "SCORCHED" | "DAMAGED" | "CRITICAL" | "COLLAPSING" | "DESTROYED";

export function damageStateFor(hpFrac: number): DamageState {
  if (hpFrac > 0.85) return "INTACT";
  if (hpFrac > 0.6) return "SCORCHED";
  if (hpFrac > 0.35) return "DAMAGED";
  return "CRITICAL";
}

export interface DamageVisual {
  diffuseScale: number;
  ember: [number, number, number];
  fireRate: number;
  smokeRate: number;
}

export const DAMAGE_VISUALS: Record<DamageState, DamageVisual> = {
  INTACT: { diffuseScale: 1.0, ember: [0, 0, 0], fireRate: 0, smokeRate: 0 },
  SCORCHED: { diffuseScale: 0.82, ember: [0.08, 0.02, 0], fireRate: 0, smokeRate: 6 },
  DAMAGED: { diffuseScale: 0.68, ember: [0.22, 0.05, 0], fireRate: 50, smokeRate: 14 },
  CRITICAL: { diffuseScale: 0.55, ember: [0.4, 0.09, 0], fireRate: 90, smokeRate: 24 },
  COLLAPSING: { diffuseScale: 0.5, ember: [0.4, 0.09, 0], fireRate: 60, smokeRate: 30 },
  DESTROYED: { diffuseScale: 0.45, ember: [0.1, 0.02, 0], fireRate: 18, smokeRate: 8 },
};
