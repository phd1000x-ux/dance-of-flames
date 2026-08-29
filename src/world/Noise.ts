/** Shared deterministic 2D noise (moved from DragonMaterials — byte-identical math). */

/** deterministic 2D value noise for low-frequency mottling */
export function valueNoise(x: number, y: number, seed: number): number {
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
export function fbm(x: number, y: number, seed: number, octaves = 3): number {
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

export function hash01(n: number): number {
  let x = n >>> 0;
  x = (x ^ (x >>> 16)) * 2246822519;
  x = (x ^ (x >>> 13)) * 3266489917;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}
