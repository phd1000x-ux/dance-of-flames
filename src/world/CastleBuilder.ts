import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { BuildingPlacement } from "./WorldBuilder";
import type { PropLibrary } from "./PropLibrary";
import type { TerrainHeightSampler } from "./Terrain";
import { SeededRng } from "../core/SeededRng";

export interface CastleAabb {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface CastleBuildResult {
  buildingPlacements: BuildingPlacement[];
  wallAabbs: CastleAabb[];
  center: Vector3;
  gatePosition: Vector3;
  radius: number;
}

/**
 * THE BLACKSTONE CITADEL — large fortified castle:
 *   outer curtain (220m square, 8 towers) → gatehouse → inner ward (110m)
 *   → central keep (46m) with turrets, courtyard, village + camp + siege lines.
 * Destructible targets are returned as BuildingPlacement entries (existing
 * state-based destruction); the remaining mega-geometry is static + instanced.
 * All geometry is sectorized (per-wall meshes, merged towers) for culling.
 */
export class CastleBuilder {
  private stoneMat: StandardMaterial;
  private darkStoneMat: StandardMaterial;
  private woodMat: StandardMaterial;
  private roofMat: StandardMaterial;

  constructor(private scene: Scene, private terrain: TerrainHeightSampler, private rng: SeededRng) {
    this.stoneMat = new StandardMaterial("castleStone", scene);
    this.stoneMat.diffuseColor = new Color3(0.34, 0.33, 0.31);
    this.stoneMat.specularColor = new Color3(0.04, 0.04, 0.04);
    this.darkStoneMat = new StandardMaterial("castleDarkStone", scene);
    this.darkStoneMat.diffuseColor = new Color3(0.22, 0.22, 0.23);
    this.darkStoneMat.specularColor = new Color3(0.03, 0.03, 0.03);
    this.woodMat = new StandardMaterial("castleWood", scene);
    this.woodMat.diffuseColor = new Color3(0.26, 0.17, 0.1);
    this.woodMat.specularColor = new Color3(0.03, 0.02, 0.02);
    this.roofMat = new StandardMaterial("castleRoof", scene);
    this.roofMat.diffuseColor = new Color3(0.15, 0.13, 0.12);
    this.roofMat.specularColor = new Color3(0.02, 0.02, 0.02);
  }

