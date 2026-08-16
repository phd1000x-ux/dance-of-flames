# Blackstone Finale — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boss vertical slice — courtyard → castellan ground duel → 40% HP transition → Vharax reveal → mount/remount → chase → flame-sweep aerial duel → resolution → existing 75 s final assault → VICTORY.

**Architecture:** A blackstone-scoped finale orchestrator (`src/mission/blackstone/`) owns a `FinalePhase` machine above the unchanged 4-value `MissionScene.phase`. Pure-logic cores (phase table, duel clamp, boss sweep SM, rubber band) are unit-tested without Babylon; Babylon-side controllers puppet existing systems (commander `Soldier`, `DragonRig`, `ProjectileSystem`).

**Tech Stack:** TypeScript strict, Babylon.js 8 (`@babylonjs/core` subpaths only), vitest (unit), Playwright (e2e, `?test=1` mode).

**Spec:** `docs/superpowers/specs/2026-08-16-blackstone-finale-slice1-design.md` — read it first; the plan argues from it.

## Global Constraints

- Babylon imports from `@babylonjs/core` subpath only; no `BABYLON` global.
- Dragon materials are scene-scoped (`buildDragonMaterials` cache keyed by scene+id); never share across scenes; `DragonRig.dispose()` releases meshes only.
- Fixed-timestep sim: never call `mission.update(dt)` outside the existing substep loop; finale updates flow through `MissionScene.update`.
- Input edges are consume-on-read; do not add input reads on render frames.
- E2E: never wall-clock-wait for gameplay — wait on `mission.time` (simWait) or `waitForFunction` polling `window.__GAME`. Keyboard-only tests never touch `page.mouse`.
- Every staged cinematic needs a wall-clock bound (pattern: `deathStartedAt`/`wallElapsed` in `MissionScene`).
- No comments in production code unless asked (repo convention: comments only for non-obvious invariants, matching existing style).
- Commands: `npm run typecheck`, `npm run test`, `npx playwright test <file> -g "<name>"`.
- Commit after every green task; never commit secrets or QA `*.png` artifacts.

---

### Task 1: Event-type objectives

**Files:**
- Modify: `src/mission/Objectives.ts:1` (type union), `:3-17` (ObjectiveDef), `:64-70` (add notifyEvent near notifyBuildingDestroyed)
- Modify: `src/data/missions.ts:414-428` (blackstone chain tail)
- Test: `tests/objectives.test.ts` (extend), `tests/scoring.test.ts:69` (invariant refinement)

**Interfaces:**
- Produces: `ObjectiveType` includes `"event"`; `ObjectiveDef.event?: string`; `ObjectiveTracker.notifyEvent(eventId: string): void` — completes EVERY incomplete event objective whose `event` matches (order-independent short-circuit).

- [ ] **Step 1: Write failing tests**

In `tests/objectives.test.ts` append:

```ts
describe("event objectives", () => {
  const ev = (id: string, event: string, alt?: ObjectiveDef): ObjectiveDef => ({
    id, type: "event", description: `event ${id}`, event, groundAlternative: alt,
  });

  test("notifyEvent completes matching current objective", () => {
    const t = new ObjectiveTracker([ev("a", "thing")]);
    t.notifyEvent("other");
    expect(t.allCompleted()).toBe(false);
    t.notifyEvent("thing");
    expect(t.allCompleted()).toBe(true);
  });

  test("notifyEvent completes ALL matching objectives regardless of chain position", () => {
    const t = new ObjectiveTracker([
      { id: "first", type: "kill", description: "x", targetType: "soldier", count: 2 },
      ev("b", "castellan-transition"),
      ev("c", "chase-complete"),
    ]);
    t.notifyEvent("castellan-transition");
    t.notifyEvent("chase-complete");
    // head not yet complete, but the events are already done behind it
    expect(t.objectives()[1].completed).toBe(true);
    expect(t.objectives()[2].completed).toBe(true);
    expect(t.current()?.id).toBe("first");
  });

  test("convertToGround removes event objectives without alternatives", () => {
    const t = new ObjectiveTracker([
      ev("a", "x", { id: "alt", type: "survive", description: "live", seconds: 5 }),
      ev("b", "y"),
    ]);
    t.convertToGround();
    expect(t.objectives().map((o) => o.id)).toEqual(["alt"]);
  });

  test("event objective completion fires listeners", () => {
    const t = new ObjectiveTracker([ev("a", "x")]);
    let fired = 0;
    t.onObjectiveComplete(() => fired++);
    t.notifyEvent("x");
    expect(fired).toBe(1);
    t.notifyEvent("x"); // idempotent
    expect(fired).toBe(1);
  });
});
```

In `tests/scoring.test.ts` find the mission-validity test asserting every objective has a `groundAlternative` (around line 69) and change the assertion to:

```ts
for (const obj of m.objectives) {
  if (obj.type === "event") continue; // finale events are removed on dragon death (sanctioned splice-out)
  expect(obj.groundAlternative, `${m.id}:${obj.id}`).toBeDefined();
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/objectives.test.ts tests/scoring.test.ts`
Expected: FAIL — `"event" not assignable to ObjectiveType` (type error surfaces as test-file compile failure) and notifyEvent missing.

- [ ] **Step 3: Implement**

`src/mission/Objectives.ts`:

```ts
export type ObjectiveType = "kill" | "destroy" | "survive" | "event";
```

In `ObjectiveDef` after `targetTag?: string;` add:

```ts
  /** event: finale event id — completes when that scripted event fires */
  event?: string;
```

After `notifyBuildingDestroyed` add:

```ts
  /** Complete event objectives whose event id matches — anywhere in the chain,
   *  so short-circuits work regardless of chain position. */
  notifyEvent(eventId: string): void {
    for (const o of this.items) {
      if (!o.completed && o.type === "event" && o.event === eventId) {
        o.progress = 1;
        this.checkDone(o);
      }
    }
  }
```

`checkDone` already computes `need = count ?? 1` for non-survive types → event need = 1. `emitObjective` in MissionScene.ts:304 sends `need = type === "survive" ? seconds : count ?? 1` → 1; no change needed.

- [ ] **Step 4: Rewrite the blackstone objective chain tail**

`src/data/missions.ts` — replace the `bs-commander` and `bs-final` objective entries (lines ~414-428) with:

```ts
      {
        id: "bs-castellan",
        type: "event",
        description: "Defeat the Castellan in single combat",
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
      },
      {
        id: "bs-final",
        type: "survive",
        description: "Survive the counterattack (75s)",
        seconds: 75,
        groundAlternative: groundSurvive(60),
      },
```

