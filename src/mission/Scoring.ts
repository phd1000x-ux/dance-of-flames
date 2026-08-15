export interface MissionStats {
  kills: number;
  buildingsDestroyed: number;
  coinsCollected: number;
  relicsFound: number;
  damageTaken: number;
  dragonSurvived: boolean;
  timeSeconds: number;
}

export function emptyStats(): MissionStats {
  return {
    kills: 0,
    buildingsDestroyed: 0,
    coinsCollected: 0,
    relicsFound: 0,
    damageTaken: 0,
    dragonSurvived: true,
    timeSeconds: 0,
  };
}

export function scoreMission(s: MissionStats): number {
  let score = 0;
  score += s.kills * 30;
  score += s.buildingsDestroyed * 80;
  score += s.coinsCollected * 2;
  score += s.relicsFound * 250;
  score += s.dragonSurvived ? 800 : 0;
  score += Math.max(0, 600 - s.damageTaken); // damage-taken penalty up to 600
  score += Math.max(0, 420 - s.timeSeconds) * 2; // speed bonus
  return Math.round(score);
}

export function rankFor(score: number): "S" | "A" | "B" | "C" {
  if (score >= 4000) return "S";
  if (score >= 2200) return "A";
  if (score >= 1000) return "B";
  return "C";
}
