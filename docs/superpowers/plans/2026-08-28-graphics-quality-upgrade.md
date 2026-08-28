# Graphics Quality Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat single-color surfaces on all world objects (buildings, castle, terrain, trees/rocks, soldiers, rider) with procedural textures (albedo + normal + gloss), and add a governor-aware post-processing pipeline (FXAA + image processing).

**Architecture:** Extend the proven `DragonMaterials` pattern to a new scene-scoped `WorldMaterials` library: pure texture-data generators (unit-testable in Node) feed a `WeakMap<Scene, …>` texture cache; consumers create tinted `StandardMaterial`s referencing cached textures. A new `PostPipeline` wraps `DefaultRenderingPipeline` with tier-dependent config wired to `PerformanceGovernor`.

**Tech Stack:** TypeScript, Babylon.js 8 (`@babylonjs/core`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-graphics-quality-upgrade-design.md`

## Deviations from spec (refinements, intent preserved)

1. **Texture-level cache, not material-level.** Materials sharing one texture cannot have per-consumer `uScale` (uScale lives on the texture). The cache stores `RawTexture`s keyed `(kind, channel, uScale, vScale)`; consumers build/own `StandardMaterial`s (they already do).
2. **`RawTexture` instead of `DynamicTexture`.** Generators emit raw RGBA bytes; `RawTexture` needs no canvas 2D context → cache is unit-testable under `NullEngine` in Node. DragonMaterials keeps `DynamicTexture` (untouched).
3. **`configureSceneQuality` stub (zero callers) is deleted.** Its job lives in `PostPipeline.applyTier(tier)` + a tier-change watcher in `GameApp.frame()`.
4. **Ground detail uScale ≈ 200** (≈8.5m per tile at 1700m ground). Spec's "60–80" was preliminary (21m tiles — too sparse). Verified visually in Task 11.
5. **Roof material bug fixed en route.** `BuildingFactory` merges walls+roofs then re-assigns the stone material, so roof color never renders and `roofMat` leaks. Roofs become a separate child mesh with their own textured material.
6. **PostFX disabled in `testMode`** (except `benchmark` mode): SwiftShader post passes would slow E2E for zero assertion value.

## Global Constraints

- `StandardMaterial` only — NO PBR.
- Scene-scoped `WeakMap<Scene, …>` caches; NEVER share textures/materials across the menu showcase scene and mission scenes (AGENTS.md invariant).
- Babylon imports: `import { X } from "@babylonjs/core"`.
- 100% procedural — no external image assets.
- Texture sizes: stone & ground 512px, others 256px. Albedo average brightness ≈ 1.0 (diffuseColor tints carry color).
- Perf budget: avg fps regression ≤ 5% on headed benchmark (high preset) vs Task 1 baseline.
- `npm run typecheck` green before every commit; existing unit + E2E suites stay green.
- Damage tint system keeps working: `refreshDamageVisuals` scales `diffuseColor` — textures multiply, never overwrite.

## File Structure

**Create:** `src/world/Noise.ts`, `src/world/WorldMaterials.ts`, `src/engine/PostPipeline.ts`, `tests/noise.test.ts`, `tests/worldmaterials.test.ts`, `tests/postpipeline.test.ts`

**Modify:** `src/world/DragonMaterials.ts` (noise import), `src/world/BuildingFactory.ts`, `src/world/BuildingSystem.ts`, `src/world/CastleBuilder.ts`, `src/world/Terrain.ts`, `src/world/WorldBuilder.ts`, `src/world/SoldierFactory.ts`, `src/mission/MissionScene.ts`, `src/scenes/MenuShowcase.ts`, `src/app/GameApp.ts`, `src/engine/PerformanceGovernor.ts` (delete dead stub)

---

### Task 1: Extract shared noise helpers

**Files:** Create `src/world/Noise.ts` · Modify `src/world/DragonMaterials.ts:35-66,180-185` · Test `tests/noise.test.ts`

**Interfaces:** Produces `valueNoise(x,y,seed): number`, `fbm(x,y,seed,octaves?): number`, `hash01(n): number` — used by DragonMaterials and WorldMaterials.

- [ ] **Step 1: Write the failing test**

```ts
// tests/noise.test.ts
import { describe, test, expect } from "vitest";
import { valueNoise, fbm, hash01 } from "../src/world/Noise";

describe("noise helpers", () => {
  test("deterministic for same inputs", () => {
    expect(valueNoise(3.2, 7.7, 42)).toBe(valueNoise(3.2, 7.7, 42));
    expect(fbm(10.5, -3.1, 99)).toBe(fbm(10.5, -3.1, 99));
    expect(hash01(1234567)).toBe(hash01(1234567));
  });
  test("valueNoise and fbm stay in [0,1]", () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 1.37 - 250, y = i * -2.11 + 90;
      const v = valueNoise(x, y, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const f = fbm(x, y, i);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
  test("hash01 deterministic and in [0,1)", () => {
    for (let n = 0; n < 200; n++) {
      const h = hash01(n * 7919);
      expect(h).toBe(hash01(n * 7919));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/noise.test.ts` — Expected: FAIL (`Cannot find module '../src/world/Noise'`)

- [ ] **Step 3: Create `src/world/Noise.ts`** — copy the three function bodies VERBATIM from `src/world/DragonMaterials.ts` (`valueNoise` lines 35–53, `fbm` lines 56–66, `hash01` lines 180–185), each with `export` added plus their doc comments. Header: `/** Shared deterministic 2D noise (moved from DragonMaterials — byte-identical math). */`

- [ ] **Step 4: Rewire DragonMaterials** — delete those three local definitions from `DragonMaterials.ts`, add `import { valueNoise, fbm, hash01 } from "./Noise";`

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/noise.test.ts && npm run typecheck` — Expected: PASS + clean

- [ ] **Step 6: Capture benchmark baseline** (must precede visual changes; Task 11 compares)

With `npm run dev` running:
```bash
npm run benchmark -- mission=riverlands seconds=25 2>&1 | tee /tmp/bench-baseline-riverlands.txt
npm run benchmark -- mission=blackstone seconds=25 2>&1 | tee /tmp/bench-baseline-blackstone.txt
```
Note the `averageFps` / `p5Fps` lines.

- [ ] **Step 7: Commit**

```bash
git add src/world/Noise.ts src/world/DragonMaterials.ts tests/noise.test.ts
git commit -m "Refactor: extract shared noise helpers from DragonMaterials"
```

---

### Task 2: WorldMaterials generators — encode helper + stone/wood/roof

**Files:** Create `src/world/WorldMaterials.ts` · Test `tests/worldmaterials.test.ts`

**Interfaces:** Consumes `./Noise`. Produces `interface MapSet { albedo: Uint8Array; normal: Uint8Array; gloss?: Uint8Array; size: number }`, `heightToNormalRGBA(h, size, strength, grain, seed): Uint8Array`, `stoneMaps(size, seed)`, `woodMaps(size, seed)`, `roofMaps(size, seed)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/worldmaterials.test.ts
import { describe, test, expect } from "vitest";
import { stoneMaps, woodMaps, roofMaps, heightToNormalRGBA } from "../src/world/WorldMaterials";

describe("map generators", () => {
  test("deterministic for same seed", () => {
    const a = stoneMaps(128, 7);
    const b = stoneMaps(128, 7);
    expect([...a.albedo]).toEqual([...b.albedo]);
    expect([...a.normal]).toEqual([...b.normal]);
  });
  test("correct buffer sizes and opaque alpha", () => {
    for (const m of [stoneMaps(128, 1), woodMaps(128, 2), roofMaps(128, 3)]) {
      expect(m.albedo.length).toBe(128 * 128 * 4);
      expect(m.normal.length).toBe(128 * 128 * 4);
      for (let i = 3; i < m.albedo.length; i += 4) expect(m.albedo[i]).toBe(255);
    }
  });
  test("stone: mortar darker than brick faces; gloss present", () => {
    const size = 128;
    const m = stoneMaps(size, 5);
    expect(m.gloss).toBeDefined();
    const lum = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return (m.albedo[i] + m.albedo[i + 1] + m.albedo[i + 2]) / 3;
    };
    expect(lum(64, 12)).toBeGreaterThan(lum(64, 1) + 30);
  });
  test("wood/roof albedo averages tint-friendly (>0.75)", () => {
    for (const m of [woodMaps(128, 4), roofMaps(128, 5)]) {
      let s = 0;
      for (let i = 0; i < m.albedo.length; i += 4) s += m.albedo[i];
      const avg = s / (m.albedo.length / 4) / 255;
      expect(avg).toBeGreaterThan(0.75);
    }
  });
  test("heightToNormalRGBA encodes mostly-up normals", () => {
    const h = new Float32Array(64 * 64).fill(0.5);
    const n = heightToNormalRGBA(h, 64, 2, 0, 1);
    expect(n[(32 * 64 + 32) * 4 + 2]).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worldmaterials.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/world/WorldMaterials.ts`**

```ts
import { hash01, fbm, valueNoise } from "./Noise";

/**
 * Procedural world material library (no external assets).
 * Layer 1 (pure): map generators → RGBA byte buffers.
 * Layer 2 (scene-scoped, added in a later task): RawTexture cache + texturedMaterial().
 *
 * ALBEDO CONVENTION: brightness modulates around ~1.0 so consumer
 * diffuseColor tints carry the color (damage scale, heraldry, env colors).
 */
export interface MapSet {
  albedo: Uint8Array;
  normal: Uint8Array;
  gloss?: Uint8Array;
  size: number;
}

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Uint8 version of DragonMaterials' heightToNormalTexture: macro slopes + micro grain. */
export function heightToNormalRGBA(h: Float32Array, size: number, strength: number, grain: number, seed: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const gx = (valueNoise(x * 1.7, y * 1.7, seed) - 0.5) * 2 * grain;
      const gy = (valueNoise(x * 1.7, y * 1.7, seed + 4242) - 0.5) * 2 * grain;
      const nx0 = -(dx + gx);
      const ny0 = -(dy + gy);
      const len = Math.sqrt(nx0 * nx0 + ny0 * ny0 + 1);
      const i = (y * size + x) * 4;
      out[i] = clampByte((nx0 / len) * 0.5 + 0.5);
      out[i + 1] = clampByte((ny0 / len) * 0.5 + 0.5);
      out[i + 2] = clampByte((1 / len) * 0.5 + 0.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---- stone: brick courses, per-brick identity, mortar, moss ----
export function stoneMaps(size: number, seed: number): MapSet {
  const rows = Math.max(6, Math.round(size / 56));
  const rowH = size / rows;
  const cols = 4;
  const mortar = Math.max(2, size / 160);
  const h = new Float32Array(size * size);
  const cell = new Int32Array(size * size).fill(-1);
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * 0.5;
    for (let col = 0; col < cols; col++) {
      const id = ((row * 73856093) ^ (col * 19349663) ^ Math.imul(seed, 2654435761)) >>> 0;
      const x0 = ((col + off) / cols) * size;
      const w = size / cols;
      const y0 = row * rowH;
      for (let y = Math.floor(y0); y < Math.ceil(y0 + rowH); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
          const px = ((x % size) + size) % size;
          const fx = x - x0, fy = y - y0;
          if (fx > mortar && fx < w - mortar && fy > mortar && fy < rowH - mortar) {
            const i = y * size + px;
            h[i] = 0.8 + hash01(id) * 0.2;
            cell[i] = id;
          }
        }
      }
    }
  }
  const albedo = new Uint8Array(size * size * 4);
  const gloss = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const id = cell[i];
      const stone = id >= 0;
      const b = stone
        ? 1.0 + (hash01(id ^ 0x9e37) - 0.5) * 0.22 + (fbm(x / (size / 6), y / (size / 6), seed) - 0.5) * 0.18
        : 0.6 + (fbm(x / 8, y / 8, seed + 7) - 0.5) * 0.12;
      const moss = fbm(x / (size / 4), y / (size / 4), seed + 31);
      const mossK = moss > 0.56 ? (moss - 0.56) * 1.6 : 0;
      const o = i * 4;
      albedo[o] = clampByte(b - mossK * 0.04);
      albedo[o + 1] = clampByte(b + mossK * 0.10);
      albedo[o + 2] = clampByte(b - mossK * 0.05);
      albedo[o + 3] = 255;
      const gl = stone ? 0.30 + hash01(id ^ 0x51f1) * 0.35 : 0.08;
      gloss[o] = gloss[o + 1] = gloss[o + 2] = clampByte(gl);
      gloss[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 2.4, 0.45, seed), gloss, size };
}

// ---- wood: vertical grain, plank seams, knots ----
export function woodMaps(size: number, seed: number): MapSet {
  const planks = 4;
  const pw = size / planks;
  const seam = Math.max(1.5, size / 170);
  const knotX = hash01(seed * 31) * size, knotY = hash01(seed * 57) * size;
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g = fbm(x * 0.35, y * 0.035, seed);
      const plank = Math.floor(x / pw);
      const inSeam = x % pw < seam || x % pw > pw - seam;
      const kd = Math.hypot((x - knotX + size) % size, (y - knotY + size) % size);
      const knot = kd < size * 0.06 ? 1 - kd / (size * 0.06) : 0;
      let b = 1.0 + (g - 0.55) * 0.35 - knot * 0.22;
      let hv = 0.5 + (g - 0.5) * 0.5 - knot * 0.3;
      if (inSeam) { b -= 0.35; hv -= 0.35; }
      b += (hash01((plank * 83492791) ^ seed) - 0.5) * 0.12;
      h[i] = Math.max(0, Math.min(1, hv));
      const o = i * 4;
      albedo[o] = clampByte(b + 0.03);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b - 0.02);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 2.0, 0.35, seed + 3), size };
}

// ---- roof: slate shingle courses, per-slate identity ----
export function roofMaps(size: number, seed: number): MapSet {
  const rows = 8;
  const rowH = size / rows;
  const cols = 6;
  const gap = Math.max(1.5, size / 180);
  const h = new Float32Array(size * size);
  const cell = new Int32Array(size * size).fill(-1);
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * 0.5;
    for (let col = 0; col < cols; col++) {
      const id = ((row * 83492791) ^ (col * 2971215073) ^ Math.imul(seed, 40503)) >>> 0;
      const x0 = ((col + off) / cols) * size;
      const w = size / cols;
      for (let y = Math.floor(row * rowH); y < Math.ceil((row + 1) * rowH); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
          const px = ((x % size) + size) % size;
          const fx = x - x0, fy = y - row * rowH;
          if (fx > gap && fx < w - gap && fy > gap && fy < rowH - gap) {
            const i = y * size + px;
            h[i] = 0.85 + hash01(id) * 0.15;
            cell[i] = id;
          }
        }
      }
    }
  }
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const id = cell[i];
      const slate = id >= 0;
      const b = slate
        ? 0.98 + (hash01(id ^ 0x9e37) - 0.5) * 0.3 + (fbm(x / (size / 5), y / (size / 5), seed) - 0.5) * 0.15
        : 0.55;
      const o = i * 4;
      albedo[o] = clampByte(b);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b + 0.02);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 2.2, 0.4, seed + 11), size };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/worldmaterials.test.ts` — Expected: PASS. If the mortar-vs-brick assertion fails, tune `mortar` width/darkness — do NOT weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/world/WorldMaterials.ts tests/worldmaterials.test.ts
git commit -m "WorldMaterials: stone/wood/roof procedural map generators"
```

---

### Task 3: Map generators — cloth/leather/metal/bark/rock/ground

**Files:** Modify `src/world/WorldMaterials.ts` (append) · Test `tests/worldmaterials.test.ts` (append)

**Interfaces:** Produces `clothMaps`, `leatherMaps`, `metalMaps`, `barkMaps`, `rockMaps`, `groundMaps` — all `(size: number, seed: number) => MapSet`.

- [ ] **Step 1: Append failing tests**

```ts
// append to tests/worldmaterials.test.ts (add imports for the six generators)
describe("more map generators", () => {
  const GEN = { cloth: clothMaps, leather: leatherMaps, metal: metalMaps, bark: barkMaps, rock: rockMaps, ground: groundMaps };
  test("all deterministic, sized, opaque, tint-friendly", () => {
    for (const gen of Object.values(GEN)) {
      const a = gen(96, 13);
      const b = gen(96, 13);
      expect([...a.albedo]).toEqual([...b.albedo]);
      expect(a.albedo.length).toBe(96 * 96 * 4);
      for (let i = 3; i < a.albedo.length; i += 4) expect(a.albedo[i]).toBe(255);
      let s = 0;
      for (let i = 0; i < a.albedo.length; i += 4) s += a.albedo[i];
      const avg = s / (a.albedo.length / 4) / 255;
      expect(avg).toBeGreaterThan(0.7);
    }
  });
  test("bark is rougher than cloth (normal variance)", () => {
    const variance = (n: Uint8Array) => {
      let m = 0, m2 = 0;
      for (let i = 0; i < n.length; i += 4) { m += n[i]; m2 += n[i] * n[i]; }
      const c = m / (n.length / 4);
      return m2 / (n.length / 4) - c * c;
    };
    expect(variance(barkMaps(96, 1).normal)).toBeGreaterThan(variance(clothMaps(96, 1).normal));
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/worldmaterials.test.ts` — Expected: FAIL (imports not exported)

- [ ] **Step 3: Append the generators to `src/world/WorldMaterials.ts`**

```ts
// ---- cloth: 2px weave checker + thread noise ----
export function clothMaps(size: number, seed: number): MapSet {
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const weave = ((x >> 1) + (y >> 1)) % 2;
      const thread = hash01((x * 131 + y * 57) ^ Math.imul(seed, 2246822519));
      const b = 1.0 + (weave - 0.5) * 0.12 + (thread - 0.5) * 0.10 + (fbm(x / 24, y / 24, seed) - 0.5) * 0.10;
      h[i] = 0.5 + (weave - 0.5) * 0.12 + (thread - 0.5) * 0.08;
      const o = i * 4;
      albedo[o] = clampByte(b);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 1.2, 0.3, seed + 5), size };
}

// ---- leather: two-frequency grain + creases ----
export function leatherMaps(size: number, seed: number): MapSet {
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g1 = fbm(x * 0.5, y * 0.5, seed);
      const g2 = fbm(x * 2.2, y * 2.2, seed + 9);
      const ridge = 1 - Math.abs(2 * fbm(x * 0.12, y * 0.12, seed + 3) - 1);
      h[i] = g1 * 0.55 + g2 * 0.3;
      const b = 1.0 + (g1 - 0.5) * 0.25 + (g2 - 0.5) * 0.12 - ridge * 0.10;
      const o = i * 4;
      albedo[o] = clampByte(b);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b * 0.98);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 1.8, 0.5, seed + 7), size };
}

// ---- metal: horizontal brushing + sparse scratch grooves ----
export function metalMaps(size: number, seed: number): MapSet {
  const scratches: { y: number; x0: number; len: number }[] = [];
  for (let s = 0; s < 7; s++) {
    scratches.push({ y: hash01(seed * 101 + s) * size, x0: hash01(seed * 211 + s) * size, len: size * (0.08 + hash01(seed * 307 + s) * 0.2) });
  }
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const brushed = valueNoise(x * 0.9, y * 0.04, seed);
      let b = 1.0 + (brushed - 0.5) * 0.16 + (fbm(x / 40, y / 40, seed + 2) - 0.5) * 0.08;
      let hv = 0.5;
      for (const s of scratches) {
        const dx = Math.min(Math.abs(x - s.x0), Math.abs(x - s.x0 - size));
        if (dx < s.len && Math.abs(y - s.y) < 1.2) { b -= 0.18; hv = 0.3; }
      }
      h[i] = hv;
      const o = i * 4;
      albedo[o] = clampByte(b * 0.99);
      albedo[o + 1] = clampByte(b * 0.995);
      albedo[o + 2] = clampByte(b);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 1.4, 0.35, seed + 13), size };
}

// ---- bark: vertical ridges + deep fissures ----
export function barkMaps(size: number, seed: number): MapSet {
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = fbm(x * 0.8, y * 0.06, seed);
      const fine = fbm(x * 2.4, y * 0.25, seed + 17);
      h[i] = v * 0.8 + fine * 0.2;
      const b = 0.95 + (v - 0.5) * 0.55 + (fine - 0.5) * 0.15;
      const o = i * 4;
      albedo[o] = clampByte(b + 0.04);
      albedo[o + 1] = clampByte(b - 0.01);
      albedo[o + 2] = clampByte(b - 0.05);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 3.2, 0.5, seed + 19), size };
}

// ---- rock: fbm mass + crack walks ----
export function rockMaps(size: number, seed: number): MapSet {
  const h = new Float32Array(size * size);
  const crack = new Uint8Array(size * size);
  for (let c = 0; c < 5; c++) {
    let x = hash01(seed * 61 + c) * size;
    let y = hash01(seed * 83 + c) * size;
    let a = hash01(seed * 97 + c) * Math.PI * 2;
    for (let s = 0, steps = Math.floor(size * 0.9); s < steps; s++) {
      x += Math.cos(a);
      y += Math.sin(a);
      a += (hash01(seed * 131 + c * 1000 + s) - 0.5) * 0.5;
      const px = ((Math.floor(x) % size) + size) % size;
      const py = ((Math.floor(y) % size) + size) % size;
      crack[py * size + px] = 1;
    }
  }
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const mass = fbm(x * 0.09, y * 0.09, seed) * 0.6 + fbm(x * 0.3, y * 0.3, seed + 5) * 0.3;
      const isCrack = crack[i] === 1;
      h[i] = isCrack ? mass * 0.35 : mass;
      const b = 1.0 + (mass - 0.45) * 0.35 - (isCrack ? 0.28 : 0);
      const o = i * 4;
      albedo[o] = clampByte(b);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b * 0.99);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 2.6, 0.5, seed + 23), size };
}

