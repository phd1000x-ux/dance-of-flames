import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { DragonController } from "../src/player/DragonController";
import { PlayerState } from "../src/player/PlayerState";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { DIFFICULTIES } from "../src/data/difficulty";
import { BOLT_SPEED, ballisticDir, boltAimPoint } from "../src/ai/EnemyManager";
import type { DragonRig } from "../src/world/DragonRig";
import type { Terrain } from "../src/world/Terrain";
import type { InputManager } from "../src/input/InputManager";
import type { EventBus } from "../src/core/EventBus";
import type { GameEvents } from "../src/core/Events";

/**
 * Ballista dodge experiment, run on the real flight controller and the real
 * bolt aim/ballistics. The warning (rail glow + SCORPION marker) starts
 * DifficultyDef.ballistaTelegraph s before release; the player reacts REACTION s after the warning. The bolt is
 * then flown with the same gravity and capsule test as ProjectileSystem.
 * Prints a hit table (vitest --reporter=verbose shows it) and asserts the
 * design contract: holding course gets you hit, reacting to the warning saves you.
 */

const REACTION = 0.35;
let TELEGRAPH = DIFFICULTIES[1].ballistaTelegraph;
const DT = 1 / 60;

type Maneuver = "none" | "left" | "right" | "climb" | "descend" | "boost" | "dodgeQ" | "dodgeE" | "lateDodge";
const MANEUVERS: Maneuver[] = ["none", "left", "right", "climb", "descend", "boost", "dodgeQ", "dodgeE", "lateDodge"];

function controller(dragonIdx: number) {
  const player = new PlayerState(DRAGONS[dragonIdx], RIDERS[0], {});
  const bus = { emit() {}, on() {} } as unknown as EventBus<GameEvents>;
  const terrain = { heightAt: () => 0 } as unknown as Terrain;
  const rig = { root: { position: new Vector3(), rotationQuaternion: null }, flapPhase: 0, animate() {} } as unknown as DragonRig;
  return { ctrl: new DragonController(player, rig, terrain, bus, 760), player };
}

function input(held: Set<string>, edges: Set<string>): InputManager {
  return {
    isDown: (a: string) => held.has(a),
    pressed: (a: string) => edges.delete(a),
    consumeMouse: () => ({ dx: 0, dy: 0 }),
    lookYaw: 0,
    lookPitch: 0,
  } as unknown as InputManager;
}

function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / ab.lengthSquared()));
  return Vector3.Distance(p, a.add(ab.scale(t)));
}

/** heading relative to line of sight: 0 = flying straight at the ballista, PI/2 = crossing, PI = departing */
type Outcome = "hit" | "miss" | "noshot";
const BALLISTA_RANGE = 260;

function trial(geometry: number, range: number, maneuver: Maneuver, dragonIdx = 0): Outcome {
  const { ctrl, player } = controller(dragonIdx);
  const ballista = new Vector3(0, 1.9, 0);
  // place the dragon `range` m away, 110 m up, heading at `geometry` from the line of sight
  const start = new Vector3(0, 110, -range);
  const toBallistaYaw = 0; // +Z
  ctrl.spawn(start, toBallistaYaw + geometry);
  const held = new Set(["accelerate"]);
  const edges = new Set<string>();
  const inp = input(held, edges);
  for (let i = 0; i < 120; i++) ctrl.update(DT, inp, false); // settle to cruise

  let t = 0;
  let bolt: { pos: Vector3; vel: Vector3 } | null = null;
  const radius = player.dragonDef.hitRadius * 0.92;
  let lateArmed = maneuver === "lateDodge";
  while (t < TELEGRAPH + 5) {
    if (t >= REACTION && t - DT < REACTION) {
      if (maneuver === "left") held.add("turnLeft");
      if (maneuver === "right") held.add("turnRight");
      if (maneuver === "climb") held.add("climb");
      if (maneuver === "descend") held.add("descend");
      if (maneuver === "boost") held.add("boost");
      if (maneuver === "dodgeQ") edges.add("dodgeLeft");
      if (maneuver === "dodgeE") edges.add("dodgeRight");
    }
    ctrl.update(DT, inp, false);
    if (!bolt && t >= TELEGRAPH) {
      // same gate as EnemyManager.updateBallista: no release beyond range
      if (Vector3.Distance(ctrl.pos, ballista) > BALLISTA_RANGE) return "noshot";
      const aim = boltAimPoint(ballista, ctrl.pos.clone(), ctrl.forward.clone(), ctrl.speed);
      bolt = { pos: ballista.clone(), vel: ballisticDir(ballista, aim, BOLT_SPEED).scale(BOLT_SPEED) };
    }
    if (bolt) {
      bolt.vel.y -= 9.8 * DT;
      bolt.pos.addInPlace(bolt.vel.scale(DT));
      if (lateArmed && Vector3.Distance(bolt.pos, ctrl.pos) < 45) {
        edges.add("dodgeRight");
        lateArmed = false;
      }
      const tail = ctrl.pos.subtract(ctrl.forward.scale(3.2 * (radius / 4)));
      if (distToSegment(bolt.pos, ctrl.pos, tail) < radius) return ctrl.invulnerable <= 0 ? "hit" : "miss";
      if (bolt.pos.y < 0) return "miss";
    }
    t += DT;
  }
  return "miss";
}

