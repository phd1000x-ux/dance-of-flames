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
      // ids are stored through Int32Array: sign-bit-set ids coerce negative, so compare against the -1 sentinel instead of >= 0.
      const stone = id !== -1;
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
      // see stoneMaps: Int32Array storage makes sign-bit ids negative — compare against the -1 sentinel.
      const slate = id !== -1;
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
