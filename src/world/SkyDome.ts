import { Color3, Constants, Mesh, MeshBuilder, RawTexture, Scene, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";

export interface SkyColors {
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  sunColor: string;
  /** DirectionalLight direction (points FROM the sun into the scene) */
  sunDirection: [number, number, number];
}

/**
 * Sky color for a unit view direction: zenith → horizon gradient that melts into
 * the fog color at the horizon (so distant terrain fades into sky, not a seam),
 * plus a soft sun halo and a tight disk. Pure function — unit tested.
 */
export function skyColorAt(dir: Vector3, c: SkyColors): Color3 {
  const top = Color3.FromHexString(c.skyTop);
  const bottom = Color3.FromHexString(c.skyBottom);
  const fog = Color3.FromHexString(c.fogColor);
  const sun = Color3.FromHexString(c.sunColor);
  const up = Math.max(0, dir.y);
  // sky gradient: bottom near the horizon, top toward the zenith
  let col = Color3.Lerp(bottom, top, Math.pow(up, 0.55));
  // horizon haze band blends into the fog color (and below the horizon stays fog)
  const haze = dir.y < 0 ? 1 : Math.pow(1 - up, 6);
  col = Color3.Lerp(col, fog, haze * 0.85);
  // sun: halo + disk around the direction TOWARD the sun
  const toSun = sunVector(c);
  const cosA = Math.max(0, Vector3.Dot(dir, toSun));
  const halo = Math.pow(cosA, 8) * 0.35 + Math.pow(cosA, 64) * 0.45;
  // soft-edged disk: a hard threshold aliased into a jagged blob under bloom
  const d = Math.max(0, Math.min(1, (cosA - 0.9965) / (0.9992 - 0.9965)));
  const disk = d * d * (3 - 2 * d);
  col = col.add(sun.scale(halo)).add(new Color3(1, 0.97, 0.9).scale(disk * 0.9));
  return new Color3(Math.min(1, col.r), Math.min(1, col.g), Math.min(1, col.b));
}

function sunVector(c: SkyColors): Vector3 {
  return new Vector3(-c.sunDirection[0], -c.sunDirection[1], -c.sunDirection[2]).normalize();
}

const TEX = 512;

/**
 * Unlit, fog-free inverted sphere that follows the camera. The sky is baked
 * into an EMISSIVE texture (vertex colors do not reach the emissive term of an
 * unlit StandardMaterial, so a vertex-colored dome renders flat). UVs use an azimuthal-equidistant
 * projection around the zenith — continuous everywhere, its only singularity
 * is the nadir (always below the terrain), so there is no longitude seam.
 */
export function buildSkyDome(scene: Scene, colors: SkyColors, radius = 2300): Mesh {
  const dome = MeshBuilder.CreateSphere("skyDome", { diameter: radius * 2, segments: 48, sideOrientation: Mesh.BACKSIDE }, scene);

  const positions = dome.getVerticesData("position")!;
  const uvs: number[] = [];
  const dir = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    dir.set(positions[i], positions[i + 1], positions[i + 2]).normalize();
    const r = Math.acos(Math.max(-1, Math.min(1, dir.y))) / Math.PI; // 0 zenith → 1 nadir
    const rho = Math.hypot(dir.x, dir.z);
    const k = rho > 1e-6 ? r / rho : 0;
    uvs.push(0.5 + 0.5 * dir.x * k, 0.5 + 0.5 * dir.z * k);
  }
  dome.setVerticesData("uv", uvs);

  // texel → direction (inverse of the projection above)
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    const dz = ((y + 0.5) / TEX) * 2 - 1;
    for (let x = 0; x < TEX; x++) {
      const dx = ((x + 0.5) / TEX) * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dz));
      const theta = r * Math.PI;
      const s = r > 1e-6 ? Math.sin(theta) / r : 0;
      dir.set(dx * s, Math.cos(theta), dz * s);
      const c = skyColorAt(dir, colors);
      const i = (y * TEX + x) * 4;
      data[i] = c.r * 255; data[i + 1] = c.g * 255; data[i + 2] = c.b * 255; data[i + 3] = 255;
    }
  }
  const tex = new RawTexture(data, TEX, TEX, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const mat = new StandardMaterial("skyDomeMat", scene);
  mat.disableLighting = true;
  mat.emissiveTexture = tex;
  // The shader ADDS the emissive texture to emissiveColor — keep the base black.
  mat.emissiveColor = Color3.Black();
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.fogEnabled = false;
  mat.backFaceCulling = false;
  dome.material = mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.applyFog = false;
  return dome;
}
