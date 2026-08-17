# Blackstone Finale — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Siege vertical slice — tower damage-state progression, collapse consequences (incl. ballista destruction), gatehouse breach hero moment, ballista volleys, 8 tower identities + fortress scale bump, ambient battle pairs; slice-1 music-override fix.

**Architecture:** Two new world modules (pure `DamageStates.ts`, visual `AmbientBattle.ts`) + extensions to BuildingSystem/BuildingFactory/CastleBuilder/EnemyManager. Objective chain and finale orchestrator untouched; non-blackstone missions inherit damage-state visuals only.

**Tech Stack:** TypeScript strict, Babylon.js 8 (`@babylonjs/core` subpaths only), vitest, Playwright (`?test=1`).

**Spec:** `docs/superpowers/specs/2026-08-17-blackstone-finale-slice2-design.md` — read it first; the plan argues from it.

## Global Constraints

- Babylon imports from `@babylonjs/core` subpath only; no `BABYLON` global.
- Fixed-timestep sim only; new update() calls flow through MissionScene.update.
- E2E: waits on `mission.time` / `waitForFunction` polls; never `page.mouse` in keyboard specs; SwiftShader-safe timeouts.
- Damage-state visuals apply on state CHANGE only (never per frame).
- Objective chain (bs-ballistae…bs-courtyard), HP values (1600/2600), and finale behavior unchanged — no rebalancing.
- No comments beyond non-obvious invariants (repo convention).
- Gates every task: `npm run typecheck` + `npm run test`. E2E gates where the task lists them.
- Commit after each green task; never commit QA PNGs.

---

### Task 1: Slice-1 parked fix — finaleMusicOverride lifecycle

**Files:**
- Modify: `src/app/GameApp.ts` — `loadMission()` (find the method; add flag reset near `this.input.resetAllInputs()`), `wireBus` finale-music handler (already exists — no change)
- Modify: `src/mission/blackstone/BlackstoneFinale.ts` — `shortCircuit()` (add resolve emit next to the other emits)

**Interfaces:** none new.

- [ ] **Step 1: Implement**

In `GameApp.loadMission()`, after `this.input.resetAllInputs();` add:

```ts
    this.finaleMusicOverride = false;
```

(Field `private finaleMusicOverride = false;` already exists from slice 1 — verify name.)

In `BlackstoneFinale.shortCircuit()`, after `this.vharax?.flee();` add:

```ts
    this.deps.bus.emit("finale-music", { state: "resolve" });
```

- [ ] **Step 2: Gates**

`npm run typecheck` clean; `npm run test` green (129); `npx playwright test e2e/blackstone-finale.spec.ts` 3/3.

- [ ] **Step 3: Commit**

```bash
git add src/app/GameApp.ts src/mission/blackstone/BlackstoneFinale.ts
git commit -m "Fix: finaleMusicOverride cleared on mission load and short-circuit resolve"
```

---

### Task 2: DamageStates pure module

**Files:**
- Create: `src/world/DamageStates.ts`
- Test: `tests/siege.test.ts` (new)

**Interfaces:**
- Produces: `type DamageState = "INTACT" | "SCORCHED" | "DAMAGED" | "CRITICAL" | "COLLAPSING" | "DESTROYED"`; `damageStateFor(hpFrac: number): DamageState`; `DAMAGE_VISUALS: Record<DamageState, { diffuseScale: number; ember: [number, number, number]; fireRate: number; smokeRate: number }>`.

- [ ] **Step 1: Write failing tests**

Create `tests/siege.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { damageStateFor, DAMAGE_VISUALS, type DamageState } from "../src/world/DamageStates";

describe("damage states", () => {
  test("threshold boundaries", () => {
    expect(damageStateFor(1)).toBe("INTACT");
    expect(damageStateFor(0.85)).toBe("SCORCHED");
    expect(damageStateFor(0.6)).toBe("DAMAGED");
    expect(damageStateFor(0.35)).toBe("CRITICAL");
    expect(damageStateFor(0)).toBe("CRITICAL");
  });

  test("monotonic escalation with damage", () => {
    let last = -1;
    const order: DamageState[] = ["INTACT", "SCORCHED", "DAMAGED", "CRITICAL"];
    for (let frac = 1; frac >= 0; frac -= 0.01) {
      const s = damageStateFor(frac);
      const idx = order.indexOf(s);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  test("visual params escalate monotonically", () => {
    const seq = ["INTACT", "SCORCHED", "DAMAGED", "CRITICAL"] as DamageState[];
    for (let i = 1; i < seq.length; i++) {
      expect(DAMAGE_VISUALS[seq[i]].diffuseScale).toBeLessThan(DAMAGE_VISUALS[seq[i - 1]].diffuseScale);
      expect(DAMAGE_VISUALS[seq[i]].fireRate).toBeGreaterThanOrEqual(DAMAGE_VISUALS[seq[i - 1]].fireRate);
      expect(DAMAGE_VISUALS[seq[i]].smokeRate).toBeGreaterThanOrEqual(DAMAGE_VISUALS[seq[i - 1]].smokeRate);
    }
    expect(DAMAGE_VISUALS.INTACT.fireRate).toBe(0);
    expect(DAMAGE_VISUALS.CRITICAL.ember[0]).toBeGreaterThan(DAMAGE_VISUALS.SCORCHED.ember[0]);
  });
});
```

