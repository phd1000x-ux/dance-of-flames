import { Color3, DynamicTexture, Matrix, Mesh, Quaternion, Scene, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import { SeededRng } from "../core/SeededRng";
import type { Terrain } from "./Terrain";

/**
 * Low grass/scrub tufts scattered over the battlefield so low passes read as
 * ground with texture rather than a flat painted plane. Pure decoration:
 * thin instances (one draw call), non-pickable, and an RNG of its own so the
 * mission's deterministic layout (buildings, squads, E2E positions) is untouched.
 */
export function scatterGroundTufts(
  scene: Scene,
  terrain: Terrain,
  opts: { seed: number; groundColor: string; accentColor: string; count: number; waterLevel?: number }
): Mesh | null {
  if (opts.count <= 0) return null;
  const rng = new SeededRng(opts.seed * 7 + 9091);

  // two crossed quads, base at y=0
  const w = 1.6;
  const h = 1.1;
  const positions = [
    -w, 0, 0, w, 0, 0, w, h, 0, -w, h, 0,
    0, 0, -w, 0, 0, w, 0, h, w, 0, h, -w,
  ];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const tuft = new Mesh("groundTufts", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  vd.normals = normals; // upward normals: tufts shade like the ground they sit on
  vd.applyToMesh(tuft);

  const mat = new StandardMaterial("groundTuftMat", scene);
  const tex = bladeTexture(scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = 1; // ALPHATEST: no sorting, cheap
  mat.alphaCutOff = 0.4;
  mat.backFaceCulling = false;
  const base = Color3.FromHexString(opts.groundColor);
  const accent = Color3.FromHexString(opts.accentColor);
  mat.diffuseColor = Color3.Lerp(base, accent, 0.25).scale(1.0);
  mat.specularColor = Color3.Black();
  tuft.material = mat;
  tuft.isPickable = false;

  const mats: number[] = [];
  const q = new Quaternion();
  const m = new Matrix();
  const water = opts.waterLevel ?? -Infinity;
  let placed = 0;
  for (let i = 0; i < opts.count * 2 && placed < opts.count; i++) {
    // clumped: pick a clump center, then a few tufts around it
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(0, 1)) * 560 + 20;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const n = rng.int(2, 5);
    for (let k = 0; k < n && placed < opts.count; k++) {
      const x = cx + rng.range(-5, 5);
      const z = cz + rng.range(-5, 5);
      const y = terrain.heightAt(x, z);
      if (y < water + 0.4) continue;
      const s = rng.range(0.6, 1.5);
      Quaternion.RotationYawPitchRollToRef(rng.range(0, Math.PI), rng.range(-0.08, 0.08), 0, q);
      Matrix.ComposeToRef(new Vector3(s, s * rng.range(0.7, 1.3), s), q, new Vector3(x, y - 0.05, z), m);
      for (let j = 0; j < 16; j++) mats.push(m.m[j]);
      placed++;
    }
  }
  tuft.thinInstanceSetBuffer("matrix", new Float32Array(mats), 16, true);
  tuft.alwaysSelectAsActiveMesh = true;
  return tuft;
}

function bladeTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const dt = new DynamicTexture("tuftTex", { width: size, height: size }, scene, true);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const rng = new SeededRng(5150);
  for (let i = 0; i < 40; i++) {
    const x = rng.range(10, size - 10);
    const top = rng.range(size * 0.05, size * 0.55);
    const lean = rng.range(-18, 18);
    const shade = Math.round(rng.range(170, 240));
    ctx.strokeStyle = `rgb(${shade},${shade},${Math.round(shade * 0.8)})`;
    ctx.lineWidth = rng.range(3.5, 6.5);
    ctx.beginPath();
    // canvas y grows downward; texture v=0 is the bottom of the quad
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 0.3, (size + top) / 2, x + lean, top);
    ctx.stroke();
  }
  dt.hasAlpha = true;
  dt.update();
  return dt;
}
