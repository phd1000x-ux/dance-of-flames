import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { SeededRng } from "../core/SeededRng";

export type BuildingKind = "house" | "tower" | "barracks" | "fort" | "wall" | "gate" | "keep" | "grandTower";

export interface BuildingSpec {
  kind: BuildingKind;
  hp: number;
  size: { w: number; h: number; d: number };
}

export const BUILDING_SPECS: Record<BuildingKind, BuildingSpec> = {
  house: { kind: "house", hp: 300, size: { w: 6, h: 4, d: 5 } },
  tower: { kind: "tower", hp: 800, size: { w: 5, h: 13, d: 5 } },
  barracks: { kind: "barracks", hp: 1200, size: { w: 12, h: 4.5, d: 6 } },
  fort: { kind: "fort", hp: 2500, size: { w: 14, h: 10, d: 14 } },
  wall: { kind: "wall", hp: 2500, size: { w: 20, h: 8, d: 3 } },
  gate: { kind: "gate", hp: 2600, size: { w: 13, h: 14, d: 9 } },
  keep: { kind: "keep", hp: 4200, size: { w: 36, h: 46, d: 36 } },
  grandTower: { kind: "grandTower", hp: 1600, size: { w: 15, h: 30, d: 15 } },
};

export interface BuiltBuilding {
  root: TransformNode;
  mesh: Mesh;
  rubble: Mesh;
  size: { w: number; h: number; d: number };
  material: StandardMaterial;
}

/** Procedural buildings with intact + collapsed state meshes. */
export class BuildingFactory {
  constructor(private scene: Scene, private rng: SeededRng) {}