- [ ] **Step 2: Run → FAIL (module not found)**

- [ ] **Step 3: Implement**

```ts
export type DamageState = "INTACT" | "SCORCHED" | "DAMAGED" | "CRITICAL" | "COLLAPSING" | "DESTROYED";

export function damageStateFor(hpFrac: number): DamageState {
  if (hpFrac > 0.85) return "INTACT";
  if (hpFrac > 0.6) return "SCORCHED";
  if (hpFrac > 0.35) return "DAMAGED";
  return "CRITICAL";
}

export interface DamageVisual {
  diffuseScale: number;
  ember: [number, number, number];
  fireRate: number;
  smokeRate: number;
}

export const DAMAGE_VISUALS: Record<DamageState, DamageVisual> = {
  INTACT: { diffuseScale: 1.0, ember: [0, 0, 0], fireRate: 0, smokeRate: 0 },
  SCORCHED: { diffuseScale: 0.82, ember: [0.08, 0.02, 0], fireRate: 0, smokeRate: 6 },
  DAMAGED: { diffuseScale: 0.68, ember: [0.22, 0.05, 0], fireRate: 50, smokeRate: 14 },
  CRITICAL: { diffuseScale: 0.55, ember: [0.4, 0.09, 0], fireRate: 90, smokeRate: 24 },
  COLLAPSING: { diffuseScale: 0.5, ember: [0.4, 0.09, 0], fireRate: 60, smokeRate: 30 },
  DESTROYED: { diffuseScale: 0.45, ember: [0.1, 0.02, 0], fireRate: 18, smokeRate: 8 },
};
```

- [ ] **Step 4: Run → PASS; typecheck. Commit**

```bash
git add src/world/DamageStates.ts tests/siege.test.ts
git commit -m "Siege: pure damage-state thresholds + visual parameter table"
```

---

### Task 3: BuildingSystem state application + gatehouse breach

**Files:**
- Modify: `src/world/BuildingSystem.ts` (BuildingEntity fields, applyFireDamage, damageBuilding, attachFire, collapse)

**Interfaces:**
- Consumes: `damageStateFor`, `DAMAGE_VISUALS` (Task 2).
- Produces: `BuildingEntity.visualState: DamageState`; `BuildingEntity.baseDiffuse: Color3`; `BuildingSystem.refreshDamageVisuals(b): void` (public — test API reads state); gatehouse BREACH READY hint; enhanced gatehouse collapse.

- [ ] **Step 1: Implement**

1. `BuildingEntity` — add fields:

```ts
  visualState: DamageState;
  baseDiffuse: Color3;
  breachHintShown: boolean;
```

(import `DamageState`, `damageStateFor`, `DAMAGE_VISUALS` from `./DamageStates`.)

2. `spawnFromLayout` — after building the entity object, capture `baseDiffuse: mat.diffuseColor.clone()`, `visualState: "INTACT"`, `breachHintShown: false`. (Placement `hpFraction` support lands in Task 6 — do not add yet.)

3. New public method + rewrite of the per-hit visual code:

```ts
  refreshDamageVisuals(b: BuildingEntity): void {
    if (b.collapsed) return;
    const state = damageStateFor(Math.max(0, b.hp) / b.maxHp);
    if (state === b.visualState) return;
    b.visualState = state;
    const v = DAMAGE_VISUALS[state];
    b.material.diffuseColor = b.baseDiffuse.scale(v.diffuseScale);
    b.material.emissiveColor = new Color3(v.ember[0], v.ember[1], v.ember[2]);
    if (v.fireRate > 0 && !b.firePs) this.attachFire(b);
    if (b.firePs) b.firePs.emitRate = v.fireRate;
    if (b.smokePs) b.smokePs.emitRate = v.smokeRate;
    if (b.tag === "gatehouse" && state === "CRITICAL" && !b.breachHintShown) {
      b.breachHintShown = true;
      this.bus.emit("hud-hint", { text: "BREACH THE GATE" });
      this.bus.emit("sfx", { name: "objective" });
    }
  }
```

4. `applyFireDamage` — DELETE the two per-hit visual lines (`const heat = …` emissive assignment and the `< 0.55` fire attach) and call `this.refreshDamageVisuals(b);` after the hp subtraction (before the collapse check). The ×1.4 building multiplier and cone math stay.

5. `damageBuilding` — add `this.refreshDamageVisuals(b);` before the collapse check.

6. `attachFire` — drop its hardcoded emit rates (fireRate 60 / smoke 18); just create/start; rates come from `refreshDamageVisuals`. Keep gravity/power.

7. `collapse` — enhancements, all inside the existing method after `b.collapsed = true`:
   - `b.visualState = "DESTROYED";`
   - Gatehouse amplification:

```ts
    const isGate = b.tag === "gatehouse";
    this.effects.dust(b.pos.subtract(new Vector3(0, b.size.h / 2, 0)), Math.max(1, b.size.w / 8) * (isGate ? 2 : 1));
    this.effects.explosion(b.pos, Math.max(1, b.size.w / 7) * (isGate ? 1.8 : 1));
```

   - shake: `Math.min(1.0, b.size.w / 12)` → `Math.min(isGate ? 1.2 : 1.0, b.size.w / 12)`.
   - Gate rubble falls inward (courtyard is −z from the south gate): after the existing rubble y-set,