  /** build the citadel centered at (cx, cz) */
  build(cx: number, cz: number, props: PropLibrary): CastleBuildResult {
    const g = (x: number, z: number) => this.terrain.height(x, z) + 0; // ground
    const base = g(cx, cz);
    const buildings: BuildingPlacement[] = [];
    const aabbs: CastleAabb[] = [];

    // ============ OUTER CURTAIN WALL (220m square, 16m tall) ============
    const HALF = 110;
    const WALL_H = 20;
    const THICK = 5;
    const sides: { x0: number; z0: number; x1: number; z1: number }[] = [
      { x0: -HALF, z0: -HALF, x1: HALF, z1: -HALF }, // north
      { x0: -HALF, z0: HALF, x1: HALF, z1: HALF }, // south (gate side)
      { x0: -HALF, z0: -HALF, x1: -HALF, z1: HALF }, // west
      { x0: HALF, z0: -HALF, x1: HALF, z1: HALF }, // east
    ];
    for (let i = 0; i < sides.length; i++) {
      const s = sides[i];
      const isSouth = i === 1;
      const midX = (s.x0 + s.x1) / 2;
      const midZ = (s.z0 + s.z1) / 2;
      if (isSouth) {
        // leave a 13m gate gap; two wall stubs
        this.wallSegment(cx + s.x0, cz + s.z0, cx - 6.5, cz + s.z0, WALL_H, THICK, base, aabbs);
        this.wallSegment(cx + 6.5, cz + s.z1, cx + s.x1, cz + s.z1, WALL_H, THICK, base, aabbs);
        continue;
      }
      this.wallSegment(cx + s.x0, cz + s.z0, cx + s.x1, cz + s.z1, WALL_H, THICK, base, aabbs);
      void midX;
      void midZ;
    }

    // outer towers: 4 corners + 2 midpoints on long sides → 8 destructible "wallTower"s
    const towerSpots: [number, number, string][] = [
      [-HALF, -HALF, "military"], [HALF, -HALF, "military"],
      [-HALF, HALF, "gate"], [HALF, HALF, "gate"],
      [-HALF, 0, "artillery"], [HALF, 0, "artillery"],
      [0, -HALF, "ruined"], [0, HALF - 26, "gate"],
    ];
    for (const [tx, tz, variant] of towerSpots) {
      buildings.push({
        kind: "grandTower",
        tag: "wallTower",
        pos: new Vector3(cx + tx, g(cx + tx, cz + tz), cz + tz),
        rotY: 0,
        variant,
        ...(variant === "ruined" ? { hpFraction: 0.45 } : {}),
      });
    }

    // gatehouse (destructible) spanning the south gap
    buildings.push({
      kind: "gate",
      tag: "gatehouse",
      pos: new Vector3(cx, g(cx, cz + HALF), cz + HALF),
      rotY: 0,
    });
    this.buildGateApproach(cx, cz + HALF + 14, props);

    // ============ INNER WARD WALL (110m square, 11m tall) ============
    const IH = 55;
    const IW_H = 11;
    const innerSides = [
      { x0: -IH, z0: -IH, x1: IH, z1: -IH },
      { x0: -IH, z0: IH, x1: IH - 22, z1: IH },
      { x0: IH - 0 + 22, z0: IH, x1: IH, z1: IH },
      { x0: -IH, z0: -IH, x1: -IH, z1: IH },
      { x0: IH, z0: -IH, x1: IH, z1: IH },
    ];
    for (const s of innerSides) {
      this.wallSegment(cx + s.x0, cz + s.z0, cx + s.x1, cz + s.z1, IW_H, 3.5, base + 1.2, aabbs, this.darkStoneMat);
    }
    for (const [tx, tz] of [[-IH, -IH], [IH, -IH], [-IH, IH], [IH, IH]] as [number, number][]) {
      this.staticTower(cx + tx, cz + tz, 9, 20, base + 1.2, this.darkStoneMat);
      aabbs.push({ x: cx + tx, z: cz + tz, hx: 6, hz: 6 });
    }

    // ============ CENTRAL KEEP (46m, destructible fortress) ============
    buildings.push({
      kind: "keep",
      tag: "keep",
      pos: new Vector3(cx, g(cx, cz), cz),
      rotY: 0,
      relicId: "dragonheartEssence",
    });
    // keep crown: static turrets on the fort roof corners (visual mass)
    for (const [kx, kz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as [number, number][]) {
      this.staticTower(cx + kx, cz + kz, 4.4, 12, base + 42, this.darkStoneMat);
    }

    // BLACKSTONE SPIRE — north landmark behind the keep (finale framing)
    this.staticTower(cx, cz - 85, 7, 58, base + 2, this.darkStoneMat);
    aabbs.push({ x: cx, z: cz - 85, hx: 7, hz: 7 });

    // barracks + chapel silhouettes in the outer ward (destructible)
    buildings.push({ kind: "barracks", tag: "barracks", pos: new Vector3(cx - 70, g(cx - 70, cz - 60), cz - 60), rotY: 0.1 });
    buildings.push({ kind: "barracks", tag: "supply", pos: new Vector3(cx + 68, g(cx + 68, cz - 58), cz - 58), rotY: -0.15, relicId: "emberCapacitor" });
    // great hall silhouette (static)
    this.greatHall(cx - 20, cz + 62, base, props);

    // ============ SURROUNDINGS ============
    // military camp east
    props.militaryCamp(cx + 190, cz + 40, 9, 34);
    // village south along the road
    props.villageCluster(cx - 30, cz + 210, 7, 40);
    // siege lines north
    props.place("siegeTower", cx - 30, cz - 190, { rotY: 0 });
    props.place("siegeTower", cx + 40, cz - 200, { rotY: 0.2 });
    props.battlefieldDebris(cx, cz - 170, 14, 45);
    // scorched field west
    props.battlefieldDebris(cx - 200, cz - 60, 10, 38);

    // courtyard dressing (inner ward + outer ward)
    props.castleCourtyard(cx, cz, IH * 0.85);
    props.militaryCamp(cx + 62, cz + 20, 4, 16);

    return {
      buildingPlacements: buildings,
      wallAabbs: aabbs,
      center: new Vector3(cx, base, cz),
      gatePosition: new Vector3(cx, base, cz + HALF + 8),
      radius: 190,
    };
  }

  /** one curtain-wall side with battlements + wall-walk; static + AABB collision */
  private wallSegment(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    height: number,
    thick: number,
    baseY: number,
    aabbs: CastleAabb[],
    mat = this.stoneMat
  ): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 4) return;
    const cxw = (x0 + x1) / 2;
    const czw = (z0 + z1) / 2;
    const yaw = Math.atan2(dx, dz);