// ---- ground detail: fine grain + patches + pebble specks (avg ~ 1.0) ----
export function groundMaps(size: number, seed: number): MapSet {
  const h = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const patch = fbm(x * 0.12, y * 0.12, seed);
      const speck = hash01((x * 92837111) ^ (y * 68927593) ^ Math.imul(seed, 2654435761));
      const grain = valueNoise(x * 2.1, y * 2.1, seed + 3);
      let b = 1.0 + (patch - 0.5) * 0.30 + (grain - 0.5) * 0.22;
      let hv = 0.4 + (patch - 0.5) * 0.3 + (grain - 0.5) * 0.35;
      if (speck > 0.995) { b += 0.18; hv += 0.35; }
      h[i] = Math.max(0, Math.min(1, hv));
      const o = i * 4;
      albedo[o] = clampByte(b + 0.015);
      albedo[o + 1] = clampByte(b);
      albedo[o + 2] = clampByte(b - 0.02);
      albedo[o + 3] = 255;
    }
  }
  return { albedo, normal: heightToNormalRGBA(h, size, 1.6, 0.6, seed + 29), size };
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/worldmaterials.test.ts` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/WorldMaterials.ts tests/worldmaterials.test.ts
git commit -m "WorldMaterials: cloth/leather/metal/bark/rock/ground generators"
```