```ts
    if (isGate) b.rubble.position.z -= b.size.d * 0.25;
```

- [ ] **Step 2: Gates**

`npm run typecheck`; `npm run test` (132 — siege tests from Task 2 + all); `npx playwright test e2e/gameplay.spec.ts` (E2E 4 destroy→relic and E2E 6 exercise buildings — must stay green).

- [ ] **Step 3: Commit**

```bash
git add src/world/BuildingSystem.ts
git commit -m "Siege: state-driven building damage visuals + gatehouse breach moment"
```

---

### Task 4: Collapse consequences — soldiers + ballistae

**Files:**
- Modify: `src/ai/EnemyManager.ts` (new method near `getGroundEnemies`)
- Modify: `src/mission/MissionScene.ts` (`wireSystems` — the existing `this.buildings.onDestroyed = …` handler)

**Interfaces:**
- Produces: `EnemyManager.applyCollapseImpact(pos: Vector3, radius: number): void` — staggers/flees soldiers, destroys ballistae in radius (existing death path → objective credit intact).

- [ ] **Step 1: Implement**

EnemyManager — after `getGroundEnemies()`:

```ts
  /** tower/wall collapse: knock down nearby soldiers, destroy nearby ballistae */
  applyCollapseImpact(pos: Vector3, radius: number): void {
    const r2 = radius * radius;
    for (const s of this.soldiers) {
      if (s.state === "dead") continue;
      const dx = s.pos.x - pos.x;
      const dz = s.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const isLeader = s.def.role === "elite" || s.def.role === "commander" || s.puppeted;
      if (isLeader) {
        s.staggered = Math.max(s.staggered, 1.0);
        continue;
      }
      s.staggered = Math.max(s.staggered, 1.2);
      s.hp -= 12;
      s.state = "flee";
      s.stateTime = 0;
      s.moveTarget = new Vector3(s.pos.x + dx * 2, 0, s.pos.z + dz * 2);
      if (s.hp <= 0) this.killSoldier(s, true);
    }
    for (const b of this.ballistae) {
      if (b.dead) continue;
      const dx = b.pos.x - pos.x;
      const dz = b.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2) this.damageBallista(b, b.hp + 1, true);
    }
  }
```

