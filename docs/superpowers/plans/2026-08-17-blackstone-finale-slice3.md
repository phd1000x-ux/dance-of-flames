# Blackstone Finale — Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the finale — 3-pattern aerial duel with HP phases, return-to-citadel, spire crash with one-time slow-mo, war horn + escalated 75 s assault, in-memory checkpoints, stereo spatial audio, deferred cosmetics.

**Architecture:** Extend the existing finale modules (FinalePhases/WarDragon/BlackstoneFinale) plus a pure `FinalePatterns.ts` (pattern/phase weights, assault bands, snapshot shape) and `SpireBreaker.ts` (authored crash). Audio panning threads through AudioManager/Events. Checkpoints snapshot/restore in GameApp+MissionScene.

**Tech Stack:** TypeScript strict, Babylon.js 8 (`@babylonjs/core` subpaths only), vitest, Playwright (`?test=1`).

**Spec:** `docs/superpowers/specs/2026-08-17-blackstone-finale-slice3-design.md` — read it first; the plan argues from it.

## Global Constraints

- Babylon imports from `@babylonjs/core` subpath only; no `BABYLON` global.
- Fixed-timestep sim only (updates flow through MissionScene.update substeps).
- Slow-motion: exactly ONE window (FINAL_CRASH trigger) — never re-trigger.
- Objective chain semantics unchanged (bs-vharax still completes on vharax-resolved; the crash sequence delays that event until the crash completes).
- E2E: sim-clock/bounded waits; never page.mouse in keyboard specs; SwiftShader-safe timeouts.
- No comments beyond non-obvious invariants.
- Gates per task: `npm run typecheck` + `npm run test`; e2e where listed.
- Commit after each green task; never commit QA PNGs.

---

### Task 1: FinalePatterns pure module (phases, patterns, assault, snapshot shape)

**Files:**
- Create: `src/mission/blackstone/FinalePatterns.ts`
- Test: `tests/finale3.test.ts` (new)

**Interfaces:**
- Produces:
  - `type AirPattern = "sweep" | "charge" | "dive"`;
  - `selectPattern(hpFrac: number, last: AirPattern | null, rng: { range: (a: number, b: number) => number }): AirPattern` (weights per spec §3, anti-repeat re-roll once);
  - `type AssaultBand = 0 | 1 | 2 | 3; assaultBand(elapsed: number, duration = 75): AssaultBand` (0: >45 remaining… band by remaining: >45→0, >20→1, >5→2, else 3);
  - `assaultProfile(band: AssaultBand): { intervalMult: number; eliteBoost: number; musicPeak: number }` (1.0/0.7/0.5/0.4, 0/2/2/4, 0.7/0.85/1.0/1.0);
  - `interface FinaleSnapshot { finalePhase: string; castellan: { hp: number; transitioned: boolean }; vharax: { hp: number } | null; destroyedBuildings: number[]; deadBallistae: number[]; objectiveProgress: { id: string; progress: number; completed: boolean }[]; player: { dragonHp: number; riderHp: number; mode: string; x: number; y: number; z: number; yaw: number }; charges: { heal: number; fireBoost: number; armorWard: number }; time: number }` + `validateSnapshot(s: unknown): FinaleSnapshot` (throws on missing fields — defensive parse of in-memory object).

