import type { ObjectiveDef } from "../mission/Objectives";
import type { MissionEventDef } from "../mission/MissionEvents";

export interface EnvironmentDef {
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunDirection: [number, number, number];
  groundColor: string;
  groundAccent: string;
  /** ridge / steep-slope rock tone — the region's signature from the air */
  highlandColor?: string;
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
  /** mid-mission beats keyed to objective completion (reinforcements + subtitle) */
  events?: MissionEventDef[];
  /** per-mission threat to the dragon (multiplies arrow damage + arrow DPS cap, and bolt damage).
   *  Shapes the campaign curve: early fields sting, the Blackstone bolt storm stays survivable. */
  threat?: { arrow?: number; bolt?: number };
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

/** active alternative to a second survive window: break the wave that lands on the rider */
const groundRepel = (n: number): ObjectiveDef => ({
  id: "g-repel",
  type: "kill",
  description: `Break the counterattack — cut down ${n} on foot`,
  targetType: "soldier",
  count: n,
});

export const MISSIONS: MissionDefinition[] = [
  {
    id: "cinderhold",
    name: "Cinderhold Coast",
    location: "Cinderhold",
    description: "A cold volcanic shore. Enemy scouts hold the fishing village below the fortress.",
    brief: "Learn the feel of wing and flame. Clear the shore, break their watchtower, claim what hides inside.",
    seed: 101,
    enemyPower: 1.0,
    threat: { arrow: 2.0, bolt: 1 },
    recommendedPower: 1,
    coinBonus: 40,
    tutorial: true,
    environment: {
      skyTop: "#34495c",
      skyBottom: "#93a6b2",
      fogColor: "#8fa2ad",
      fogDensity: 0.0009,
      sunColor: "#e2e9ee",
      sunDirection: [-0.4, -0.7, -0.5],
      groundColor: "#3e4a38",
      groundAccent: "#55603f",
      highlandColor: "#1f1f22",
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
    events: [
      {
        id: "ev-boats",
        afterObjective: "obj-burn",
        subtitle: "Boats row ashore — the watchtower calls for help!",
        reinforce: { swordsman: 3 },
        anchor: "watchtower",
      },
    ],
    objectives: [
      {
        id: "obj-burn",
        type: "kill",
        description: "Burn 10 enemy soldiers",
        targetType: "soldier",
        count: 10,
        hint: "Hold F to breathe fire (or left mouse)",
        groundAlternative: groundKillSoldiers(10),
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
    id: "fenwater",
    name: "Fenwater Raid",
    location: "The Fenwater",
    description: "Green fields split by rivers. A supply camp feeds the enemy war camp.",
    brief: "Break their supply lines. Watch the sky — they have scorpions now.",
    seed: 202,
    enemyPower: 1.4,
    threat: { arrow: 1.5, bolt: 0.7 },
    recommendedPower: 2,
    coinBonus: 80,
    environment: {
      skyTop: "#4a6a88",
      skyBottom: "#c9c6a4",
      fogColor: "#bdbb9c",
      fogDensity: 0.0008,
      sunColor: "#f4e2b8",
      sunDirection: [0.5, -0.6, -0.3],
      groundColor: "#4c6a34",
      groundAccent: "#8a8442",
      highlandColor: "#6b6650",
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
    events: [
      {
        id: "ev-relief",
        afterObjective: "obj-supply",
        subtitle: "A relief column fords the river — spears rally at the watchtowers!",
        reinforce: { spearman: 4, shieldman: 3 },
        anchor: "watchtower",
      },
    ],
    objectives: [
      {
        id: "obj-archers",
        type: "kill",
        description: "Eliminate 12 archers",
        targetType: "archer",
        count: 12,
        hint: "The archers hold the village to the west — keep moving",
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
        groundAlternative: groundRepel(8),
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
    id: "ashgrave",
    name: "Ashgrave Outskirts",
    location: "Ashgrave",
    description: "Melted towers against a bruised sky. Rain, mud, and burned stone.",
    brief: "Their siege park aims at our lines. Silence every scorpion. The old keep gives up its dead — and its treasures. Survivors speak of a second shadow over Blackstone, larger than any scorpion.",
    seed: 303,
    enemyPower: 1.9,
    threat: { arrow: 1.8, bolt: 0.55 },
    recommendedPower: 3,
    coinBonus: 140,
    environment: {
      skyTop: "#20242c",
      skyBottom: "#4a4f58",
      fogColor: "#41464e",
      fogDensity: 0.0015,
      sunColor: "#a4a9b2",
      sunDirection: [-0.3, -0.8, -0.2],
      groundColor: "#3b3833",
      groundAccent: "#4f463b",
      highlandColor: "#24221f",
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
      { kind: "barracks", tag: "camp", count: 2, relicIds: ["emberCapacitor", "elderSaddle"] },
    ],
    events: [
      {
        id: "ev-sally",
        afterObjective: "obj-ballistae",
        subtitle: "The siege park is ash — the keep's garrison sallies into the mud!",
        reinforce: { swordsman: 4, elite: 1 },
        anchor: "keep",
        insertObjective: {
          id: "obj-sally",
          type: "kill",
          description: "Break the sally — cut down 5 of the garrison",
          targetType: "soldier",
          count: 5,
          hint: "They charge across the mud from the keep",
          groundAlternative: { id: "g-sally", type: "kill", description: "Break the sally — cut down 3 on foot", targetType: "soldier", count: 3 },
        },
      },
      {
        id: "ev-walls",
        afterObjective: "obj-structures",
        subtitle: "Crossbowmen man the melted walls — burn the camps out from under them!",
        reinforce: { archer: 6 },
        anchor: "camp",
        elevated: true,
      },
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
        groundAlternative: groundSurvive(45),
      },
      {
        id: "obj-structures",
        type: "destroy",
        description: "Raze 6 structures",
        targetTag: "any",
        count: 6,
        groundAlternative: groundRepel(10),
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
    id: "portcalder",
    name: "Port Calder Assault",
    location: "Port Calder",
    description: "The city that started the war. Saltmere smoke on the wind.",
    brief: "No walls to break this time — strike the city itself. Silence the harbor scorpions, burn the granaries, topple the beacons before they light. The city falls — but their Castellan has already fled to Blackstone.",
    seed: 404,
    enemyPower: 2.6,
    threat: { arrow: 1.5, bolt: 0.5 },
    recommendedPower: 4,
    coinBonus: 220,
    environment: {
      skyTop: "#2e2846",
      skyBottom: "#a8765a",
      fogColor: "#6c5e58",
      fogDensity: 0.0011,
      sunColor: "#e6c29e",
      sunDirection: [0.6, -0.35, 0.4],
      groundColor: "#57533f",
      groundAccent: "#6d6447",
      highlandColor: "#8f8068",
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
      { kind: "house", tag: "district", count: 8 },
      { kind: "barracks", tag: "granary", count: 3, relicIds: ["ancientFlameGland", "bloodfireHeart"] },
      { kind: "tower", tag: "beacon", count: 3, relicIds: ["stormWings"] },
    ],
    events: [
      {
        id: "ev-cityguards",
        afterObjective: "obj-scorpions",
        subtitle: "City guards pour from the city gates to guard the granaries!",
        reinforce: { swordsman: 4, shieldman: 3 },
        anchor: "granary",
      },
      {
        id: "ev-beacon-guard",
        afterObjective: "obj-beacons",
        subtitle: "The beacons fall dark — the commander's guard forms up to meet you!",
        reinforce: { elite: 2, archer: 3 },
        anchor: "player",
        insertObjective: {
          id: "obj-guard",
          type: "kill",
          description: "Cut through the commander's guard (2 elite knights)",
          targetType: "elite",
          count: 2,
          hint: "Elites shrug off a glancing breath — hold the flame on them",
          groundAlternative: { id: "g-guard", type: "survive", description: "Hold out against the guard (30s)", seconds: 30 },
        },
      },
    ],
    objectives: [
      {
        id: "obj-scorpions",
        type: "kill",
        description: "Silence the harbor scorpions",
        targetType: "ballista",
        count: 5,
        hint: "Scorpions line the Saltmere quays",
        groundAlternative: groundKillSoldiers(12),
      },
      {
        id: "obj-granaries",
        type: "destroy",
        description: "Burn the royal granaries",
        targetTag: "granary",
        count: 3,
        hint: "Starve the garrison — the granaries sit behind the docks",
        groundAlternative: groundSurvive(45),
      },
      {
        id: "obj-beacons",
        type: "destroy",
        description: "Topple the beacon towers before they warn Blackstone",
        targetTag: "beacon",
        count: 3,
        groundAlternative: groundRepel(12),
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
      "Their last citadel, and the Castellan who rules it. Silence their scorpions, shatter the walls, take the gate, hold the courtyard — then face him. End this, in fire or in blood.",
    seed: 505,
    enemyPower: 3.2,
    threat: { arrow: 1.1, bolt: 0.35 },
    recommendedPower: 5,
    coinBonus: 320,
    environment: {
      skyTop: "#1a1820",
      skyBottom: "#6a3a2a",
      fogColor: "#4a3430",
      fogDensity: 0.0017,
      sunColor: "#e0a878",
      sunDirection: [-0.5, -0.6, -0.4],
      groundColor: "#34332e",
      groundAccent: "#463f34",
      highlandColor: "#17161a",
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
        groundAlternative: groundRepel(8),
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
        // before the duel: the climax (spire crash) now ends the mission directly
        id: "bs-final",
        type: "survive",
        description: "Hold the courtyard against the counterattack (75s)",
        seconds: 75,
        groundAlternative: groundSurvive(60),
      },
      {
        id: "bs-castellan",
        type: "event",
        description: "Duel the Castellan",
        event: "castellan-transition",
        hint: "Land in the courtyard to face him",
        groundAlternative: { id: "bs-cmd-g", type: "kill", description: "Eliminate the castellan", targetType: "commander", count: 1 },
      },
      {
        id: "bs-pursue",
        type: "event",
        description: "Pursue the Castellan",
        event: "chase-complete",
      },
      {
        id: "bs-vharax",
        type: "event",
        description: "Defeat Vharax, the War Dragon",
        event: "vharax-resolved",
        // dragon lost mid-finale: the mission must not end on the spot
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
