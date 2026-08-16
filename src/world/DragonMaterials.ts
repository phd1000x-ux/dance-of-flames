import {
  Color3,
  DynamicTexture,
  Scene,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";
import type { DragonDefinition } from "../data/dragons";
import { SeededRng } from "../core/SeededRng";

/**
 * Procedural dragon material stack (per-dragon identity, no external assets).
 *
 * Anti-plastic principles baked into every layer:
 *  - PER-SCALE identity: each scale cell carries its own brightness/hue/gloss
 *    offset (cell hash) — organic mottling instead of one flat color
 *  - RIM AMBIENT OCCLUSION: the outer rim of every scale darkens hard
 *    (overlapping-plate depth) instead of a smooth dome gradient
 *  - TWO-FREQUENCY NORMALS: macro scale slopes + per-pixel micro grain
 *    (keratin pores) break light interpolation — no mirror-smooth areas
 *  - TIGHT DIM SPECULAR: high specularPower (narrow highlight like polished
 *    horn/keratin) at LOW intensity with per-scale gloss variation — the
 *    broad even sheen that reads as "plastic" is gone
 *  - low-frequency grime mottling + soot over everything
 */

interface HeightResult {
  data: Float32Array;
  /** per-pixel deterministic scale-cell hash (scales only; null for veins) */
  cells: Int32Array | null;
  size: number;
}

/** deterministic 2D value noise for low-frequency mottling */
function valueNoise(x: number, y: number, seed: number): number {
  const h = (ix: number, iy: number) => {
    let n = (ix * 374761393 + iy * 668265263 + seed * 1442695040) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967295;
  };
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** tiny fbm of the value noise */
function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let v = 0;
  let amp = 0.55;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    v += valueNoise(x * f, y * f, seed + o * 97) * amp;
    amp *= 0.45;
    f *= 2.2;
  }
  return v;
}

function drawScaleHeight(size: number, rng: SeededRng, opts: { cols: number; elongate: number; jitter: number }): HeightResult {
  const h = new Float32Array(size * size);
  const cells = new Int32Array(size * size).fill(-1);
  const cell = size / opts.cols;
  for (let row = 0; row < opts.cols + 1; row++) {
    const offset = row % 2 === 0 ? 0 : cell * 0.5;
    for (let col = 0; col < opts.cols + 1; col++) {
      const jx = rng.range(-opts.jitter, opts.jitter);
      const jy = rng.range(-opts.jitter, opts.jitter);
      const cx = col * cell + offset + jx * cell;
      const cy = row * cell * (1 / Math.max(0.35, opts.elongate)) + jy * cell;
      const rx = cell * rng.range(0.42, 0.55);
      const ry = rx * opts.elongate;
      // per-cell deterministic identity hash (drives albedo/gloss mottling)
      const cellHash = ((row * 73856093) ^ (col * 19349663) ^ (Math.floor(jx * 1024) * 83492791)) >>> 0;
      const x0 = Math.max(0, Math.floor(cx - rx * 1.6));
      const x1 = Math.min(size - 1, Math.ceil(cx + rx * 1.6));
      const y0 = Math.max(0, Math.floor(cy - ry * 1.6));
      const y1 = Math.min(size - 1, Math.ceil(cy + ry * 1.6));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1.25) {
            // flat-topped plate with a steep falloff rim (reads as an overlapping
            // horny plate, not a smooth dome)
            const dome = d < 0.62 ? 1 - (d / 0.62) * 0.18 : Math.max(0, 1 - 0.18 - ((d - 0.62) / 0.63) * 0.95);
            const i = y * size + x;
            if (dome > h[i]) {
              h[i] = dome;
              cells[i] = cellHash;
            }
          }
        }
      }
    }
  }
  return { data: h, cells, size };
}

function drawVeinHeight(size: number, rng: SeededRng): HeightResult {
  const h = new Float32Array(size * size);
  const branches = 9;
  for (let b = 0; b < branches; b++) {
    let x = 0;
    let y = (b / branches) * size + rng.range(-6, 6);
    let angle = rng.range(-0.12, 0.12) + (b / branches - 0.5) * 0.25;
    const thick = 2.2 + rng.range(0, 1.6);
    while (x < size) {
      const steps = 4 + rng.int(0, 3);
      for (let s = 0; s < steps && x < size; s++) {
        x += 1.6;
        y += Math.sin(angle) * 1.6;
        angle += rng.range(-0.05, 0.05);
        for (let oy = -3; oy <= 3; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const px = Math.round(x + ox);
            const py = Math.round(y + oy) % size;
            if (px < 0 || px >= size || py < 0 || py >= size) continue;
            const dd = Math.sqrt(ox * ox + oy * oy);
            if (dd <= thick) {
              const i = py * size + px;
              h[i] = Math.max(h[i], 1 - dd / (thick + 0.8));
            }
          }
        }
      }
      if (rng.chance(0.4) && x < size * 0.7) {
        angle += rng.sign() * rng.range(0.25, 0.5);
      }
    }
  }
  return { data: h, cells: null, size };
}

