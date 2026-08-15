import type { StatModSource } from "../progression/StatBlock";

export interface RelicDefinition {
  id: string;
  name: string;
  flavor: string;
  /** stat multipliers; `healFlat` (value 0..1 = fraction of max HP) and `lifesteal` handled specially */
  effect: StatModSource;
  announce: string;
}

/**
 * Hidden dragon upgrades found by destroying specific buildings.
 * Mission-scoped for the MVP; architecture supports persistent unlocks later.
 */
export const RELICS: RelicDefinition[] = [
  {
    id: "dragonfireCore",
    name: "Dragonfire Core",
    flavor: "A pulsing ember older than the Doom.",
    effect: { fireDamage: 1.15 },
    announce: "Fire Damage +15%",
  },
  {
    id: "ancientFlameGland",
    name: "Ancient Flame Gland",
    flavor: "It still thrums with heat.",
    effect: { fireRange: 1.2, fireCone: 1.15 },
    announce: "Fire Range +20% / Wider Cone",
  },
  {
    id: "windriderSpurs",
    name: "Windrider Spurs",
    flavor: "Steel that whispers of open sky.",
    effect: { maxSpeed: 1.15, boostSpeed: 1.08 },
    announce: "Max Speed +15%",
  },
  {
    id: "stormWings",
    name: "Storm Wings",
    flavor: "Feathers of a storm that never broke.",
    effect: { turnRate: 1.15, acceleration: 1.12 },
    announce: "Turn Rate +15% / Acceleration +12%",
  },
  {
    id: "emberCapacitor",
    name: "Ember Capacitor",
    flavor: "It drinks the fire and asks for more.",
    effect: { superGain: 1.5 },
    announce: "Super Charge +50% faster",
  },
  {
    id: "obsidianScale",
    name: "Obsidian Scale",
    flavor: "Black glass, blood-warm.",
    effect: { armor: 1.3 },
    announce: "Dragon Armor +30%",
  },
  {
    id: "dragonheartEssence",
    name: "Dragonheart Essence",
    flavor: "One heartbeat of a god.",
    effect: { healFlat: 0.35 },
    announce: "Dragon Health restored +35%",
  },
  {
    id: "bloodfireHeart",
    name: "Bloodfire Heart",
    flavor: "Fire given, life returned.",
    effect: { lifesteal: 0.06 },
    announce: "Fire damage heals your dragon",
  },
  {
    id: "valyrianSaddle",
    name: "Valyrian Saddle",
    flavor: "Woven before the Freehold fell.",
    effect: { damageTaken: 0.85 },
    announce: "Damage taken -15%",
  },
];

export function getRelic(id: string): RelicDefinition {
  const r = RELICS.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown relic: ${id}`);
  return r;
}
