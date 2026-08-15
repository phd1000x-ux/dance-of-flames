import type { StatModSource } from "../progression/StatBlock";

export interface EnemyDefinition {
  id: string;
  name: string;
  role: "infantry" | "archer" | "spear" | "shield" | "elite" | "siege" | "commander";
  hp: number;
  damage: number; // per hit (already difficulty-scaled at runtime)
  range: number; // attack range meters
  attackCooldown: number; // seconds
  accuracy: number; // 0..1 projectile spread factor
  moveSpeed: number;
  scoreValue: number;
  color: string;
  scale: number;
}

export const ENEMIES: Record<string, EnemyDefinition> = {
  swordsman: {
    id: "swordsman",
    name: "Swordsman",
    role: "infantry",
    hp: 40,
    damage: 12,
    range: 2.2,
    attackCooldown: 1.1,
    accuracy: 1,
    moveSpeed: 4.5,
    scoreValue: 30,
    color: "#7a4a3a",
    scale: 1,
  },
  archer: {
    id: "archer",
    name: "Archer",
    role: "archer",
    hp: 28,
    damage: 9,
    range: 120,
    attackCooldown: 2.4,
    accuracy: 0.75,
    moveSpeed: 4.2,
    scoreValue: 35,
    color: "#5a6a3a",
    scale: 0.95,
  },
  spearman: {
    id: "spearman",
    name: "Spearman",
    role: "spear",
    hp: 45,
    damage: 15,
    range: 3.2,
    attackCooldown: 1.5,
    accuracy: 1,
    moveSpeed: 4.4,
    scoreValue: 32,
    color: "#4a5a6a",
    scale: 1,
  },
  shieldman: {
    id: "shieldman",
    name: "Shield Soldier",
    role: "shield",
    hp: 70,
    damage: 14,
    range: 2.4,
    attackCooldown: 1.3,
    accuracy: 1,
    moveSpeed: 3.8,
    scoreValue: 45,
    color: "#6a6a7a",
    scale: 1.05,
  },
  elite: {
    id: "elite",
    name: "Elite Knight",
    role: "elite",
    hp: 220,
    damage: 26,
    range: 2.8,
    attackCooldown: 1.8,
    accuracy: 1,
    moveSpeed: 4.0,
    scoreValue: 150,
    color: "#3a2a4a",
    scale: 1.18,
  },
  ballista: {
    id: "ballista",
    name: "Siege Ballista",
    role: "siege",
    hp: 160,
    damage: 95,
    range: 260,
    attackCooldown: 6.5,
    accuracy: 0.9,
    moveSpeed: 0,
    scoreValue: 200,
    color: "#5a4a2a",
    scale: 1,
  },
  commander: {
    id: "commander",
    name: "Enemy Commander",
    role: "commander",
    hp: 320,
    damage: 32,
    range: 3.0,
    attackCooldown: 1.6,
    accuracy: 1,
    moveSpeed: 4.6,
    scoreValue: 400,
    color: "#5a1a1a",
    scale: 1.22,
  },
};

/** Ballista bolt damage is high — the player must learn to destroy them fast. */
export const BALLISTA_BOLT_DAMAGE = 95;
export const ARROW_DAMAGE_MIN = 5;
export const ARROW_DAMAGE_MAX = 12;