(Note: `bs-pursue`/`bs-vharax` intentionally have NO groundAlternative — dragon death splices them out; see spec §2.2.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/objectives.test.ts tests/scoring.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Verify existing castle E2E still passes (chain compatibility)**

Run: `npx playwright test e2e/regression.spec.ts -g "§90"`
Expected: PASS (commander kill will later short-circuit events; today the chain has no consumer yet — but the survive objective still completes and VICTORY fires because nothing requires the event ids… if this FAILS because bs-castellan never completes, that is expected only if the commander kill path completed objectives 1-4 — in that case note the failure and proceed: Task 10 adds the short-circuit that fixes it. Record actual result in the task notes.)

- [ ] **Step 7: Commit**

```bash
git add src/mission/Objectives.ts src/data/missions.ts tests/objectives.test.ts tests/scoring.test.ts
git commit -m "Objectives: event-type objectives + blackstone finale chain tail"
```

---

### Task 2: Finale phase machine (pure)

**Files:**
- Create: `src/mission/blackstone/FinalePhases.ts`
- Test: `tests/finale.test.ts` (new file — later tasks append suites)

**Interfaces:**
- Produces: `type FinalePhase`, `FINALE_TRANSITIONS`, `canTransition(from, to): boolean`, `class PhaseMachine { constructor(initial?); get current(): FinalePhase; transition(to): boolean; isTerminal(): boolean }`.

- [ ] **Step 1: Write failing tests**

Create `tests/finale.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { PhaseMachine, canTransition, FINALE_TRANSITIONS, type FinalePhase } from "../src/mission/blackstone/FinalePhases";

describe("finale phase machine", () => {
  test("legal forward chain", () => {
    const m = new PhaseMachine();
    for (const p of ["AWAIT_LANDING", "DUEL_GROUND", "TRANSITION", "REVEAL", "MOUNT", "REMOUNT", "CHASE", "DUEL_AIR", "RESOLVED"] as FinalePhase[]) {
      expect(m.transition(p), `→ ${p}`).toBe(true);
      expect(m.current).toBe(p);
    }
    expect(m.isTerminal()).toBe(true);
  });

  test("illegal transitions rejected without state change", () => {
    const m = new PhaseMachine();
    expect(m.transition("CHASE")).toBe(false);
    expect(m.current).toBe("INACTIVE");
  });

  test("skips to RESOLVED are legal from active phases (dragon-death/fallback)", () => {
    for (const from of ["AWAIT_LANDING", "DUEL_GROUND", "CHASE", "DUEL_AIR"] as FinalePhase[]) {
      expect(canTransition(from, "RESOLVED"), from).toBe(true);
    }
  });

  test("terminal phase accepts nothing", () => {
    const m = new PhaseMachine();
    m.transition("AWAIT_LANDING");
    m.transition("RESOLVED");
    expect(m.transition("RESOLVED")).toBe(false);
    expect(FINALE_TRANSITIONS.RESOLVED).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/finale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/mission/blackstone/FinalePhases.ts`:

```ts
export type FinalePhase =
  | "INACTIVE"
  | "AWAIT_LANDING"
  | "DUEL_GROUND"
  | "TRANSITION"
  | "REVEAL"
  | "MOUNT"
  | "REMOUNT"
  | "CHASE"
  | "DUEL_AIR"
  | "RESOLVED";

/** legal successors — RESOLVED is the universal fallback (dragon death, short-circuit) */
export const FINALE_TRANSITIONS: Record<FinalePhase, FinalePhase[]> = {
  INACTIVE: ["AWAIT_LANDING"],
  AWAIT_LANDING: ["DUEL_GROUND", "RESOLVED"],
  DUEL_GROUND: ["TRANSITION", "RESOLVED"],
  TRANSITION: ["REVEAL", "RESOLVED"],
  REVEAL: ["MOUNT", "RESOLVED"],
  MOUNT: ["REMOUNT", "RESOLVED"],
  REMOUNT: ["CHASE", "RESOLVED"],
  CHASE: ["DUEL_AIR", "RESOLVED"],
  DUEL_AIR: ["RESOLVED"],
  RESOLVED: [],
};

export function canTransition(from: FinalePhase, to: FinalePhase): boolean {
  return FINALE_TRANSITIONS[from].includes(to);
}

export class PhaseMachine {
  constructor(private _current: FinalePhase = "INACTIVE") {}
  get current(): FinalePhase {
    return this._current;
  }
  transition(to: FinalePhase): boolean {
    if (!canTransition(this._current, to)) return false;
    this._current = to;
    return true;
  }
  isTerminal(): boolean {
    return this._current === "RESOLVED";
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/finale.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/mission/blackstone/FinalePhases.ts tests/finale.test.ts
git commit -m "Finale: phase machine with legal-transition table"
```

---

### Task 3: Castellan duel core (pure)

**Files:**
- Create: `src/mission/blackstone/CastellanDuel.ts`
- Test: `tests/finale.test.ts` (append suite)

**Interfaces:**
- Produces: `interface DuelHit { applied: number; clamped: boolean; transitionNow: boolean }`; `class CastellanDuel { constructor(maxHp: number, opts?: { floorPct?: number; reinforcePct?: number }); readonly hp: number; readonly floor: number; transitioned: boolean; reinforceFired: boolean; damage(n: number): DuelHit; shouldReinforce(): boolean }`; `type CastellanPattern`; `function selectCastellanPattern(rand: () => number, dist: number, last: CastellanPattern | null, reinforceAvailable: boolean): CastellanPattern`.

- [ ] **Step 1: Write failing tests** (append to `tests/finale.test.ts`)

```ts
import { CastellanDuel, selectCastellanPattern, type CastellanPattern } from "../src/mission/blackstone/CastellanDuel";

describe("castellan duel core", () => {
  test("damage above floor applies fully, no transition", () => {
    const d = new CastellanDuel(320); // floor 0.4 → 128
    const r = d.damage(100);
    expect(r).toEqual({ applied: 100, clamped: false, transitionNow: false });
    expect(d.hp).toBe(220);
  });

  test("damage below floor clamps and fires transition exactly once", () => {
    const d = new CastellanDuel(320);
    d.damage(150); // hp 170, above floor 128
    const hit = d.damage(100); // would be 70 — below floor
    expect(hit.clamped).toBe(true);
    expect(hit.transitionNow).toBe(true);
    expect(d.hp).toBe(128);
    const again = d.damage(50);
    expect(again.transitionNow).toBe(false);
    expect(again.applied).toBe(0);
    expect(d.hp).toBe(128);
  });

  test("burst multi-hit cannot double-transition", () => {
    const d = new CastellanDuel(320);
    d.damage(200);
    expect(d.damage(50).transitionNow).toBe(true);
    expect(d.damage(50).transitionNow).toBe(false);
    expect(d.damage(50).transitionNow).toBe(false);
  });

  test("reinforce triggers once below 70%", () => {
    const d = new CastellanDuel(320);
    expect(d.shouldReinforce()).toBe(false);
    d.damage(100); // 220/320 ≈ 0.69
    expect(d.shouldReinforce()).toBe(true);
    d.reinforceFired = true;
    expect(d.shouldReinforce()).toBe(false);
  });

  test("pattern selection: javelin at range, melee close, no immediate repeats", () => {
    const seq: CastellanPattern[] = [];
    let last: CastellanPattern | null = null;
    let i = 0;
    const rand = () => [0.1, 0.1, 0.1, 0.1][i++ % 4];
    last = selectCastellanPattern(rand, 30, last, false); seq.push(last);
    last = selectCastellanPattern(rand, 30, last, false); seq.push(last);
    expect(seq[0]).toBe("javelin");
    expect(seq[1]).not.toBe(seq[0]);
    expect(selectCastellanPattern(rand, 4, null, false)).toMatch(/combo|shieldBreaker/);
    expect(selectCastellanPattern(rand, 4, null, true)).toBe("reinforce");
  });
});
```

- [ ] **Step 2: Run → FAIL (module not found)**

- [ ] **Step 3: Implement**

Create `src/mission/blackstone/CastellanDuel.ts`:

```ts
export interface DuelHit {
  applied: number;
  clamped: boolean;
  transitionNow: boolean;
}

export type CastellanPattern = "combo" | "shieldBreaker" | "javelin" | "reinforce";

/** Pure duel state: HP floor clamp + one-shot transition + reinforce gate. */
export class CastellanDuel {
  private _hp: number;
  readonly floor: number;
  transitioned = false;
  reinforceFired = false;
  private readonly reinforcePct: number;

  constructor(readonly maxHp: number, opts: { floorPct?: number; reinforcePct?: number } = {}) {
    const floorPct = opts.floorPct ?? 0.4;
    this.reinforcePct = opts.reinforcePct ?? 0.7;
    this._hp = maxHp;
    this.floor = maxHp * floorPct;
  }

  get hp(): number {
    return this._hp;
  }

  damage(n: number): DuelHit {
    if (this.transitioned) return { applied: 0, clamped: true, transitionNow: false };
    if (this._hp - n <= this.floor) {
      const applied = Math.max(0, this._hp - this.floor);
      this._hp = this.floor;
      this.transitioned = true;
      return { applied, clamped: true, transitionNow: true };
    }
    this._hp -= n;
    return { applied: n, clamped: false, transitionNow: false };
  }

  shouldReinforce(): boolean {
    return !this.reinforceFired && this._hp <= this.maxHp * this.reinforcePct && !this.transitioned;
  }
}

export function selectCastellanPattern(
  rand: () => number,
  dist: number,
  last: CastellanPattern | null,
  reinforceAvailable: boolean
): CastellanPattern {
  if (reinforceAvailable && rand() < 0.35) return "reinforce";
  if (dist > 12) return "javelin";
  const melee: CastellanPattern[] = ["combo", "shieldBreaker"];
  const filtered = last ? melee.filter((m) => m !== last) : melee;
  return filtered[Math.floor(rand() * filtered.length)] ?? "combo";
}
```

- [ ] **Step 4: Run → PASS; typecheck clean**

- [ ] **Step 5: Commit**

```bash
git add src/mission/blackstone/CastellanDuel.ts tests/finale.test.ts
git commit -m "Finale: castellan duel core (40% clamp, single transition, patterns)"
```

---

### Task 4: Boss AI core (pure)

**Files:**
- Create: `src/mission/blackstone/BossAI.ts`
- Test: `tests/finale.test.ts` (append suite)

**Interfaces:**
- Produces: `function rubberBandFactor(dist: number, min?: number, max?: number): number`; `interface PathPoint { x: number; z: number }`; `function advanceWaypoint(px: number, pz: number, path: PathPoint[], idx: number, reachRadius?: number): number`; `type SweepState = "IDLE" | "TELEGRAPH" | "ATTACK" | "RECOVERY"`; `class FlameSweepSM { constructor(opts?: { telegraph?: number; attack?: number; recovery?: number }); get state(): SweepState; get t(): number; get elapsed(): number; start(): boolean; update(dt: number): void }`.

- [ ] **Step 1: Write failing tests** (append)

```ts
import { rubberBandFactor, advanceWaypoint, FlameSweepSM, type PathPoint } from "../src/mission/blackstone/BossAI";

describe("boss ai core", () => {
  test("rubber band: slows when player far, speeds when crowding, neutral in band", () => {
    expect(rubberBandFactor(140)).toBeCloseTo(-0.1);
    expect(rubberBandFactor(30)).toBeCloseTo(0.1);
    expect(rubberBandFactor(75)).toBeCloseTo(0);
  });

  test("waypoint advance on reach, wraps at path end", () => {
    const path: PathPoint[] = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    expect(advanceWaypoint(0, 0, path, 0)).toBe(1);
    expect(advanceWaypoint(99, 0, path, 1)).toBe(1);
    expect(advanceWaypoint(95, 0, path, 1)).toBe(0); // wrapped
  });

  test("flame sweep SM: telegraph → attack → recovery → idle with correct durations", () => {
    const sm = new FlameSweepSM({ telegraph: 1.1, attack: 1.4, recovery: 2.2 });
    expect(sm.state).toBe("IDLE");
    expect(sm.start()).toBe(true);
    expect(sm.start()).toBe(false); // already running
    expect(sm.state).toBe("TELEGRAPH");
    sm.update(1.0);
    expect(sm.state).toBe("TELEGRAPH");
    sm.update(0.2);
    expect(sm.state).toBe("ATTACK");
    sm.update(1.3);
    expect(sm.state).toBe("ATTACK");
    sm.update(0.2);
    expect(sm.state).toBe("RECOVERY");
    sm.update(2.2);
    expect(sm.state).toBe("IDLE"); // recovery window is the player's attack opening
    expect(sm.start()).toBe(true); // can re-arm
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

Create `src/mission/blackstone/BossAI.ts`:

```ts
export interface PathPoint {
  x: number;
  z: number;
}

/** >max → boss slows 10%; <min → boss speeds 10%; inside band → 0 */
export function rubberBandFactor(dist: number, min = 60, max = 90): number {
  if (dist > max) return -0.1;
  if (dist < min) return 0.1;
  return 0;
}

/** Returns the (possibly advanced/wrapped) waypoint index. */
export function advanceWaypoint(px: number, pz: number, path: PathPoint[], idx: number, reachRadius = 25): number {
  const wp = path[idx % path.length];
  const dx = px - wp.x;
  const dz = pz - wp.z;
  if (dx * dx + dz * dz < reachRadius * reachRadius) return (idx + 1) % path.length;
  return idx;
}

export type SweepState = "IDLE" | "TELEGRAPH" | "ATTACK" | "RECOVERY";

/** One flame-sweep cycle: TELEGRAPH → ATTACK → RECOVERY (player window) → IDLE. */
export class FlameSweepSM {
  private _state: SweepState = "IDLE";
  private _t = 0;
  constructor(private opts: { telegraph: number; attack: number; recovery: number }) {}
  get state(): SweepState {
    return this._state;
  }
  get t(): number {
    return this._t;
  }
  start(): boolean {
    if (this._state !== "IDLE") return false;
    this._state = "TELEGRAPH";
    this._t = 0;
    return true;
  }
  update(dt: number): void {
    if (this._state === "IDLE") return;
    this._t += dt;
    const dur =
      this._state === "TELEGRAPH" ? this.opts.telegraph :
      this._state === "ATTACK" ? this.opts.attack :
      this.opts.recovery;
    if (this._t >= dur) {
      this._t = 0;
      this._state =
        this._state === "TELEGRAPH" ? "ATTACK" :
        this._state === "ATTACK" ? "RECOVERY" : "IDLE";
    }
  }
}
```

- [ ] **Step 4: Run → PASS; typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/mission/blackstone/BossAI.ts tests/finale.test.ts
git commit -m "Finale: boss AI core (rubber band, waypoints, flame sweep SM)"
```

---

### Task 5: Vharax definition + rig bulk/armor

**Files:**
- Create: `src/data/wardragon.ts`
- Modify: `src/data/dragons.ts` (add `bulk?: number` to `DragonDefinition` — find the interface near the `WingShape` type at top of file)
- Modify: `src/world/DragonRig.ts:74-77` (chest capsule), `:107` (neck segs), add `buildWarArmor()` method + call
- Test: `tests/upgrades.test.ts` (append validity test — it already covers dragon stat blocks)

**Interfaces:**
- Produces: `const VHARAX: DragonDefinition & { bulk: number }` exported from `src/data/wardragon.ts` (`id: "vharax"`, `scale: 2.2`, `bulk: 1.25`); `DragonDefinition.bulk?: number`; `DragonRig.buildWarArmor(mat: StandardMaterial): void`.

- [ ] **Step 1: Write failing test** (append to `tests/upgrades.test.ts`)

```ts
import { VHARAX } from "../src/data/wardragon";
import { DRAGONS } from "../src/data/dragons";

describe("war dragon definition", () => {
  test("vharax is a valid, distinct, oversized dragon definition", () => {
    expect(VHARAX.id).toBe("vharax");
    expect(DRAGONS.find((d) => d.id === "vharax")).toBeUndefined(); // not player-selectable
    expect(VHARAX.scale).toBeGreaterThan(Math.max(...DRAGONS.map((d) => d.scale)));
    expect(VHARAX.bulk).toBeGreaterThan(1);
    expect(VHARAX.wingShape.membraneNotch).toBeGreaterThan(0.3); // torn membrane
    for (const k of ["bodyColor", "wingColor", "accentColor"] as const) {
      expect(VHARAX[k]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL (module not found)**

- [ ] **Step 3: Implement**

`src/data/dragons.ts` — in the `DragonDefinition` interface add next to `scale`:

```ts
  /** proportion multiplier for chest/neck girth (war dragon bulk) */
  bulk?: number;
```

Create `src/data/wardragon.ts`:

```ts
import type { DragonDefinition } from "./dragons";

/** VHARAX — War Dragon of Blackstone. Boss-only: never enters DRAGONS (select screen). */
export const VHARAX: DragonDefinition = {
  id: "vharax",
  name: "Vharax",
  maxHealth: 1600,
  armor: 6,
  fireDamage: 26,
  fireRange: 34,
  fireCone: 0.55,
  fireCapacity: 999,
  fireDrain: 0,
  fireRecharge: 999,
  acceleration: 22,
  maxSpeed: 46,
  boostSpeed: 62,
  turnRate: 1.5,
  climbRate: 20,
  diveSpeed: 70,
  staggerResistance: 1,
  scale: 2.2,
  bulk: 1.25,
  bodyColor: "#241d1c",
  wingColor: "#31201d",
  accentColor: "#5a1414",
  wingShape: { span: 1.15, chord: 1.1, fingers: 4, membraneNotch: 0.5, sweepAngle: 0.35 },
} as DragonDefinition;
```

(If `DragonDefinition` has additional required fields, mirror them from an existing dragon in `src/data/dragons.ts` — the object literal must typecheck; `npm run typecheck` is the gate.)

`src/world/DragonRig.ts`:

1. In the constructor, after `const s = def.scale;` (line 61) add `const bulk = (def as Required<Pick<DragonDefinition, "bulk">> & DragonDefinition).bulk ?? 1;` — simpler: `const bulk = def.bulk ?? 1;` once the interface has the field.
2. Chest capsule (line 74): `radius: 1.12 * s` → `radius: 1.12 * s * bulk`.
3. Neck segments (line 107): `radius: (0.52 - i * 0.07) * s` → `radius: (0.52 - i * 0.07) * s * bulk`.
4. After the rider build (end of constructor, before closing brace) add:

```ts
    if (def.bulk) this.buildWarArmor();
```

5. New method (before `animate`):

```ts
  /** partial war armor: head plate, neck rings, chest plate, saddle hardware (~25% coverage) */
  private buildWarArmor(): void {
    const s = this.def.scale;
    const mat = new StandardMaterial(`war-armor-${this.def.id}`, this.scene);
    mat.diffuseColor = Color3.FromHexString("#2e2a26");
    mat.specularColor = new Color3(0.22, 0.2, 0.18);
    mat.specularPower = 60;
    const parts: Mesh[] = [];
    const brow = MeshBuilder.CreateBox(`armor-brow`, { width: 1.05 * s, height: 0.22 * s, depth: 0.5 * s }, this.scene);
    brow.position.set(0, 0.42 * s, 0.55 * s);
    parts.push(brow);
    for (let i = 0; i < 3; i++) {
      const ring = MeshBuilder.CreateTorus(`armor-neck${i}`, { diameter: 1.15 * s * this.def.bulk!, thickness: 0.12 * s, tessellation: 10 }, this.scene);
      ring.position.set(0, (0.42 + i * 0.5) * s, (0.55 + i * 0.72) * s);
      ring.rotation.x = 0.55 + i * 0.1;
      parts.push(ring);
    }
    const plate = MeshBuilder.CreateBox(`armor-chest`, { width: 1.5 * s * this.def.bulk!, height: 0.7 * s, depth: 1.6 * s }, this.scene);
    plate.position.set(0, 0.2 * s, 1.1 * s);
    parts.push(plate);
    const saddle = MeshBuilder.CreateBox(`armor-saddle`, { width: 1.0 * s, height: 0.25 * s, depth: 1.4 * s }, this.scene);
    saddle.position.set(0, 1.05 * s, 0.2 * s);
    parts.push(saddle);
    for (const side of [-1, 1]) {
      const chain = MeshBuilder.CreateCylinder(`armor-chain${side}`, { diameter: 0.06 * s, height: 0.9 * s, tessellation: 4 }, this.scene);
      chain.position.set(side * 0.75 * s, 0.7 * s, 0.9 * s);
      chain.rotation.z = side * 0.4;
      parts.push(chain);
    }
    const armor = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    armor.material = mat;
    armor.parent = this.root;
    armor.isPickable = false;
    for (const m of this.root.getChildMeshes()) {
      if (m.name.startsWith("armor-")) m.receiveShadows = false;
    }
  }
```

(Adjust `position` values to sit on the rig visually if obviously off — verify via screenshot in Task 15; the armor parent is `this.root` so it inherits transforms. `this.def` is `private def` — accessible inside the class. `StandardMaterial`, `Color3`, `MeshBuilder`, `Mesh` are already imported at the top of DragonRig.ts.)

- [ ] **Step 4: Run → PASS; `npm run typecheck` clean**

- [ ] **Step 5: Commit**

```bash
git add src/data/wardragon.ts src/data/dragons.ts src/world/DragonRig.ts tests/upgrades.test.ts
git commit -m "Finale: Vharax war-dragon definition, rig bulk proportions + war armor"
```

---

### Task 6: EnemyManager commander puppeting

**Files:**
- Modify: `src/ai/EnemyManager.ts:25-50` (Soldier interface), `:318-322` (update loop), add `claimCommander()` near `getGroundEnemies` (line ~306); export `ballisticDir` (line ~83)

**Interfaces:**
- Produces: `Soldier.puppeted?: boolean`; `claimCommander(): Soldier | null`; `export function ballisticDir(...)` (existing signature unchanged, add `export`).

- [ ] **Step 1: Implement (logic is trivial; Babylon-bound — covered by typecheck + Task 15 e2e)**

1. In the `Soldier` interface add:

```ts
  /** finale boss owns this soldier — generic AI skipped */
  puppeted?: boolean;
```

2. In `update()`'s soldier loop, right after the dead-check block (lines 319-322), insert:

```ts
      if (s.puppeted) {
        s.root.position.copyFrom(s.pos);
        s.root.rotation.y = damp(s.root.rotation.y, s.yaw, 12, dt);
        continue;
      }
```

3. Add method (near `getGroundEnemies`, ~line 306):

```ts
  /** Hand the commander to the finale boss (generic AI skipped until released). */
  claimCommander(): Soldier | null {
    const c = this.soldiers.find((s) => s.def.role === "commander" && s.state !== "dead");
    if (c) c.puppeted = true;
    return c ?? null;
  }

  releaseCommander(): void {
    for (const s of this.soldiers) s.puppeted = false;
  }
```

4. Line ~83: change `function ballisticDir(` to `export function ballisticDir(`.

- [ ] **Step 2: `npm run typecheck` → clean; `npm run test` → all pass (no behavior change yet — nothing sets `puppeted`).**

- [ ] **Step 3: Commit**

```bash
git add src/ai/EnemyManager.ts
git commit -m "EnemyManager: commander puppet claim/release + exported ballisticDir"
```

---

### Task 7: MissionScene dismount/remount + finale mount points

**Files:**
- Modify: `src/mission/MissionScene.ts:147` (store effects), fields area (~line 74-78), end of constructor (~line 175), `wireSystems` fire hooks (lines 187-198), `update()` victory-check area (line ~528), new methods after `spawnRider()` (line ~611)
- Modify: `src/app/GameApp.ts:541-545` (reverse phase mirroring)

**Interfaces:**
- Produces: `MissionScene.readonly effects: EffectsLibrary`; `MissionScene.readonly finale: BlackstoneFinale | null`; `scriptedDismount(pos: Vector3): void`; `remountDragon(): void`.

- [ ] **Step 1: Store effects + finale field + construction**

1. Fields (near line 74):

```ts
  readonly effects: EffectsLibrary;
  readonly finale: import("../mission/blackstone/BlackstoneFinale").BlackstoneFinale | null = null;
```

2. Constructor line 147: `const effects = new EffectsLibrary(this.scene);` → `this.effects = new EffectsLibrary(this.scene);` and keep a local `const effects = this.effects;` (existing call sites unchanged).
   Move the field initializer problem: `readonly effects` assigned in ctor is fine; remove `= new ...` from declaration, declare as `readonly effects: EffectsLibrary;`.

3. End of constructor (after the tutorial block, ~line 177):

```ts
    if (d.mission.id === "blackstone") {
      this.finale = new BlackstoneFinale(this, d);
    }
```

4. `update()`: insert immediately before the victory check (~line 528):

```ts
    if (this.finale) this.finale.update(dt);
```

5. `wireSystems()` — in `this.fire.onFireHit = (origin, dir, range, halfAngle, dps, dt) => {` body append after the buildings call; and in the super-beam block (lines 195-198) append the same line with beam params:

```ts
      if (this.finale) this.finale.applyFire(origin, dir, range, halfAngle, dps, dt);
```

- [ ] **Step 2: scriptedDismount / remountDragon** (insert after `spawnRider()`, ~line 611)

```ts
  /** Finale: land-and-dismount with the dragon ALIVE (no convertToGround, no death cinematics). */
  scriptedDismount(spawnPos: Vector3): void {
    this.phase = "ground";
    this.player.mode = "ground";
    this.dragonCtrl.speed = 0;
    this.dragonCtrl.pitch = 0;
    this.dragonCtrl.roll = 0;
    this.rig.setRiderVisible(false);
    const factory = new SoldierFactory(this.scene);
    const figure = factory.createRiderFigure(this.deps.rider);
    for (const m of figure.root.getChildMeshes()) {
      this.world.shadows?.addShadowCaster(m);
    }
    this.riderCtrl = new RiderController(this.player, figure, this.world.terrain, this.deps.bus);
    this.riderCtrl.spawn(spawnPos, this.dragonCtrl.yaw);
    this.groundCam.yaw = this.dragonCtrl.yaw;
    this.groundCam.pitch = 0.15;
    this.groundCam.reset(this.riderCtrl.pos);
    this.scene.activeCamera = this.groundCam.camera;
    this.deps.bus.emit("ground-mode-start", { pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z } });
  }

  /** Finale: rider back on the (alive, parked) dragon — returns flight mode. */
  remountDragon(): void {
    if (!this.riderCtrl) return;
    this.riderCtrl.figure.root.dispose(false, false);
    this.riderCtrl = null;
    this.phase = "dragon";
    this.player.mode = "dragon";
    this.player.riderAlive = true;
    this.rig.setRiderVisible(true);
    this.dragonCtrl.speed = 20;
    this.dragonCtrl.pitch = 0.12;
    this.dragonCam.reset(this.dragonCtrl);
    this.scene.activeCamera = this.dragonCam.camera;
  }
```

Import `SoldierFactory` at top of MissionScene.ts if not already imported (check existing imports; `spawnRider` already uses `new SoldierFactory(this.scene)` so the import exists).

- [ ] **Step 3: GameApp reverse mirroring** — `src/app/GameApp.ts` lines 541-545, extend the chain:

```ts
      } else if (this.mission.phase === "ground" && this.state.is(GameState.DRAGON_DEATH, GameState.DRAGON_GAMEPLAY)) {
        this.state.transition(GameState.GROUND_GAMEPLAY);
      } else if (this.mission.phase === "dragon" && this.state.is(GameState.GROUND_GAMEPLAY)) {
        this.state.transition(GameState.DRAGON_GAMEPLAY); // finale remount
      }
```

- [ ] **Step 4: Stub BlackstoneFinale so typecheck passes**

Create minimal `src/mission/blackstone/BlackstoneFinale.ts` (full logic in Task 10):

```ts
import type { MissionScene, MissionSceneDeps } from "../MissionScene";
import type { Vector3 } from "@babylonjs/core";

export class BlackstoneFinale {
  constructor(private mission: MissionScene, private deps: MissionSceneDeps) {
    void deps;
  }
  update(dt: number): void {
    void dt;
  }
  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    void origin; void dir; void range; void halfAngle; void dps; void dt;
  }
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → clean. `npm run test` → pass. `npx playwright test e2e/regression.spec.ts` → all pass (finale is a no-op stub; dismounted path not yet reachable).

- [ ] **Step 6: Commit**

```bash
git add src/mission/MissionScene.ts src/app/GameApp.ts src/mission/blackstone/BlackstoneFinale.ts
git commit -m "Finale: mission mount points — scriptedDismount/remountDragon, effects field, fire hook, reverse state mirroring"
```

---

### Task 8: WarDragon controller

**Files:**
- Create: `src/mission/blackstone/WarDragon.ts`

**Interfaces:**
- Consumes: `VHARAX` (Task 5), `DragonRig` (bulk + armor), `rubberBandFactor`/`advanceWaypoint`/`FlameSweepSM` (Task 4), `EffectsLibrary`.
- Produces: `class WarDragon { constructor(scene: Scene, effects: EffectsLibrary, bus: GameEventBus); readonly rig: DragonRig; hp: number; readonly maxHp: number; readonly floor: number; pos: Vector3; yaw: number; get state(): "CHASE" | "ORBIT" | "TELEGRAPH" | "ATTACK" | "RECOVERY" | "FLEEING" | "GONE"; update(dt: number, playerPos: Vector3, playerAlive: boolean, terrainHeight: number): void; applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void; chasePathIndex: number; startChase(firstPos: Vector3): void; startDuel(): void; flee(): void; onSweepHitPlayer: ((dps: number, dt: number) => void) | null; onResolved: (() => void) | null; dispose(): void }`.

- [ ] **Step 1: Implement**

Create `src/mission/blackstone/WarDragon.ts`:

```ts
import { Color3, PointLight, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EffectsLibrary } from "../../world/EffectsLibrary";
import { DragonRig } from "../../world/DragonRig";
import { VHARAX } from "../../data/wardragon";
import { FlameSweepSM, advanceWaypoint, rubberBandFactor, type PathPoint } from "./BossAI";

const CHASE_PATH: (PathPoint & { y: number })[] = [
  { x: 0, z: -60, y: 75 },    // keep
  { x: 0, z: -95, y: 90 },    // spire (Task 13 landmark)
  { x: -170, z: 0, y: 80 },   // west wall sweep
  { x: 0, z: 160, y: 70 },    // over the gatehouse
  { x: 60, z: 330, y: 95 },   // outer cliff
  { x: 240, z: 420, y: 120 }, // open sky
];

export type WarDragonState = "CHASE" | "ORBIT" | "TELEGRAPH" | "ATTACK" | "RECOVERY" | "FLEEING" | "GONE";

export class WarDragon {
  readonly rig: DragonRig;
  readonly maxHp = VHARAX.maxHealth;
  readonly floor = VHARAX.maxHealth * 0.4;
  hp = VHARAX.maxHealth;
  pos = new Vector3(0, 60, -95);
  yaw = 0;
  roll = 0;
  speed = 40;
  chasePathIndex = 0;
  onSweepHitPlayer: ((dps: number, dt: number) => void) | null = null;
  onResolved: (() => void) | null = null;
  private state_: WarDragonState = "CHASE";
  private sm = new FlameSweepSM({ telegraph: 1.1, attack: 1.4, recovery: 2.2 });
  private sweepCooldown = 2;
  private orbitAngle = 0;
  private fleeT = 0;
  private fireLight: PointLight;
  private readonly tmp = new Vector3();

  constructor(private scene: Scene, private effects: EffectsLibrary, private bus: GameEventBus) {
    this.rig = new DragonRig(scene, VHARAX);
    this.rig.root.setEnabled(false);
    this.fireLight = new PointLight("vharax-fire", new Vector3(0, 0, 0), scene);
    this.fireLight.diffuse = new Color3(1, 0.45, 0.15);
    this.fireLight.intensity = 0;
    this.fireLight.range = 90;
  }

  get state(): WarDragonState {
    return this.state_;
  }

  startChase(firstPos: Vector3): void {
    this.pos.copyFrom(firstPos);
    this.rig.root.setEnabled(true);
    this.rig.root.position.copyFrom(this.pos);
    this.state_ = "CHASE";
  }

  startDuel(): void {
    this.state_ = "ORBIT";
    this.sweepCooldown = 2.5;
  }

  flee(): void {
    if (this.state_ === "GONE") return;
    this.state_ = "FLEEING";
    this.fleeT = 0;
  }

  private resolve(): void {
    if (this.state_ === "GONE") return;
    this.flee();
    this.onResolved?.();
  }

  update(dt: number, playerPos: Vector3, playerAlive: boolean, terrainHeight: number): void {
    if (this.state_ === "GONE") return;
    if (this.hp <= this.floor && this.state_ !== "FLEEING") this.resolve();

    let target: Vector3;
    let speed = 42;
    if (this.state_ === "CHASE") {
      const wp = CHASE_PATH[this.chasePathIndex];
      target = new Vector3(wp.x, wp.y, wp.z);
      this.chasePathIndex = advanceWaypoint(this.pos.x, this.pos.z, CHASE_PATH, this.chasePathIndex, 28);
      const dist = Vector3.Distance(this.pos, playerPos);
      speed *= 1 + rubberBandFactor(dist);
    } else if (this.state_ === "ORBIT") {
      this.orbitAngle += dt * 0.35;
      target = playerPos.add(new Vector3(Math.cos(this.orbitAngle) * 70, 18, Math.sin(this.orbitAngle) * 70));
      speed = 34;
      this.sweepCooldown -= dt;
      const facing = Vector3.Dot(this.forward(), Vector3.Normalize(playerPos.subtract(this.pos)));
      if (this.sweepCooldown <= 0 && facing > 0.86 && Vector3.Distance(this.pos, playerPos) < 95) {
        this.sm.start();
        this.state_ = "TELEGRAPH";
        this.bus.emit("sfx", { name: "inhale" });
      }
    } else if (this.state_ === "TELEGRAPH" || this.state_ === "ATTACK" || this.state_ === "RECOVERY") {
      target = playerPos;
      speed = 20;
      this.sm.update(dt);
      this.state_ = this.sm.state === "TELEGRAPH" ? "TELEGRAPH" : this.sm.state === "ATTACK" ? "ATTACK" : this.sm.state === "RECOVERY" ? "RECOVERY" : "ORBIT";
      if (this.sm.state === "IDLE") this.sweepCooldown = 3.2;
      if (this.sm.state === "ATTACK" && playerAlive) {
        // flame cone vs player capsule (head + body spheres)
        const origin = this.rig.headTip.getAbsolutePosition();
        const dir = Vector3.Normalize(playerPos.subtract(origin));
        const d = Vector3.Distance(origin, playerPos);
        const coneCos = Math.cos(VHARAX.fireCone!);
        if (d < VHARAX.fireRange! && Vector3.Dot(dir, this.forward()) > coneCos) {
          this.onSweepHitPlayer?.(VHARAX.fireDamage!, dt);
        }
      }
    } else {
      // FLEEING — straight out, despawn past fog
      this.fleeT += dt;
      target = new Vector3(this.pos.x, 200, this.pos.z - 400);
      speed = 70;
      if (this.fleeT > 6) {
        this.state_ = "GONE";
        this.rig.root.setEnabled(false);
        this.fireLight.intensity = 0;
        return;
      }
    }

    // steering (turn-rate limited)
    this.tmp.copyFrom(target).subtractInPlace(this.pos);
    const wantYaw = Math.atan2(this.tmp.x, this.tmp.z);
    const wantPitch = Math.atan2(this.tmp.y, Math.hypot(this.tmp.x, this.tmp.z));
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 1.6);
    const pitch = Math.max(-0.6, Math.min(0.6, wantPitch)) * 0.5;
    this.roll += (Math.max(-0.7, Math.min(0.7, -dy * 3)) - this.roll) * Math.min(1, dt * 3);
    this.speed += (speed - this.speed) * Math.min(1, dt * 1.5);

    const fwd = this.forward();
    this.pos.addInPlace(fwd.scale(this.speed * dt));
    this.pos.y += Math.sin(pitch) * this.speed * dt;
    this.pos.y = Math.max(this.pos.y, terrainHeight + 12); // never inside terrain/fortress
    this.rig.root.position.copyFrom(this.pos);
    this.rig.root.rotation.set(pitch, this.yaw, this.roll);
    this.rig.animate({ flapRate: 5.2, flapAmp: 0.8, sweep: this.state_ === "CHASE" ? 0.25 : 0.1, jawOpen: this.sm.state === "TELEGRAPH" ? 1 : this.sm.state === "ATTACK" ? 1 : 0, dt });

    this.fireLight.position.copyFrom(this.rig.headTip.getAbsolutePosition());
    this.fireLight.intensity = this.sm.state === "ATTACK" ? 2.2 : this.sm.state === "TELEGRAPH" ? 0.8 : 0;
  }

  forward(): Vector3 {
    return new Vector3(Math.sin(this.yaw) * Math.cos(0), 0, Math.cos(this.yaw));
  }

  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    if (this.state_ === "GONE" || this.state_ === "FLEEING") return;
    const head = this.pos.add(this.forward().scale(4 * VHARAX.scale));
    const tail = this.pos.subtract(this.forward().scale(4 * VHARAX.scale));
    const closest = closestPointOnSegment(origin, head, tail);
    const d = Vector3.Distance(origin, closest);
    if (d > range) return;
    const toDragon = closest.subtract(origin);
    toDragon.y = 0;
    const flat = Vector3.Normalize(toDragon);
    const flatDir = new Vector3(dir.x, 0, dir.z).normalize();
    if (Vector3.Dot(flat, flatDir) < Math.cos(halfAngle + 0.15)) return;
    const falloff = 1 - 0.35 * (d / range);
    this.hp = Math.max(this.floor, this.hp - dps * dt * falloff);
    if (Math.random() < dt * 6) this.bus.emit("sfx", { name: "bossHit" });
  }

  dispose(): void {
    this.rig.dispose(); // meshes only — materials are scene-scoped cache-owned
    this.fireLight.dispose();
  }
}

function closestPointOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  const ab = b.subtract(a);
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / Vector3.Dot(ab, ab)));
  return a.add(ab.scale(t));
}
```

(If `DragonRig.animate` param shape differs — check `DragonAnimParams` — adapt field names; `VHARAX.fireCone!` etc. rely on optional fields in `DragonDefinition` — keep the `!` consistent with how `DragonController` reads stats, or provide fallbacks `?? 0.5`.)

- [ ] **Step 2: `npm run typecheck` → clean (stub finale does not use it yet; unused warnings are not errors).**

- [ ] **Step 3: Commit**

```bash
git add src/mission/blackstone/WarDragon.ts
git commit -m "Finale: WarDragon controller — chase/duel flight, flame sweep, fire intake, fail-safes"
```

---

### Task 9: CastellanBoss puppet layer

**Files:**
- Create: `src/mission/blackstone/CastellanBoss.ts`

**Interfaces:**
- Consumes: `Soldier` (puppeted), `CastellanDuel`, `selectCastellanPattern` (Task 3), `ballisticDir` + `ProjectileSystem` + `EnemyManager` (Task 6).
- Produces: `class CastellanBoss { constructor(soldier: Soldier, enemies: EnemyManager, projectiles: ProjectileSystem, bus: GameEventBus); readonly duel: CastellanDuel; update(dt: number, playerPos: Vector3, playerMode: "dragon" | "ground"): void; get alive(): boolean; setHp(n: number): void }`.

- [ ] **Step 1: Implement**

```ts
import { Color3, Vector3 } from "@babylonjs/core";
import type { GameEventBus } from "../../core/Events";
import type { EnemyManager, Soldier } from "../../ai/EnemyManager";
import { ballisticDir } from "../../ai/EnemyManager";
import type { ProjectileSystem } from "../../combat/ProjectileSystem";
import { CastellanDuel, selectCastellanPattern, type CastellanPattern } from "./CastellanDuel";

interface PuppetCtx {
  playerPos: Vector3;
  playerMode: "dragon" | "ground";
}

export class CastellanBoss {
  readonly duel: CastellanDuel;
  private pattern: CastellanPattern | null = null;
  private patternT = 0;
  private swingIndex = 0;

  constructor(private s: Soldier, private enemies: EnemyManager, private projectiles: ProjectileSystem, private bus: GameEventBus) {
    this.duel = new CastellanDuel(s.maxHp);
  }

  get alive(): boolean {
    return this.s.state !== "dead";
  }

  setHp(n: number): void {
    this.s.hp = Math.max(1, Math.min(this.s.maxHp, n));
    if (n > this.duel.floor) this.duel.restoreHp(this.s.hp);
  }

  update(dt: number, ctx: PuppetCtx): void {
    const s = this.s;
    if (s.state === "dead") return;
    // clamp: any damage source that dipped the puppet below the floor
    if (!this.duel.transitioned && s.hp <= this.duel.floor) {
      s.hp = this.duel.floor;
      this.duel.markTransitioned();
    } else if (s.hp < this.duel.floor) {
      s.hp = this.duel.floor;
    }
    const dist = Vector3.Distance(s.pos, ctx.playerPos);
    // face the player
    const want = Math.atan2(ctx.playerPos.x - s.pos.x, ctx.playerPos.z - s.pos.z);
    let dy = want - s.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * Math.min(1, dt * 6);

    if (!this.pattern) {
      if (s.cooldown > 0) {
        s.cooldown -= dt;
        return;
      }
      this.pattern = selectCastellanPattern(Math.random, dist, null, this.duel.shouldReinforce());
      this.patternT = 0;
      this.swingIndex = 0;
      if (this.pattern === "reinforce") this.doReinforce();
      return;
    }
    this.patternT += dt;
    switch (this.pattern) {
      case "combo":
        this.runMeleeSwing(dt, dist, 0.55 + this.swingIndex * 0.15, 22 + this.swingIndex * 8, false);
        break;
      case "shieldBreaker":
        this.runMeleeSwing(dt, dist, 0.9, 40, true);
        break;
      case "javelin":
        this.runJavelin(dt, dist, ctx);
        break;
      case "reinforce":
        this.pattern = null; // handled instantly
        return;
    }
    if (this.patternT > 2.4) {
      this.pattern = null;
      s.cooldown = 0.8;
      s.material.emissiveColor.copyFrom(s.baseEmissive);
    }
  }

  private runMeleeSwing(dt: number, dist: number, windup: number, dmg: number, unblockable: boolean): void {
    const s = this.s;
    const telegraph = unblockable ? new Color3(0.85, 0.45, 0.05) : new Color3(0.7, 0.1, 0.05);
    if (this.patternT < windup) {
      s.material.emissiveColor = telegraph; // animation + visual telegraph channels
      s.state = "meleeWindup";
      return;
    }
    if (this.swingIndex === 0) {
      this.swingIndex = 1;
      if (dist < s.def.range + 1.4) {
        this.enemies.onMeleeHitRider?.(dmg * unblockable ? dmg : dmg, dist > 0 ? (s.pos.x - this.lastPlayerX) * 0 + (this.lastPlayerX > s.pos.x ? 1 : -1) : 1, this.lastPlayerZ > s.pos.z ? 1 : -1);
        this.bus.emit("sfx", { name: "swordSwing" });
      }
      if (this.pattern === "combo" && this.swingIndex < 3) {
        this.patternT = 0; // next swing of the combo
      }
    }
  }

  private lastPlayerX = 0;
  private lastPlayerZ = 0;

  private runJavelin(dt: number, dist: number, ctx: PuppetCtx): void {
    void dt;
    void dist;
    const s = this.s;
    this.lastPlayerX = ctx.playerPos.x;
    this.lastPlayerZ = ctx.playerPos.z;
    if (this.patternT < 0.7) {
      s.material.emissiveColor = new Color3(0.6, 0.5, 0.1);
      s.state = "aim";
      return;
    }
    if (this.swingIndex === 0) {
      this.swingIndex = 1;
      const origin = s.pos.add(new Vector3(0, 1.9, 0));
      const dir = ballisticDir(origin, ctx.playerPos.add(new Vector3(0, 1, 0)), 28);
      if (dir) this.projectiles.spawn("spear", origin, dir, 28, 26, 0.05);
      this.bus.emit("sfx", { name: "ballistaFire" });
    }
  }

  private doReinforce(): void {
    this.duel.reinforceFired = true;
    const base = this.s.pos;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const p = new Vector3(base.x + Math.cos(a) * 10, base.y, base.z + Math.sin(a) * 10);
      const s = this.enemies.spawnSoldier("swordsman", p);
      s.state = "alert";
    }
    this.bus.emit("sfx", { name: "roar" });
    this.pattern = null;
    this.s.cooldown = 1.2;
  }
}
```

`CastellanDuel` needs two tiny additions (add to Task 3's file + tests in this task):

```ts
  markTransitioned(): void {
    this.transitioned = true;
    this._hp = this.floor;
  }

  restoreHp(hp: number): void {
    // test API: re-arm the transition when HP is set above the floor again
    this._hp = hp;
    this.transitioned = false;
  }
```

(`restoreHp` exists for the E2E `setCastellanHp` flow; note in its test: `restoreHp` un-clamps. The `runMeleeSwing` direction computation is intentionally simplified — pass a unit direction from player→castellan; refactor to compute `fromDir` exactly as `EnemyManager.meleeBehavior` does: `Vector3.Normalize(ctx.playerPos.subtract(s.pos))` passed as `fromX/fromZ`.)

- [ ] **Step 2: Extend Task 3 tests for markTransitioned/restoreHp; run `npx vitest run tests/finale.test.ts` → PASS; `npm run typecheck`**

- [ ] **Step 3: Commit**

```bash
git add src/mission/blackstone/CastellanBoss.ts src/mission/blackstone/CastellanDuel.ts tests/finale.test.ts
git commit -m "Finale: castellan boss puppet — patterns, telegraphs, javelin, reinforce, floor clamp"
```

---

### Task 10: BlackstoneFinale orchestrator (full)

**Files:**
- Modify: `src/mission/blackstone/BlackstoneFinale.ts` (replace stub)
- Modify: `src/core/Events.ts` (3 new events)

**Interfaces:**
- Consumes: everything above + `PhaseMachine`.
- Produces: `BlackstoneFinale { constructor(mission: MissionScene, deps: MissionSceneDeps); readonly phases: PhaseMachine; get phase(): FinalePhase; update(dt: number): void; applyFire(...): void; setCastellanHp(n: number): void; damageWarDragon(n: number): void; forceLand(): void; skipTo(p: FinalePhase): boolean }`.

- [ ] **Step 1: Events** — append to `GameEvents` in `src/core/Events.ts`:

```ts
  "finale-boss": { show: boolean; name?: string; hpFrac?: number };
  "finale-subtitle": { text: string; ms: number };
  "finale-music": { state: "chase" | "boss" | "resolve" };
```

(`"resolve"` is a signal, not a MusicStateId — GameApp maps it back to normal adaptive selection.)

- [ ] **Step 2: Implement the orchestrator**

Replace `src/mission/blackstone/BlackstoneFinale.ts`:

```ts
import { Vector3 } from "@babylonjs/core";
import type { MissionScene, MissionSceneDeps } from "../MissionScene";
import type { GameEventBus } from "../../core/Events";
import { PhaseMachine, type FinalePhase } from "./FinalePhases";
import { CastellanBoss } from "./CastellanBoss";
import { WarDragon } from "./WarDragon";

const STAGE_BUDGET: Partial<Record<FinalePhase, number>> = {
  TRANSITION: 7,
  REVEAL: 9,
  MOUNT: 6,
  REMOUNT: 8,
};

export class BlackstoneFinale {
  readonly phases = new PhaseMachine();
  private castellan: CastellanBoss | null = null;
  private vharax: WarDragon | null = null;
  private stageStartedAt = 0;
  private stageT = 0;
  private shortCircuited = false;
  private courtyardDone = false;
  private chaseLoopNeeded = 1;

  constructor(private mission: MissionScene, private deps: MissionSceneDeps) {
    void deps;
  }

  get phase(): FinalePhase {
    return this.phases.current;
  }

  get warDragon(): WarDragon | null {
    return this.vharax;
  }

  update(dt: number): void {
    const m = this.mission;
    this.stageT += dt;

    // castellan death short-circuit — any time, any chain position
    if (!this.shortCircuited && this.castellan && !this.castellan.alive) {
      this.shortCircuit();
    }

    // dragon died mid-finale → resolve silently (tracker splices event objectives)
    if ((m.phase === "dragonDying") && !this.phases.isTerminal() && this.phases.current !== "INACTIVE" && this.phases.current !== "AWAIT_LANDING") {
      this.vharax?.flee();
      this.phases.transition("RESOLVED");
    }

    switch (this.phases.current) {
      case "INACTIVE": {
        const cur = m.tracker.current();
        if (cur?.id === "bs-castellan") {
          this.courtyardDone = true;
        }
        if (this.courtyardDone) {
          this.castellan = new CastellanBoss(this.claimCastellan(), m.enemies, m.projectiles, this.deps.bus);
          this.phases.transition("AWAIT_LANDING");
          this.deps.bus.emit("hud-hint", { text: "LAND IN THE COURTYARD — FACE THE CASTELLAN" });
        }
        break;
      }
      case "AWAIT_LANDING": {
        const c = m.dragonCtrl;
        const alt = c.pos.y - m.world.terrain.heightAt(c.pos.x, c.pos.z);
        if (alt < 4 && c.speed < 12) {
          const spawn = c.pos.add(new Vector3(Math.sin(c.yaw + Math.PI / 2) * 6, 0, Math.cos(c.yaw + Math.PI / 2) * 6));
          m.scriptedDismount(spawn);
          this.setStage("DUEL_GROUND");
          this.deps.bus.emit("finale-music", { state: "boss" });
          this.deps.bus.emit("finale-boss", { show: true, name: "THE CASTELLAN", hpFrac: 1 });
        }
        break;
      }
      case "DUEL_GROUND": {
        if (this.castellan && m.riderCtrl) {
          this.castellan.update(dt, { playerPos: m.riderCtrl.pos, playerMode: "ground" });
          this.deps.bus.emit("finale-boss", { show: true, name: "THE CASTELLAN", hpFrac: this.castellan.duel.hp / this.castellan.duel.maxHp });
          if (this.castellan.duel.transitioned) {
            this.setStage("TRANSITION");
            this.mission.slowmoT = Math.max(this.mission.slowmoT, 0.5);
            this.deps.bus.emit("finale-subtitle", { text: "You came here riding a dragon.", ms: 2600 });
          }
        }
        break;
      }
      case "TRANSITION": {
        if (this.stageT > 2.8) {
          this.deps.bus.emit("finale-subtitle", { text: "Did you think you were the only one?", ms: 3000 });
          this.setStage("REVEAL");
          this.revealVharax();
        }
        break;
      }
      case "REVEAL": {
        if (this.stageT > 4.5) {
          this.setStage("MOUNT");
        }
        break;
      }
      case "MOUNT": {
        if (this.stageT > 2.8) {
          this.setStage("REMOUNT");
        }
        break;
      }
      case "REMOUNT": {
        if (this.stageT > 1.2 && m.phase === "ground") {
          m.remountDragon();
          this.vharax?.startChase(new Vector3(0, 75, -95));
          this.chaseLoopNeeded = CHASE_LOOPS;
          this.setStage("CHASE");
          this.deps.bus.emit("finale-music", { state: "chase" });
          this.deps.bus.emit("finale-subtitle", { text: "PURSUE THE CASTELLAN", ms: 2400 });
        }
        break;
      }
      case "CHASE": {
        const v = this.vharax!;
        this.updateVharax(dt);
        if (v.chasePathIndex === 0 && this.stageT > 4) {
          this.chaseLoopNeeded--;
          if (this.chaseLoopNeeded <= 0) {
            v.startDuel();
            this.setStage("DUEL_AIR");
            this.deps.bus.emit("finale-music", { state: "boss" });
            this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: 1 });
            this.mission.tracker.notifyEvent("chase-complete");
          }
        }
        break;
      }
      case "DUEL_AIR": {
        this.updateVharax(dt);
        const v = this.vharax!;
        this.deps.bus.emit("finale-boss", { show: true, name: "VHARAX — WAR DRAGON OF BLACKSTONE", hpFrac: Math.max(0, (v.hp - v.floor) / (v.maxHp - v.floor)) });
        break;
      }
      case "RESOLVED": {
        this.deps.bus.emit("finale-boss", { show: false });
        break;
      }
    }

    // wall-clock bound per staged phase (slow-pipeline safety)
    const budget = STAGE_BUDGET[this.phases.current];
    if (budget !== undefined && this.stageRealSeconds() > budget * 1.8) {
      this.forceAdvance();
    }
  }

  private static readonly NULL_BOSS = 0;

  applyFire(origin: Vector3, dir: Vector3, range: number, halfAngle: number, dps: number, dt: number): void {
    this.vharax?.applyFire(origin, dir, range, halfAngle, dps, dt);
  }

  setCastellanHp(n: number): void {
    this.castellan?.setHp(n);
  }

  damageWarDragon(n: number): void {
    const v = this.vharax;
    if (!v) return;
    v.hp = Math.max(v.floor, v.hp - n);
  }

  forceLand(): void {
    if (this.phases.current !== "AWAIT_LANDING") return;
    const c = this.mission.dragonCtrl;
    c.pos.y = this.mission.world.terrain.heightAt(c.pos.x, c.pos.z) + 2;
    c.speed = 0;
  }

  skipTo(p: FinalePhase): boolean {
    if (this.phases.current === p) return true;
    while (this.phases.current !== p && !this.phases.isTerminal()) {
      if (!this.forceAdvance()) return false;
    }
    return this.phases.current === p;
  }

  private forceAdvance(): boolean {
    const cur = this.phases.current;
    const next: Partial<Record<FinalePhase, FinalePhase>> = {
      AWAIT_LANDING: "DUEL_GROUND",
      DUEL_GROUND: "TRANSITION",
      TRANSITION: "REVEAL",
      REVEAL: "MOUNT",
      MOUNT: "REMOUNT",
      REMOUNT: "CHASE",
      CHASE: "DUEL_AIR",
      DUEL_AIR: "RESOLVED",
    };
    const to = next[cur];
    if (!to) return false;
    // perform mandatory side effects so skipped states are consistent
    switch (cur) {
      case "AWAIT_LANDING":
        this.forceLand();
        this.mission.scriptedDismount(this.mission.dragonCtrl.pos.add(new Vector3(3, 0, 3)));
        break;
      case "REMOUNT":
        this.mission.remountDragon();
        this.vharax?.startChase(new Vector3(0, 75, -95));
        break;
      case "CHASE":
        this.vharax?.startDuel();
        this.mission.tracker.notifyEvent("chase-complete");
        break;
      case "DUEL_AIR":
        this.vharax?.flee();
        this.mission.tracker.notifyEvent("vharax-resolved");
        break;
    }
    return this.phases.transition(to);
  }

  private claimCastellan() {
    const c = this.mission.enemies.claimCommander();
    if (!c) throw new Error("[finale] blackstone mission has no commander to claim");
    return c;
  }

  private revealVharax(): void {
    if (!this.vharax) {
      this.vharax = new WarDragon(this.mission.scene, this.mission.effects, this.deps.bus);
      this.vharax.onSweepHitPlayer = (dps, dt) => {
        const died = this.mission.player.damageDragon(dps * dt);
        if (died) this.mission.beginDragonDeathPublic();
      };
      this.vharax.onResolved = () => {
        this.mission.tracker.notifyEvent("vharax-resolved");
        this.deps.bus.emit("finale-music", { state: "resolve" });
        this.deps.bus.emit("finale-boss", { show: false });
      };
    }
    this.vharax.startChase(new Vector3(0, 8, -120));
    this.deps.bus.emit("sfx", { name: "deepRoar" });
    this.mission.dragonCam.addShake(1.0);
  }

  private updateVharax(dt: number): void {
    const m = this.mission;
    this.vharax?.update(dt, m.dragonCtrl.pos, m.player.mode === "dragon", m.world.terrain.heightAt(this.vharax.pos.x, this.vharax.pos.z));
  }

  private shortCircuit(): void {
    this.shortCircuited = true;
    const t = this.mission.tracker;
    t.notifyEvent("castellan-transition");
    t.notifyEvent("chase-complete");
    t.notifyEvent("vharax-resolved");
    this.vharax?.flee();
    this.phases.transition("RESOLVED");
    this.deps.bus.emit("finale-boss", { show: false });
  }

  private setStage(p: FinalePhase): void {
    if (!this.phases.transition(p)) return;
    this.stageT = 0;
    this.stageStartedAt = performance.now();
  }

  private stageRealSeconds(): number {
    return (performance.now() - this.stageStartedAt) / 1000;
  }
}

const CHASE_LOOPS = 1;
```

Required MissionScene additions for visibility (modify `src/mission/MissionScene.ts`):
- `beginDragonDeath` is private — add a public wrapper next to it:

```ts
  /** finale hook — routes into the idempotent death pipeline */
  beginDragonDeathPublic(): void {
    if (this.phase === "dragon") this.beginDragonDeath();
  }
```

- `slowmoT` is private — add `friendlySlowmo(seconds: number)` OR make `slowmoT` public; simplest: change `private slowmoT = 0;` → `slowmoT = 0;`.

`WarDragon.onSweepHitPlayer` returning `died` — `damageDragon` returns boolean (PlayerState.damageDragon line 190 returns boolean) — good.

- [ ] **Step 3: `npm run typecheck` → clean; `npm run test` → pass**

- [ ] **Step 4: Commit**

```bash
git add src/mission/blackstone/BlackstoneFinale.ts src/core/Events.ts src/mission/MissionScene.ts
git commit -m "Finale: orchestrator — staged sequence with wall-clock bounds, short-circuit, skip API"
```

---

### Task 11: HUD — boss bar + subtitles

**Files:**
- Modify: `src/ui/HudController.ts` (build + wire), `src/styles/main.css` (append)

- [ ] **Step 1: Elements** — in `build()`, after the `fallenOverlay` block (line ~215):

```ts
    // finale boss bar + cinematic subtitles
    this.bossBar = this.el("div", "boss-bar", `
      <div class="bb-name">—</div>
      <div class="bb-track"><div class="bb-fill"></div></div>`);
    this.bossBar.style.display = "none";
    this.parent.appendChild(this.bossBar);
    this.bossName = this.bossBar.querySelector(".bb-name") as HTMLElement;
    this.bossFill = this.bossBar.querySelector(".bb-fill") as HTMLElement;

    this.subtitleBar = this.el("div", "finale-subtitle", "");
    this.subtitleBar.style.display = "none";
    this.parent.appendChild(this.subtitleBar);
    this.subtitleTimer = 0;
```

Declare fields near the class top (beside `fallenOverlay`):

```ts
  private bossBar: HTMLElement;
  private bossName: HTMLElement;
  private bossFill: HTMLElement;
  private subtitleBar: HTMLElement;
  private subtitleTimer = 0;
```

- [ ] **Step 2: Wire** — in `wire()` (beside the `"dragon-fallen"` subscription, ~line 244):

```ts
    this.bus.on("finale-boss", (e) => {
      this.bossBar.style.display = e.show ? "block" : "none";
      if (e.show) {
        this.bossName.textContent = e.name ?? "—";
        this.bossFill.style.width = `${Math.max(0, Math.min(1, e.hpFrac ?? 1)) * 100}%`;
      }
    });
    this.bus.on("finale-subtitle", (e) => {
      this.subtitleBar.textContent = e.text;
      this.subtitleBar.style.display = "block";
      this.subtitleTimer = e.ms / 1000;
    });
```

In the HUD's per-frame update entry point (`update(snapshot)` or wherever `dt` is available — HudController has an update driven by GameApp at ~30 Hz; if it lacks dt, use the existing pattern from `showHint`'s setTimeout instead):

```ts
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= 1 / 30;
      if (this.subtitleTimer <= 0) this.subtitleBar.style.display = "none";
    }
```

(If HudController has no dt-driven update, replicate the `showFallenTransition` `setTimeout` pattern: replace the timer countdown with `clearTimeout`/`setTimeout` bookkeeping.)

- [ ] **Step 3: CSS** — append to `src/styles/main.css`:

```css
/* finale boss bar + subtitles */
.boss-bar { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); width: 420px; text-align: center; pointer-events: none; z-index: 40; }
.boss-bar .bb-name { font-size: 13px; letter-spacing: 3px; color: #e8d8c8; text-shadow: 0 1px 3px #000; margin-bottom: 4px; }
.boss-bar .bb-track { height: 8px; background: rgba(10, 8, 8, 0.75); border: 1px solid #6a5148; }
.boss-bar .bb-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #7a1a12, #c8451e); transition: width 0.2s ease-out; }
.finale-subtitle { position: absolute; bottom: 18%; left: 50%; transform: translateX(-50%); font-size: 22px; letter-spacing: 2px; color: #f0e6d8; text-shadow: 0 2px 6px #000; pointer-events: none; z-index: 40; font-style: italic; }
```

- [ ] **Step 4: `npm run typecheck`; visual smoke via Task 15 e2e (boss bar asserted by selector).**

- [ ] **Step 5: Commit**

```bash
git add src/ui/HudController.ts src/styles/main.css
git commit -m "HUD: finale boss health bar + cinematic subtitle bar"
```

---

### Task 12: Audio — SFX + chase/boss music states

**Files:**
- Modify: `src/audio/AudioManager.ts` (4 SFX near `roar`, ~line 234)
- Modify: `src/audio/MusicComposer.ts:12-21` (union), `:85-98` (STATE_CONFIG), `:114-246` (composeBar cases)
- Modify: `src/app/GameApp.ts` `wireBus` (~line 157) — finale-music mapping
- Test: `tests/music.test.ts` (append)

- [ ] **Step 1: Failing tests** (append to `tests/music.test.ts`, follow its existing import style):

```ts
describe("chase/boss states", () => {
  test("chase bars are violin-dominant and fast", () => {
    const bar = composeBar("chase", 0, 1234);
    expect(bar.bpm).toBeGreaterThan(120);
    const violin = bar.notes.filter((n) => n.voice === "violin").length;
    const cello = bar.notes.filter((n) => n.voice === "cello").length;
    expect(violin).toBeGreaterThan(cello);
  });

  test("boss bars deterministic and dense", () => {
    expect(composeBar("boss", 2, 42)).toEqual(composeBar("boss", 2, 42));
    expect(composeBar("boss", 0, 42).notes.length).toBeGreaterThanOrEqual(8);
  });

  test("state configs loop", () => {
    expect(stateConfig("chase").loop).toBe(true);
    expect(stateConfig("boss").loop).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL (state ids not in union)**

- [ ] **Step 3: Implement**

MusicComposer: extend `MusicStateId` with `| "chase" | "boss"`; STATE_CONFIG:

```ts
  chase: { bpm: 132, loop: true, intensity: 0.9 },
  boss: { bpm: 116, loop: true, intensity: 0.95 },
```

composeBar cases:

```ts
    case "chase": {
      // fast violin ostinato over pounding cello roots
      for (let i = 0; i < 16; i++) {
        notes.push({ voice: "violin", midi: midi(5, chord[i % chord.length]), start: i * 0.25, dur: 0.22, vel: i % 4 === 0 ? 0.26 : 0.15 });
      }
      for (const b of [0, 1, 2, 3]) {
        notes.push({ voice: "cello", midi: root, start: b, dur: 0.9, vel: 0.4 });
        notes.push({ voice: "drum", midi: 36, start: b, dur: 0.2, vel: 0.6 });
        notes.push({ voice: "drum", midi: 36, start: b + 0.5, dur: 0.15, vel: 0.35 });
      }
      break;
    }
    case "boss": {
      // aggressive interplay: cello ostinato vs violin stabs a fifth above
      let t = 0;
      for (const [m, d] of OSTINATO) {
        notes.push({ voice: "cello", midi: m - 5, start: t, dur: d * 0.9, vel: 0.5 });
        t += d;
      }
      for (let i = 0; i < 8; i++) {
        notes.push({ voice: "violin", midi: midi(4, chord[i % chord.length]) + 7, start: i * 0.5 + 0.25, dur: 0.3, vel: 0.22 });
      }
      for (const b of [0, 2]) notes.push({ voice: "drum", midi: 36, start: b, dur: 0.4, vel: 0.65 });
      notes.push({ voice: "pad", midi: root - 12, start: 0, dur: 4, vel: 0.12 });
      break;
    }
```

AudioManager — add after `roar` (mirror existing helpers `tone`/`noise`/`throttled`):

```ts
  /** war-dragon roar: pitched-down, slower, heavier than the player roar */
  deepRoar(): void {
    if (this.throttled("deepRoar", 2500)) return;
    const dur = 2.6;
    this.tone(34, 20, dur, "sine", 0.5, { am: 14, attack: 0.15 });
    this.tone(17, 12, dur, "sine", 0.3, { attack: 0.2 });
    this.noise(dur, "bandpass", 240, 120, 0.16, 1.2);
    this.impactDuck(0.7, 2);
  }

  /** flame-sweep telegraph inhale */
  inhale(): void {
    this.noise(1.0, "bandpass", 400, 1600, 0.14, -2);
    this.tone(140, 320, 1.0, "sine", 0.06);
  }

  /** near-miss / wing buffet whoosh */
  wingBuffet(intensity = 1): void {
    if (this.throttled("buffet", 300)) return;
    this.noise(0.5, "lowpass", 300 + 200 * intensity, 150, 0.2, 1.5);
  }

  /** hit on war-dragon scales */
  bossHit(): void {
    if (this.throttled("bossHit", 120)) return;
    this.tone(220, 90, 0.12, "square", 0.1);
    this.noise(0.1, "highpass", 3000, 1500, 0.12, 1);
  }
```

(If `noise()`'s last param is a Q or sweep factor with fixed sign semantics, check its signature at the top of AudioManager and adapt values; the goal: inhale = rising filter, buffet = low whoosh.)

GameApp `wireBus` (~line 157-169), add:

```ts
    this.bus.on("finale-music", (e) => {
      if (e.state === "resolve") {
        this.updateMusicAndAmbient();
      } else {
        this.music.setState(e.state);
      }
    });
```

- [ ] **Step 4: Run `npx vitest run tests/music.test.ts` → PASS; `npm run typecheck`**

- [ ] **Step 5: Commit**

```bash
git add src/audio/AudioManager.ts src/audio/MusicComposer.ts src/app/GameApp.ts tests/music.test.ts
git commit -m "Audio: deepRoar/inhale/wingBuffet/bossHit SFX + chase/boss music states"
```

---

### Task 13: CastleBuilder spire

**Files:**
- Modify: `src/world/CastleBuilder.ts` — inner-ward section (~lines 128-144, after keep turrets)

- [ ] **Step 1: Implement** — after the keep crown turrets block insert:

```ts
    // BLACKSTONE SPIRE — north landmark behind the keep (finale framing)
    this.staticTower(cx, cz - 85, 7, 58, base + 2, this.matDark);
    aabbs.push({ x: cx, z: cz - 85, hx: 7, hz: 7 });
```

(Anchor names from the existing code: `staticTower(x, z, radius, height, baseY, mat)` at line ~228, the dark material field is `castleDarkStone` — use the actual field name; `aabbs` is the local wall-AABB array used by `wallSegment`; if `staticTower` doesn't take AABBs, push into the same array the corner towers use — mirror exactly how the 4 inner corner towers (~line 128-131) register their 6×6 AABBs and copy that pattern with 7.)

- [ ] **Step 2: `npm run typecheck`; quick e2e: `npx playwright test e2e/regression.spec.ts -g "§90"` (spire must not break castle completion — it is static, non-objective).**

- [ ] **Step 3: Commit**

```bash
git add src/world/CastleBuilder.ts
git commit -m "Castle: Blackstone Spire north landmark for finale framing"
```

---

### Task 14: Test API extensions

**Files:**
- Modify: `src/main.ts:86-142` (api object)

- [ ] **Step 1: Implement** — inside `api: { ... }` add:

```ts
        setCastellanHp(n: number) {
          app.mission?.finale?.setCastellanHp(n);
        },
        damageWarDragon(n: number) {
          app.mission?.finale?.damageWarDragon(n);
        },
        getFinale() {
          const f = app.mission?.finale;
          if (!f) return null;
          return {
            phase: f.phase,
            vharax: f.warDragon
              ? { hp: f.warDragon.hp, maxHp: f.warDragon.maxHp, state: f.warDragon.state, pos: { x: f.warDragon.pos.x, y: f.warDragon.pos.y, z: f.warDragon.pos.z } }
              : null,
          };
        },
        forceLand() {
          app.mission?.finale?.forceLand();
        },
        setFinalePhase(p: string) {
          return app.mission?.finale?.skipTo(p as any) ?? false;
        },
```

- [ ] **Step 2: `npm run typecheck` → clean**

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "Test API: finale controls (setCastellanHp, damageWarDragon, getFinale, forceLand, setFinalePhase)"
```

---

### Task 15: E2E — blackstone finale

**Files:**
- Create: `e2e/blackstone-finale.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from "@playwright/test";

/** simWait — wait on mission.time (the fixed-timestep clock), never wall-clock */
async function simWait(page: Page, simSeconds: number, timeoutMs = 60000) {
  const t0 = await page.evaluate(() => (window as any).__GAME.mission?.time ?? 0);
  await page.waitForFunction(
    (t) => (window as any).__GAME.mission?.time >= t,
    t0 + simSeconds,
    { timeout: timeoutMs }
  );
}

async function bootBlackstone(page: Page) {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function clearSiege(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killBallistae(6);
    g.api.collapseBuildingsWithTag("wallTower", 4);
    g.api.collapseBuildingsWithTag("gatehouse", 1);
    g.api.killByType("soldier", 12);
  });
}

test("finale: courtyard → land → ground duel → transition → remount → chase → duel → VICTORY", async ({ page }) => {
  await bootBlackstone(page);
  await clearSiege(page);

  // courtyard objective completes → finale waits for landing
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "AWAIT_LANDING", null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__GAME.api.forceLand());
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "ground", null, { timeout: 20000 });

  // duel: force to just above the floor, then one hit triggers the transition
  await page.evaluate(() => (window as any).__GAME.api.setCastellanHp(150)); // floor = 128
  await simWait(page, 1);
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "DUEL_GROUND", null, { timeout: 10000 });
  // any damage source dips the puppet below the floor → clamp + transition
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const s = g.mission.enemies.soldiers.find((x: any) => x.def.role === "commander");
    s.hp = 120; // below floor
  });
  await page.waitForFunction(() => ["TRANSITION", "REVEAL", "MOUNT", "REMOUNT", "CHASE", "DUEL_AIR", "RESOLVED"].includes((window as any).__GAME.api.getFinale()?.phase), null, { timeout: 10000 });

  // staged cinematics are wall-clock bounded → remount happens without input
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "dragon", null, { timeout: 40000 });
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY", null, { timeout: 10000 });
  await page.waitForFunction(() => ["CHASE", "DUEL_AIR"].includes((window as any).__GAME.api.getFinale()?.phase ?? ""), null, { timeout: 30000 });

  // aerial duel: war dragon exists and takes damage; floor → resolved
  const v = await page.evaluate(() => (window as any).__GAME.api.getFinale()?.vharax);
  expect(v).not.toBeNull();
  await page.evaluate(() => (window as any).__GAME.api.damageWarDragon(99999));
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "RESOLVED", null, { timeout: 15000 });

  // final assault → VICTORY
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 120000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
});

test("finale: dragon dies first → commander killable → ground VICTORY (no dead-end)", async ({ page }) => {
  await bootBlackstone(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 40000 });
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killByType("soldier", 12);
    g.api.killByType("commander", 1);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 120000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
});

test("finale: skip API walks the legal chain", async ({ page }) => {
  await bootBlackstone(page);
  await clearSiege(page);
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "AWAIT_LANDING", null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__GAME.api.setFinalePhase("DUEL_AIR"));
  const f = await page.evaluate(() => (window as any).__GAME.api.getFinale());
  expect(f.phase).toBe("DUEL_AIR");
  expect(f.vharax).not.toBeNull();
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test e2e/blackstone-finale.spec.ts`
Expected: 3 passed. If staged cinematics stall, the wall-clock bounds (STAGE_BUDGET ×1.8) are the pressure-relief — verify they fire by watching phase progression in failures.

- [ ] **Step 3: Full regression**

Run: `npm run typecheck && npm run test && npx playwright test`
Expected: all green, including §90/§91 and Scenario A/B.

- [ ] **Step 4: Commit**

```bash
git add e2e/blackstone-finale.spec.ts
git commit -m "E2E: blackstone finale — full chain, dragon-death fallback, skip API"
```

---

### Task 16: Manual verification + polish pass

- [ ] **Step 1: Headed playthrough** — `npm run dev`, play blackstone: confirm Vharax visually distinct (bulk/armor/charred), reveal reads at distance, remount feels immediate, boss bar/subtitles show, chase keeps 60–90 m, flame sweep telegraph visible 3 ways (pose/glow/inhale). Fix visual constants only (positions/colors/timings) — no architecture changes.
- [ ] **Step 2: Keyboard-only** — same run with `?keyboardOnly=1`: complete the finale with zero mouse.
- [ ] **Step 3: Screenshot QA** — capture reveal + aerial duel; leave PNGs untracked (repo rule).
- [ ] **Step 4: Dead code sweep** — remove any leftover stubs/debug logs introduced during iteration (`rg -n "console.log|TODO" src/mission/blackstone src/data/wardragon.ts` must be clean or justified).
- [ ] **Step 5: Final gates** — `npm run typecheck && npm run test && npx playwright test` all green.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Finale slice 1: polish pass from manual playthrough"
```

---

## Self-review notes

- Spec coverage: phases (T2), duel+clamp (T3/T9), reveal/mount/remount/chase/duel (T10), event objectives + chain (T1), Vharax visual (T5), boss fail-safes (T8), wall-clock bounds (T10), short-circuit (T1/T10), HUD (T11), audio (T12), spire framing (T13), test API (T14), e2e (T15), manual matrix subset (T16). Slice-1 out-of-scope items (spec §7) intentionally absent.
- Type consistency: `notifyEvent`, `PhaseMachine.transition`, `CastellanDuel.{damage,markTransitioned,restoreHp,shouldReinforce}`, `FlameSweepSM.start/update`, `rubberBandFactor`, `advanceWaypoint`, `claimCommander/releaseCommander`, `scriptedDismount/remountDragon`, `WarDragon.{startChase,startDuel,flee,applyFire,update}`, `BlackstoneFinale.{update,applyFire,setCastellanHp,damageWarDragon,forceLand,skipTo,phase,warDragon}` — names used identically across tasks.
- Known risk flagged in-plan: Task 1 Step 6 may show §90 red until Task 10 lands the short-circuit — the plan sequences the full regression at Task 15 Step 3, after which §90 must be green.