---

### Task 4: Scene-scoped texture cache + texturedMaterial

**Files:** Modify `src/world/WorldMaterials.ts` (append) · Test `tests/worldmaterials.test.ts` (append)

**Interfaces:**
- `type WorldTexKind = "stone" | "wood" | "roof" | "cloth" | "leather" | "metal" | "bark" | "rock" | "ground"`
- `getWorldTexture(scene, kind, channel: "albedo"|"normal"|"gloss", uScale, vScale): RawTexture`
- `texturedMaterial(scene, name, kind, o: { uScale; vScale; tint?; specular?; power?; emissive?; gloss? }): StandardMaterial` — caller owns/disposes the material; textures are cache-owned.

- [ ] **Step 1: Append failing test**

```ts
// add imports: NullEngine, Scene, Color3 from "@babylonjs/core"; getWorldTexture, texturedMaterial from src
describe("scene-scoped texture cache", () => {
  test("same scene + key → same texture instance", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = getWorldTexture(scene, "stone", "albedo", 8, 8);
    expect(getWorldTexture(scene, "stone", "albedo", 8, 8)).toBe(a);
    engine.dispose();
  });
  test("different scale/channel/kind → different instance", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = getWorldTexture(scene, "stone", "albedo", 8, 8);
    expect(getWorldTexture(scene, "stone", "albedo", 4, 4)).not.toBe(a);
    expect(getWorldTexture(scene, "stone", "normal", 8, 8)).not.toBe(a);
    expect(getWorldTexture(scene, "wood", "albedo", 8, 8)).not.toBe(a);
    engine.dispose();
  });
  test("different scene → different instance (scene-scoped invariant)", () => {
    const e1 = new NullEngine(), e2 = new NullEngine();
    const s1 = new Scene(e1), s2 = new Scene(e2);
    expect(getWorldTexture(s1, "stone", "albedo", 8, 8)).not.toBe(getWorldTexture(s2, "stone", "albedo", 8, 8));
    e1.dispose(); e2.dispose();
  });
  test("texturedMaterial sets textures + tint", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = texturedMaterial(scene, "t", "wood", { uScale: 2, vScale: 2, tint: new Color3(0.3, 0.2, 0.1) });
    expect(m.diffuseTexture).toBeDefined();
    expect(m.bumpTexture).toBeDefined();
    expect(m.diffuseColor.r).toBeCloseTo(0.3);
    engine.dispose();
  });
});
```

