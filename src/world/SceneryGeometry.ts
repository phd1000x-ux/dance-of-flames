import { Mesh, MeshBuilder, Quaternion, Scene, Vector3, VertexData } from "@babylonjs/core";
import { SeededRng } from "../core/SeededRng";

/** Closed triangular-prism roof; ridge runs along local Z, with full rectangular eaves. */
export function gabledRoof(name: string, width: number, depth: number, rise: number, scene: Scene): Mesh {
  const w = width / 2, d = depth / 2;
  const points = [[-w, 0, -d], [w, 0, -d], [0, rise, -d], [-w, 0, d], [w, 0, d], [0, rise, d]];
  const faces = [[0, 2, 1], [3, 4, 5], [0, 3, 5, 2], [1, 2, 5, 4], [0, 1, 4, 3]];
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
  for (const face of faces) {
    const start = positions.length / 3;
    face.forEach((p, i) => { positions.push(...points[p]); uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); });
    indices.push(start, start + 1, start + 2);
    if (face.length === 4) indices.push(start, start + 2, start + 3);
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs });
  const roof = new Mesh(name, scene);
  data.applyToMesh(roof);
  return roof;
}

/** Deformed geological mass. Position-based noise keeps UV seam duplicates welded. */
export function weatheredRock(name: string, seed: number, scene: Scene, size = 1): Mesh {
  const rock = MeshBuilder.CreateSphere(name, { diameter: size * 2, segments: 5 }, scene);
  const positions = rock.getVerticesData("position")!;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] / size, y = positions[i + 1] / size, z = positions[i + 2] / size;
    const n = Math.sin(x * 5.7 + y * 3.1 + seed) * Math.cos(z * 4.9 - y * 2.3 + seed * 0.7);
    const r = 1 + n * 0.24;
    positions[i] = (x * r + y * 0.18) * size;
    positions[i + 1] = (y * r * 0.72 + Math.sin(x * 4 + seed) * 0.07) * size;
    positions[i + 2] = z * r * 0.87 * size;
  }
  rock.setVerticesData("position", positions);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, rock.getIndices()!, normals);
  // Sphere poles contain duplicated zero-area triangles. Supply their radial
  // fallback explicitly so tiny pole faces never receive a black/undefined normal.
  for (let i = 0; i < normals.length; i += 3) {
    if (Math.hypot(normals[i], normals[i + 1], normals[i + 2]) < 0.001) {
      const n = new Vector3(positions[i], positions[i + 1], positions[i + 2]).normalize();
      normals[i] = n.x; normals[i + 1] = n.y; normals[i + 2] = n.z;
    }
  }
  rock.setVerticesData("normal", normals);
  rock.refreshBoundingInfo();
  return rock;
}

/** Two merged templates per tree: woody branching structure and irregular foliage masses. */
export function branchingTree(name: string, seed: number, broadleaf: boolean, scene: Scene): { trunk: Mesh; crown: Mesh } {
  const rng = new SeededRng(seed);
  const wood: Mesh[] = [], leaves: Mesh[] = [];
  const trunk = MeshBuilder.CreateCylinder(`${name}-bole`, { diameterBottom: 0.64, diameterTop: 0.18, height: 5.5, tessellation: 7 }, scene);
  trunk.position.y = 2.65;
  wood.push(trunk);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399 + rng.range(-0.25, 0.25);
    const y = broadleaf ? 3.1 + i * 0.33 : 2.1 + i * 0.55;
    const reach = broadleaf ? rng.range(1.2, 2) : 2.0 - i * 0.18;
    const start = new Vector3(0, y, 0);
    const end = new Vector3(Math.cos(a) * reach, y + 0.55, Math.sin(a) * reach);
    const branch = MeshBuilder.CreateCylinder(`${name}-limb`, { height: Vector3.Distance(start, end), diameterBottom: 0.19, diameterTop: 0.055, tessellation: 5 }, scene);
    branch.position.copyFrom(start.add(end).scale(0.5));
    branch.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), end.subtract(start).normalize(), new Quaternion());
    wood.push(branch);
    const foliage = weatheredRock(`${name}-needles`, seed + i * 13, scene, broadleaf ? 1.55 : 1.35);
    foliage.position.copyFrom(broadleaf ? end : new Vector3(end.x * 0.35, y + 0.7, end.z * 0.35));
    foliage.scaling.set(broadleaf ? 1.15 : reach * 0.87, broadleaf ? 1.1 : 0.87, broadleaf ? 1 : reach * 0.87);
    foliage.rotation.y = a;
    leaves.push(foliage);
  }
  const tip = weatheredRock(`${name}-leader`, seed + 67, scene, broadleaf ? 1.6 : 0.85);
  tip.position.set(0.1, broadleaf ? 6.1 : 6.5, -0.15);
  tip.scaling.set(broadleaf ? 1 : 0.7, broadleaf ? 0.9 : 1.6, broadleaf ? 1 : 0.7);
  leaves.push(tip);
  return { trunk: Mesh.MergeMeshes(wood, true, true)!, crown: Mesh.MergeMeshes(leaves, true, true)! };
}
