/** Per-dragon wing silhouette — drives the procedural wing geometry. */
export interface WingShape {
  /** overall wingspan multiplier (1 = baseline) */
  span: number;
  /** fore-aft chord multiplier — narrow & long (0.75) vs broad (1.25) */
  chord: number;
  /** wing-finger bones 3..5 (visual spars along the trailing edge) */
  fingers: number;
  /** trailing-edge notch depth 0..1 (scalloped bat-wing cut) */
  membraneNotch: number;
  /** backward sweep of the outer panel, radians */
  sweepAngle: number;
}

export interface DragonDefinition {
  id: string;
  name: string;
  epithet: string;
  description: string;
  /** Visual */
  scale: number;
  /** proportion multiplier for chest/neck girth (war dragon bulk) */
  bulk?: number;
  bodyColor: string;
  wingColor: string;
  accentColor: string;
  fireColor: string;
  /** Wing silhouette (distinct per dragon) */
  wingShape: WingShape;
  /** Combat */
  maxHealth: number;
  armor: number;
  fireDamage: number; // dps at point blank
  fireRange: number; // meters
  fireCone: number; // half-angle radians
  fireCapacity: number; // energy units
  fireDrain: number; // units/sec
  fireRecharge: number; // units/sec
  superCooldown: number; // seconds
  /** Flight */
  acceleration: number;
  maxSpeed: number;
  boostSpeed: number;
  boostRecharge: number;
  turnRate: number; // rad/sec
  climbRate: number;
  diveSpeed: number;
  staggerResistance: number; // 0..1
  /** hit radius meters */
  hitRadius: number;
}