NOTE: if `RawTexture` throws under `NullEngine` in Node, do NOT change the design — export a pure `textureKey(kind, channel, u, v)` helper and test key generation instead. Report which path was taken in the commit message.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/worldmaterials.test.ts` — Expected: FAIL (not exported)

- [ ] **Step 3: Append cache layer to `src/world/WorldMaterials.ts`** (merge the Babylon import into the file's top)

```ts
import { Color3, Constants, RawTexture, Scene, StandardMaterial, Texture } from "@babylonjs/core";

export type WorldTexKind = "stone" | "wood" | "roof" | "cloth" | "leather" | "metal" | "bark" | "rock" | "ground";

const GENERATORS: Record<WorldTexKind, (size: number, seed: number) => MapSet> = {
  stone: stoneMaps, wood: woodMaps, roof: roofMaps, cloth: clothMaps,
  leather: leatherMaps, metal: metalMaps, bark: barkMaps, rock: rockMaps, ground: groundMaps,
};
const SIZES: Record<WorldTexKind, number> = { stone: 512, ground: 512, wood: 256, roof: 256, cloth: 256, leather: 256, metal: 256, bark: 256, rock: 256 };
const SEEDS: Record<WorldTexKind, number> = { stone: 11, wood: 23, roof: 37, cloth: 41, leather: 53, metal: 67, bark: 71, rock: 83, ground: 97 };

const mapCache = new WeakMap<Scene, Map<WorldTexKind, MapSet>>();
const texCache = new WeakMap<Scene, Map<string, RawTexture>>();

function getMaps(scene: Scene, kind: WorldTexKind): MapSet {
  let m = mapCache.get(scene);
  if (!m) { m = new Map(); mapCache.set(scene, m); }
  let maps = m.get(kind);
  if (!maps) { maps = GENERATORS[kind](SIZES[kind], SEEDS[kind]); m.set(kind, maps); }
  return maps;
}

