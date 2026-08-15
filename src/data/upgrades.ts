export interface ShopUpgradeDef {
  id: string;
  name: string;
  category: "dragon" | "rider" | "consumable";
  stat: string;
  /** fractional bonus per level (0.10 = +10%/level) */
  perLevel: number;
  maxLevel: number;
  prices: number[];
  description: string;
}

const P = [50, 120, 250, 500];

export const SHOP_UPGRADES: ShopUpgradeDef[] = [
  { id: "fireDamage", name: "Kindled Fury", category: "dragon", stat: "fireDamage", perLevel: 0.1, maxLevel: 4, prices: P, description: "Dragonfire burns hotter." },
  { id: "fireCapacity", name: "Deep Furnace", category: "dragon", stat: "fireCapacity", perLevel: 0.12, maxLevel: 4, prices: P, description: "Longer sustained fire." },
  { id: "dragonMaxHp", name: "Thick Hide", category: "dragon", stat: "maxHealth", perLevel: 0.1, maxLevel: 4, prices: P, description: "Dragon max health." },
  { id: "dragonArmor", name: "Scale Plating", category: "dragon", stat: "armor", perLevel: 0.1, maxLevel: 4, prices: P, description: "Dragon armor." },
  { id: "maxSpeed", name: "Tail Wind", category: "dragon", stat: "maxSpeed", perLevel: 0.06, maxLevel: 4, prices: P, description: "Dragon top speed." },
  { id: "boost", name: "Rage of Wings", category: "dragon", stat: "boostSpeed", perLevel: 0.07, maxLevel: 4, prices: P, description: "Boost speed." },
  { id: "turnRate", name: "Keen Instinct", category: "dragon", stat: "turnRate", perLevel: 0.06, maxLevel: 4, prices: P, description: "Turning agility." },

  { id: "swordDamage", name: "Valyrian Edge", category: "rider", stat: "swordDamage", perLevel: 0.12, maxLevel: 4, prices: P, description: "Sword damage." },
  { id: "riderMaxHp", name: "Hardened Rider", category: "rider", stat: "riderHp", perLevel: 0.1, maxLevel: 4, prices: P, description: "Rider max health." },
  { id: "riderArmor", name: "Half-Plate", category: "rider", stat: "riderArmor", perLevel: 0.12, maxLevel: 4, prices: P, description: "Rider armor." },
  { id: "blockEfficiency", name: "Shield Drill", category: "rider", stat: "riderBlock", perLevel: 0.08, maxLevel: 4, prices: P, description: "Block efficiency." },
  { id: "dodge", name: "Footwork", category: "rider", stat: "riderStamina", perLevel: 0.1, maxLevel: 4, prices: P, description: "Stamina & dodge economy." },

  { id: "startHeal", name: "Field Physick", category: "consumable", stat: "startHeal", perLevel: 0.34, maxLevel: 4, prices: [40, 90, 180, 350], description: "Begin each mission with a healing flask (+1 use/level)." },
  { id: "fireBoostStart", name: "Brazier Charm", category: "consumable", stat: "fireBoostStart", perLevel: 0.5, maxLevel: 4, prices: [40, 90, 180, 350], description: "Begin each mission with a fire boost charge." },
  { id: "armorCharmStart", name: "Ward Charm", category: "consumable", stat: "armorCharmStart", perLevel: 0.5, maxLevel: 4, prices: [40, 90, 180, 350], description: "Begin each mission with an armor ward charge." },
];

export function getShopUpgrade(id: string): ShopUpgradeDef {
  const u = SHOP_UPGRADES.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown upgrade: ${id}`);
  return u;
}
