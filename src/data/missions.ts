import type { ObjectiveDef } from "../mission/Objectives";

export interface EnvironmentDef {
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunDirection: [number, number, number];
  groundColor: string;
  groundAccent: string;
  waterLevel?: number;
  waterColor?: string;
  rain?: boolean;
  treeCount?: number;
  treeColor?: string;
  rockCount?: number;
  ambient?: number;
  /** distant silhouette style */
  silhouette?: "cliffs" | "ruins" | "city" | "forest";
}

export interface BuildingSpawnDef {
  kind: "house" | "tower" | "barracks" | "fort" | "wall" | "gate" | "keep" | "grandTower";
  tag: string;
  count: number;
  /** relics hidden inside — distributed across buildings of this group */
  relicIds?: string[];
}

export interface SpawnBudget {
  swordsmen: number;
  archers: number;
  spearmen: number;
  shieldmen: number;
  elites: number;
  ballistae: number;
  commander?: boolean;
}

export interface MissionDefinition {
  id: string;
  name: string;
  location: string;
  description: string;
  brief: string;
  seed: number;
  enemyPower: number;
  recommendedPower: number;
  coinBonus: number;
  tutorial?: boolean;
  environment: EnvironmentDef;
  spawns: SpawnBudget;
  buildings: BuildingSpawnDef[];
  objectives: ObjectiveDef[];
}

const groundKillSoldiers = (n: number): ObjectiveDef => ({
  id: "g-kill",
  type: "kill",
  description: `Cut down ${Math.max(2, Math.ceil(n / 2))} enemy soldiers on foot`,
  targetType: "soldier",
  count: Math.max(2, Math.ceil(n / 2)),
});

const groundSurvive = (sec: number): ObjectiveDef => ({
  id: "g-survive",
  type: "survive",
  description: `Survive the counterattack (${sec}s)`,
  seconds: sec,
});

