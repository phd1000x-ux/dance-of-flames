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
 * Procedural dragon material stack (per-dragon identity, no external assets):
 *  - scale/vein normal maps (height → sobel → tangent-space normals)
 *  - albedo variation (crevice darkening, bright scale edges, soot, scars)
 *  - specular (roughness inverse) variation per part
 * Parts get distinct scale characters: fine head, medium neck, armored torso,
 * leathery wings, elongated tail.
 */

interface HeightResult {
  data: Float32Array;
  size: number;
}

function drawScaleHeight(size: number, rng: SeededRng, opts: { cols: number; elongate: number; jitter: number }): HeightResult {
  const h = new Float32Array(size * size);
  const cell = size / opts.cols;
  for (let row = 0; row < opts.cols + 1; row++) {
    const offset = row % 2 === 0 ? 0 : cell * 0.5;
    for (let col = 0; col < opts.cols + 1; col++) {
      const cx = col * cell + offset + rng.range(-opts.jitter, opts.jitter) * cell;
      const cy = row * cell * (1 / Math.max(0.35, opts.elongate)) + rng.range(-opts.jitter, opts.jitter) * cell;
      const rx = cell * rng.range(0.42, 0.55);
      const ry = rx * opts.elongate;
      // stamp a rounded scale dome: height falls off from center
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
            const dome = Math.max(0, 1 - d * d * 0.8);
            const i = y * size + x;
            h[i] = Math.max(h[i], dome);
          }
        }
      }
    }
  }
  return { data: h, size };
}

function drawVeinHeight(size: number, rng: SeededRng): HeightResult {
  const h = new Float32Array(size * size);
  // branching wing-vein network from the left edge
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
      // child branch
      if (rng.chance(0.4) && x < size * 0.7) {
        const saveAngle = angle;
        angle += rng.sign() * rng.range(0.25, 0.5);
      }
    }
  }
  return { data: h, size };
}

function heightToNormalTexture(scene: Scene, name: string, h: HeightResult, strength = 2.2): DynamicTexture {
  const { data, size } = h;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => data[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // tangent-space normal
      let nx = -dx;
      let ny = -dy;
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

function variationAlbedo(
  scene: Scene,
  name: string,
  base: Color3,
  h: HeightResult,
  rng: SeededRng,
  opts: { crevice: number; edge: number; soot: number }
): DynamicTexture {
  const { data, size } = h;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const height = data[i];
      // crevices darker, scale tops brighter
      let r = base.r * (1 - opts.crevice * (1 - height) + opts.edge * height);
      let g = base.g * (1 - opts.crevice * (1 - height) + opts.edge * height);
      let b = base.b * (1 - opts.crevice * (1 - height) + opts.edge * height);
      // patchy soot + organic breakup
      const n = rng.next();
      if (n < 0.06) {
        r *= 1 - opts.soot;
        g *= 1 - opts.soot;
        b *= 1 - opts.soot * 0.8;
      } else if (n > 0.94) {
        r = Math.min(1, r * 1.12);
        g = Math.min(1, g * 1.1);
        b = Math.min(1, b * 1.08);
      }
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

function roughnessTexture(scene: Scene, name: string, h: HeightResult, baseRough: number): DynamicTexture {
  const { data, size } = h;
  const dt = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // scale tops slightly glossier, crevices rougher
    const v = Math.max(0, Math.min(1, baseRough - data[i] * 0.22));
    const o = i * 4;
    img.data[o] = Math.floor(v * 255);
    img.data[o + 1] = Math.floor(v * 255);
    img.data[o + 2] = Math.floor(v * 255);
    img.data[o + 3] = 255;
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
  const SZ = 256;

  // ---- heights per body zone ----
  const hTorso = drawScaleHeight(SZ, rng, { cols: 9, elongate: 1.25, jitter: 0.3 });
  const hHead = drawScaleHeight(SZ, rng, { cols: 20, elongate: 0.85, jitter: 0.25 });
  const hTail = drawScaleHeight(SZ, rng, { cols: 8, elongate: 1.9, jitter: 0.35 });
  const hWing = drawVeinHeight(SZ, rng);

  const mkMat = (
    name: string,
    base: Color3,
    h: HeightResult,
    o: { bumpStrength: number; crevice: number; edge: number; soot: number; rough: number; spec: Color3; uScale: number }
  ): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    const albedo = variationAlbedo(scene, `${name}-alb`, base, h, rng, {
      crevice: o.crevice,
      edge: o.edge,
      soot: o.soot,
    });
    albedo.uScale = o.uScale;
    albedo.vScale = o.uScale;
    m.diffuseTexture = albedo;
    const norm = heightToNormalTexture(scene, `${name}-nrm`, h, o.bumpStrength);
    norm.uScale = o.uScale;
    norm.vScale = o.uScale;
    m.bumpTexture = norm;
    const rough = roughnessTexture(scene, `${name}-rgh`, h, o.rough);
    rough.uScale = o.uScale;
    rough.vScale = o.uScale;
    m.specularTexture = rough;
    m.specularColor = o.spec;
    m.specularPower = 48;
    m.emissiveColor = base.scale(0.06);
    return m;
  };

  const set: DragonMaterialSet = {
    body: mkMat(`dm-${def.id}-body`, body, hTorso, {
      bumpStrength: 2.4, crevice: 0.34, edge: 0.2, soot: 0.3, spec: new Color3(0.16, 0.15, 0.14), uScale: 2.5, rough: 0.62,
    }),
    head: mkMat(`dm-${def.id}-head`, body, hHead, {
      bumpStrength: 2.0, crevice: 0.26, edge: 0.24, soot: 0.34, spec: new Color3(0.2, 0.18, 0.16), uScale: 2, rough: 0.55,
    }),
    wing: mkMat(`dm-${def.id}-wing`, wing, hWing, {
      bumpStrength: 1.5, crevice: 0.4, edge: 0.12, soot: 0.22, spec: new Color3(0.08, 0.07, 0.07), uScale: 1.5, rough: 0.78,
    }),
    accent: mkMat(`dm-${def.id}-accent`, accent, hTorso, {
      bumpStrength: 0.5, crevice: 0.12, edge: 0.14, soot: 0.18, spec: new Color3(0.35, 0.33, 0.3), uScale: 1.5, rough: 0.3,
    }),
    jaw: mkMat(`dm-${def.id}-jaw`, accent, hHead, {
      bumpStrength: 1.2, crevice: 0.2, edge: 0.18, soot: 0.4, spec: new Color3(0.2, 0.16, 0.12), uScale: 1.5, rough: 0.5,
    }),
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

/** subtle damage state: darken + warm tint as HP drops */
export function applyDamageTint(mats: DragonMaterialSet, hpFraction: number): void {
  const t = Math.max(0, Math.min(1, 1 - hpFraction)); // 0 clean → 1 near death
  const dark = 1 - t * 0.28;
  for (const m of [mats.body, mats.head]) {
    const tex = m.diffuseTexture as DynamicTexture;
    void tex;
    // cheap approximation: modulate emissive + specular soot feel
    m.specularColor = new Color3(0.16 * dark, 0.15 * dark, 0.14 * dark);
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
