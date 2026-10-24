import { Color3, Mesh, MeshBuilder, Scene } from "@babylonjs/core";

export interface ShaftSpec {
  length: number;
  shaftDiameter: number;
  headLength: number;
  headDiameter: number;
  finLength: number;
  finHeight: number;
  /** barbed broadhead blades (ballista bolts) */
  barbs: boolean;
}

export const BOLT_SPEC: ShaftSpec = { length: 2.7, shaftDiameter: 0.13, headLength: 0.55, headDiameter: 0.3, finLength: 0.62, finHeight: 0.2, barbs: true };
export const ARROW_SPEC: ShaftSpec = { length: 1.1, shaftDiameter: 0.035, headLength: 0.12, headDiameter: 0.07, finLength: 0.22, finHeight: 0.06, barbs: false };

const WOOD = new Color3(0.42, 0.29, 0.17);
const IRON = new Color3(0.3, 0.31, 0.34);
const FLETCH = new Color3(0.72, 0.68, 0.6);
const BIND = new Color3(0.18, 0.12, 0.08);

function paint(mesh: Mesh, color: Color3): Mesh {
  const n = mesh.getTotalVertices();
  const colors = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = color.r; colors[i * 4 + 1] = color.g; colors[i * 4 + 2] = color.b; colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData("color", colors);
  return mesh;
}

/**
 * Shaft + iron head + (optional) barbs + three fletching fins + bindings, merged
 * into ONE vertex-colored mesh pointing down +Z with its center at the origin,
 * so it can be instanced and oriented by yaw/pitch like the old box.
 */
export function buildShaftMesh(name: string, spec: ShaftSpec, scene: Scene): Mesh {
  const half = spec.length / 2;
  const parts: Mesh[] = [];
  const shaftLen = spec.length - spec.headLength;

  const shaft = MeshBuilder.CreateCylinder(`${name}-shaft`, { diameter: spec.shaftDiameter, height: shaftLen, tessellation: 8 }, scene);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -half + shaftLen / 2;
  parts.push(paint(shaft, WOOD));

  // conical iron head with a short socket
  const head = MeshBuilder.CreateCylinder(`${name}-head`, { diameterTop: 0, diameterBottom: spec.headDiameter, height: spec.headLength, tessellation: 4 }, scene);
  head.rotation.x = Math.PI / 2;
  head.position.z = half - spec.headLength / 2;
  parts.push(paint(head, IRON));
  const socket = MeshBuilder.CreateCylinder(`${name}-socket`, { diameterTop: spec.headDiameter * 0.55, diameterBottom: spec.shaftDiameter * 1.15, height: spec.headLength * 0.35, tessellation: 8 }, scene);
  socket.rotation.x = Math.PI / 2;
  socket.position.z = half - spec.headLength - spec.headLength * 0.12;
  parts.push(paint(socket, IRON));

  if (spec.barbs) {
    for (const side of [-1, 1]) {
      const barb = MeshBuilder.CreateBox(`${name}-barb`, { width: spec.headDiameter * 0.9, height: 0.025, depth: spec.headLength * 0.55 }, scene);
      barb.position.set(side * spec.headDiameter * 0.42, 0, half - spec.headLength * 0.78);
      barb.rotation.y = side * 0.55;
      parts.push(paint(barb, IRON));
    }
  }

  // three fins, 120° apart, swept back
  for (let i = 0; i < 3; i++) {
    const fin = MeshBuilder.CreateBox(`${name}-fin`, { width: 0.012 + spec.shaftDiameter * 0.08, height: spec.finHeight, depth: spec.finLength }, scene);
    const pivot = (i / 3) * Math.PI * 2;
    const r = spec.shaftDiameter / 2 + spec.finHeight / 2;
    fin.position.set(Math.sin(pivot) * r, Math.cos(pivot) * r, -half + spec.finLength / 2 + spec.length * 0.03);
    fin.rotation.z = -pivot;
    parts.push(paint(fin, FLETCH));
  }

  // wrapped bindings at both ends of the fletching
  for (const z of [-half + spec.length * 0.03, -half + spec.length * 0.03 + spec.finLength]) {
    const ring = MeshBuilder.CreateCylinder(`${name}-bind`, { diameter: spec.shaftDiameter * 1.35, height: spec.shaftDiameter * 0.9, tessellation: 8 }, scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = z;
    parts.push(paint(ring, BIND));
  }

  const merged = Mesh.MergeMeshes(parts, true, true)!;
  merged.name = name;
  merged.useVertexColors = true;
  return merged;
}

/** test helper: vertex colors survived the merge */
export function hasVertexColors(mesh: Mesh): boolean {
  return mesh.isVerticesDataPresent("color") && mesh.getVerticesData("color")!.length === mesh.getTotalVertices() * 4;
}