export const DRAGONS: DragonDefinition[] = [
  {
    id: "syrax",
    name: "Syrax",
    epithet: "The Queen's Dragon",
    description: "Quick to turn, eager to climb. A responsive mount with a mean streak when provoked.",
    scale: 1.0,
    bodyColor: "#c8a832",
    wingColor: "#e8d478",
    accentColor: "#7a6414",
    fireColor: "#ff9a3c",
    wingShape: { span: 1.0, chord: 1.0, fingers: 4, membraneNotch: 0.35, sweepAngle: 0.18 }, // balanced queenly wings
    maxHealth: 1000,
    armor: 30,
    fireDamage: 55,
    fireRange: 62,
    fireCone: 0.34,
    fireCapacity: 100,
    fireDrain: 20,
    fireRecharge: 24,
    superCooldown: 14,
    acceleration: 28,
    maxSpeed: 42,
    boostSpeed: 62,
    boostRecharge: 0.9,
    turnRate: 1.9,
    climbRate: 26,
    diveSpeed: 72,
    staggerResistance: 0.5,
    hitRadius: 4.0,
  },
  {
    id: "caraxes",
    name: "Caraxes",
    epithet: "The Blood Wyrm",
    description: "Lean and merciless. Long-reaching flames and a devastating dive.",
    scale: 1.08,
    bodyColor: "#a4243c",
    wingColor: "#d4485c",
    accentColor: "#5a1020",
    fireColor: "#ff5a2a",
    wingShape: { span: 1.12, chord: 0.74, fingers: 4, membraneNotch: 0.55, sweepAngle: 0.42 }, // narrow serpentine sails
    maxHealth: 950,
    armor: 35,
    fireDamage: 78,
    fireRange: 74,
    fireCone: 0.3,
    fireCapacity: 100,
    fireDrain: 22,
    fireRecharge: 22,
    superCooldown: 13,
    acceleration: 26,
    maxSpeed: 44,
    boostSpeed: 66,
    boostRecharge: 1.0,
    turnRate: 1.7,
    climbRate: 24,
    diveSpeed: 82,
    staggerResistance: 0.55,
    hitRadius: 4.2,
  },
  {
    id: "vhagar",
    name: "Vhagar",
    epithet: "The Last Ember of the Conquest",
    description: "A living fortress. Turns like a castle, burns like a furnace.",
    scale: 1.45,
    bodyColor: "#4c6b52",
    wingColor: "#6e8f74",
    accentColor: "#233327",
    fireColor: "#ffb347",
    wingShape: { span: 1.32, chord: 1.28, fingers: 5, membraneNotch: 0.18, sweepAngle: 0.08 }, // colossal broad battle-planes
    maxHealth: 1550,
    armor: 62,
    fireDamage: 96,
    fireRange: 66,
    fireCone: 0.44,
    fireCapacity: 130,
    fireDrain: 18,
    fireRecharge: 16,
    superCooldown: 16,
    acceleration: 18,
    maxSpeed: 34,
    boostSpeed: 50,
    boostRecharge: 1.4,
    turnRate: 1.2,
    climbRate: 18,
    diveSpeed: 64,
    staggerResistance: 0.9,
    hitRadius: 5.6,
  },
  {
    id: "sunfyre",
    name: "Sunfyre",
    epithet: "The Golden",
    description: "Golden wings, even temper. Efficient flame and remarkable recovery.",
    scale: 1.05,
    bodyColor: "#e0b23e",
    wingColor: "#f4d675",
    accentColor: "#9c7018",
    fireColor: "#ffd24a",
    wingShape: { span: 1.06, chord: 1.08, fingers: 4, membraneNotch: 0.28, sweepAngle: 0.22 }, // wide golden glory
    maxHealth: 1100,
    armor: 40,
    fireDamage: 60,
    fireRange: 62,
    fireCone: 0.33,
    fireCapacity: 115,
    fireDrain: 18,
    fireRecharge: 27,
    superCooldown: 13,
    acceleration: 25,
    maxSpeed: 40,
    boostSpeed: 58,
    boostRecharge: 0.9,
    turnRate: 1.8,
    climbRate: 24,
    diveSpeed: 70,
    staggerResistance: 0.6,
    hitRadius: 4.2,
  },
  {
    id: "meleys",
    name: "Meleys",
    epithet: "The Red Queen",
    description: "No dragon on wing is faster. Scarlet terror of the skies.",
    scale: 1.1,
    bodyColor: "#b23a48",
    wingColor: "#d96a75",
    accentColor: "#6b1520",
    fireColor: "#ff7a3c",
    wingShape: { span: 1.18, chord: 0.85, fingers: 5, membraneNotch: 0.45, sweepAngle: 0.35 }, // long scarlet speed-blades
    maxHealth: 900,
    armor: 28,
    fireDamage: 58,
    fireRange: 58,
    fireCone: 0.32,
    fireCapacity: 95,
    fireDrain: 21,
    fireRecharge: 30,
    superCooldown: 12,
    acceleration: 32,
    maxSpeed: 50,
    boostSpeed: 72,
    boostRecharge: 0.8,
    turnRate: 2.1,
    climbRate: 30,
    diveSpeed: 76,
    staggerResistance: 0.5,
    hitRadius: 4.2,
  },
  {
    id: "moondancer",
    name: "Moondancer",
    epithet: "The Pale Huntress",
    description: "Slim as a knife, turns on a copper coin. Fragile as glass when caught.",
    scale: 0.88,
    bodyColor: "#bcd6d8",
    wingColor: "#dceef0",
    accentColor: "#6e8c94",
    fireColor: "#9adcff",
    wingShape: { span: 1.22, chord: 0.68, fingers: 3, membraneNotch: 0.62, sweepAngle: 0.5 }, // slim falcon-like slivers
    maxHealth: 780,
    armor: 22,
    fireDamage: 50,
    fireRange: 54,
    fireCone: 0.28,
    fireCapacity: 90,
    fireDrain: 19,
    fireRecharge: 28,
    superCooldown: 11,
    acceleration: 36,
    maxSpeed: 48,
    boostSpeed: 74,
    boostRecharge: 0.65,
    turnRate: 2.6,
    climbRate: 32,
    diveSpeed: 78,
    staggerResistance: 0.35,
    hitRadius: 3.5,
  },
];

export function getDragon(id: string): DragonDefinition {
  const d = DRAGONS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown dragon: ${id}`);
  return d;
}