/**
 * Normal map with TWO frequencies: macro scale/vein slopes + per-pixel micro
 * grain. The grain is what kills the plastic look — it breaks specular
 * interpolation everywhere, like keratin pores on real scale.
 */
function heightToNormalTexture(scene: Scene, name: string, h: HeightResult, strength = 2.2, grain = 0.55): DynamicTexture {
  const { data, size } = h;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => data[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // micro grain (deterministic per pixel): high-frequency normal jitter
      const gx = (valueNoise(x * 1.7, y * 1.7, 1234) - 0.5) * 2 * grain;
      const gy = (valueNoise(x * 1.7, y * 1.7, 5678) - 0.5) * 2 * grain;
      let nx = -(dx + gx);
      let ny = -(dy + gy);
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      img.data[i] = Math.floor((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.floor((nz / len + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  return dt;
}

function hash01(n: number): number {
  let x = n >>> 0;
  x = (x ^ (x >>> 16)) * 2246822519;
  x = (x ^ (x >>> 13)) * 3266489917;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function variationAlbedo(
  scene: Scene,
  name: string,
  base: Color3,
  accent: Color3,
  h: HeightResult,
  rng: SeededRng,
  opts: { crevice: number; edge: number; soot: number; rimAO: number; cellVar: number }
): DynamicTexture {
  const { data, cells, size } = h;
  const seed = rng.next() * 10000;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const height = data[i];
      // per-scale identity mottling
      let cellTint = 0;
      let cellWarm = 0;
      if (cells && cells[i] >= 0) {
        cellTint = (hash01(cells[i]) - 0.5) * 2 * opts.cellVar; // ±brightness
        cellWarm = (hash01(cells[i] ^ 0x9e37) - 0.5) * 2 * 0.5; // toward accent
      }
      // scale shading: crevice dark, plate top bright — plus a HARD rim AO band
      let shade = 1 - opts.crevice * (1 - height) + opts.edge * height;
      if (height > 0.12 && height < 0.5) shade *= 1 - opts.rimAO * (1 - Math.abs(height - 0.31) * 2 / 0.19);
      // low-frequency grime mottling (fbm)
      const mottle = (fbm(x / (size / 7), y / (size / 7), seed) - 0.5) * 0.22;
      // micro grain
      const grain = (valueNoise(x * 2.3, y * 2.3, 777) - 0.5) * 0.08;
      // patchy soot
      let sootK = 1;
      if (rng.next() < 0.05) sootK = 1 - opts.soot;
      else if (rng.next() > 0.96) sootK = 1.08;

      const k = (shade + mottle + grain + cellTint) * sootK;
      let r = base.r * k + accent.r * cellWarm * 0.12;
      let g = base.g * k + accent.g * cellWarm * 0.12;
      let b = base.b * k + accent.b * cellWarm * 0.12;
      const o = i * 4;
      img.data[o] = Math.floor(Math.max(0, Math.min(1, r)) * 255);
      img.data[o + 1] = Math.floor(Math.max(0, Math.min(1, g)) * 255);
      img.data[o + 2] = Math.floor(Math.max(0, Math.min(1, b)) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  return dt;
}

/**
 * Specular modulation texture (brightness = gloss strength):
 * per-scale gloss variation, matte crevices, grime breaking up any even sheen.
 */
function glossTexture(scene: Scene, name: string, h: HeightResult, baseGloss: number, rng: SeededRng): DynamicTexture {
  const { data, cells, size } = h;
  const seed = rng.next() * 10000;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const height = data[i];
      // some scales are noticeably glossier (fresh keratin), most are matte
      let g = baseGloss * (0.72 + height * 0.4);
      if (cells && cells[i] >= 0) g *= 0.7 + hash01(cells[i] ^ 0x51f1) * 0.75;
      // grime reduces gloss in blotches
      g *= 0.65 + fbm(x / (size / 5), y / (size / 5), seed) * 0.7;
      const v = Math.max(0.04, Math.min(1, g));
      const o = i * 4;
      img.data[o] = Math.floor(v * 255);
      img.data[o + 1] = Math.floor(v * 255);
      img.data[o + 2] = Math.floor(v * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  dt.update();
  return dt;
}

export interface DragonMaterialSet {
  body: StandardMaterial; // torso/neck/tail: large armored scales
  head: StandardMaterial; // fine dense scales
  wing: StandardMaterial; // leathery membrane with veins
  accent: StandardMaterial; // horns/claws: smooth harder surface
  jaw: StandardMaterial; // mouth-side: heat-reactive emissive
  /** base specular colors (applyDamageTint scales from these, never overwrites) */
  baseSpec: Record<string, Color3>;
  dispose(): void;
}

/**
 * SCENE-SCOPED material cache.
 *
 * Root cause of the invisible-dragon bug: this cache was module-level and keyed
 * by dragon id only, while the menu showcase and each mission are SEPARATE
 * Babylon scenes with independent lifecycles. Starting a mission disposes the
 * showcase scene — releasing the cached textures' GPU resources — and the new
 * mission's rig then received the poisoned set (mesh.isVisible true, alpha 1,
 * but dead textures → body rendered invisible while the rider, whose materials
 * are built per-rig, stayed visible).
 *
 * Keying by scene makes cross-scene reuse impossible; a scene's set dies with
 * that scene and is rebuilt on demand (a few ms inside the loading screen).
 */
const sceneCache = new WeakMap<Scene, Map<string, DragonMaterialSet>>();

export function buildDragonMaterials(scene: Scene, def: DragonDefinition): DragonMaterialSet {
  let cache = sceneCache.get(scene);
  if (!cache) {
    cache = new Map<string, DragonMaterialSet>();
    sceneCache.set(scene, cache);
  }
  const cached = cache.get(def.id);
  if (cached) return cached;

  const rng = new SeededRng(def.id.length * 7919 + def.maxHealth);
  const body = Color3.FromHexString(def.bodyColor);
  const wing = Color3.FromHexString(def.wingColor);
  const accent = Color3.FromHexString(def.accentColor);

  // high-priority camera subjects (back view fills the frame) get 2× detail
  const SZ_BIG = 512;
  const SZ = 256;

  // ---- heights per body zone ----
  const hTorso = drawScaleHeight(SZ_BIG, rng, { cols: 9, elongate: 1.25, jitter: 0.3 });
  const hHead = drawScaleHeight(SZ_BIG, rng, { cols: 20, elongate: 0.85, jitter: 0.25 });
  const hTail = drawScaleHeight(SZ, rng, { cols: 8, elongate: 1.9, jitter: 0.35 });
  const hWing = drawVeinHeight(SZ, rng);

  const mkMat = (
    name: string,
    base: Color3,
    h: HeightResult,
    hBump: HeightResult,
    o: {
      bumpStrength: number; grain: number; crevice: number; edge: number; soot: number;
      rimAO: number; cellVar: number; gloss: number; spec: Color3; power: number; uScale: number;
    }
  ): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    const albedo = variationAlbedo(scene, `${name}-alb`, base, accent, h, rng, {
      crevice: o.crevice,
      edge: o.edge,
      soot: o.soot,
      rimAO: o.rimAO,
      cellVar: o.cellVar,
    });
    albedo.uScale = o.uScale;
    albedo.vScale = o.uScale;
    m.diffuseTexture = albedo;
    const norm = heightToNormalTexture(scene, `${name}-nrm`, hBump, o.bumpStrength, o.grain);
    norm.uScale = o.uScale;
    norm.vScale = o.uScale;
    m.bumpTexture = norm;
    const gloss = glossTexture(scene, `${name}-gls`, h, o.gloss, rng);
    gloss.uScale = o.uScale;
    gloss.vScale = o.uScale;
    m.specularTexture = gloss;
    // TIGHT highlight (high power) at LOW intensity: keratin, not plastic
    m.specularColor = o.spec;
    m.specularPower = o.power;
    m.emissiveColor = base.scale(0.02);
    return m;
  };

  const bodySpec = new Color3(0.085, 0.08, 0.075);
  const headSpec = new Color3(0.1, 0.09, 0.085);
  const wingSpec = new Color3(0.045, 0.04, 0.04);
  const accentSpec = new Color3(0.16, 0.15, 0.135);
  const jawSpec = new Color3(0.1, 0.08, 0.06);

  const set: DragonMaterialSet = {
    // armored torso: big plates, hard rim shadows, mostly matte with sparse gloss
    body: mkMat(`dm-${def.id}-body`, body, hTorso, hTorso, {
      bumpStrength: 2.6, grain: 0.5, crevice: 0.42, edge: 0.22, soot: 0.32,
      rimAO: 0.5, cellVar: 0.16, gloss: 0.34, spec: bodySpec, power: 190, uScale: 2.5,
    }),
    // head: fine dense scales, slightly oilier
    head: mkMat(`dm-${def.id}-head`, body, hHead, hHead, {
      bumpStrength: 2.2, grain: 0.55, crevice: 0.34, edge: 0.26, soot: 0.36,
      rimAO: 0.42, cellVar: 0.13, gloss: 0.42, spec: headSpec, power: 170, uScale: 2,
    }),
    // wing membrane: leathery — veins + grain, dim broad-ish sheen suppressed by grime
    wing: mkMat(`dm-${def.id}-wing`, wing, hWing, hWing, {
      bumpStrength: 1.7, grain: 0.6, crevice: 0.5, edge: 0.12, soot: 0.24,
      rimAO: 0.25, cellVar: 0.1, gloss: 0.18, spec: wingSpec, power: 90, uScale: 1.5,
    }),
    // horns/claws: the ONE legitimately smooth-ish surface (bone/horn)
    accent: mkMat(`dm-${def.id}-accent`, accent, hTorso, hTail, {
      bumpStrength: 0.55, grain: 0.35, crevice: 0.16, edge: 0.14, soot: 0.2,
      rimAO: 0.2, cellVar: 0.08, gloss: 0.62, spec: accentSpec, power: 240, uScale: 1.5,
    }),
    // jaw sides: heat-discolored, rough
    jaw: mkMat(`dm-${def.id}-jaw`, accent, hHead, hHead, {
      bumpStrength: 1.3, grain: 0.6, crevice: 0.26, edge: 0.18, soot: 0.45,
      rimAO: 0.4, cellVar: 0.14, gloss: 0.3, spec: jawSpec, power: 150, uScale: 1.5,
    }),
    baseSpec: {
      body: bodySpec.clone(),
      head: headSpec.clone(),
      wing: wingSpec.clone(),
      accent: accentSpec.clone(),
      jaw: jawSpec.clone(),
    },
    dispose() {
      set.body.dispose();
      set.head.dispose();
      set.wing.dispose();
      set.accent.dispose();
      set.jaw.dispose();
      cache?.delete(def.id);
    },
  };

  cache.set(def.id, set);
  return set;
}
/** heat glow animation for the jaw when breathing fire */
export function animateJawHeat(mat: StandardMaterial, jawOpen: number, fireColor: string): void {
  const c = Color3.FromHexString(fireColor);
  const glow = jawOpen * 0.85;
  mat.emissiveColor = new Color3(c.r * glow, c.g * glow * 0.8, c.b * glow * 0.6);
}

/** subtle damage state: soot-darkened specular as HP drops (scales from base, never overwrites) */
export function applyDamageTint(mats: DragonMaterialSet, hpFraction: number): void {
  const t = Math.max(0, Math.min(1, 1 - hpFraction)); // 0 clean → 1 near death
  const k = 1 - t * 0.45;
  const parts: [StandardMaterial, string][] = [
    [mats.body, "body"],
    [mats.head, "head"],
  ];
  for (const [m, key] of parts) {
    const b = mats.baseSpec[key];
    m.specularColor = new Color3(b.r * k, b.g * k, b.b * k);
  }
}

/**
 * Defensive invariant check: every dragon material must belong to the scene the
 * rig renders in. Cross-scene reuse was the invisible-dragon root cause; this
 * fails loudly instead of silently rendering dead textures if it ever recurs.
 */
export function assertMaterialsInScene(set: DragonMaterialSet, scene: Scene): void {
  for (const m of [set.body, set.head, set.wing, set.accent, set.jaw]) {
    if (m.getScene() !== scene) {
      throw new Error(
        `[dragon-materials] material ${m.name} belongs to a disposed/foreign scene — refusing to render (invisible-dragon guard)`
      );
    }
    if (m.alpha !== 1) {
      m.alpha = 1; // opaque invariant; runtime effects must not leave transparency behind
    }
  }
}

export type { Texture };
