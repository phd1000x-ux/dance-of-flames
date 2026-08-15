export type DifficultyId = "story" | "normal" | "hard";

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  description: string;
  enemyDamage: number;
  enemyAccuracy: number;
  enemyCount: number;
  ballistaCount: number;
  healDropRate: number;
  aggression: number;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: "story",
    label: "Story",
    description: "Feel the fire. Enemies hit softer and miss more often.",
    enemyDamage: 0.6,
    enemyAccuracy: 0.6,
    enemyCount: 0.7,
    ballistaCount: 0.6,
    healDropRate: 1.6,
    aggression: 0.7,
  },
  {
    id: "normal",
    label: "Normal",
    description: "The Dance as it was danced.",
    enemyDamage: 1,
    enemyAccuracy: 1,
    enemyCount: 1,
    ballistaCount: 1,
    healDropRate: 1,
    aggression: 1,
  },
  {
    id: "hard",
    label: "Hard",
    description: "Every arrow finds its mark. Fewer flasks. More steel.",
    enemyDamage: 1.5,
    enemyAccuracy: 1.25,
    enemyCount: 1.3,
    ballistaCount: 1.5,
    healDropRate: 0.7,
    aggression: 1.4,
  },
];

export function applyDifficulty(id: string): DifficultyDef {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}