const GEOMETRIES: [string, number][] = [
  ["head-on", 0],
  ["oblique", Math.PI / 4],
  ["crossing", Math.PI / 2],
  ["departing", Math.PI * 0.85],
];
const RANGES = [140, 220];

/** hits per maneuver, over the trials where the steady flier drew a shot */
function table(dragonIdx: number) {
  const cases: [number, number][] = [];
  for (const [, g] of GEOMETRIES) for (const r of RANGES) for (const side of [1, -1]) {
    if (trial(g * side, r, "none", dragonIdx) !== "noshot") cases.push([g * side, r]);
  }
  const rows: Record<string, number> = { shots: cases.length };
  for (const m of MANEUVERS) rows[m] = cases.filter(([g, r]) => trial(g, r, m, dragonIdx) === "hit").length;
  return rows;
}

describe("ballista: dangerous but dodgeable (real flight controller + real bolt aim)", () => {
  const rows = table(0);
  const total = rows.shots;
  // eslint-disable-next-line no-console
  console.log(`ballista hit table (${total} shots per maneuver):`, rows);

  it("a dragon that ignores the warning is usually hit", () => {
    expect(rows.none / total).toBeGreaterThanOrEqual(0.75);
  });

  it("every warning response (turn either way, climb, dive, dodge) cuts hits sharply", () => {
    for (const m of ["left", "right", "climb", "descend", "dodgeQ", "dodgeE", "lateDodge"] as const) {
      expect(rows[m], m).toBeLessThanOrEqual(rows.none * 0.35);
    }
  });

  it("left and right are equally valid answers", () => {
    expect(Math.abs(rows.left - rows.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(rows.dodgeQ - rows.dodgeE)).toBeLessThanOrEqual(2);
  });

  it("holds for the heaviest and the lightest dragon too", () => {
    for (const idx of DRAGONS.map((_, i) => i)) {
      const r = table(idx);
      expect(r.none / r.shots, DRAGONS[idx].id).toBeGreaterThanOrEqual(0.6);
      expect(Math.min(r.left, r.right, r.climb, r.dodgeE), DRAGONS[idx].id).toBeLessThanOrEqual(r.none * 0.5);
    }
  });

  it("Hard's shorter warning still leaves a reaction window", () => {
    TELEGRAPH = DIFFICULTIES[2].ballistaTelegraph;
    try {
      const r = table(0);
      // eslint-disable-next-line no-console
      console.log("hard:", r);
      expect(r.none / r.shots).toBeGreaterThanOrEqual(0.75);
      expect(Math.min(r.left, r.right, r.climb)).toBeLessThanOrEqual(r.none * 0.35);
    } finally {
      TELEGRAPH = DIFFICULTIES[1].ballistaTelegraph;
    }
  });
});