(Check `damageBallista`'s actual signature — it takes `(b, amount, byFire?)`; verify in source. `killSoldier(s, byFire)` fires `onSoldierDeath` → objective credit as usual.)

MissionScene `wireSystems` — in the existing `this.buildings.onDestroyed = (b) => { … }` handler body append:

```ts
      this.enemies.applyCollapseImpact(b.pos, Math.max(b.size.w, b.size.d) * 1.2);
```

- [ ] **Step 2: Gates**

`npm run typecheck`; `npm run test`; `npx playwright test e2e/regression.spec.ts -g "§90"` (castle phased completion — collapse path exercised).

- [ ] **Step 3: Commit**

```bash
git add src/ai/EnemyManager.ts src/mission/MissionScene.ts
git commit -m "Siege: collapse impacts soldiers and destroys ballistae in radius"
```

---

### Task 5: Ballista volley scheduler

**Files:**
- Create: volley helper inside `src/ai/EnemyManager.ts` (exported pure function at module level, near `ballisticDir`)
- Modify: `src/ai/EnemyManager.ts` (field + update hook)
- Test: `tests/siege.test.ts` (append)

**Interfaces:**
- Produces: `export function planVolley(aliveCount: number, rng: { range: (a: number, b: number) => number }): { count: number; window: number }` — count = clamp(2..3, ≤aliveCount) (0 if aliveCount < 2), window = 0.6.
- `BallistaEntity` gains `volleyAimJitter?: number` (meters, ±).

- [ ] **Step 1: Write failing tests** (append to `tests/siege.test.ts`)

```ts
import { planVolley } from "../src/ai/EnemyManager";

describe("ballista volley planning", () => {
  const rng = { range: (a: number, b: number) => (a + b) / 2 };

  test("no volley below 2 alive", () => {
    expect(planVolley(0, rng).count).toBe(0);
    expect(planVolley(1, rng).count).toBe(0);
  });

  test("volley of 2-3 scaled by alive count", () => {
    expect(planVolley(2, rng).count).toBeGreaterThanOrEqual(2);
    expect(planVolley(6, rng).count).toBeLessThanOrEqual(3);
    expect(planVolley(6, rng).count).toBeGreaterThanOrEqual(2);
  });

  test("window is tight and fixed", () => {
    expect(planVolley(3, rng).window).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

Module level in EnemyManager.ts:

```ts
/** coordinated volley plan: 2-3 ballistae firing inside a 0.6s window */
export function planVolley(aliveCount: number, rng: { range: (a: number, b: number) => number }): { count: number; window: number } {
  if (aliveCount < 2) return { count: 0, window: 0.6 };
  const count = Math.min(3, Math.max(2, Math.round(rng.range(2, aliveCount))));
  return { count, window: 0.6 };
}
```

In the class: private field `private volleyTimer = 14;`. In `update(dt, ctx)` (before the ballista loop):

```ts
    this.volleyTimer -= dt;
    if (this.volleyTimer <= 0) {
      this.volleyTimer = this.rng.range(9, 15);
      const alive = this.ballistae.filter((b) => !b.dead);
      const plan = planVolley(alive.length, this.rng);
      if (plan.count >= 2) {
        const picked = alive.slice(0, plan.count);
        picked.forEach((b, i) => {
          b.cooldown = 1.0 + (i * plan.window) / plan.count;
          b.volleyAimJitter = this.rng.range(-3, 3);
        });
      }
    }
```

In `updateBallista`'s fire block — after the existing lead computation, apply jitter to the aim point (find the `spawn("bolt", …)` call; the target/aim variables it uses — offset that aim's x/z by `b.volleyAimJitter ?? 0` in opposite ±; then `b.volleyAimJitter = 0;`).

- [ ] **Step 4: Run → PASS (135 tests); typecheck. Commit**

```bash
git add src/ai/EnemyManager.ts tests/siege.test.ts
git commit -m "Siege: coordinated ballista volleys with aim jitter"
```

---

### Task 6: Tower identities + fortress scale

**Files:**
- Modify: `src/world/WorldBuilder.ts` — `BuildingPlacement` interface (add `variant?: string; hpFraction?: number`), blackstone ballista re-anchoring
- Modify: `src/world/BuildingFactory.ts` — `create(kind, stoneColor?, variant?)` variant geometry; `BuiltBuilding.size` reflects actual
- Modify: `src/world/CastleBuilder.ts` — WALL_H 16→20, tower spots → identity variants/heights
- Modify: `src/world/BuildingSystem.ts` — `spawnFromLayout` passes variant + applies `hpFraction` (then `refreshDamageVisuals`)
- Test: `tests/siege.test.ts` (append — placement data sanity via CastleBuilder is Babylon-bound; instead unit-test nothing here; e2e covers. Keep typecheck+full suite as gates.)

**Interfaces:**
- Produces: `BuildingPlacement.variant?: "gate" | "artillery" | "military" | "ruined"`; `BuildingPlacement.hpFraction?: number`.

- [ ] **Step 1: WorldBuilder**

In `BuildingPlacement` (lines ~19-25) add the two optional fields. In the blackstone case: wall ballistae currently 4 entries with `y = heightAt + 17` — the E/W mid ones (±110, 0) become artillery-tower crowns: `y: terrain.heightAt(±110, 0) + 42`, yaw unchanged; the N mid (0, -110) and diagonal (-70, -70) entries: `+ 21` (wall-walk for 20m walls). Courtyard two unchanged.

- [ ] **Step 2: BuildingFactory**

`create(kind: BuildingKind, stoneColor = "#6a6460", variant?: string)`. In the `grandTower` case, after the base geometry, adjust by variant:

```ts
        if (variant === "artillery") {
          const plat = MeshBuilder.CreateCylinder("gt-plat", { diameter: w * 1.45, height: 1.0, tessellation: 9 }, this.scene);
          plat.position.y = h / 2 + 1.9;
          parts.push(plat);
          troof.isVisible = false;
        }
        if (variant === "gate") {
          for (const side of [-1, 1]) {
            const banner = MeshBuilder.CreateBox("gt-ban", { width: 0.2, height: 3.2, depth: 1.4 }, this.scene);
            banner.position.set(side * w * 0.5, h / 2 + 3.4, 0);
            parts.push(banner);
          }
        }
        if (variant === "ruined") {
          troof.isVisible = false;
          for (let i = 0; i < 7; i++) {
            if (i % 2 === 0) cren.isVisible = false;
          }
          const breach = MeshBuilder.CreateBox("gt-breach", { width: w * 0.5, height: h * 0.3, depth: w * 0.6 }, this.scene);
          breach.position.set(w * 0.25, -h / 2 + h * 0.15, 0);
          parts.push(breach);
        }
```

(`troof`/`cren` are existing locals in that case — hoist `cren` handling into the loop variable if needed.) Variant size returned: at the end of the grandTower case compute `spec = { …spec, size: { w, h: variant === "artillery" ? 42 : variant === "ruined" ? 24 : 38, d } }` — simplest: after the switch, `if (kind === "grandTower" && variant) spec = { ...spec, size: { ...spec.size, h: variant === "artillery" ? 42 : variant === "ruined" ? 24 : 38 } };` using a local `let spec` (currently `const spec` — change to let and reassign). `BuiltBuilding.size` already returns `spec.size` → actual height flows through.

- [ ] **Step 3: CastleBuilder**

`WALL_H = 20`. Tower spots → variants (order of `towerSpots` array maps to spots):

```ts
    const towerSpots: [number, number, string][] = [
      [-HALF, -HALF, "military"], [HALF, -HALF, "military"],
      [-HALF, HALF, "gate"], [HALF, HALF, "gate"],
      [-HALF, 0, "artillery"], [HALF, 0, "artillery"],
      [0, -HALF, "ruined"], [0, HALF - 26, "gate"],
    ];
    for (const [tx, tz, variant] of towerSpots) {
      buildings.push({
        kind: "grandTower",
        tag: "wallTower",
        pos: new Vector3(cx + tx, g(cx + tx, cz + tz), cz + tz),
        rotY: 0,
        variant,
        ...(variant === "ruined" ? { hpFraction: 0.45 } : {}),
      });
    }
```

- [ ] **Step 4: BuildingSystem.spawnFromLayout**

Pass variant: `factory.create(b.kind, undefined, b.variant)` (keep default stone color). After entity construction: if `b.hpFraction !== undefined` → `entity.hp = entity.maxHp * b.hpFraction; this.refreshDamageVisuals(entity);` (ruined towers spawn DAMAGED-looking). Refresh signature from Task 3.

- [ ] **Step 5: Gates**

`npm run typecheck`; `npm run test`; `npx playwright test e2e/regression.spec.ts -g "§90" && npx playwright test e2e/blackstone-finale.spec.ts` (tower/gate collapse paths + spire clearance still fine — towers taller, CHASE_PATH waypoint clearance ≥75m vs 42m crowns: OK).

- [ ] **Step 6: Commit**

```bash
git add src/world/WorldBuilder.ts src/world/BuildingFactory.ts src/world/CastleBuilder.ts src/world/BuildingSystem.ts
git commit -m "Siege: 8 tower identities, 20m curtain, ruined pre-damaged tower, artillery ballista crowns"
```

---

### Task 7: AmbientBattle pairs

**Files:**
- Create: `src/world/AmbientBattle.ts`
- Modify: `src/mission/MissionScene.ts` — construct for blackstone (after finale construction), `update()` hook next to `world.props.update(dt)`
- Test: `tests/siege.test.ts` (append — pure helpers)

**Interfaces:**
- Produces: `export function tierFor(dist: number): 0 | 1 | 2`; `export function shouldLookUp(dragonPos: {x,y,z}, pairPos: {x,z}, alt: number): boolean`; `export function pairPhase(t: number, seed: number): { swayA: number; swayB: number; lunge: number }`; `class AmbientBattle { constructor(scene, terrain sampler, rng); spawn(anchors: {x: number; z: number; r: number; pairs: number}[]): void; update(dt, cameraPos: Vector3, dragonPos: Vector3, dragonAlt: number): void; pairCount(): number; tierHistogram(): number[] }`.

- [ ] **Step 1: Write failing tests** (append)

```ts
import { tierFor, shouldLookUp, pairPhase } from "../src/world/AmbientBattle";

describe("ambient battle helpers", () => {
  test("distance tiers", () => {
    expect(tierFor(50)).toBe(0);
    expect(tierFor(120)).toBe(1);
    expect(tierFor(300)).toBe(2);
  });

  test("look up only for low nearby dragons", () => {
    expect(shouldLookUp({ x: 0, y: 10, z: 0 }, { x: 30, z: 0 }, 8)).toBe(true);
    expect(shouldLookUp({ x: 0, y: 100, z: 0 }, { x: 30, z: 0 }, 95)).toBe(false);
    expect(shouldLookUp({ x: 0, y: 10, z: 0 }, { x: 90, z: 0 }, 8)).toBe(false);
  });

  test("pair phase deterministic per seed and bounded", () => {
    const a = pairPhase(3.5, 7);
    const b = pairPhase(3.5, 7);
    const c = pairPhase(3.5, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.abs(a.swayA)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.lunge)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** (`src/world/AmbientBattle.ts`)

```ts
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { TerrainHeightSampler } from "./Terrain";
import type { SeededRng } from "../core/SeededRng";

export function tierFor(dist: number): 0 | 1 | 2 {
  if (dist < 120) return 0;
  if (dist < 300) return 1;
  return 2;
}

export function shouldLookUp(dragonPos: { x: number; y: number; z: number }, pairPos: { x: number; z: number }, alt: number): boolean {
  if (alt > 40) return false;
  const dx = dragonPos.x - pairPos.x;
  const dz = dragonPos.z - pairPos.z;
  return dx * dx + dz * dz < 60 * 60;
}

export function pairPhase(t: number, seed: number): { swayA: number; swayB: number; lunge: number } {
  const p = t * 2.2 + seed * 1.7;
  return {
    swayA: Math.sin(p),
    swayB: Math.sin(p + Math.PI * 0.9),
    lunge: Math.sin(p * 0.5 + seed),
  };
}

interface Pair {
  root: TransformNode;
  a: { body: TransformNode; arm: Mesh };
  b: { body: TransformNode; arm: Mesh };
  seed: number;
  tier: 0 | 1 | 2;
  lookUp: boolean;
  animT: number;
  updateBudget: number;
  deathAt: number;
  fallen: boolean;
}

/** Visual-only battlefield: paired duelists animating a fight loop. No damage/AI/collision. */
export class AmbientBattle {
  private pairs: Pair[] = [];
  private matA: StandardMaterial;
  private matB: StandardMaterial;

  constructor(private scene: Scene, private terrain: TerrainHeightSampler, private rng: SeededRng) {
    this.matA = new StandardMaterial("amb-faction-a", scene);
    this.matA.diffuseColor = new Color3(0.3, 0.26, 0.2);
    this.matB = new StandardMaterial("amb-faction-b", scene);
    this.matB.diffuseColor = new Color3(0.2, 0.23, 0.28);
  }

  spawn(anchors: { x: number; z: number; r: number; pairs: number }[]): void {
    for (const an of anchors) {
      for (let i = 0; i < an.pairs; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const rr = this.rng.range(an.r * 0.2, an.r);
        const x = an.x + Math.cos(a) * rr;
        const z = an.z + Math.sin(a) * rr;
        this.pairs.push(this.makePair(x, z, this.rng.range(0, Math.PI * 2)));
      }
    }
  }

  private makePair(x: number, z: number, yaw: number): Pair {
    const root = new TransformNode(`ambpair-${this.pairs.length}`, this.scene);
    root.position.set(x, this.terrain.height(x, z), z);
    root.rotation.y = yaw;
    const mk = (mat: StandardMaterial, offX: number) => {
      const body = new TransformNode(`ambfig`, this.scene);
      body.parent = root;
      body.position.set(offX, 0, 0);
      const parts: Mesh[] = [];
      const torso = MeshBuilder.CreateCapsule("amb-t", { height: 1.7, radius: 0.3, tessellation: 6 }, this.scene);
      torso.position.y = 1.0;
      parts.push(torso);
      const head = MeshBuilder.CreateSphere("amb-h", { diameter: 0.42, segments: 4 }, this.scene);
      head.position.y = 2.0;
      parts.push(head);
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
      merged.material = mat;
      merged.parent = body;
      merged.isPickable = false;
      const arm = MeshBuilder.CreateBox("amb-arm", { width: 0.12, height: 0.9, depth: 0.12 }, this.scene);
      arm.material = mat;
      arm.parent = body;
      arm.position.set(0.1, 1.35, 0.3);
      arm.isPickable = false;
      return { body, arm };
    };
    return {
      root,
      a: mk(this.matA, -0.9),
      b: mk(this.matB, 0.9),
      seed: this.rng.range(0, 100),
      tier: 2,
      lookUp: false,
      animT: this.rng.range(0, 10),
      updateBudget: 0,
      deathAt: this.rng.range(20, 40),
      fallen: false,
    };
  }

  update(dt: number, cameraPos: Vector3, dragonPos: Vector3, dragonAlt: number): void {
    for (const p of this.pairs) {
      const dx = p.root.position.x - cameraPos.x;
      const dz = p.root.position.z - cameraPos.z;
      p.tier = tierFor(Math.hypot(dx, dz));
      p.updateBudget -= dt;
      if (p.tier === 2) continue;
      const step = p.tier === 0 ? dt : 0;
      if (p.tier === 1 && p.updateBudget > 0) continue;
      if (p.tier === 1) p.updateBudget = 0.1;
      const d = step || 0.1;
      p.animT += d;
      p.deathAt -= d;
      if (p.deathAt <= 0 && !p.fallen) {
        p.fallen = true;
        p.b.body.rotation.x = Math.PI / 2;
        p.b.body.position.y = 0.4;
      }
      if (p.deathAt <= -6) {
        p.fallen = false;
        p.b.body.rotation.x = 0;
        p.b.body.position.y = 0;
        p.deathAt = this.rng.range(20, 40);
      }
      p.lookUp = shouldLookUp(dragonPos, p.root.position, dragonAlt);
      const ph = pairPhase(p.animT, p.seed);
      if (p.lookUp) {
        p.a.body.rotation.x = -0.55;
        p.b.body.rotation.x = p.fallen ? Math.PI / 2 : -0.55;
      } else {
        p.a.body.rotation.x = ph.swayA * 0.12;
        p.a.body.rotation.z = ph.swayA * 0.1;
        p.b.body.rotation.z = ph.swayB * 0.1;
        p.a.body.position.z = ph.lunge * 0.35;
        p.b.body.position.z = -ph.lunge * 0.35;
        p.a.arm.rotation.x = Math.max(0, ph.swayA) * -1.4;
        p.b.arm.rotation.x = p.fallen ? 0 : Math.max(0, ph.swayB) * -1.4;
      }
    }
  }

  pairCount(): number {
    return this.pairs.length;
  }

  tierHistogram(): number[] {
    const h = [0, 0, 0];
    for (const p of this.pairs) h[p.tier]++;
    return h;
  }

  dispose(): void {
    for (const p of this.pairs) p.root.dispose(false, true);
    this.pairs = [];
    this.matA.dispose();
    this.matB.dispose();
  }
}
```

MissionScene — field `readonly ambient: AmbientBattle | null = null;`; in the constructor's blackstone block (where the finale is constructed) add:

```ts
      this.ambient = new AmbientBattle(this.scene, this.world.terrain.sampler, new SeededRng(d.mission.seed + 91));
      this.ambient.spawn([
        { x: 0, z: 20, r: 40, pairs: 8 },
        { x: 0, z: 150, r: 45, pairs: 6 },
        { x: -160, z: -170, r: 40, pairs: 4 },
        { x: 190, z: 40, r: 35, pairs: 4 },
        { x: 60, z: -120, r: 30, pairs: 3 },
      ]);
```

In `update()` next to `this.world.props.update(dt)`:

```ts
    if (this.ambient) {
      const dp = this.dragonCtrl.pos;
      this.ambient.update(dt, this.activeCamera().position, dp, dp.y - this.world.terrain.heightAt(dp.x, dp.z));
    }
```

Dispose: in the existing mission dispose path (find where buildings.disposeAll / enemies dispose happen — add `this.ambient?.dispose(); this.finale?.dispose?.();` only if a dispose method exists for the scene teardown — check how MissionScene is disposed; Babylon scene.dispose covers meshes, so explicit dispose is for materials only — safe to rely on scene dispose and skip explicit call; document in report).

- [ ] **Step 4: Run → PASS (138); typecheck. Commit**

```bash
git add src/world/AmbientBattle.ts src/mission/MissionScene.ts tests/siege.test.ts
git commit -m "Siege: ambient battle pairs — visual duelists with distance tiers + dragon look-up"
```

---

### Task 8: Test API additions

**Files:**
- Modify: `src/main.ts` api object (inside testMode guard)

- [ ] **Step 1: Implement**

```ts
        getBuildingStates() {
          const m = app.mission;
          if (!m) return [];
          return m.buildings.buildings.map((b) => ({
            tag: b.tag,
            hp: Math.round(b.hp),
            maxHp: b.maxHp,
            state: b.visualState,
            collapsed: b.collapsed,
          }));
        },
        getAmbientPairs() {
          const amb = app.mission?.ambient;
          if (!amb) return null;
          return { count: amb.pairCount(), tiers: amb.tierHistogram() };
        },
        triggerVolley() {
          return app.mission?.enemies.forceVolley() ?? false;
        },
```

EnemyManager: add `forceVolley(): boolean` — runs the same volley block as the timer (extract the volley execution into `private runVolley(): boolean` used by both the timer and the public force).

- [ ] **Step 2: Gates** — typecheck + unit suite. Commit:

```bash
git add src/main.ts src/ai/EnemyManager.ts
git commit -m "Test API: building states, ambient pairs, volley trigger"
```

---

### Task 9: E2E — siege spec

**Files:**
- Create: `e2e/siege.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, type Page } from "@playwright/test";

async function bootBlackstone(page: Page) {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

function nearestTower(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__GAME;
    const dragon = g.mission.dragonCtrl.pos;
    const towers = g.mission.buildings.buildings.filter((b) => b.tag === "wallTower" && !b.collapsed);
    towers.sort((a, b) => Math.hypot(a.pos.x - dragon.x, a.pos.z - dragon.z) - Math.hypot(b.pos.x - dragon.x, b.pos.z - dragon.z));
    (window as any).__tower = towers[0];
    return { hp: towers[0].hp, state: towers[0].visualState };
  });
}

test("siege: tower damage-state progression → collapse → ballistae destroyed", async ({ page }) => {
  await bootBlackstone(page);
  await nearestTower(page);
  // teleport next to the nearest tower and burn it down via test damage, checking states
  const states: string[] = [];
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const t = (window as any).__tower;
    g.mission.dragonCtrl.pos.set(t.pos.x + 25, t.pos.y + 20, t.pos.z + 25);
    (window as any).__burn = () => {
      const b = (window as any).__tower;
      b.hp -= b.maxHp * 0.2;
      g.mission.buildings.refreshDamageVisuals(b);
      if (b.hp <= 0) g.mission.buildings.damageBuilding(b, 1);
    };
  });
  for (let i = 0; i < 6; i++) {
    const res = await page.evaluate(() => {
      (window as any).__burn();
      const b = (window as any).__tower;
      return { state: b.visualState, collapsed: b.collapsed, hp: Math.max(0, Math.round(b.hp)) };
    });
    if (!res.collapsed && states[states.length - 1] !== res.state) states.push(res.state);
    if (res.collapsed) break;
    await page.waitForTimeout(200);
  }
  expect(states).toContain("SCORCHED");
  expect(states).toContain("DAMAGED");
  expect(states).toContain("CRITICAL");
  // collapse killed nearby ballistae (blackstone has 4 wall-mounted ones)
  const ballistae = await page.evaluate(() => {
    const g = (window as any).__GAME;
    const t = (window as any).__tower;
    const near = g.mission.enemies.ballistae.filter((b) => Math.hypot(b.pos.x - t.pos.x, b.pos.z - t.pos.z) < 40);
    return { total: g.mission.enemies.ballistae.length, nearDead: near.filter((b) => b.dead).length, nearCount: near.length };
  });
  expect(ballistae.nearCount).toBeGreaterThan(0);
  expect(ballistae.nearDead).toBe(ballistae.nearCount);
});

test("siege: gatehouse breach-ready hint + enhanced collapse", async ({ page }) => {
  await bootBlackstone(page);
  const hintSeen = await page.evaluate(() => {
    const g = (window as any).__GAME;
    const gate = g.mission.buildings.buildings.find((b) => b.tag === "gatehouse");
    (window as any).__gate = gate;
    return gate !== undefined;
  });
  expect(hintSeen).toBe(true);
  // damage to just above critical
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const gate = (window as any).__gate;
    gate.hp = gate.maxHp * 0.34;
    g.mission.buildings.refreshDamageVisuals(gate);
  });
  await page.waitForFunction(() => document.querySelector(".hud-hint")?.textContent?.includes("BREACH"), null, { timeout: 5000 });
  // final blow collapses
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.buildings.damageBuilding((window as any).__gate, 99999);
  });
  await page.waitForFunction(() => (window as any).__gate.collapsed === true, null, { timeout: 5000 });
  const rubble = await page.evaluate(() => {
    const gate = (window as any).__gate;
    return { z: gate.rubble.position.z, rootZ: gate.root.position.z };
  });
  expect(rubble.z).toBeLessThan(rubble.rootZ); // fell inward (courtyard = -z)
});

test("siege: volley fires 2+ bolts in a tight window", async ({ page }) => {
  await bootBlackstone(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(0, 120, 0); // inside ballista range
    (window as any).__bolts = [];
    const orig = g.mission.projectiles.spawn.bind(g.mission.projectiles);
    g.mission.projectiles.spawn = (kind, origin, dir, speed, dmg, spread) => {
      if (kind === "bolt") (window as any).__bolts.push(g.mission.time);
      return orig(kind, origin, dir, speed, dmg, spread);
    };
    g.api.triggerVolley();
  });
  await page.waitForFunction(() => (window as any).__bolts.length >= 2, null, { timeout: 15000 });
  const windowSpan = await page.evaluate(() => {
    const b = (window as any).__bolts;
    return Math.max(...b) - Math.min(...b);
  });
  expect(windowSpan).toBeLessThanOrEqual(1.5); // sim seconds incl. aim settle
});

test("siege: ambient pairs spawn and tier", async ({ page }) => {
  await bootBlackstone(page);
  const pairs = await page.evaluate(() => (window as any).__GAME.api.getAmbientPairs());
  expect(pairs).not.toBeNull();
  expect(pairs.count).toBeGreaterThanOrEqual(20);
  expect(pairs.tiers[0] + pairs.tiers[1] + pairs.tiers[2]).toBe(pairs.count);
});

test("siege: no regression — §90 phased castle completion", async ({ page }) => {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killBallistae(6);
    g.api.collapseBuildingsWithTag("wallTower", 4);
    g.api.collapseBuildingWithTag("gatehouse");
    g.api.killByType("soldier", 12);
    g.api.killByType("commander", 1);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 180000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
});
```

(If `projectiles.spawn` monkey-patching fights the pool's return type, adapt to counting `"sfx" {name:"ballistaFire"}` bus events via a page-side listener instead — same assertion.)

- [ ] **Step 2: Run**

`npx playwright test e2e/siege.spec.ts` — 5/5. Full suite: `npm run typecheck && npm run test && npx playwright test` all green.

- [ ] **Step 3: Commit**

```bash
git add e2e/siege.spec.ts
git commit -m "E2E: siege — damage states, collapse ballista kill, breach hint, volley, ambient pairs"
```

---

### Task 10: Browser verification + polish

- [ ] Headed browser pass (script under /tmp): screenshot tower SCORCHED→CRITICAL ramp, gate breach burst, volley telegraph glow, ambient pairs at courtyard + look-up reaction; PNGs stay untracked.
- [ ] Verify non-blackstone missions unaffected visually beyond damage states (boot dragonstone, burn a watchtower, confirm state ramp only).
- [ ] Dead-code sweep: `grep -rn "console.log\|TODO" src/world/DamageStates.ts src/world/AmbientBattle.ts` clean.
- [ ] Full gates. Commit polish (if any): `"Siege slice: visual polish from browser verification"`.

---

### Task 11: Final whole-branch review

Dispatch final reviewer (most capable model) over `git merge-base main HEAD..HEAD` package + ledger deferred minors; fix wave + scoped re-review per SDD skill; then finishing-a-development-branch.

---

## Self-review notes

- Spec coverage: §12 states (T2/T3), §15 consequences (T4), §16 breach (T3), §11 volleys (T5), §5-7 scale+identities (T6), §9/§10 pairs (T7), §8 perf (state-change-only application, shared materials, existing pools), slice-1 fix (T1), testing (T2/T5/T7 unit + T9 e2e). §13 zone hits / §16 charge / §3+ extras intentionally absent (spec §0 out-of-scope).
- Type consistency: `damageStateFor`/`DAMAGE_VISUALS` (T2→T3), `refreshDamageVisuals(b)` public (T3→T6/T8/T9), `applyCollapseImpact(pos, radius)` (T4), `planVolley` (T5), `variant`/`hpFraction` placement fields (T6), `tierFor/shouldLookUp/pairPhase` + AmbientBattle (T7→T8), api getters (T8→T9).
- Known risk: taller towers (38-42m) vs camera/frustum — DragonCamera maxZ 2600 fine; CHASE_PATH waypoints ≥75m alt vs 42m crowns OK; §90 collapse API path unaffected by variants (same tags).
- test-collapse API (`testCollapseBuildingWithTag`) uses `damageBuilding`/`maxHp+1` — state visuals apply via refreshDamageVisuals inside damageBuilding (T3 step 5) so §90's collapse still fires correctly.
