import type { StatModSource } from "../progression/StatBlock";

export interface RiderGroundStats {
  hp: number;
  armor: number;
  swordDamage: number;
  heavyMultiplier: number;
  stamina: number;
  block: number; // 0..1 fraction blocked
  dodgeCost: number;
  moveSpeed: number;
}

export interface RiderDefinition {
  id: string;
  name: string;
  title: string;
  faction: string;
  description: string;
  /** canon dragon — used only as default pairing & "Bonded" badge (never hardcoded in logic) */
  bondedDragonId: string;
  /** multiplicative bonuses to dragon stats when riding (bond synergy) */
  dragonBonus: StatModSource;
  ground: RiderGroundStats;
  color: string;
}

export const RIDERS: RiderDefinition[] = [
  {
    id: "rhaenyra",
    name: "Rhaenyra Targaryen",
    title: "The Realm's Delight",
    faction: "The Black Council",
    description: "The declared heir. Rides with a light touch and an iron will.",
    bondedDragonId: "syrax",
    dragonBonus: { maxSpeed: 1.05, turnRate: 1.08 },
    ground: { hp: 200, armor: 18, swordDamage: 26, heavyMultiplier: 2.1, stamina: 100, block: 0.6, dodgeCost: 22, moveSpeed: 7.5 },
    color: "#d8d0c0",
  },
  {
    id: "daemon",
    name: "Daemon Targaryen",
    title: "The Rogue Prince",
    faction: "The Black Council",
    description: "The most dangerous man in Westeros takes the sharpest edges of any fight.",
    bondedDragonId: "caraxes",
    dragonBonus: { fireDamage: 1.08, boostSpeed: 1.06 },
    ground: { hp: 220, armor: 22, swordDamage: 34, heavyMultiplier: 2.2, stamina: 110, block: 0.65, dodgeCost: 24, moveSpeed: 7.8 },
    color: "#404850",
  },
  {
    id: "aemond",
    name: "Aemond Targaryen",
    title: "One-Eye",
    faction: "The Green Council",
    description: "Rides the largest living dragon as if punishing it for existing.",
    bondedDragonId: "vhagar",
    dragonBonus: { maxHealth: 1.06, armor: 1.08 },
    ground: { hp: 240, armor: 26, swordDamage: 30, heavyMultiplier: 2.4, stamina: 100, block: 0.7, dodgeCost: 25, moveSpeed: 7.2 },
    color: "#2f3a2f",
  },
  {
    id: "aegon",
    name: "Aegon II Targaryen",
    title: "The Golden King",
    faction: "The Green Council",
    description: "Whatever his faults, his dragon always seems to rise again.",
    bondedDragonId: "sunfyre",
    dragonBonus: { fireRecharge: 1.1, fireCapacity: 1.1 },
    ground: { hp: 210, armor: 20, swordDamage: 27, heavyMultiplier: 2.0, stamina: 105, block: 0.6, dodgeCost: 22, moveSpeed: 7.4 },
    color: "#c8a83e",
  },
  {
    id: "rhaenys",
    name: "Rhaenys Targaryen",
    title: "The Queen Who Never Was",
    faction: "The Black Council",
    description: "A veteran of the skies. She was born forty years too early to be tested.",
    bondedDragonId: "meleys",
    dragonBonus: { maxSpeed: 1.07, fireRecharge: 1.12 },
    ground: { hp: 205, armor: 19, swordDamage: 28, heavyMultiplier: 2.1, stamina: 112, block: 0.62, dodgeCost: 21, moveSpeed: 7.6 },
    color: "#8f3040",
  },
  {
    id: "baela",
    name: "Baela Targaryen",
    title: "Wing and Wolf-Blood",
    faction: "The Black Council",
    description: "Half-wild, wholly fearless. Her dragon answers her like a thought.",
    bondedDragonId: "moondancer",
    dragonBonus: { turnRate: 1.12, acceleration: 1.1 },
    ground: { hp: 190, armor: 14, swordDamage: 25, heavyMultiplier: 1.9, stamina: 120, block: 0.5, dodgeCost: 18, moveSpeed: 8.2 },
    color: "#b8c8cc",
  },
];

export function getRider(id: string): RiderDefinition {
  const r = RIDERS.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rider: ${id}`);
  return r;
}