export const MISSIONS: MissionDefinition[] = [
  {
    id: "dragonstone",
    name: "Dragonstone Coast",
    location: "Dragonstone",
    description: "A cold volcanic shore. Enemy scouts hold the fishing village below the fortress.",
    brief: "Learn the feel of wing and flame. Clear the shore, break their watchtower, claim what hides inside.",
    seed: 101,
    enemyPower: 1.0,
    recommendedPower: 1,
    coinBonus: 40,
    tutorial: true,
    environment: {
      skyTop: "#3a4a58",
      skyBottom: "#8a97a0",
      fogColor: "#9aa5ac",
      fogDensity: 0.0016,
      sunColor: "#cfd8dd",
      sunDirection: [-0.4, -0.7, -0.5],
      groundColor: "#4a4a46",
      groundAccent: "#5a5148",
      waterLevel: 0.5,
      waterColor: "#2c4a5c",
      treeCount: 30,
      treeColor: "#2e4030",
      rockCount: 80,
      silhouette: "cliffs",
      ambient: 0.55,
    },
    spawns: { swordsmen: 6, archers: 6, spearmen: 2, shieldmen: 0, elites: 0, ballistae: 0 },
    buildings: [
      { kind: "house", tag: "house", count: 4 },
      { kind: "tower", tag: "watchtower", count: 1, relicIds: ["dragonfireCore"] },
    ],
    objectives: [
      {
        id: "obj-burn",
        type: "kill",
        description: "Burn 8 enemy soldiers",
        targetType: "soldier",
        count: 8,
        hint: "Hold LMB to breathe fire",
        groundAlternative: groundKillSoldiers(8),
      },
      {
        id: "obj-tower",
        type: "destroy",
        description: "Destroy the watchtower",
        targetTag: "watchtower",
        count: 1,
        hint: "Fire damages buildings",
        groundAlternative: groundSurvive(45),
      },
    ],
  },
  {
    id: "riverlands",
    name: "Riverlands Raid",
    location: "The Riverlands",
    description: "Green fields split by rivers. A supply camp feeds the enemy war camp.",
    brief: "Break their supply lines. Watch the sky — they have scorpions now.",
    seed: 202,
    enemyPower: 1.4,
    recommendedPower: 2,
    coinBonus: 80,
    environment: {
      skyTop: "#4a5a68",
      skyBottom: "#a8b098",
      fogColor: "#a8ac9a",
      fogDensity: 0.0012,
      sunColor: "#e8e0c8",
      sunDirection: [0.5, -0.6, -0.3],
      groundColor: "#4a5a3a",
      groundAccent: "#5c6a42",
      treeCount: 140,
      treeColor: "#2a4a2e",
      rockCount: 40,
      silhouette: "forest",
      ambient: 0.6,
    },
    spawns: { swordsmen: 14, archers: 14, spearmen: 6, shieldmen: 6, elites: 1, ballistae: 2 },
    buildings: [
      { kind: "barracks", tag: "supply", count: 2, relicIds: ["windriderSpurs"] },
      { kind: "house", tag: "village", count: 5 },
      { kind: "tower", tag: "watchtower", count: 2, relicIds: ["obsidianScale"] },
    ],
    objectives: [
      {
        id: "obj-archers",
        type: "kill",
        description: "Eliminate 12 archers",
        targetType: "archer",
        count: 12,
        hint: "Archers shoot back — keep moving",
        groundAlternative: groundKillSoldiers(12),
      },
      {
        id: "obj-supply",
        type: "destroy",
        description: "Burn the supply camp (2 barracks)",
        targetTag: "supply",
        count: 2,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "obj-towers",
        type: "destroy",
        description: "Destroy the watchtowers",
        targetTag: "watchtower",
        count: 2,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "obj-commander",
        type: "kill",
        description: "Eliminate the enemy commander",
        targetType: "commander",
        count: 1,
        groundAlternative: { id: "g-cmd", type: "kill", description: "Eliminate the enemy commander", targetType: "commander", count: 1 },
      },
    ],
  },
    {
    id: "harrenhal",
    name: "Harrenhal Outskirts",
    location: "Harrenhal",
    description: "Melted towers against a bruised sky. Rain, mud, and burned stone.",
    brief: "Their siege park aims at our lines. Silence every scorpion. The old keep gives up its dead — and its treasures.",
    seed: 303,
    enemyPower: 1.9,
    recommendedPower: 3,
    coinBonus: 140,
    environment: {
      skyTop: "#20242c",
      skyBottom: "#3c4148",
      fogColor: "#41464e",
      fogDensity: 0.0035,
      sunColor: "#8a8f96",
      sunDirection: [-0.3, -0.8, -0.2],
      groundColor: "#3a3a38",
      groundAccent: "#46423c",
      rain: true,
      treeCount: 70,
      treeColor: "#26302a",
      rockCount: 90,
      silhouette: "ruins",
      ambient: 0.45,
    },
    spawns: { swordsmen: 18, archers: 18, spearmen: 8, shieldmen: 10, elites: 3, ballistae: 4 },
    buildings: [
      { kind: "fort", tag: "keep", count: 1, relicIds: ["dragonheartEssence"] },
      { kind: "house", tag: "ruin", count: 5 },
      { kind: "barracks", tag: "camp", count: 2, relicIds: ["emberCapacitor", "valyrianSaddle"] },
    ],
    objectives: [
      {
        id: "obj-ballistae",
        type: "kill",
        description: "Destroy 4 siege ballistae",
        targetType: "ballista",
        count: 4,
        hint: "Ballistae hit hard — destroy them first",
        groundAlternative: groundKillSoldiers(10),
      },
      {
        id: "obj-elites",
        type: "kill",
        description: "Slay 3 elite knights",
        targetType: "elite",
        count: 3,
        groundAlternative: groundKillSoldiers(10),
      },
      {
        id: "obj-structures",
        type: "destroy",
        description: "Raze 6 structures",
        targetTag: "any",
        count: 6,
        groundAlternative: groundSurvive(75),
      },
      {
        id: "obj-relics",
        type: "destroy",
        description: "Uncover hidden relics (destroy marked keep & camp)",
        targetTag: "relic-building",
        count: 3,
        groundAlternative: groundSurvive(75),
      },
    ],
  },
  {
    id: "kingslanding",
    name: "King's Landing Assault",
    location: "King's Landing",
    description: "The city that started the war. Blackwater smoke on the wind.",
    brief: "Break the outer walls, silence their scorpions, crack the gate. End this, in fire or in blood.",
    seed: 404,
    enemyPower: 2.6,
    recommendedPower: 4,
    coinBonus: 220,
    environment: {
      skyTop: "#2e2438",
      skyBottom: "#8a5a3a",
      fogColor: "#584438",
      fogDensity: 0.0022,
      sunColor: "#d8a068",
      sunDirection: [0.6, -0.35, 0.4],
      groundColor: "#4c4438",
      groundAccent: "#584e40",
      waterLevel: 0.4,
      waterColor: "#28404c",
      treeCount: 20,
      treeColor: "#2a3a2c",
      rockCount: 30,
      silhouette: "city",
      ambient: 0.5,
    },
    spawns: { swordsmen: 22, archers: 22, spearmen: 10, shieldmen: 12, elites: 4, ballistae: 5, commander: true },
    buildings: [
      { kind: "wall", tag: "wall", count: 3 },
      { kind: "tower", tag: "wallTower", count: 4, relicIds: ["stormWings"] },
      { kind: "barracks", tag: "gatehouse", count: 2, relicIds: ["ancientFlameGland", "bloodfireHeart"] },
    ],
    objectives: [
      {
        id: "obj-walls",
        type: "destroy",
        description: "Break the outer wall towers",
        targetTag: "wallTower",
        count: 4,
        groundAlternative: groundKillSoldiers(12),
      },
      {
        id: "obj-scorpions",
        type: "kill",
        description: "Silence the ballista positions",
        targetType: "ballista",
        count: 5,
        groundAlternative: groundKillSoldiers(12),
      },
      {
        id: "obj-gate",
        type: "destroy",
        description: "Crack the gatehouse",
        targetTag: "gatehouse",
        count: 2,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "obj-commander",
        type: "kill",
        description: "Defeat the enemy commander",
        targetType: "commander",
        count: 1,
        groundAlternative: { id: "g-cmd", type: "kill", description: "Defeat the enemy commander", targetType: "commander", count: 1 },
      },
      {
        id: "obj-final",
        type: "survive",
        description: "Survive the final counterattack (90s)",
        seconds: 90,
        groundAlternative: groundSurvive(60),
      },
    ],
  },
  {
    id: "blackstone",
    name: "The Blackstone Citadel",
    location: "Blackstone",
    description: "A colossal fortress of dark stone. Walls within walls, towers like teeth, and a keep that scratches the sky.",
    brief:
      "The greatest stronghold of the war. Silence their scorpions, shatter the walls, take the gate — and end their command in the courtyard beyond.",
    seed: 505,
    enemyPower: 3.2,
    recommendedPower: 5,
    coinBonus: 320,
    environment: {
      skyTop: "#1c2028",
      skyBottom: "#4a4038",
      fogColor: "#3a3833",
      fogDensity: 0.0028,
      sunColor: "#c8b8a0",
      sunDirection: [-0.5, -0.6, -0.4],
      groundColor: "#3c3a34",
      groundAccent: "#484438",
      treeCount: 90,
      treeColor: "#24301f",
      rockCount: 120,
      silhouette: "ruins",
      ambient: 0.5,
    },
    spawns: {
      swordsmen: 26,
      archers: 26,
      spearmen: 12,
      shieldmen: 14,
      elites: 5,
      ballistae: 6,
      commander: true,
    },
    buildings: [
      { kind: "grandTower", tag: "wallTower", count: 8 },
      { kind: "gate", tag: "gatehouse", count: 1 },
      { kind: "barracks", tag: "barracks", count: 1 },
      { kind: "barracks", tag: "supply", count: 1, relicIds: ["emberCapacitor"] },
      { kind: "keep", tag: "keep", count: 1, relicIds: ["dragonheartEssence"] },
    ],
    objectives: [
      {
        id: "bs-defenses",
        type: "kill",
        description: "Silence the outer ballistae",
        targetType: "ballista",
        count: 6,
        hint: "Scorpions defend the walls — destroy them first",
        groundAlternative: groundKillSoldiers(10),
      },
      {
        id: "bs-breach",
        type: "destroy",
        description: "Shatter the wall towers",
        targetTag: "wallTower",
        count: 4,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "bs-gate",
        type: "destroy",
        description: "Breach the gatehouse",
        targetTag: "gatehouse",
        count: 1,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "bs-courtyard",
        type: "kill",
        description: "Clear the courtyard defenders",
        targetType: "soldier",
        count: 12,
        groundAlternative: groundKillSoldiers(12),
      },
      {
        id: "bs-commander",
        type: "kill",
        description: "Eliminate the castellan",
        targetType: "commander",
        count: 1,
        groundAlternative: { id: "bs-cmd-g", type: "kill", description: "Eliminate the castellan", targetType: "commander", count: 1 },
      },
      {
        id: "bs-final",
        type: "survive",
        description: "Survive the counterattack (75s)",
        seconds: 75,
        groundAlternative: groundSurvive(60),
      },
    ],
  },
];

export function getMission(id: string): MissionDefinition {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mission: ${id}`);
  return m;
}
