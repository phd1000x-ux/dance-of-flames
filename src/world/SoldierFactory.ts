import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { EnemyDefinition } from "../data/enemies";
import type { RiderDefinition } from "../data/riders";

/** Procedural low-poly soldiers + ballistae + ground-mode rider. */
export class SoldierFactory {
  private bodyMat: StandardMaterial;
  private burningMat: StandardMaterial;
  private deadMat: StandardMaterial;
  private metalMat: StandardMaterial;

  constructor(private scene: Scene) {
    this.bodyMat = new StandardMaterial("soldierBody", scene);
    this.bodyMat.specularColor = new Color3(0.08, 0.08, 0.08);
    this.burningMat = new StandardMaterial("soldierBurning", scene);
    this.burningMat.diffuseColor = new Color3(0.35, 0.12, 0.04);
    this.burningMat.emissiveColor = new Color3(0.85, 0.3, 0.05);
    this.deadMat = new StandardMaterial("soldierDead", scene);
    this.deadMat.diffuseColor = new Color3(0.18, 0.16, 0.14);
    this.deadMat.emissiveColor = Color3.Black();
    this.metalMat = new StandardMaterial("soldierMetal", scene);
    this.metalMat.diffuseColor = new Color3(0.55, 0.55, 0.6);
    this.metalMat.specularColor = new Color3(0.7, 0.7, 0.75);
  }