    const parts: Mesh[] = [];
    const body = MeshBuilder.CreateBox("wseg", { width: thick, height: height, depth: len }, this.scene);
    body.position.y = height / 2 - 1;
    parts.push(body);
    // wall-walk parapet
    const parapet = MeshBuilder.CreateBox("wpar", { width: thick * 0.55, height: 1.4, depth: len }, this.scene);
    parapet.position.set(0, height / 2 + 0.4, 0);
    parts.push(parapet);
    // merlons (instancing would be nicer; merged here per segment — one mesh total)
    const merlonCount = Math.floor(len / 4);
    for (let i = 0; i < merlonCount; i++) {
      const m = MeshBuilder.CreateBox("wm", { width: thick * 0.6, height: 1.6, depth: 1.6 }, this.scene);
      m.position.set(0, height / 2 + 1.6, -len / 2 + 2.2 + i * 4);
      parts.push(m);
    }
    const seg = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    seg.material = mat;
    const holder = new TransformNode("wsegHolder", this.scene);
    holder.position.set(cxw, baseY, czw);
    holder.rotation.y = yaw + Math.PI / 2;
    seg.parent = holder;
    seg.isPickable = false;
    seg.receiveShadows = true;
    seg.freezeWorldMatrix();

    // AABB (axis-aligned approximation; walls are axis-aligned in this layout)
    const hx = Math.abs(dx) > Math.abs(dz) ? len / 2 : thick / 2;
    const hz = Math.abs(dx) > Math.abs(dz) ? thick / 2 : len / 2;
    aabbs.push({ x: cxw, z: czw, hx, hz });
  }

  private staticTower(x: number, z: number, radius: number, height: number, baseY: number, mat: StandardMaterial): void {
    const parts: Mesh[] = [];
    const body = MeshBuilder.CreateCylinder("stow", { diameter: radius * 2, height, tessellation: 9 }, this.scene);
    body.position.y = height / 2;
    parts.push(body);
    const top = MeshBuilder.CreateCylinder("stowt", { diameter: radius * 2.3, height: 1.6, tessellation: 9 }, this.scene);
    top.position.y = height + 0.6;
    parts.push(top);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const m = MeshBuilder.CreateBox("stowm", { width: 1, height: 1.4, depth: 1 }, this.scene);
      m.position.set(Math.cos(a) * radius * 1.05, height + 1.8, Math.sin(a) * radius * 1.05);
      parts.push(m);
    }
    const roof = MeshBuilder.CreateCylinder("stowr", { diameterTop: 0, diameterBottom: radius * 2.2, height: radius * 1.6, tessellation: 8 }, this.scene);
    roof.position.y = height + radius * 0.9 + 1.6;
    roof.material = this.roofMat;
    const t = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    t.material = mat;
    const holder = new TransformNode("stowHolder", this.scene);
    holder.position.set(x, baseY, z);
    t.parent = holder;
    roof.parent = holder;
    t.isPickable = false;
    t.freezeWorldMatrix();
    roof.freezeWorldMatrix();
  }

  private buildGateApproach(x: number, z: number, props: PropLibrary): void {
    // raised bridge + banners + braziers flanking the gate
    const bridge = MeshBuilder.CreateBox("gateBridge", { width: 10, height: 1.2, depth: 18 }, this.scene);
    bridge.material = this.stoneMat;
    bridge.position.set(x, this.terrain.height(x, z) + 0.7, z);
    bridge.isPickable = false;
    bridge.freezeWorldMatrix();
    props.place("banner", x - 7, z + 2, { rotY: Math.PI });
    props.place("banner", x + 7, z + 2, { rotY: Math.PI });
    props.place("brazier", x - 5, z - 6);
    props.place("brazier", x + 5, z - 6);
  }

  private greatHall(x: number, z: number, baseY: number, props: PropLibrary): void {
    const parts: Mesh[] = [];
    const hall = MeshBuilder.CreateBox("gh", { width: 22, height: 12, depth: 34 }, this.scene);
    hall.position.y = 6;
    parts.push(hall);
    const roof = MeshBuilder.CreateCylinder("ghr", { diameterTop: 0, diameterBottom: 24, height: 8, tessellation: 4 }, this.scene);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 15.5;
    parts.push(roof);
    const tower = MeshBuilder.CreateCylinder("ght", { diameterTop: 2, diameterBottom: 5, height: 24, tessellation: 6 }, this.scene);
    tower.position.set(-8, 12, 14);
    parts.push(tower);
    const hallMesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    hallMesh.material = this.darkStoneMat;
    const holder = new TransformNode("ghHolder", this.scene);
    holder.position.set(x, baseY, z);
    hallMesh.parent = holder;
    hallMesh.isPickable = false;
    hallMesh.freezeWorldMatrix();
    props.place("brazier", x + 13, z);
    props.place("brazier", x - 13, z);
  }
}
