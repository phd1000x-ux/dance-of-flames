import { MeshBuilder, Mesh, StandardMaterial, Color3, VertexData, Scene, Texture, DynamicTexture } from "@babylonjs/core";
import { getWorldTexture } from "./WorldMaterials";
import { SeededRng } from "../core/SeededRng";
import { smoothstep } from "../core/MathUtils";
import { fbm } from "./Noise";
import { branchingTree, weatheredRock } from "./SceneryGeometry";

/** Analytic terrain height — shared by rendering, gameplay collision, and placement. */
export class TerrainHeightSampler {
  private perm: Float32Array;

  constructor(
    seed: number,
    private amp = 22,
    private freq = 1 / 150,
    private flatRadius = 240,
    private flatBlend = 380,
    _waterLevel = 0
  ) {
    const rng = new SeededRng(seed);
    this.perm = new Float32Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = rng.next();
  }

  private valueAt(ix: number, iz: number): number {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return this.perm[(h >>> 0) % 512];
  }

  private noise2(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = this.valueAt(ix, iz);
    const b = this.valueAt(ix + 1, iz);
    const c = this.valueAt(ix, iz + 1);
    const d = this.valueAt(ix + 1, iz + 1);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sz;
  }

  height(x: number, z: number): number {
    let total = 0;
    let amp = this.amp;
    let f = this.freq;
    for (let o = 0; o < 3; o++) {
      total += this.noise2(x * f + o * 17.3, z * f - o * 9.1) * amp;
      amp *= 0.42;
      f *= 2.15;
    }
    // flatten battlefield center so buildings/melee have sane footing
    const d = Math.sqrt(x * x + z * z);
    const flat = smoothstep(this.flatRadius, this.flatRadius + this.flatBlend, d);
    return total * (0.1 + 0.9 * flat) + this.mountains(x, z, d);
  }

  /**
   * Ridged mountain ring past the playable area: rises from MOUNTAIN_START and
   * peaks near the flight soft bound (DragonController boundsRadius 760), so the
   * edge of the map reads as a range instead of a flat plane meeting fog.
   * Zero inside MOUNTAIN_START — battlefield placement is unaffected.
   */
  private mountains(x: number, z: number, d: number): number {
    const ring = smoothstep(MOUNTAIN_START, MOUNTAIN_FULL, d);
    if (ring <= 0) return 0;
    let ridge = 0;
    let amp = 1;
    let f = 1 / 95;
    for (let o = 0; o < 3; o++) {
      const n = this.noise2(x * f + 41.7 + o * 7.3, z * f - 13.9 - o * 5.1);
      ridge += (1 - Math.abs(2 * n - 1)) ** 2 * amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return ring * (MOUNTAIN_BASE + ridge * MOUNTAIN_AMP);
  }
}

export const MOUNTAIN_START = 590;
export const MOUNTAIN_FULL = 800;
const MOUNTAIN_BASE = 35;
const MOUNTAIN_AMP = 120;

export interface TerrainOptions {
  size?: number;
  subdivisions?: number;
  groundColor: string;
  accentColor: string;
}

export class Terrain {
  readonly sampler: TerrainHeightSampler;
  readonly mesh: Mesh;
  readonly size: number;

  constructor(scene: Scene, seed: number, waterLevel: number | undefined, opts: TerrainOptions) {
    this.size = opts.size ?? 1700;
    this.sampler = new TerrainHeightSampler(seed, 22, 1 / 150, 240, 380, waterLevel ?? 0);

    const subdivisions = opts.subdivisions ?? 150;
    const ground = MeshBuilder.CreateGround("terrain", { width: this.size, height: this.size, subdivisions }, scene);
    ground.isPickable = false;

    const positions = ground.getVerticesData("position")!;
    const colors: number[] = [];
    const base = Color3.FromHexString(opts.groundColor);
    const accent = Color3.FromHexString(opts.accentColor);


    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      const h = this.sampler.height(x, z);
      positions[i + 1] = h;
      // Continuous soil patches and exposed rock follow the terrain; independent
      // random vertex colors formerly produced an artificial triangle patchwork.
      const patch = fbm(x / 65, z / 65, seed + 13);
      const slope = Math.hypot(this.sampler.height(x + 3, z) - h, this.sampler.height(x, z + 3) - h);
      const t = Math.min(1, smoothstep(-6, 24, h) * 0.38 + patch * 0.52 + slope * 0.15);
      colors.push(base.r + (accent.r - base.r) * t, base.g + (accent.g - base.g) * t, base.b + (accent.b - base.b) * t, 1);
    }
    ground.setVerticesData("position", positions);
    ground.setVerticesData("color", colors);
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, ground.getIndices()!, normals);
    ground.setVerticesData("normal", normals);

