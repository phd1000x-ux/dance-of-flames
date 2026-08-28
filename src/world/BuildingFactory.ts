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
import { texturedMaterial } from "./WorldMaterials";

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
  meshes: Mesh[];
  rubble: Mesh;
  size: { w: number; h: number; d: number };
  material: StandardMaterial;
  materials: StandardMaterial[];
}

/** per-kind stone texture repeat (u = around, v = up) */
const UV: Record<BuildingKind, { u: number; v: number }> = {
  house: { u: 2, v: 2 }, tower: { u: 4, v: 10 }, barracks: { u: 3, v: 2 },
  fort: { u: 5, v: 3 }, wall: { u: 8, v: 2 }, gate: { u: 4, v: 8 },
  keep: { u: 10, v: 10 }, grandTower: { u: 5, v: 12 },
};

const windowMats = new WeakMap<Scene, StandardMaterial>();
/** near-black window glass with a faint warm hearth glow — shared per scene (cache-owned) */
function windowMaterial(scene: Scene): StandardMaterial {
  let m = windowMats.get(scene);
  if (!m) {
    m = new StandardMaterial("worldWindowMat", scene);
    m.diffuseColor = new Color3(0.03, 0.03, 0.04);
    m.emissiveColor = new Color3(0.05, 0.035, 0.02);
    m.specularColor = new Color3(0.02, 0.02, 0.02);
    windowMats.set(scene, m);
  }
  return m;
}

/** Procedural buildings with intact + collapsed state meshes. */
export class BuildingFactory {
  constructor(private scene: Scene, private rng: SeededRng) {}