- [ ] **Step 1: Write failing tests** — `tests/finale3.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { selectPattern, assaultBand, assaultProfile, validateSnapshot, type FinaleSnapshot } from "../src/mission/blackstone/FinalePatterns";

const rng = { range: (a: number, b: number) => a }; // deterministic low roll
const rngHi = { range: (a: number, b: number) => b };

describe("aerial pattern selection", () => {
  test("phase weights: high hp favors sweep, low-mid favors charge, return favors dive", () => {
    const hi = selectPattern(0.9, null, rng);        // low roll → first weight bucket (sweep)
    expect(["sweep", "charge", "dive"]).toContain(hi);
    expect(selectPattern(0.9, null, rng)).toBe("sweep");
    expect(selectPattern(0.5, null, rngHi)).toBe("dive");  // see weight ordering note below
  });

  test("anti-repeat: never same twice in a row (re-roll once)", () => {
    for (let i = 0; i < 50; i++) {
      const a = selectPattern(0.5, "charge", rng);
      if (a === "charge") {
        // low-roll selected charge again → re-roll must swap it away (low roll again → first non-charge)
        expect(a).not.toBe("charge");
        break;
      }
    }
    expect(selectPattern(0.5, "charge", rng)).not.toBe("charge");
  });
});

describe("assault escalation", () => {
  test("bands by remaining time", () => {
    expect(assaultBand(0, 75)).toBe(0);    // 75 remaining
    expect(assaultBand(40, 75)).toBe(0);   // 35 remaining
    expect(assaultBand(45, 75)).toBe(1);   // 30 remaining
    expect(assaultBand(60, 75)).toBe(1);   // 15 remaining
    expect(assaultBand(72, 75)).toBe(2);   // 3 remaining → band 2? (>5) no → 3
  });
  test("profiles escalate monotonically", () => {
    const p = [0, 1, 2, 3].map(assaultProfile);
    for (let i = 1; i < 4; i++) {
      expect(p[i].intervalMult).toBeLessThan(p[i - 1].intervalMult);
      expect(p[i].eliteBoost).toBeGreaterThanOrEqual(p[i - 1].eliteBoost);
      expect(p[i].musicPeak).toBeGreaterThanOrEqual(p[i - 1].musicPeak);
    }
  });
});

describe("snapshot validation", () => {
  const good: FinaleSnapshot = {
    finalePhase: "DUEL_AIR", castellan: { hp: 128, transitioned: true }, vharax: { hp: 800 },
    destroyedBuildings: [1, 2], deadBallistae: [0, 2],
    objectiveProgress: [{ id: "bs-ballistae", progress: 6, completed: true }],
    player: { dragonHp: 400, riderHp: 200, mode: "dragon", x: 0, y: 80, z: 0, yaw: 1 },
    charges: { heal: 1, fireBoost: 0, armorWard: 0 }, time: 123.4,
  };
  test("valid snapshot passes through", () => {
    expect(validateSnapshot(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  test("missing field throws", () => {
    const bad = { ...good } as Record<string, unknown>;
    delete bad.player;
    expect(() => validateSnapshot(bad)).toThrow();
  });
});
```

NOTE on the `rngHi` assertion at hpFrac 0.5 (weights sweep .3 / charge .45 / dive .25): with cumulative buckets ordered [charge, sweep, dive] a high roll (1.0) lands dive — ORDER the cumulative buckets as charge, sweep, dive in the implementation so the test's expectations hold; if the implementer prefers a different order, adjust BOTH test and impl consistently and record it in the report.