    const mat = new StandardMaterial("terrainMat", scene);
    const detail = getWorldTexture(scene, "ground", "albedo", 200, 200);
    detail.anisotropicFilteringLevel = 8;
    mat.diffuseTexture = detail;
    const bump = getWorldTexture(scene, "ground", "normal", 200, 200);
    bump.anisotropicFilteringLevel = 4;
    mat.bumpTexture = bump;
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    ground.material = mat;
    ground.useVertexColors = true; // explicit for clarity
    ground.receiveShadows = true;
    ground.freezeWorldMatrix();

    this.mesh = ground;
  }

  heightAt(x: number, z: number): number {
    return this.sampler.height(x, z);
  }

  /** flat spot finder for rider landing / building placement */
  isFlat(x: number, z: number, radius: number, tolerance = 1.2): boolean {
    const h = this.heightAt(x, z);
    return (
      Math.abs(this.heightAt(x + radius, z) - h) < tolerance &&
      Math.abs(this.heightAt(x - radius, z) - h) < tolerance &&
      Math.abs(this.heightAt(x, z + radius) - h) < tolerance &&
      Math.abs(this.heightAt(x, z - radius) - h) < tolerance
    );
  }
}

/** Simple drifting cloud planes + distant silhouette ring. */
export function buildSkyAndHorizon(
  scene: Scene,
  seed: number,
  cfg: { skyBottom?: string; silhouette?: string; fogColor: string },
  ground?: TerrainHeightSampler
): void {
  const rng = new SeededRng(seed + 999);

  // distant silhouette ring
  const kind = cfg.silhouette ?? "cliffs";
  // The terrain's mountain ring now forms the natural horizon; giant rock and
  // building stand-ins perched on its ridges read as floating fog blobs, so
  // only forest/ruins silhouettes (which belong on mountainsides) remain.
  const count = kind === "cliffs" || kind === "city" ? 0 : 30;
  const mat = new StandardMaterial("silhouetteMat", scene);
  const fog = Color3.FromHexString(cfg.fogColor);
  mat.diffuseColor = fog.scale(0.55);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.emissiveColor = fog.scale(0.25);

  const forestTemplates = kind === "forest" ? [false, true].map((b, i) => {
    const tree = branchingTree(`horizon-tree-${i}`, seed + i * 41, b, scene);
    const merged = Mesh.MergeMeshes([tree.trunk, tree.crown], true, true)!;
    merged.material = mat; merged.isVisible = false; merged.isPickable = false;
    return merged;
  }) : [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const dist = rng.range(760, 860);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    let m: Mesh | import("@babylonjs/core").InstancedMesh;
    if (kind === "ruins") {
      m = weatheredRock(`sil${i}`, seed + i * 11, scene);
      m.scaling.set(rng.range(9, 16), rng.range(35, 65), rng.range(10, 19));
      m.position.y = 20;
    } else {
      m = forestTemplates[i % 2].createInstance(`horizon-forest-${i}`);
      const scale = rng.range(5.5, 9);
      m.scaling.set(scale * 1.3, scale, scale * 1.3);
      m.position.y = -10;
    }
    m.position.x = x; m.position.z = z;
    // sit on the mountain ring rather than floating/buried at a fixed height
    if (ground) m.position.y += ground.height(x, z);
    m.material = mat;
    m.isPickable = false;
    // Freeze only after all transforms: the former horizon was frozen at y=0.
    m.freezeWorldMatrix();
  }

  // cloud layer: two large semi-transparent planes with procedural blob texture
  const cloudTex = makeCloudTexture(scene, seed);
  for (let layer = 0; layer < 2; layer++) {
    const cloud = MeshBuilder.CreateGround(`clouds${layer}`, { width: 3600, height: 3600, subdivisions: 1 }, scene);
    cloud.position.y = 280 + layer * 120;
    const cm = new StandardMaterial(`cloudMat${layer}`, scene);
    cm.diffuseTexture = cloudTex;
    cm.opacityTexture = cloudTex;
    // tinted toward the fog so the layer reads as overcast, not a white sheet over the sky dome
    cm.emissiveColor = Color3.Lerp(fog, Color3.White(), 0.45);
    cm.diffuseColor = Color3.Black();
    cm.specularColor = Color3.Black();
    cm.disableLighting = true;
    cm.alpha = layer === 0 ? 0.42 : 0.26;
    cm.backFaceCulling = false;
    cloud.material = cm;
    cloud.isPickable = false;
    if (layer === 1) cloud.rotation.y = 0.7;
    // slow drift via texture offset animation
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      cloudTex.uOffset += dt * 0.0016 * (layer + 1);
    });
  }
}

function makeCloudTexture(scene: Scene, seed: number): Texture {
  const size = 256;
  const dt = new DynamicTexture("cloudTex", { width: size, height: size }, scene, false);
  const ctx = dt.getContext();
  ctx.clearRect(0, 0, size, size);
  const rng = new SeededRng(seed + 5);
  for (let i = 0; i < 46; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(14, 44);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.floor(rng.range(190, 235));
    g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  dt.update();
  dt.hasAlpha = true;
  return dt as unknown as Texture;
}