  create(kind: BuildingKind, stoneColor = "#6a6460", variant?: string): BuiltBuilding {
    let spec = BUILDING_SPECS[kind];
    if (kind === "grandTower" && variant) {
      spec = { ...spec, size: { ...spec.size, h: variant === "artillery" ? 42 : variant === "ruined" ? 24 : 38 } };
    }
    const root = new TransformNode(`building-${kind}-${this.rng.int(0, 1e6)}`, this.scene);
    const c = Color3.FromHexString(stoneColor);
    const uv = UV[kind];
    const mat = texturedMaterial(this.scene, `bmat-${kind}-${this.rng.int(0, 1e9)}`, "stone", {
      uScale: uv.u, vScale: uv.v, tint: c, gloss: true,
      specular: new Color3(0.06, 0.06, 0.06), power: 48,
    });

    const { w, h, d } = spec.size;
    const parts: Mesh[] = [];
    const roofParts: Mesh[] = [];
    const winParts: Mesh[] = [];

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
        this.addWindow(winParts, 0, 0.1, d / 2 + 0.05, 0, 0.5, 0.7);
        break;
      }
      case "tower": {
        parts.push(MeshBuilder.CreateCylinder("t-body", { diameter: w, height: h, tessellation: 12 }, this.scene));
        const top = MeshBuilder.CreateCylinder("t-top", { diameter: w * 1.25, height: 0.8, tessellation: 12 }, this.scene);
        top.position.y = h / 2 + 0.4;
        parts.push(top);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const cren = MeshBuilder.CreateBox("t-cren", { width: 0.6, height: 0.7, depth: 0.6 }, this.scene);
          cren.position.set(Math.cos(a) * w * 0.55, h / 2 + 1.0, Math.sin(a) * w * 0.55);
          parts.push(cren);
        }
        for (const [a, hy] of [[0, h * 0.45], [2.1, h * 0.62], [4.2, h * 0.79]] as const) {
          this.addWindow(winParts, Math.cos(a) * (w / 2), -h / 2 + hy, Math.sin(a) * (w / 2), Math.PI / 2 - a, 0.4, 1.1);
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
          const twr = MeshBuilder.CreateCylinder("f-twr", { diameter: 3.2, height: h * 1.35, tessellation: 12 }, this.scene);
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
          const turret = MeshBuilder.CreateCylinder("k-tur", { diameter: w * 0.24, height: h * 0.95, tessellation: 12 }, this.scene);
          turret.position.set(cx2 * (w / 2 - w * 0.14), 0, cz2 * (d / 2 - d * 0.14));
          parts.push(turret);
          const cap = MeshBuilder.CreateCylinder("k-cap", { diameterTop: 0, diameterBottom: w * 0.3, height: h * 0.18, tessellation: 12 }, this.scene);
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
        for (let r = 0; r < 4; r++) for (let cx = -1; cx <= 1; cx++) {
          this.addWindow(winParts, cx * w * 0.2, -h * 0.28 + r * h * 0.17, d * 0.39, 0, 0.8, 1.6);
          this.addWindow(winParts, cx * w * 0.2, -h * 0.28 + r * h * 0.17, -d * 0.39, 0, 0.8, 1.6);
        }
        break;
      }
      case "grandTower": {
        parts.push(MeshBuilder.CreateCylinder("gt-body", { diameter: w, height: h, tessellation: 12 }, this.scene));
        const top = MeshBuilder.CreateCylinder("gt-top", { diameter: w * 1.25, height: 1.4, tessellation: 12 }, this.scene);
        top.position.y = h / 2 + 0.7;
        parts.push(top);
        const crens: Mesh[] = [];
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const cren = MeshBuilder.CreateBox("gt-cren", { width: 1.1, height: 1.4, depth: 1.1 }, this.scene);
          cren.position.set(Math.cos(a) * w * 0.56, h / 2 + 1.8, Math.sin(a) * w * 0.56);
          crens.push(cren);
          parts.push(cren);
        }
        const troof = MeshBuilder.CreateCylinder("gt-roof", { diameterTop: 0, diameterBottom: w * 1.15, height: h * 0.3, tessellation: 8 }, this.scene);
        troof.position.y = h / 2 + h * 0.15 + 1.6;
        parts.push(troof);
        for (const [a, hy] of [[0.8, h * 0.5], [3.9, h * 0.75]] as const) {
          this.addWindow(winParts, Math.cos(a) * (w / 2), -h / 2 + hy, Math.sin(a) * (w / 2), Math.PI / 2 - a, 0.4, 1.1);
        }
        if (variant === "artillery") {
          const plat = MeshBuilder.CreateCylinder("gt-plat", { diameter: w * 1.45, height: 1.0, tessellation: 9 }, this.scene);
          plat.position.y = h / 2 + 1.9;
          parts.push(plat);
          troof.isVisible = false;
        }
        if (variant === "military") {
          troof.isVisible = false;
        }
        if (variant === "gate") {
          for (const side of [-1, 1]) {
            const banner = MeshBuilder.CreateBox("gt-ban", { width: 0.2, height: 3.2, depth: 1.4 }, this.scene);
            banner.position.set(side * w * 0.5, h / 2 + 3.4, 0);
            parts.push(banner);
          }
        }
        if (variant === "ruined") {
          troof.isVisible = false;
          crens.forEach((cr, i) => {
            if (i % 2 === 0) cr.isVisible = false;
          });
          const breach = MeshBuilder.CreateBox("gt-breach", { width: w * 0.5, height: h * 0.3, depth: w * 0.6 }, this.scene);
          breach.position.set(w * 0.25, -h / 2 + h * 0.15, 0);
          parts.push(breach);
        }
        break;
      }
      case "gate": {
        for (const gx of [-w / 2 + 1.5, w / 2 - 1.5]) {
          const twr = MeshBuilder.CreateCylinder("g-twr", { diameter: 3.4, height: h, tessellation: 12 }, this.scene);
          twr.position.set(gx, 0, 0);
          parts.push(twr);
          this.addWindow(winParts, gx, -h / 2 + h * 0.55, d * 0.3, 0, 0.5, 1.4);
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

    // variant-hidden parts (troof / alternate crenellations) must not reach the merge
    const mergeParts = parts.filter((p) => p.isVisible);
    for (const p of parts) if (!p.isVisible) p.dispose();
    const walls = Mesh.MergeMeshes(mergeParts, true, true, undefined, false, false)!;
    walls.material = mat;
    walls.parent = root;
    walls.isPickable = false;
    const solidMeshes: Mesh[] = [walls];
    const materials: StandardMaterial[] = [mat];
    if (roofParts.length) {
      const roofMat = texturedMaterial(this.scene, `rmat-${kind}-${this.rng.int(0, 1e6)}`, "roof", {
        uScale: Math.max(2, Math.round(uv.u * 1.5)), vScale: Math.max(2, Math.round(uv.v * 0.6)),
        tint: new Color3(0.32, 0.16, 0.1), specular: new Color3(0.03, 0.03, 0.03),
      });
      const roofs = Mesh.MergeMeshes(roofParts, true, true, undefined, false, false)!;
      roofs.material = roofMat;
      roofs.parent = root;
      roofs.isPickable = false;
      solidMeshes.push(roofs);
      materials.push(roofMat);
    }
    if (winParts.length) {
      const wins = Mesh.MergeMeshes(winParts, true, true, undefined, false, false)!;
      wins.material = windowMaterial(this.scene);
      wins.parent = root;
      wins.isPickable = false;
      solidMeshes.push(wins);
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
    const rubbleMat = texturedMaterial(this.scene, `rubbleMat-${this.rng.int(0, 1e6)}`, "stone", {
      uScale: 1, vScale: 1, tint: c.scale(0.5), emissive: new Color3(0.02, 0.02, 0.02),
    });
    materials.push(rubbleMat);
    const rubble = Mesh.MergeMeshes(rubbleParts, true, true, undefined, false, false)!;
    rubble.material = rubbleMat;
    rubble.parent = root;
    rubble.isVisible = false;
    rubble.isPickable = false;

    return { root, mesh: walls, meshes: solidMeshes, rubble, size: spec.size, material: mat, materials };
  }

  private addWindow(list: Mesh[], x: number, y: number, z: number, rotY = 0, w = 0.55, h = 1.25): void {
    const win = MeshBuilder.CreateBox("b-win", { width: w, height: h, depth: 0.3 }, this.scene);
    win.position.set(x, y, z);
    win.rotation.y = rotY;
    list.push(win);
  }
}