  /** One merged soldier mesh (torso/head/legs + type-specific weapon). */
  createSoldier(def: EnemyDefinition): { root: TransformNode; mesh: Mesh } {
    const s = def.scale;
    const root = new TransformNode(`soldier-${def.id}-${Math.random().toString(36).slice(2, 7)}`, this.scene);
    const parts: Mesh[] = [];

    const torso = MeshBuilder.CreateCapsule("s-torso", { height: 1.0 * s, radius: 0.26 * s, tessellation: 6, subdivisions: 1 }, this.scene);
    torso.position.y = 1.0 * s;
    parts.push(torso);
    const head = MeshBuilder.CreateSphere("s-head", { diameter: 0.34 * s, segments: 4 }, this.scene);
    head.position.y = 1.68 * s;
    parts.push(head);
    const helmet = MeshBuilder.CreateCylinder("s-helmet", { diameterTop: 0.02, diameterBottom: 0.3 * s, height: 0.22 * s, tessellation: 6 }, this.scene);
    helmet.position.y = 1.84 * s;
    parts.push(helmet);
    for (const lx of [-0.12, 0.12]) {
      const leg = MeshBuilder.CreateBox("s-leg", { width: 0.13 * s, height: 0.62 * s, depth: 0.15 * s }, this.scene);
      leg.position.set(lx * s, 0.32 * s, 0);
      parts.push(leg);
    }

    switch (def.role) {
      case "archer": {
        const bow = MeshBuilder.CreateBox("s-bow", { width: 0.06, height: 0.95 * s, depth: 0.06 }, this.scene);
        bow.position.set(0.32 * s, 1.15 * s, 0.12);
        parts.push(bow);
        break;
      }
      case "spear": {
        const spear = MeshBuilder.CreateCylinder("s-spear", { diameter: 0.05, height: 2.6 * s, tessellation: 4 }, this.scene);
        spear.position.set(0.3 * s, 1.2 * s, 0.1);
        spear.rotation.z = 0.12;
        parts.push(spear);
        break;
      }
      case "shield":
      case "infantry": {
        const sword = MeshBuilder.CreateBox("s-sword", { width: 0.05, height: 0.8 * s, depth: 0.12 }, this.scene);
        sword.position.set(0.34 * s, 1.2 * s, 0.16);
        sword.rotation.x = 0.5;
        parts.push(sword);
        if (def.role === "shield") {
          const shield = MeshBuilder.CreateCylinder("s-shield", { diameter: 0.62 * s, height: 0.07, tessellation: 8 }, this.scene);
          shield.rotation.x = Math.PI / 2;
          shield.position.set(-0.36 * s, 1.1 * s, 0.18);
          parts.push(shield);
        }
        break;
      }
      case "elite":
      case "commander": {
        const plate = MeshBuilder.CreateBox("s-plate", { width: 0.68 * s, height: 0.55 * s, depth: 0.42 * s }, this.scene);
        plate.position.y = 1.2 * s;
        parts.push(plate);
        const plume = MeshBuilder.CreateCylinder("s-plume", { diameterTop: 0.02, diameterBottom: 0.14 * s, height: 0.42 * s, tessellation: 4 }, this.scene);
        plume.position.y = 2.0 * s;
        parts.push(plume);
        const greatsword = MeshBuilder.CreateBox("s-gsword", { width: 0.09, height: 1.25 * s, depth: 0.16 }, this.scene);
        greatsword.position.set(0.4 * s, 1.15 * s, 0.12);
        parts.push(greatsword);
        break;
      }
      default:
        break;
    }

    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    mesh.parent = root;
    const c = Color3.FromHexString(def.color);
    const mat = this.bodyMat.clone(`soldierMat-${mesh.uniqueId}`);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.15);
    mesh.material = mat;
    mesh.isPickable = false;
    return { root, mesh };
  }

  setSoldierState(mesh: Mesh, state: "normal" | "burning" | "dead"): void {
    if (state === "burning") mesh.material = this.burningMat;
    else if (state === "dead") mesh.material = this.deadMat;
  }

  /** Ballista with rotating turret. */
  createBallista(def: EnemyDefinition): { root: TransformNode; turret: TransformNode; railGlow: StandardMaterial } {
    const root = new TransformNode("ballista", this.scene);
    const base = MeshBuilder.CreateBox("b-base", { width: 2.6, height: 0.6, depth: 2.2 }, this.scene);
    base.position.y = 0.3;
    const woodMat = new StandardMaterial("ballistaWood", this.scene);
    woodMat.diffuseColor = Color3.FromHexString(def.color);
    woodMat.emissiveColor = new Color3(0.08, 0.06, 0.02);
    base.material = woodMat;
    base.parent = root;
    for (const wx of [-1.2, 1.2]) {
      const wheel = MeshBuilder.CreateCylinder("b-wheel", { diameter: 1.3, height: 0.22, tessellation: 10 }, this.scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.65, 0);
      wheel.material = woodMat;
      wheel.parent = root;
    }

    const turret = new TransformNode("b-turret", this.scene);
    turret.parent = root;
    turret.position.y = 0.75;
    const railMat = new StandardMaterial("ballistaRail", this.scene);
    railMat.diffuseColor = new Color3(0.4, 0.38, 0.36);
    railMat.specularColor = new Color3(0.5, 0.5, 0.5);
    railMat.emissiveColor = Color3.Black();
    const rail = MeshBuilder.CreateBox("b-rail", { width: 0.3, height: 0.24, depth: 3.4 }, this.scene);
    rail.position.set(0, 0.3, 0.6);
    rail.material = railMat;
    rail.parent = turret;
    const bowArm = MeshBuilder.CreateBox("b-arm", { width: 2.8, height: 0.18, depth: 0.18 }, this.scene);
    bowArm.position.set(0, 0.3, 2.1);
    bowArm.material = railMat;
    bowArm.parent = turret;
    const bolt = MeshBuilder.CreateBox("b-bolt", { width: 0.16, height: 0.16, depth: 2.4 }, this.scene);
    bolt.position.set(0, 0.36, 1.2);
    bolt.material = railMat;
    bolt.parent = turret;
    return { root, turret, railGlow: railMat };
  }

  /** Ground-mode humanoid rider with sword. */
  createRiderFigure(def: RiderDefinition): {
    root: TransformNode;
    body: Mesh;
    swordPivot: TransformNode;
    shieldMesh: Mesh;
  } {
    const root = new TransformNode("riderGround", this.scene);
    const mat = new StandardMaterial("riderGroundMat", this.scene);
    const c = Color3.FromHexString(def.color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.12);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);

    const parts: Mesh[] = [];
    const torso = MeshBuilder.CreateCapsule("g-torso", { height: 0.95, radius: 0.26, tessellation: 8, subdivisions: 1 }, this.scene);
    torso.position.y = 1.15;
    parts.push(torso);
    const head = MeshBuilder.CreateSphere("g-head", { diameter: 0.38, segments: 6 }, this.scene);
    head.position.y = 1.85;
    parts.push(head);
    for (const lx of [-0.14, 0.14]) {
      const leg = MeshBuilder.CreateBox("g-leg", { width: 0.15, height: 0.72, depth: 0.17 }, this.scene);
      leg.position.set(lx, 0.38, 0);
      parts.push(leg);
    }
    for (const ax of [-0.32, 0.32]) {
      const arm = MeshBuilder.CreateCapsule("g-arm", { height: 0.6, radius: 0.09, tessellation: 6, subdivisions: 1 }, this.scene);
      arm.position.set(ax, 1.25, 0.05);
      arm.rotation.z = ax > 0 ? -0.25 : 0.25;
      parts.push(arm);
    }
    const cloak = MeshBuilder.CreateBox("g-cloak", { width: 0.62, height: 0.95, depth: 0.08 }, this.scene);
    cloak.position.set(0, 1.15, -0.28);
    cloak.rotation.x = 0.15;
    parts.push(cloak);

    const body = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    body.parent = root;
    body.material = mat;
    body.isPickable = false;

    const swordPivot = new TransformNode("swordPivot", this.scene);
    swordPivot.parent = root;
    swordPivot.position.set(0.38, 1.25, 0.1);
    const bladeMat = new StandardMaterial("bladeMat", this.scene);
    bladeMat.diffuseColor = new Color3(0.8, 0.8, 0.86);
    bladeMat.specularColor = new Color3(0.9, 0.9, 1);
    const blade = MeshBuilder.CreateBox("blade", { width: 0.07, height: 1.1, depth: 0.18 }, this.scene);
    blade.position.set(0, 0.6, 0);
    blade.material = bladeMat;
    blade.parent = swordPivot;
    const guard = MeshBuilder.CreateBox("guard", { width: 0.26, height: 0.06, depth: 0.2 }, this.scene);
    guard.position.y = 0.06;
    guard.material = bladeMat;
    guard.parent = swordPivot;

    const shieldMesh = MeshBuilder.CreateCylinder("riderShield", { diameter: 0.66, height: 0.08, tessellation: 10 }, this.scene);
    shieldMesh.rotation.x = Math.PI / 2;
    shieldMesh.rotation.y = Math.PI / 2;
    shieldMesh.position.set(-0.42, 1.15, 0.12);
    const shieldMat = new StandardMaterial("shieldMat", this.scene);
    shieldMat.diffuseColor = c.scale(0.6);
    shieldMat.emissiveColor = c.scale(0.1);
    shieldMesh.material = shieldMat;
    shieldMesh.parent = root;

    return { root, body, swordPivot, shieldMesh };
  }
}

export function disposeTree(node: TransformNode): void {
  const meshes = node.getChildMeshes();
  for (const m of meshes) {
    const mat = m.material;
    if (mat && mat.name.startsWith("soldierMat-")) mat.dispose();
  }
  node.dispose(false, true);
  void meshes;
}

export const tmp = new Vector3();