Also fix the bands test expectations to match the spec: remaining = duration - elapsed; band = remaining > 45 ? 0 : remaining > 20 ? 1 : remaining > 5 ? 2 : 3. assaultBand(72,75) → remaining 3 → band 3 (the inline comment in the test above is wrong — write the correct expectations: 0→0, 40→0 (35>20? 35>20 yes → band 1? — recompute: remaining 75→0; 35→1 (≤45, >20); 30→1; 15→2; 3→3).

- [ ] **Step 2: Run → FAIL (module not found)**

- [ ] **Step 3: Implement** `src/mission/blackstone/FinalePatterns.ts`:

```ts
export type AirPattern = "sweep" | "charge" | "dive";

const WEIGHTS: { above: number; w: Record<AirPattern, number> }[] = [
  { above: 0.7, w: { sweep: 0.6, charge: 0.3, dive: 0.1 } },
  { above: 0.4, w: { sweep: 0.3, charge: 0.45, dive: 0.25 } },
  { above: 0.25, w: { sweep: 0.15, charge: 0.35, dive: 0.5 } },
];

export function selectPattern(hpFrac: number, last: AirPattern | null, rng: { range: (a: number, b: number) => number }): AirPattern {
  const row = WEIGHTS.find((r) => hpFrac > r.above) ?? { w: { sweep: 1, charge: 0, dive: 0 } as Record<AirPattern, number> };
  const order: AirPattern[] = ["charge", "sweep", "dive"];
  const pick = (exclude?: AirPattern): AirPattern => {
    let r = rng.range(0, 1);
    for (const p of order) {
      if (p === exclude) continue;
      r -= row.w[p];
      if (r <= 0) return p;
    }
    return order.filter((p) => p !== exclude && row.w[p] > 0).pop() ?? "sweep";
  };
  const first = pick();
  return first === last ? pick(last) : first;
}

export type AssaultBand = 0 | 1 | 2 | 3;

export function assaultBand(elapsed: number, duration = 75): AssaultBand {
  const remaining = duration - elapsed;
  if (remaining > 45) return 0;
  if (remaining > 20) return 1;
  if (remaining > 5) return 2;
  return 3;
}

export function assaultProfile(band: AssaultBand): { intervalMult: number; eliteBoost: number; musicPeak: number } {
  return [
    { intervalMult: 1.0, eliteBoost: 0, musicPeak: 0.7 },
    { intervalMult: 0.7, eliteBoost: 2, musicPeak: 0.85 },
    { intervalMult: 0.5, eliteBoost: 2, musicPeak: 1.0 },
    { intervalMult: 0.4, eliteBoost: 4, musicPeak: 1.0 },
  ][band];
}

export interface FinaleSnapshot {
  finalePhase: string;
  castellan: { hp: number; transitioned: boolean };
  vharax: { hp: number } | null;
  destroyedBuildings: number[];
  deadBallistae: number[];
  objectiveProgress: { id: string; progress: number; completed: boolean }[];
  player: { dragonHp: number; riderHp: number; mode: string; x: number; y: number; z: number; yaw: number };
  charges: { heal: number; fireBoost: number; armorWard: number };
  time: number;
}

export function validateSnapshot(s: unknown): FinaleSnapshot {
  const o = s as Partial<FinaleSnapshot>;
  const need = <T,>(v: T | undefined, f: string): T => {
    if (v === undefined) throw new Error(`[snapshot] missing ${f}`);
    return v;
  };
  const snap: FinaleSnapshot = {
    finalePhase: need(o.finalePhase, "finalePhase"),
    castellan: need(o.castellan, "castellan"),
    vharax: o.vharax ?? null,
    destroyedBuildings: need(o.destroyedBuildings, "destroyedBuildings"),
    deadBallistae: need(o.deadBallistae, "deadBallistae"),
    objectiveProgress: need(o.objectiveProgress, "objectiveProgress"),
    player: need(o.player, "player"),
    charges: need(o.charges, "charges"),
    time: need(o.time, "time"),
  };
  return snap;
}
```

(If the anti-repeat semantics of the test don't hold for the low-roll rng with these weights, adjust the re-roll so `selectPattern(0.5, "charge", rngLow)` can never return "charge" when another pattern has weight > 0 — the second pick excludes `last`; trace: first pick with r=0 → charge (0.45 bucket first, r−0.45 ≤ 0) → equals last → second pick excludes charge → r=0 − sweep 0.3 ≤ 0 → sweep. Test holds.)

- [ ] **Step 4: Run → PASS; `npm run typecheck`. Commit**

```bash
git add src/mission/blackstone/FinalePatterns.ts tests/finale3.test.ts
git commit -m "Finale3: pure pattern/phase weights, assault bands, snapshot schema"
```

---

### Task 2: WarDragon charge + dive patterns

**Files:**
- Modify: `src/mission/blackstone/WarDragon.ts`

**Interfaces:**
- Consumes: `selectPattern`, `AirPattern` (Task 1).
- Produces: `WarDragonState` gains `"POSITIONING" | "CHARGE_TEL" | "CHARGING" | "CLIMB" | "DIVE_TEL" | "DIVING"`; `WarDragon.pendingPattern: AirPattern | null`; behavior: pattern state machine integrated into update(); `onChargeNearMiss: ((dist: number) => void) | null` (wiring sets damage/stagger); public `get patternState(): string`.

- [ ] **Step 1: Implement (Babylon-bound; unit coverage via Task 1 weights + e2e)**

Extend WarDragon per this state map (integrate with the existing ORBIT sweep flow — sweep stays the default when selected):

1. Fields: `private pattern: AirPattern = "sweep"; private patternT = 0; private chargeDir = new Vector3(); onChargeNearMiss: ((dist: number) => void) | null = null;`
2. In ORBIT, when the existing sweep-start condition would fire, first consult selection: `this.pattern = selectPattern(this.hp / this.maxHp, this.pattern, Math.random)` — if "sweep": existing path unchanged. If "charge": state → POSITIONING (target = player pos + (playerPos−pos) normalized × 130; when dist to that target < 15 or 2.5 s elapse → CHARGE_TEL (1.2 s, roar sfx via bus "deepRoar", headPitch bias −0.15 in animate params) → CHARGING (speed 70 toward lead-predicted player pos; when passed (dot(fwd, toPlayer) < 0) or 3 s → near-miss check: closest approach distance during CHARGING (track min each frame); if < 12 → onChargeNearMiss?.(minDist); → RECOVERY 2.5 s (existing recovery reuse: state RECOVERY with a timer then ORBIT)). If "dive": state → CLIMB (target = player + (0, 34, 0) offset toward boss side; 1.5 s or reach → DIVE_TEL 0.8 s (inhale sfx, jawOpen 1) → DIVING (velocity toward player's current pos each frame at 55 m/s; when alt gain would go below player.y − 5 or 2 s → RECOVERY 2.0 s → ORBIT).
3. Teleport-free fail-safes: any pattern state stuck 4 s (patternT > 4 non-TELEGRAPH) → RECOVERY 1 s → ORBIT.
4. steering block reuse: pattern states feed `target`/speed into the existing steering code (POSITIONING/CHARGE_TEL/CLIMB/DIVE_TEL feed targets; CHARGING/DIVING override movement directly: pos += dir × speed × dt with terrain clamp).
5. rig.animate: CHARGE_TEL jawOpen 0.2; DIVING sweep 0.7 (folded wings).

- [ ] **Step 2: Gates** — typecheck + full unit (141) + `npx playwright test e2e/blackstone-finale.spec.ts e2e/siege.spec.ts` (existing duels still resolve: they damage via damageWarDragon API → floor → resolve; new patterns must not break RESOLVED flow).

- [ ] **Step 3: Commit**

```bash
git add src/mission/blackstone/WarDragon.ts
git commit -m "Finale3: war-dragon charge + dive patterns with phase-weighted selection"
```

---

### Task 3: Phases RETURN / FINAL_STAGGER / FINAL_CRASH + spire split

**Files:**
- Modify: `src/mission/blackstone/FinalePhases.ts` (3 new ids in union + transitions: DUEL_AIR → RETURN → FINAL_STAGGER → FINAL_CRASH → RESOLVED; also RETURN/FINAL_STAGGER/FINAL_CRASH → RESOLVED fallback edges)
- Modify: `src/world/CastleBuilder.ts` (spire split: base staticTower unchanged height 40; crown = separate cylinder/cone 18 m sitting on top, named "spireCrown", NOT merged with base, returned via a new field `spireCrownMesh` on CastleBuildResult; AABB unchanged)
- Create: `src/mission/blackstone/SpireBreaker.ts` (authored crash choreography)
- Modify: `src/mission/blackstone/BlackstoneFinale.ts` (wire phases + SpireBreaker)

**Interfaces:**
- Produces: `CastleBuildResult.spireCrownMesh: Mesh`; `SpireBreaker { constructor(effects, bus, shake: (s: number) => void); begin(crown: Mesh, spireBaseTop: Vector3, vharaxRoot: TransformNode): void; update(dt: number): boolean /*done*/; get detached(): boolean }` — sequence: t0 slow-mo request via callback; wing-hit at t≈1.2 (crown detaches: unparent → animate tilt+fall 2.2 s with dust); body-through at t≈2.4 (explosion ×2.2, dust ×2.5, shake 1.6, vharax setEnabled(false)); done at t≈4.5. `BlackstoneFinale.update` drives it in FINAL_CRASH; on done → notifyEvent("vharax-resolved") + setStage("RESOLVED").

- [ ] **Step 1: FinalePhases** — extend union and table per Interfaces. Existing tests assert the old chain legality — extend `tests/finale.test.ts` (append a test for the new chain: DUEL_AIR→RETURN→FINAL_STAGGER→FINAL_CRASH→RESOLVED all legal; RESOLVED fallback from each new phase legal; MOUNT→RETURN illegal).

- [ ] **Step 2: CastleBuilder split** — build base tower height 40 (was 58) at the spire spot; crown: `MeshBuilder.CreateCylinder("spireCrown", { diameterTop: 0, diameterBottom: 13, height: 18, tessellation: 8 }, scene)` positioned on top (same dark material, isPickable false, receiveShadows true, freezeWorldMatrix). Result field carries the mesh + expose `spireCrownTop: Vector3` (world pos of crown tip) for the crash choreography.

- [ ] **Step 3: SpireBreaker** per Interfaces (pure-ish Babylon choreography; time-driven keyframes; wall-clock independent — driven by dt from the finale update).

- [ ] **Step 4: BlackstoneFinale wiring**:
  - DUEL_AIR case: replace the 40%-floor resolve with: `if (v.hp <= v.maxHp * 0.25)` → setStage("RETURN"); emit finale-boss subtitle "HE RETURNS TO THE CITADEL" (2.5 s); boss steering switches to castle-top waypoint ring (reuse CHASE_PATH waypoints at reduced speed 30; attacks still fire per pattern selection with dive/sweep only).
  - RETURN case: `if (v.hp <= v.maxHp * 0.10)`: if horizontal dist(v.pos, spireBase) < 80 → setStage("FINAL_STAGGER"), hud-hint "FINISH THE CASTELLAN" once; else boss steers toward spire (waypoint = spire top); wall-clock 25 s force-in-zone (teleport-free: steer hard, if still out set v.pos toward spire by 40 m ONCE outside camera view check — simplest: hard steer + speed 40).
  - FINAL_STAGGER case: v staggers (existing rig wobble via roll bias); first `applyFire` hit (finale.applyFire routes) → begin SpireBreaker + slowmoT = 1.0 + setStage("FINAL_CRASH"); budget 30 s → force (damage-independent begin).
  - FINAL_CRASH case: `breaker.update(dt)`; done → notifyEvent("vharax-resolved"), finale-boss hide, finale-music resolve, setStage("RESOLVED").
  - STAGE_BUDGET: FINAL_CRASH: 8; FINAL_STAGGER: 30; RETURN: 60.
  - forceAdvance chain extended: DUEL_AIR → RETURN (boss.hp = 0.25*max), RETURN → FINAL_STAGGER (teleport-free), FINAL_STAGGER → FINAL_CRASH (begin breaker), FINAL_CRASH → RESOLVED (breaker fast-forward: set done).
  - Dragon-death during new phases: existing dragonDying check covers (not in exclusion list — verify exclusion list still only INACTIVE/AWAIT_LANDING).

- [ ] **Step 5: Gates** — typecheck; unit (finale.test.ts extended green, full suite); `npx playwright test e2e/blackstone-finale.spec.ts` — test 1 damages Vharax via API to floor → NOW the flow goes RETURN→STAGGER→(no fire hit in that test… it uses damageWarDragon(99999)) — ADJUST: damageWarDragon must floor at the crash threshold (0.10) instead of 0.40 resolve when in new phases; the API method in BlackstoneFinale clamps to `Math.max(v.maxHp * 0.10, ...)` and the RESOLVED expectation becomes: damage to floor → RETURN/STAGGER auto-advance via wall-clock budgets → FINAL_CRASH (forced begin via budget) → RESOLVED. Verify the finale spec still passes; if the 99999 damage test's RESOLVED wait exceeds its 15 s timeout due to staged budgets, extend that wait to 90 s in the spec (test-only change, note in report).

- [ ] **Step 6: Commit**

```bash
git add src/mission/blackstone/FinalePhases.ts src/world/CastleBuilder.ts src/mission/blackstone/SpireBreaker.ts src/mission/blackstone/BlackstoneFinale.ts tests/finale.test.ts e2e/blackstone-finale.spec.ts
git commit -m "Finale3: RETURN/stagger/crash phases, spire split + authored crash sequence"
```

---

### Task 4: War horn + escalated final assault

**Files:**
- Modify: `src/audio/AudioManager.ts` (warHorn + warHornShort)
- Modify: `src/ai/EnemyManager.ts` (reinforcement spawner: `setAssault(active: boolean, profile: { intervalMult: number; eliteBoost: number }): void`)
- Modify: `src/mission/MissionScene.ts` or `BlackstoneFinale.ts` (assault driver — bs-final active detection + band polling + war horn stabs)
- Test: `tests/finale3.test.ts` (bands already tested; add: band-transition detection pure fn `bandChanged(prev, elapsed, duration)` if non-trivial — else skip)

**Interfaces:**
- Produces: `AudioManager.warHorn(): void` (long) / `warHornShort(): void`; `EnemyManager.setAssault(active, profile)` + assault spawner in update (anchors: courtyard (0,20) r30, gate (0,140) r20; types swordsman 0.8 / archer 0.2, elites per eliteBoost appended per spawn batch; interval base 4 s × intervalMult; respects tier-0 24 cap by skipping spawn when live soldiers ≥ 60); assault driver emits warHornShort on band change, warHorn (long) once at assault start.

- [ ] **Step 1: AudioManager** — warHorn: two detuned saws (110 Hz + 165 fifth) through lowpass 900 with 0.35 s attack, 1.8 s sustain, brass-vibrato 5.5 Hz; warHornShort: same, 0.5 s. Throttle long 10 s / short 2 s.

- [ ] **Step 2: EnemyManager.setAssault + spawner** — fields `assaultActive`, `assaultProfile`, `assaultTimer`; in update(): if active, timer -= dt; on ≤0: timer = 4 × intervalMult; spawn 2-3 at anchor rng; every batch, if eliteBoost > 0 and rng < 0.3 × eliteBoost/4: +1 elite. Skip when `this.soldiers.filter(s => s.state !== "dead").length >= 60`.

- [ ] **Step 3: Driver** — in BlackstoneFinale (or MissionScene.update when mission blackstone): when tracker.current()?.id === "bs-final": once → enemies.setAssault(true, profile(band(0))) + audio warHorn via bus; poll band each second (sim time); on change → setAssault profile refresh + warHornShort; when bs-final completes → setAssault(false).

- [ ] **Step 4: Gates** — typecheck; unit; e2e siege + finale specs (assault activates only during bs-final; §90 kills commander before bs-final? — §90 completes objectives then VICTORY via survive: the assault will run there too — verify §90 still green (reinforcements spawn but survive objective completes on timer — fine; 24-cap keeps perf sane)).

- [ ] **Step 5: Commit**

```bash
git add src/audio/AudioManager.ts src/ai/EnemyManager.ts src/mission/blackstone/BlackstoneFinale.ts
git commit -m "Finale3: war horn SFX + escalated final assault reinforcement waves"
```

---

### Task 5: Checkpoints (snapshot/restore)

**Files:**
- Modify: `src/app/GameApp.ts` (hold snapshot; loadMission(snapshot?); DEFEAT retry offers checkpoint when snapshot exists)
- Modify: `src/mission/MissionScene.ts` (captureCheckpoints: `captureSnapshot(): FinaleSnapshot | null`; `applySnapshot(s: FinaleSnapshot): void`)
- Modify: `src/mission/blackstone/BlackstoneFinale.ts` (checkpoint capture points per spec §5)
- Modify: `src/ui/UIManager.ts` (DEFEAT panel: when checkpoint exists, RETRY resumes from checkpoint — label "RETRY (CHECKPOINT)"; secondary "RESTART MISSION" does a clean load; without checkpoint the existing buttons stand)
- Test: `tests/finale3.test.ts` (validateSnapshot round-trip already covered; add pure test for checkpoint-point predicate `shouldCapture(phase)` = {DUEL_GROUND entry, CHASE, DUEL_AIR, FINAL_CRASH→RESOLVED, courtyard-complete} if extracted — else covered by e2e)

**Interfaces:**
- Produces: `GameApp.checkpoint: FinaleSnapshot | null`; `loadMission(s?: FinaleSnapshot)`; `MissionScene.captureSnapshot()` / `applySnapshot(s)`; UI button flow per above.

- [ ] **Step 1: MissionScene.captureSnapshot** — read finale (phase/castellan/vharax via finale getters — add small public getters if private), buildings destroyed ids (`b.id` for collapsed), ballistae dead indices, tracker.objectives() → progress list, player state + dragonCtrl pos/yaw, charges, mission.time.
- [ ] **Step 2: MissionScene.applySnapshot** — after a NORMAL construction (loadMission builds the mission deterministically, then applies): buildings: for each id not in destroyed list → `damageBuilding(b, maxHp − storedHpEquivalent)`… simpler: destroyed ids → `damageBuilding(b, b.hp + 1)` (collapse path fires visuals+objectives — objectives then OVERWRITTEN by tracker restore below); tracker: set each item's progress/completed directly (add `ObjectiveTracker.restoreState(list)` method — pure, unit-test in objectives.test.ts appended: restore sets exact progresses and completion, keeps listener list); ballistae dead → damageBallista(b, hp+1, true); player: dragonHp/riderHp/charges/pos/yaw (dragonCtrl.spawn-like direct set); finale: skipTo(stored finalePhase) (side effects reconstruct the runtime — castellan/vharax HP reapplied via finale setters after skipTo).
- [ ] **Step 3: ObjectiveTracker.restoreState** — pure method + tests.
- [ ] **Step 4: GameApp** — field `checkpoint: FinaleSnapshot | null = null`; loadMission(s?) stores/applies; capture hook: MissionScene calls `deps.onCheckpoint?.(snapshot)` — wire from GameApp at the 5 capture points (finale emits a `finale-checkpoint` bus event with the snapshot; GameApp stores it). Clear on any non-checkpoint load. DEFEAT + checkpoint → UIManager shows checkpoint-retry (wire via existing results-button dispatch: retry → `loadMission(checkpoint)`; restart → `loadMission()`).
- [ ] **Step 5: Events.ts** — `"finale-checkpoint": { snapshot: unknown }`.
- [ ] **Step 6: Gates** — typecheck; unit (objectives restore tests + snapshot validation); e2e: new spec test comes in Task 7; existing suites green (checkpoint flow is additive; §91/Scenario B unaffected — Scenario B has no checkpoint (dragonstone)).

- [ ] **Step 7: Commit**

```bash
git add src/app/GameApp.ts src/mission/MissionScene.ts src/mission/blackstone/BlackstoneFinale.ts src/ui/UIManager.ts src/mission/Objectives.ts src/core/Events.ts tests/objectives.test.ts
git commit -m "Finale3: in-memory checkpoints — capture at finale beats, restore on retry"
```

---

### Task 6: Stereo spatial audio + cosmetics

**Files:**
- Modify: `src/core/Events.ts` (sfx pos?), `src/audio/AudioManager.ts` (panFor + panner routing), `src/mission/MissionScene.ts` (panFromWorld helper + emitter call sites: ballista fire/telegraph in EnemyManager emit pos), `src/ai/EnemyManager.ts` (pos on ballista sfx), `src/mission/blackstone/WarDragon.ts` + `BlackstoneFinale.ts` (roar/inhale/warHorn pos)
- Modify: `src/world/BuildingSystem.ts` (attachSmoke split — smoke-only attach at SCORCHED)
- Modify: `src/ai/EnemyManager.ts` (staggered wiring: skip AI 0.8 s when staggered > 0; decrement in loop)
- Modify: `src/world/CastleBuilder.ts` (weapon racks at N-corner military tower bases via props)
- Modify: `src/world/DragonRig.ts` or `WarDragon.ts` (damage-state visuals: hp<25% roll bias +0.06, flapRate ×0.85, intermittent jaw ember — implemented in WarDragon.animate params)
- Test: `tests/finale3.test.ts` (panFor math: front/back/left/right/degraded-by-distance)

**Interfaces:**
- Produces: `AudioManager.panFor(pos: {x,z}, listener: {x,z,yaw}): number` (pure static or instance; −1..1); sfx events accept `{ name, intensity?, pos?: {x,z} }` and AudioManager applies StereoPannerNode per-voice when present; `panFromWorld(pos): number` helper on MissionScene.

- [ ] **Step 1: panFor failing tests** — left of listener yaw → negative; right → positive; behind → sign flips; distance rolloff tested separately as gain if implemented (pan value unaffected by distance — keep pan distance-invariant; rolloff optional gain scale via existing intensity — skip gain change, note in report).

- [ ] **Step 2: Implement** panFor:

```ts
panFor(pos: { x: number; z: number }, listener: { x: number; z: number; yaw: number }): number {
  const dx = pos.x - listener.x;
  const dz = pos.z - listener.z;
  const bearing = Math.atan2(dx, dz);
  let rel = bearing - listener.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  return Math.max(-1, Math.min(1, Math.sin(rel)));
}
```

(tone/noise routing: add optional `pan?: number` to their opts; create StereoPannerNode when |pan| > 0.01 and chain gain → panner → bus. Verify AudioContext.createStereoPanner availability — standard.)

- [ ] **Step 3: Emit pos at call sites** — EnemyManager ballista fire/telegraph (`pos: {x: b.pos.x, z: b.pos.z}`), explosion/collapse (BuildingSystem pos), WarDragon roar/inhale (b.pos), finale warHorn (castle center). AudioManager sfx entry: `play(name, intensity, pos?)` — the bus dispatch in GameApp passes e.pos; compute pan with the active camera (GameApp has engine/scene access at emit time — compute listener there OR MissionScene.panFromWorld and pass number in the event as `pan?: number`. DECISION: event carries `pan?: number` computed by the emitter via MissionScene helper — keeps AudioManager context-free).

- [ ] **Step 4: Cosmetics** — attachSmoke split (BuildingSystem: `attachSmoke(b)` separate; refreshDamageVisuals: smokeRate > 0 && !smokePs → attachSmoke; fireRate > 0 && !firePs → attachFire (fire attach also attaches smoke as today)); staggered wiring (update loop: if s.staggered > 0 { s.staggered -= dt; if tier-0 AI tick due and staggered > 0 skip AI this tick }; scatter unaffected); weapon racks (CastleBuilder: after military towers, `props.place("weaponRack", cx ± 10, cz ∓ 78, {})` ×2 per tower — verify prop id "weaponRack" exists in PropLibrary TemplateId — it's "weaponRack"); damage-state visuals in WarDragon.update animate call: `flapRate: this.hp < this.maxHp * 0.25 ? 4.4 : 5.2`, roll bias added to the rig rotation quaternion computation (+0.06 when damaged).

- [ ] **Step 5: Gates** — typecheck; unit (panFor tests); e2e siege+finale specs green (sfx payloads additive).

- [ ] **Step 6: Commit**

```bash
git add src/core/Events.ts src/audio/AudioManager.ts src/mission/MissionScene.ts src/ai/EnemyManager.ts src/mission/blackstone/WarDragon.ts src/mission/blackstone/BlackstoneFinale.ts src/world/BuildingSystem.ts src/world/CastleBuilder.ts tests/finale3.test.ts
git commit -m "Finale3: stereo pan spatial audio + smoke split, stagger wiring, racks, damage state"
```

---

### Task 7: Test API + E2E finale3

**Files:**
- Modify: `src/main.ts` (api: getFinale extended — crash state, breaker detached; assaultInfo(); checkpoint()/restoreCheckpoint() test hooks (wrap GameApp); warHorn counter spy)
- Create: `e2e/finale3.spec.ts`

**E2E tests:**
1. `finale3: full crash chain` — boot blackstone; clear siege; land; duel to transition (setCastellanHp+dip); remount; skipTo("DUEL_AIR"); damage to 26% → RETURN observed; steer dragon near spire (dragonCtrl.pos.set near spire top); damage to 9% → FINAL_STAGGER + hint; one fire hit (finale.applyFire direct call with boss in cone — or api.damageWarDragon(1) if fire routing complex: ruling: use api damage for determinism, SpireBreaker begins via FINAL_STAGGER hit → simulate with api) → FINAL_CRASH: poll slowmoT === 1 exactly once (sample twice), breaker.detached true, crown world y decreasing, then RESOLVED; warHorn counter ≥ 1; assault active (reinforcement count grows); survive 75 sim s (tracker fast-forward allowed per Task 9 slice-2 precedent) → VICTORY.
2. `finale3: checkpoint restore` — reach DUEL_AIR; force dragon death + rider death (damageDragon 99999; place enemy on rider / setCastellanHp small + many hits — ruling: damage rider via enemy melee is slow; use test API `__GAME.player.riderHp = 1` + one castellan combo hit, or direct `riderCtrl.takeHit(999, dir)` — check exposure) → DEFEAT with checkpoint button; click RETRY (CHECKPOINT) → mission rebuilt: assert finale phase DUEL_AIR, collapsed buildings still collapsed (count matches), vharax hp ≈ snapshot, dragonHp restored → complete via API → VICTORY.
3. `finale3: no regression` — full suite gate (Task 8).

- [ ] Steps: implement api additions → write spec → run `npx playwright test e2e/finale3.spec.ts` 2/2 → full suite → commit:

```bash
git add src/main.ts e2e/finale3.spec.ts
git commit -m "E2E: finale3 — crash chain, checkpoint restore, assault escalation"
```

---

### Task 8: Browser verification + final whole-branch review

- [ ] Browser pass (throwaway /tmp script): charge telegraph→pass near-miss shake; dive shadow+pull-out; RETURN steering around burning fortress (collapse states visible from air); crash sequence screenshots (crown detach, body-through, dust); war horn audibility (spy counter); checkpoint UI on defeat. Fix visual constants only.
- [ ] Dead-code sweep + full gates (`npm run typecheck && npm run test && npx playwright test`).
- [ ] Final whole-branch review (SDD skill): package merge-base..HEAD + ledger; fix wave if needed.
- [ ] Commit polish: `"Finale3: visual polish from browser verification"`.

---

## Self-review notes

- Spec coverage: §1 phases (T3), §2 crash (T3), §3 patterns (T1/T2), §4 assault (T4), §5 checkpoints (T5), §6 spire split + cosmetics (T3/T6), §7 audio (T6), §8 testing (T1/T5/T7), §9 exclusions honored.
- Type consistency: selectPattern/assaultBand/assaultProfile/FinaleSnapshot+validateSnapshot (T1) consumed T2/T4/T5; WarDragon.pendingPattern/patternState + onChargeNearMiss (T2→T3/T7); CastleBuildResult.spireCrownMesh/spireCrownTop (T3); SpireBreaker.detached (T3/T7); setAssault (T4); captureSnapshot/applySnapshot/restoreState (T5/T7); panFor/pan (T6).
- Sequencing risk: T3 changes the DUEL_AIR end-of-fight flow that slice-1 e2e pins — Task 3 Step 5 explicitly re-gates blackstone-finale.spec.ts (timeout extension is test-only). T5 checkpoint restore interacts with T3 phases — restore uses skipTo which performs side effects (breaker NOT auto-run: FINAL_CRASH restore point is post-crash → RESOLVED — capture point listed as "FINAL_CRASH completed" per spec §5).
- §90 interplay: assault spawner runs during bs-final survive in §90 too — bounded by 60-soldier cap; §90 must stay green (Task 4 gate).
- War horn: exactly one long horn at assault start; short stabs at band changes (§40 "WAR HORN" + §41 escalation audio).