/** Scene-scoped RawTexture with wrapping + trilinear mips. Cache-owned; dies with the scene. */
export function getWorldTexture(scene: Scene, kind: WorldTexKind, channel: "albedo" | "normal" | "gloss", uScale: number, vScale: number): RawTexture {
  let cache = texCache.get(scene);
  if (!cache) { cache = new Map(); texCache.set(scene, cache); }
  const key = `${kind}:${channel}:${uScale}x${vScale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const maps = getMaps(scene, kind);
  const data = channel === "albedo" ? maps.albedo : channel === "normal" ? maps.normal : maps.gloss ?? maps.albedo;
  const tex = new RawTexture(data, maps.size, maps.size, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  tex.name = key;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uScale;
  tex.vScale = vScale;
  cache.set(key, tex);
  return tex;
}

/** Fresh StandardMaterial wired to cached world textures. Caller owns/disposes it. */
export function texturedMaterial(
  scene: Scene, name: string, kind: WorldTexKind,
  o: { uScale: number; vScale: number; tint?: Color3; specular?: Color3; power?: number; emissive?: Color3; gloss?: boolean }
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = getWorldTexture(scene, kind, "albedo", o.uScale, o.vScale);
  m.bumpTexture = getWorldTexture(scene, kind, "normal", o.uScale, o.vScale);
  if (o.gloss) m.specularTexture = getWorldTexture(scene, kind, "gloss", o.uScale, o.vScale);
  m.diffuseColor = o.tint ?? Color3.White();
  m.specularColor = o.specular ?? new Color3(0.04, 0.04, 0.04);
  m.specularPower = o.power ?? 32;
  m.emissiveColor = o.emissive ?? Color3.Black();
  return m;
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/worldmaterials.test.ts && npm run typecheck` — Expected: PASS + clean

- [ ] **Step 5: Commit**

```bash
git add src/world/WorldMaterials.ts tests/worldmaterials.test.ts
git commit -m "WorldMaterials: scene-scoped RawTexture cache + texturedMaterial"
```

---

### Task 5: PostPipeline

**Files:** Create `src/engine/PostPipeline.ts` · Modify `src/engine/PerformanceGovernor.ts` (delete dead stub) · Test `tests/postpipeline.test.ts`

**Interfaces:**
- `interface PostConfig { fxaa: boolean; imageProcessing: boolean; toneMapping: boolean; vignette: boolean }`
- `postConfigForTier(tier: QualityTier, enabled: boolean): PostConfig`
- `class PostPipeline { constructor(scene, cfg); applyTier(tier): void; dispose(): void; readonly pipeline }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/postpipeline.test.ts
import { describe, test, expect } from "vitest";
import { postConfigForTier } from "../src/engine/PostPipeline";

describe("postConfigForTier", () => {
  test("disabled → everything off", () => {
    expect(postConfigForTier(0, false)).toEqual({ fxaa: false, imageProcessing: false, toneMapping: false, vignette: false });
  });
  test("tier 0/1 → fxaa + image processing", () => {
    for (const tier of [0, 1] as const) {
      const c = postConfigForTier(tier, true);
      expect(c.fxaa).toBe(true);
      expect(c.imageProcessing).toBe(true);
      expect(c.toneMapping).toBe(true);
      expect(c.vignette).toBe(true);
    }
  });
  test("tier 2/3 → fxaa only (perf-first)", () => {
    for (const tier of [2, 3] as const) {
      const c = postConfigForTier(tier, true);
      expect(c.fxaa).toBe(true);
      expect(c.imageProcessing).toBe(false);
      expect(c.toneMapping).toBe(false);
      expect(c.vignette).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/postpipeline.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/engine/PostPipeline.ts`**

```ts
import {
  BaseImageProcessingEffect,
  Color4,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  Scene,
} from "@babylonjs/core";
import type { QualityTier } from "./PerformanceGovernor";

export interface PostConfig {
  fxaa: boolean;
  imageProcessing: boolean;
  toneMapping: boolean;
  vignette: boolean;
}

/** Tier → post-processing config. Tier 2/3 (upscaled) keep only cheap FXAA. */
export function postConfigForTier(tier: QualityTier, enabled: boolean): PostConfig {
  if (!enabled) return { fxaa: false, imageProcessing: false, toneMapping: false, vignette: false };
  const full = tier <= 1;
  return { fxaa: true, imageProcessing: full, toneMapping: full, vignette: full };
}

/**
 * Per-scene post-processing: FXAA always (engine MSAA already on, but governor
 * tiers 2/3 render upscaled where FXAA recovers edges), mild image processing
 * at good tiers. One pipeline per scene; dispose() with the owner.
 */
export class PostPipeline {
  readonly pipeline: DefaultRenderingPipeline;
  private enabled: boolean;

  constructor(scene: Scene, cfg: PostConfig) {
    this.enabled = cfg.fxaa || cfg.imageProcessing;
    this.pipeline = new DefaultRenderingPipeline("postfx", true, scene, scene.cameras);
    this.pipeline.samples = 1; // MSAA handled by engine backbuffer; post chain stays cheap
    this.apply(cfg);
  }

  apply(cfg: PostConfig): void {
    const p = this.pipeline;
    const ip = p.imageProcessing;
    p.fxaaEnabled = cfg.fxaa;
    p.imageProcessingEnabled = cfg.imageProcessing;
    ip.contrast = 1.06;
    ip.exposure = 1.0;
    ip.toneMappingEnabled = cfg.toneMapping;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.vignetteEnabled = cfg.vignette;
    ip.vignetteWeight = 1.5;
    ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0, 0, 0, 0);
    ip.vignetteBlendMode = BaseImageProcessingEffect.VIGNETTEMODE_MULTIPLY;
  }

  /** runtime governor tier change — no-op safe when pipeline disabled */
  applyTier(tier: QualityTier): void {
    this.apply(postConfigForTier(tier, this.enabled));
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/postpipeline.test.ts && npm run typecheck` — Expected: PASS + clean

- [ ] **Step 5: Delete dead stub** — in `src/engine/PerformanceGovernor.ts` remove `configureSceneQuality` (lines ~116-120, zero callers) and drop `Scene` from its imports: `import type { AbstractEngine } from "@babylonjs/core";`

- [ ] **Step 6: Full unit suite** — `npm run typecheck && npm run test` — Expected: clean + green

- [ ] **Step 7: Commit**

```bash
git add src/engine/PostPipeline.ts src/engine/PerformanceGovernor.ts tests/postpipeline.test.ts
git commit -m "PostPipeline: DefaultRenderingPipeline wrapper + tier config (removes dead stub)"
```

---

### Task 6: BuildingFactory — textures, windows, roof/rubble fixes, tessellation

**Files:** Modify `src/world/BuildingFactory.ts`, `src/world/BuildingSystem.ts`

**Interfaces:**
- Consumes: `texturedMaterial` from `./WorldMaterials`.
- Produces: `BuiltBuilding` gains `meshes: Mesh[]` (all solid parts; `mesh` stays = walls mesh for compat) and `materials: StandardMaterial[]` (all factory-owned materials EXCEPT the scene-shared window material). `BuildingEntity` gains `meshes: Mesh[]`.

- [ ] **Step 1: Adapt BuildingSystem** (covered by typecheck + existing e2e siege suite)

In `src/world/BuildingSystem.ts`:
1. `BuildingEntity`: add `meshes: import("@babylonjs/core").Mesh[];`
2. `spawnFromLayout`: replace `this.shadows?.addShadowCaster(built.mesh); built.mesh.receiveShadows = true;` with `for (const m of built.meshes) { this.shadows?.addShadowCaster(m); m.receiveShadows = true; }` and add `meshes: built.meshes,` to the entity literal (keep `mesh: built.mesh`).
3. `collapse()`: replace `b.mesh.isVisible = false;` with `for (const m of b.meshes) m.isVisible = false;`
4. `disposeAll()`: replace `b.root.dispose(false, true); b.material.dispose();` with `b.root.dispose(false, true); for (const mat of b.materials) mat.dispose();`

- [ ] **Step 2: Rework BuildingFactory.create**

In `src/world/BuildingFactory.ts`:

1. Imports: add `import { texturedMaterial } from "./WorldMaterials";` and `Scene` from `@babylonjs/core` (for the window-material WeakMap).
2. `BuiltBuilding`: add `meshes: Mesh[]; materials: StandardMaterial[];`
3. Scene-scoped shared window material (module level):

```ts
const windowMats = new WeakMap<Scene, StandardMaterial>();
/** near-black window glass with a faint warm hearth glow — shared per scene (cache-owned) */
function windowMaterial(scene: Scene): StandardMaterial {
  let m = windowMats.get(scene);
  if (!m) {
    m = new StandardMaterial("worldWindowMat", scene);
    m.diffuseColor = new Color3(0.03, 0.03, 0.04);
    m.emissiveColor = new Color3(0.05, 0.035, 0.02);
    m.specularColor = new Color3(0.02, 0.02, 0.02);
    windowMats.set(scene, m);
  }
  return m;
}
```

4. Replace the material setup at the top of `create()` (the `const mat = new StandardMaterial(...)` … `mat.specularColor = ...` block) with:

```ts
const UV: Record<BuildingKind, { u: number; v: number }> = {
  house: { u: 2, v: 2 }, tower: { u: 4, v: 10 }, barracks: { u: 3, v: 2 },
  fort: { u: 5, v: 3 }, wall: { u: 8, v: 2 }, gate: { u: 4, v: 8 },
  keep: { u: 10, v: 10 }, grandTower: { u: 5, v: 12 },
};
const uv = UV[kind];
const mat = texturedMaterial(this.scene, `bmat-${kind}-${this.rng.int(0, 1e9)}`, "stone", {
  uScale: uv.u, vScale: uv.v, tint: c, gloss: true,
  specular: new Color3(0.06, 0.06, 0.06), power: 48,
});
```

(Move `UV` to module scope so it is allocated once.)

5. Window insets — declare `const winParts: Mesh[] = [];` beside `parts`/`roofParts`; add helper method:

```ts
private addWindow(list: Mesh[], x: number, y: number, z: number, rotY = 0, w = 0.55, h = 1.25): void {
  const win = MeshBuilder.CreateBox("b-win", { width: w, height: h, depth: 0.3 }, this.scene);
  win.position.set(x, y, z);
  win.rotation.y = rotY;
  list.push(win);
}
```

Emit per kind (`w`/`h`/`d` from spec.size; heights relative to building root):
- `tower`: 3 arrow slits — angles/heights `[[0, h*0.45], [2.1, h*0.62], [4.2, h*0.79]]` → `this.addWindow(winParts, Math.cos(a) * (w / 2), hy, Math.sin(a) * (w / 2), -a, 0.4, 1.1);`
- `grandTower`: 2 slits — `[[0.8, h*0.5], [3.9, h*0.75]]`, same call shape.
- `keep`: main block (`w*0.78` × `h*0.82` × `d*0.78`): 3 cols × 4 rows on `+Z` and `−Z` faces:
  `for (let r = 0; r < 4; r++) for (let cx = -1; cx <= 1; cx++) { this.addWindow(winParts, cx * w * 0.2, -h * 0.28 + r * h * 0.17, d * 0.39, 0, 0.8, 1.6); this.addWindow(winParts, cx * w * 0.2, -h * 0.28 + r * h * 0.17, -d * 0.39, 0, 0.8, 1.6); }`
- `gate`: one slit per tower: `for (const gx of [-w / 2 + 1.5, w / 2 - 1.5]) this.addWindow(winParts, gx, h * 0.55, d * 0.3, 0, 0.5, 1.4);`
- `house`: `this.addWindow(winParts, 0, 0.1, d / 2 + 0.05, 0, 0.5, 0.7);`

6. Tessellation bumps: `tower` body+top 8→12; `fort` corner towers 8→12; `keep` turrets+caps 8→12; `gate` towers 8→12; `grandTower` body+top 9→12.

7. Roof handling — REPLACE the `if (roofParts.length) {...}` cross-merge block (which overwrote the roof material — existing bug) with:

```ts
const solidMeshes: Mesh[] = [walls];
const materials: StandardMaterial[] = [mat];
if (roofParts.length) {
  const roofMat = texturedMaterial(this.scene, `rmat-${kind}-${this.rng.int(0, 1e6)}`, "roof", {
    uScale: Math.max(2, Math.round(uv.u * 1.5)), vScale: Math.max(2, Math.round(uv.v * 0.6)),
    tint: new Color3(0.32, 0.16, 0.1), specular: new Color3(0.03, 0.03, 0.03),
  });
  const roofs = Mesh.MergeMeshes(roofParts, true, true, undefined, false, false)!;
  roofs.material = roofMat;
  roofs.parent = root;
  roofs.isPickable = false;
  solidMeshes.push(roofs);
  materials.push(roofMat);
}
if (winParts.length) {
  const wins = Mesh.MergeMeshes(winParts, true, true, undefined, false, false)!;
  wins.material = windowMaterial(this.scene);
  wins.parent = root;
  wins.isPickable = false;
  solidMeshes.push(wins);
}
```

8. Rubble material — replace the `rubbleMat` block:

```ts
const rubbleMat = texturedMaterial(this.scene, `rubbleMat-${this.rng.int(0, 1e6)}`, "stone", {
  uScale: 1, vScale: 1, tint: c.scale(0.5), emissive: new Color3(0.02, 0.02, 0.02),
});
materials.push(rubbleMat);
```

9. Return: `{ root, mesh: walls, meshes: solidMeshes, rubble, size: spec.size, material: mat, materials }`.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run test && npx vitest run tests/siege.test.ts` — Expected: clean + green

- [ ] **Step 4: Visual smoke check** — `npm run dev`; Playwright browser → `http://localhost:5173/?test=1`; start a mission (read `e2e/gameplay.spec.ts` for the exact `window.__GAME` call); screenshot. Verify: stone courses on buildings/keep, roofs brown (not gray), windows read as dark slits, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/world/BuildingFactory.ts src/world/BuildingSystem.ts
git commit -m "Buildings: stone/roof textures, window insets, roof+rubble material fixes"
```

---

### Task 7: CastleBuilder textured materials

**Files:** Modify `src/world/CastleBuilder.ts:48-61` (constructor)

**Interfaces:** Consumes `texturedMaterial` from `./WorldMaterials`.

- [ ] **Step 1: Replace constructor materials** (keep field types/names — only the construction changes)

```ts
import { texturedMaterial } from "./WorldMaterials";
// ...
this.stoneMat = texturedMaterial(scene, "castleStone", "stone", { uScale: 40, vScale: 5, tint: new Color3(0.34, 0.33, 0.31), gloss: true, specular: new Color3(0.04, 0.04, 0.04), power: 40 });
this.darkStoneMat = texturedMaterial(scene, "castleDarkStone", "stone", { uScale: 6, vScale: 14, tint: new Color3(0.22, 0.22, 0.23), gloss: true, specular: new Color3(0.03, 0.03, 0.03), power: 40 });
this.woodMat = texturedMaterial(scene, "castleWood", "wood", { uScale: 2, vScale: 2, tint: new Color3(0.26, 0.17, 0.1), specular: new Color3(0.03, 0.02, 0.02) });
this.roofMat = texturedMaterial(scene, "castleRoof", "roof", { uScale: 8, vScale: 3, tint: new Color3(0.15, 0.13, 0.12), specular: new Color3(0.02, 0.02, 0.02) });
```

`stoneMat` primarily textures the 220m curtain walls (u40 ≈ 5.5m/tile). Do NOT restructure CastleBuilder beyond materials — spec keeps castle as texture-attach only.

- [ ] **Step 2: Verify + visual + commit** — `npm run typecheck && npm run test`; reload the blackstone mission — curtain wall shows courses.

```bash
git add src/world/CastleBuilder.ts
git commit -m "Castle: textured stone/wood/roof materials from WorldMaterials"
```

---

### Task 8: Terrain ground detail + tree/rock textures

**Files:** Modify `src/world/Terrain.ts:100-110`, `src/world/WorldBuilder.ts:144-197`

**Interfaces:** Consumes `getWorldTexture`, `texturedMaterial` from `./WorldMaterials`.

- [ ] **Step 1: Terrain material** — in `Terrain` constructor replace the `terrainMat` block:

```ts
import { getWorldTexture } from "./WorldMaterials";
// ...
const mat = new StandardMaterial("terrainMat", scene);
const detail = getWorldTexture(scene, "ground", "albedo", 200, 200);
detail.anisotropicFilteringLevel = 8;
mat.diffuseTexture = detail;
const bump = getWorldTexture(scene, "ground", "normal", 200, 200);
bump.anisotropicFilteringLevel = 4;
mat.bumpTexture = bump;
mat.diffuseColor = Color3.White();
mat.specularColor = Color3.Black();
```

(Vertex colors keep carrying `groundColor`/`groundAccent` — the detail texture multiplies with them.)

- [ ] **Step 2: Trees — split trunk/crown textures** in `WorldBuilder.buildProps` (trunk gets bark, crown keeps env tree color with foliage detail):

```ts
import { texturedMaterial } from "./WorldMaterials";
// inside the treeCount branch — replaces the merged trunk+crown template:
const trunkTpl = MeshBuilder.CreateCylinder("treeTrunk", { diameterTop: 0.28, diameterBottom: 0.5, height: 3.2, tessellation: 5 }, this.scene);
trunkTpl.material = texturedMaterial(this.scene, "treeTrunkMat", "bark", { uScale: 2, vScale: 3, tint: new Color3(0.29, 0.21, 0.13) });
const crownTpl = MeshBuilder.CreateCylinder("treeCrown", { diameterTop: 0, diameterBottom: 3.6, height: 5.4, tessellation: 6 }, this.scene);
crownTpl.material = texturedMaterial(this.scene, "treeCrownMat", "ground", { uScale: 3, vScale: 3, tint: tc, emissive: tc.scale(0.08) });
for (const t of [trunkTpl, crownTpl]) { t.isVisible = false; t.isPickable = false; }
const count = env.treeCount!;
for (let i = 0; i < count; i++) {
  const a = rng.range(0, Math.PI * 2);
  const r = rng.range(120, 680);
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const y = terrain.heightAt(x, z) - 0.2;
  const rotY = rng.range(0, Math.PI * 2);
  const s = rng.range(0.7, 1.6);
  const trunkInst = trunkTpl.createInstance(`treeT${i}`);
  trunkInst.position.set(x, y, z);
  const crownInst = crownTpl.createInstance(`treeC${i}`);
  crownInst.position.set(x, y + 3.8 * s, z); // template crown offset scaled (template local y offset is 0 here)
  for (const inst of [trunkInst, crownInst]) {
    inst.rotation.y = rotY;
    inst.scaling.setAll(s);
    inst.isPickable = false;
    inst.freezeWorldMatrix();
  }
}
```

NOTE: remove `crown.position.y = 3.8` from the template (the instance positions the crown explicitly). If trees look wrong, verify crown height `y + 3.8 * s` visually.

- [ ] **Step 3: Rocks** — replace the `rockMat` block:

```ts
const mat = texturedMaterial(this.scene, "rockMat", "rock", { uScale: 2, vScale: 2, tint: rc, emissive: rc.scale(0.1) });
```

- [ ] **Step 4: Verify + visual + commit** — `npm run typecheck && npm run test`; riverlands mission: ground shows grain up close without shimmering at distance, trees have brown trunks + green crowns, rocks show cracks.

```bash
git add src/world/Terrain.ts src/world/WorldBuilder.ts
git commit -m "Terrain ground detail + tree bark/crown + rock textures"
```

---

### Task 9: SoldierFactory textures

**Files:** Modify `src/world/SoldierFactory.ts`

**Interfaces:** Consumes `texturedMaterial` from `./WorldMaterials`.

- [ ] **Step 1: Apply textures** (all other code unchanged — per-soldier clones keep tints):

```ts
import { texturedMaterial } from "./WorldMaterials";
// constructor:
this.bodyMat = texturedMaterial(scene, "soldierBody", "cloth", { uScale: 2, vScale: 2, specular: new Color3(0.08, 0.08, 0.08) });
// (burningMat / deadMat stay flat — they are state visuals)
this.metalMat = texturedMaterial(scene, "soldierMetal", "metal", { uScale: 2, vScale: 2, tint: new Color3(0.55, 0.55, 0.6), specular: new Color3(0.7, 0.7, 0.75), power: 64 });
// createBallista():
const woodMat = texturedMaterial(this.scene, `ballistaWood-${def.id}`, "wood", { uScale: 2, vScale: 2, tint: Color3.FromHexString(def.color), emissive: new Color3(0.08, 0.06, 0.02) });
const railMat = texturedMaterial(this.scene, `ballistaRail-${def.id}`, "metal", { uScale: 2, vScale: 2, tint: new Color3(0.4, 0.38, 0.36), specular: new Color3(0.5, 0.5, 0.5) });
// createRiderFigure():
const leather = texturedMaterial(this.scene, "gLeather", "leather", { uScale: 3, vScale: 3, tint: new Color3(0.24, 0.15, 0.1), specular: new Color3(0.09, 0.07, 0.06) });
const metal = texturedMaterial(this.scene, "gMetal", "metal", { uScale: 3, vScale: 3, tint: new Color3(0.55, 0.56, 0.62), specular: new Color3(0.85, 0.86, 0.92), power: 96 });
const cloth = texturedMaterial(this.scene, "gCloth", "cloth", { uScale: 3, vScale: 3, tint: c, emissive: c.scale(0.12), specular: new Color3(0.04, 0.04, 0.04) });
const bladeMat = texturedMaterial(this.scene, "bladeMat", "metal", { uScale: 3, vScale: 3, tint: new Color3(0.8, 0.8, 0.86), specular: new Color3(0.9, 0.9, 1), power: 96 });
const shieldMat = texturedMaterial(this.scene, "shieldMat", "wood", { uScale: 2, vScale: 2, tint: c.scale(0.6), emissive: c.scale(0.1) });
```

hairMat / skinMat / patch / gold stay flat (small surfaces — avoid noise read). The rider figure creates fresh materials per call (existing behavior — GameApp/MissionScene construct one rider); soldiers keep cloning `bodyMat`.

- [ ] **Step 2: Verify + commit** — `npm run typecheck && npm run test`; visual: ground-phase screenshot — rider armor reads as leather/metal, ballista wood grain visible.

```bash
git add src/world/SoldierFactory.ts
git commit -m "Soldiers/ballista/rider: cloth/leather/metal/wood textures"
```

---

### Task 10: Wire PostPipeline into scenes + GameApp

**Files:** Modify `src/mission/MissionScene.ts`, `src/scenes/MenuShowcase.ts`, `src/app/GameApp.ts`

**Interfaces:**
- Consumes: `PostPipeline`, `postConfigForTier` from `./PostPipeline` (or `../engine/PostPipeline`); `QualityTier` type.
- Produces: `MissionSceneDeps.postFX?: boolean` (default true); `MissionScene.postPipeline: PostPipeline`; `MenuShowcase(engine, canvas, opts?: { postFX?: boolean })`.

- [ ] **Step 1: MissionScene**

1. `MissionSceneDeps`: add `postFX?: boolean;`
2. Import `PostPipeline, postConfigForTier` + add member `readonly postPipeline: PostPipeline;`
3. In constructor AFTER `this.glow = ...` (cameras exist by then):
   `this.postPipeline = new PostPipeline(this.scene, postConfigForTier(1, d.postFX !== false));`
4. In `dispose()`: add `this.postPipeline.dispose();` before `this.scene.dispose();`

- [ ] **Step 2: MenuShowcase**

1. Constructor: `constructor(private engine: AbstractEngine, canvas: HTMLCanvasElement, opts: { postFX?: boolean } = {})` — at the END of the constructor (after camera creation): `this.post = new PostPipeline(this.scene, postConfigForTier(0, opts.postFX !== false));` with a `private post: PostPipeline` member.
2. `dispose()`: `this.post.dispose(); this.scene.dispose();`

- [ ] **Step 3: GameApp**

1. `loadMission` — add to the `MissionScene` deps: `postFX: !this.opts.testMode || this.opts.benchmark,`
2. After `this.mission = mission;`: `mission.postPipeline.applyTier(this.governor.tier);`
3. `openShowcase()`: `this.showcase = new MenuShowcase(this.engine, this.canvas, { postFX: !this.opts.testMode });`
4. Tier-change watcher — in `frame()` immediately after `this.governor.update(frameMs);`:

```ts
if (this.governor.tier !== this.appliedTier) {
  this.appliedTier = this.governor.tier;
  this.mission?.postPipeline.applyTier(this.governor.tier);
}
```

5. Member: `private appliedTier: number = -1;`

- [ ] **Step 4: Verify + commit** — `npm run typecheck && npm run test` — Expected: clean + green

```bash
git add src/mission/MissionScene.ts src/scenes/MenuShowcase.ts src/app/GameApp.ts
git commit -m "Wire PostPipeline into missions + menu, governor tier watcher"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suites** — `npm run typecheck && npm run test && npm run test:e2e` — Expected: all green
- [ ] **Step 2: Benchmark comparison** (dev server running):

```bash
npm run benchmark -- mission=riverlands seconds=25 2>&1 | tee /tmp/bench-after-riverlands.txt
npm run benchmark -- mission=blackstone seconds=25 2>&1 | tee /tmp/bench-after-blackstone.txt
```

Compare `averageFps`/`p5Fps` to the Task 1 baselines. Budget: avg fps regression ≤ 5%. If exceeded: check governor tier reached during run; likely fixes = reduce ground anisotropy 8→4, drop stone to 256, or gate normal maps off at tier 2/3 (extend `postConfigForTier` pattern to materials is NOT in scope — prefer texture-size/anisotropy tweaks).

- [ ] **Step 3: Visual QA via Playwright** (`?test=1`, start each mission type):
  - riverlands: ground grain near/far, trees (brown trunk/green crown), rocks, village houses (stone + brown roof + windows)
  - blackstone: curtain wall courses, keep windows grid, gatehouse slits, rubble after collapse (use `api.testCollapseNearestBuilding()`), damaged-building fire tint still reads
  - menu showcase: dragon + FXAA/vignette present, no visual artifacts
  - ground phase: rider leather/metal/cloth, soldiers at distance, ballista wood
  - console: zero errors (assertMaterialsInScene-style violations would throw)
- [ ] **Step 4: Cleanup** — remove any QA screenshots from the repo root (`git status` — untracked `*.png` stays uncommitted)
- [ ] **Step 5: Final commit** (if any tweaks were made during verification — tuning values, anisotropy, etc.)

```bash
git add -A src/ docs/
git commit -m "Graphics pass: verification tuning"
```

## Self-Review Notes (for executor)

- Spec coverage: textures (Tasks 2-4, 6-9), windows/geometry (Task 6), castle (7), terrain/trees/rocks (8), units (9), post-processing + governor (5, 10), tests/benchmark (1, 11), spec deviations documented above.
- The roof-material dead-merge fix (Task 6 step 2.7) changes roof VISUAL color from gray→brown for the first time — this is the spec's intent (roof texture), not a regression.
- If `RawTexture` under `NullEngine` fails (Task 4), take the documented `textureKey` fallback path — do not redesign.