  create(kind: BuildingKind, stoneColor = "#6a6460"): BuiltBuilding {
    const spec = BUILDING_SPECS[kind];
    const root = new TransformNode(`building-${kind}-${this.rng.int(0, 1e6)}`, this.scene);
    const mat = new StandardMaterial(`bmat-${kind}-${this.rng.int(0, 1e9)}`, this.scene);
    const c = Color3.FromHexString(stoneColor);
    mat.diffuseColor = c;
    mat.emissiveColor = Color3.Black();
    mat.specularColor = new Color3(0.06, 0.06, 0.06);

    const { w, h, d } = spec.size;
    const parts: Mesh[] = [];
    const roofParts: Mesh[] = [];

    switch (kind) {
      case "house": {
        parts.push(MeshBuilder.CreateBox("h-wall", { width: w, height: h, depth: d }, this.scene));
        const roof = MeshBuilder.CreateCylinder("h-roof", { diameterTop: 0, diameterBottom: Math.max(w, d) * 1.2, height: 2.6, tessellation: 4 }, this.scene);
        roof.rotation.y = Math.PI / 4;
        roof.position.y = h / 2 + 1.3;
        roofParts.push(roof);
        const chimney = MeshBuilder.CreateBox("h-chim", { width: 0.7, height: 1.6, depth: 0.7 }, this.scene);
        chimney.position.set(w * 0.28, h / 2 + 1.4, 0);
        parts.push(chimney);
        break;
      }
      case "tower": {
        parts.push(MeshBuilder.CreateCylinder("t-body", { diameter: w, height: h, tessellation: 8 }, this.scene));
        const top = MeshBuilder.CreateCylinder("t-top", { diameter: w * 1.25, height: 0.8, tessellation: 8 }, this.scene);
        top.position.y = h / 2 + 0.4;
        parts.push(top);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const cren = MeshBuilder.CreateBox("t-cren", { width: 0.6, height: 0.7, depth: 0.6 }, this.scene);
          cren.position.set(Math.cos(a) * w * 0.55, h / 2 + 1.0, Math.sin(a) * w * 0.55);
          parts.push(cren);
        }
        break;
      }
      case "barracks": {
        parts.push(MeshBuilder.CreateBox("b-body", { width: w, height: h, depth: d }, this.scene));
        const roof = MeshBuilder.CreateBox("b-roof", { width: w * 1.08, height: 0.4, depth: d * 1.15 }, this.scene);
        roof.position.y = h / 2 + 0.2;
        roofParts.push(roof);
        break;
      }
      case "fort": {
        parts.push(MeshBuilder.CreateBox("f-body", { width: w, height: h, depth: d }, this.scene));
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          const twr = MeshBuilder.CreateCylinder("f-twr", { diameter: 3.2, height: h * 1.35, tessellation: 8 }, this.scene);
          twr.position.set(cx * (w / 2 - 0.5), h * 1.35 / 2 - h / 2, cz * (d / 2 - 0.5));
          parts.push(twr);
        }
        const gate = MeshBuilder.CreateBox("f-gate", { width: 2.6, height: 3.4, depth: 0.6 }, this.scene);
        gate.position.set(0, -h / 2 + 1.7, d / 2);
        parts.push(gate);
        break;
      }
      case "wall": {
        parts.push(MeshBuilder.CreateBox("w-body", { width: w, height: h, depth: d }, this.scene));
        for (let i = 0; i < 5; i++) {
          const cren = MeshBuilder.CreateBox("w-cren", { width: 1.1, height: 0.9, depth: d * 1.1 }, this.scene);
          cren.position.set(-w / 2 + 2 + i * (w - 4) / 4, h / 2 + 0.45, 0);
          parts.push(cren);
        }
        break;
      }
      case "keep": {
        // colossal central keep: tiered mass + side wings + crown
        parts.push(MeshBuilder.CreateBox("k-main", { width: w * 0.78, height: h * 0.82, depth: d * 0.78 }, this.scene));
        const tier2 = MeshBuilder.CreateBox("k-t2", { width: w * 0.5, height: h * 0.3, depth: d * 0.5 }, this.scene);
        tier2.position.y = h * 0.45;
        parts.push(tier2);
        for (const [cx2, cz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          const turret = MeshBuilder.CreateCylinder("k-tur", { diameter: w * 0.24, height: h * 0.95, tessellation: 8 }, this.scene);
          turret.position.set(cx2 * (w / 2 - w * 0.14), 0, cz2 * (d / 2 - d * 0.14));
          parts.push(turret);
          const cap = MeshBuilder.CreateCylinder("k-cap", { diameterTop: 0, diameterBottom: w * 0.3, height: h * 0.18, tessellation: 8 }, this.scene);
          cap.position.set(cx2 * (w / 2 - w * 0.14), h * 0.55, cz2 * (d / 2 - d * 0.14));
          parts.push(cap);
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const cren = MeshBuilder.CreateBox("k-cren", { width: 2, height: 1.6, depth: 2 }, this.scene);
          cren.position.set(Math.cos(a) * w * 0.4, h * 0.44, Math.sin(a) * d * 0.4);
          parts.push(cren);
        }
        const gate = MeshBuilder.CreateBox("k-gate", { width: 4, height: 6, depth: 1 }, this.scene);
        gate.position.set(0, -h / 2 + 3, d / 2);
        parts.push(gate);
        break;
      }
      case "grandTower": {
        parts.push(MeshBuilder.CreateCylinder("gt-body", { diameter: w, height: h, tessellation: 9 }, this.scene));
        const top = MeshBuilder.CreateCylinder("gt-top", { diameter: w * 1.25, height: 1.4, tessellation: 9 }, this.scene);
        top.position.y = h / 2 + 0.7;
        parts.push(top);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const cren = MeshBuilder.CreateBox("gt-cren", { width: 1.1, height: 1.4, depth: 1.1 }, this.scene);
          cren.position.set(Math.cos(a) * w * 0.56, h / 2 + 1.8, Math.sin(a) * w * 0.56);
          parts.push(cren);
        }
        const troof = MeshBuilder.CreateCylinder("gt-roof", { diameterTop: 0, diameterBottom: w * 1.15, height: h * 0.3, tessellation: 8 }, this.scene);
        troof.position.y = h / 2 + h * 0.15 + 1.6;
        parts.push(troof);
        break;
      }
      case "gate": {
        for (const gx of [-w / 2 + 1.5, w / 2 - 1.5]) {
          const twr = MeshBuilder.CreateCylinder("g-twr", { diameter: 3.4, height: h, tessellation: 8 }, this.scene);
          twr.position.set(gx, 0, 0);
          parts.push(twr);
        }
        const arch = MeshBuilder.CreateBox("g-arch", { width: w - 3, height: h * 0.6, depth: d * 0.7 }, this.scene);
        arch.position.y = h * 0.2 + 1.5;
        parts.push(arch);
        const portcullis = MeshBuilder.CreateBox("g-port", { width: 2.4, height: 3.2, depth: 0.3 }, this.scene);
        portcullis.position.set(0, 1.6, 0);
        parts.push(portcullis);
        break;
      }
    }

    const walls = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    walls.material = mat;
    walls.parent = root;
    walls.isPickable = false;
    let mesh = walls;
    if (roofParts.length) {
      const roofMat = new StandardMaterial(`rmat-${kind}`, this.scene);
      roofMat.diffuseColor = new Color3(0.32, 0.16, 0.1);
      const roofs = Mesh.MergeMeshes(roofParts, true, true, undefined, false, false)!;
      roofs.material = roofMat;
      roofs.parent = root;
      roofs.isPickable = false;
      mesh = Mesh.MergeMeshes([walls, roofs], true, true, undefined, false, false)!;
      mesh.material = mat;
      mesh.parent = root;
      mesh.isPickable = false;
    }

    // rubble / collapsed mesh (hidden initially)
    const rubbleParts: Mesh[] = [];
    const rubbleCount = kind === "fort" || kind === "wall" ? 10 : 7;
    for (let i = 0; i < rubbleCount; i++) {
      const rb = MeshBuilder.CreateBox("rubble", {
        width: this.rng.range(0.8, w * 0.4),
        height: this.rng.range(0.5, 1.6),
        depth: this.rng.range(0.8, d * 0.4),
      }, this.scene);
      rb.rotation.y = this.rng.range(0, Math.PI);
      rb.rotation.z = this.rng.range(-0.2, 0.2);
      rb.position.set(this.rng.range(-w / 2, w / 2), this.rng.range(0.1, 0.9), this.rng.range(-d / 2, d / 2));
      rubbleParts.push(rb);
    }
    const rubbleMat = new StandardMaterial("rubbleMat", this.scene);
    rubbleMat.diffuseColor = c.scale(0.45);
    rubbleMat.emissiveColor = new Color3(0.02, 0.02, 0.02);
    const rubble = Mesh.MergeMeshes(rubbleParts, true, true, undefined, false, false)!;
    rubble.material = rubbleMat;
    rubble.parent = root;
    rubble.isVisible = false;
    rubble.isPickable = false;

    return { root, mesh, rubble, size: spec.size, material: mat };
  }
}
