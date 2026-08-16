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
    body: TransformNode;
    swordPivot: TransformNode;
    shieldMesh: TransformNode;
  } {
    const root = new TransformNode("riderGround", this.scene);
    const look = def.look;
    const female = look.gender === "female";
    const build = look.build;
    // PROTAGONIST SCALE 1.5x — same character as the mounted rider
    root.scaling.setAll(1.5);
    const c = Color3.FromHexString(def.color);

    // distinct material types: leather / metal / cloth / hair / skin (look colors)
    const leather = new StandardMaterial("gLeather", this.scene);
    leather.diffuseColor = new Color3(0.24, 0.15, 0.1);
    leather.specularColor = new Color3(0.09, 0.07, 0.06);
    const metal = new StandardMaterial("gMetal", this.scene);
    metal.diffuseColor = new Color3(0.55, 0.56, 0.62);
    metal.specularColor = new Color3(0.85, 0.86, 0.92);
    metal.specularPower = 96;
    const cloth = new StandardMaterial("gCloth", this.scene);
    cloth.diffuseColor = c;
    cloth.emissiveColor = c.scale(0.12);
    cloth.specularColor = new Color3(0.04, 0.04, 0.04);
    const hairMat = new StandardMaterial("gHair", this.scene);
    hairMat.diffuseColor = Color3.FromHexString(look.hairColor);
    hairMat.specularColor = new Color3(0.14, 0.11, 0.09);
    const skinMat = new StandardMaterial("gSkin", this.scene);
    skinMat.diffuseColor = Color3.FromHexString(look.skin);
    skinMat.specularColor = new Color3(0.16, 0.13, 0.11);

    const attach = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode) => {
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
    };

    const shoulderW = (female ? 0.86 : 1.0) * build;
    const hipW = female ? 1.1 : 1.0;

    // torso group (walk bob + attack lean applied here by the controller)
    const torsoPivot = new TransformNode("gTorsoPivot", this.scene);
    torsoPivot.parent = root;
    const pelvis = MeshBuilder.CreateBox("g-pelvis", { width: 0.42 * hipW, height: 0.2, depth: 0.3 }, this.scene);
    pelvis.position.y = 0.88;
    attach(pelvis, cloth, torsoPivot);
    const chest = MeshBuilder.CreateCapsule("g-chest", { height: 0.72, radius: 0.24 * (female ? 0.94 : 1) * build, tessellation: 8, subdivisions: 1 }, this.scene);
    chest.position.y = 1.25;
    attach(chest, leather, torsoPivot);
    const plate = MeshBuilder.CreateBox("g-plate", { width: 0.46 * shoulderW, height: 0.42, depth: 0.34 }, this.scene);
    plate.position.set(0, 1.28, 0.02);
    attach(plate, metal, torsoPivot);
    const belt = MeshBuilder.CreateBox("g-belt", { width: 0.47 * hipW, height: 0.07, depth: 0.35 }, this.scene);
    belt.position.y = 1.0;
    attach(belt, leather, torsoPivot);
    for (const sx of [-0.26, 0.26]) {
      const pauldron = MeshBuilder.CreateSphere(`g-pauldron${sx}`, { diameterX: 0.22 * shoulderW, diameterY: 0.15, diameterZ: 0.24, segments: 6 }, this.scene);
      pauldron.position.set(sx * shoulderW, 1.52, 0);
      attach(pauldron, metal, torsoPivot);
    }
    // head + hairstyle + face identity
    const headPivot = new TransformNode("gHeadPivot", this.scene);
    headPivot.parent = torsoPivot;
    headPivot.position.y = 1.66;
    const skull = MeshBuilder.CreateSphere("g-skull", { diameterX: 0.2, diameterY: 0.24, diameterZ: 0.22, segments: 6 }, this.scene);
    attach(skull, skinMat, headPivot);
    const nose = MeshBuilder.CreateBox("g-nose", { width: 0.045, height: 0.07, depth: 0.06 }, this.scene);
    nose.position.set(0, -0.01, 0.11);
    attach(nose, skinMat, headPivot);
    const hairCap = MeshBuilder.CreateSphere("g-hair", { diameterX: 0.22, diameterY: 0.23, diameterZ: 0.22, segments: 6 }, this.scene);
    hairCap.position.set(0, 0.05, -0.03);
    hairCap.scaling.y = 0.82;
    attach(hairCap, hairMat, headPivot);

    switch (look.hairStyle) {
      case "long": {
        const back = MeshBuilder.CreateBox("g-hairL", { width: 0.2, height: 0.72, depth: 0.05 }, this.scene);
        back.position.set(0, -0.3, -0.11);
        attach(back, hairMat, headPivot);
        for (const fx of [-0.11, 0.11]) {
          const strand = MeshBuilder.CreateBox(`g-hairS${fx}`, { width: 0.045, height: 0.5, depth: 0.045 }, this.scene);
          strand.position.set(fx, -0.18, 0.075);
          attach(strand, hairMat, headPivot);
        }
        break;
      }
      case "braids": {
        for (const bx of [-0.1, 0.1]) {
          const braid = MeshBuilder.CreateCylinder(`g-braid${bx}`, { diameter: 0.06, height: 0.6, tessellation: 5 }, this.scene);
          braid.position.set(bx, -0.34, -0.1);
          braid.rotation.x = 0.12;
          attach(braid, hairMat, headPivot);
          const tie = MeshBuilder.CreateSphere(`g-tie${bx}`, { diameter: 0.07, segments: 4 }, this.scene);
          tie.position.set(bx, -0.64, -0.06);
          attach(tie, metal, headPivot);
        }
        break;
      }
      case "topknot": {
        const bun = MeshBuilder.CreateSphere("g-bun", { diameter: 0.13, segments: 6 }, this.scene);
        bun.position.set(0, 0.16, -0.02);
        attach(bun, hairMat, headPivot);
        break;
      }
      case "ponytail": {
        const tail = MeshBuilder.CreateCapsule("g-tail", { height: 0.5, radius: 0.05, tessellation: 6, subdivisions: 1 }, this.scene);
        tail.position.set(0, -0.18, -0.16);
        tail.rotation.x = 0.5;
        attach(tail, hairMat, headPivot);
        break;
      }
      case "buzz": {
        hairCap.scaling.scaleInPlace(0.94);
        break;
      }
      case "short":
      default: {
        const back = MeshBuilder.CreateBox("g-hairSh", { width: 0.17, height: 0.22, depth: 0.06 }, this.scene);
        back.position.set(0, -0.04, -0.1);
        attach(back, hairMat, headPivot);
        break;
      }
    }
    if (look.face === "eyepatch") {
      const patchMat = new StandardMaterial("gPatchM", this.scene);
      patchMat.diffuseColor = new Color3(0.05, 0.04, 0.03);
      const patch = MeshBuilder.CreateBox("g-patch", { width: 0.085, height: 0.07, depth: 0.03 }, this.scene);
      patch.position.set(0.055, 0.02, 0.1);
      attach(patch, patchMat, headPivot);
      const band = MeshBuilder.CreateBox("g-band", { width: 0.24, height: 0.025, depth: 0.22 }, this.scene);
      band.position.set(0, 0.03, 0);
      attach(band, patchMat, headPivot);
    } else if (look.face === "beard") {
      const beard = MeshBuilder.CreateBox("g-beard", { width: 0.14, height: 0.1, depth: 0.06 }, this.scene);
      beard.position.set(0, -0.1, 0.075);
      attach(beard, hairMat, headPivot);
    } else if (look.face === "crownBraid") {
      const gold = new StandardMaterial("gGoldM", this.scene);
      gold.diffuseColor = new Color3(0.85, 0.68, 0.3);
      gold.specularColor = new Color3(0.9, 0.8, 0.5);
      gold.specularPower = 64;
      const circlet = MeshBuilder.CreateCylinder("g-circlet", { diameter: 0.2, height: 0.03, tessellation: 10 }, this.scene);
      circlet.position.set(0, 0.11, 0);
      attach(circlet, gold, headPivot);
    }
    // cloak
    const cloak = MeshBuilder.CreateBox("g-cloak", { width: 0.6, height: female ? 1.05 : 1.0, depth: 0.06 }, this.scene);
    cloak.position.set(0, 1.15, -0.24);
    cloak.rotation.x = 0.12;
    attach(cloak, cloth, torsoPivot);

    // arms
    for (const ax of [-0.33, 0.33]) {
      const upper = MeshBuilder.CreateCapsule(`g-armU${ax}`, { height: 0.34, radius: 0.06, tessellation: 6, subdivisions: 1 }, this.scene);
      upper.position.set(ax * shoulderW, 1.44, 0.04);
      upper.rotation.z = ax > 0 ? -0.3 : 0.3;
      attach(upper, leather, torsoPivot);
      const fore = MeshBuilder.CreateCapsule(`g-armF${ax}`, { height: 0.32, radius: 0.05, tessellation: 6, subdivisions: 1 }, this.scene);
      fore.position.set(ax * shoulderW, 1.18, 0.12);
      fore.rotation.z = ax > 0 ? -0.15 : 0.15;
      attach(fore, skinMat, torsoPivot);
      const glove = MeshBuilder.CreateSphere(`g-glove${ax}`, { diameter: 0.11, segments: 5 }, this.scene);
      glove.position.set(ax * shoulderW, 1.02, 0.14);
      attach(glove, leather, torsoPivot);
    }

    // legs with boots
    const legParts: Mesh[] = [];
    for (const lx of [-0.15, 0.15]) {
      const thigh = MeshBuilder.CreateCapsule(`g-thigh${lx}`, { height: 0.44, radius: 0.085 * hipW, tessellation: 6, subdivisions: 1 }, this.scene);
      thigh.position.set(lx, 0.66, 0);
      legParts.push(thigh);
      const shin = MeshBuilder.CreateCapsule(`g-shin${lx}`, { height: 0.4, radius: 0.07, tessellation: 6, subdivisions: 1 }, this.scene);
      shin.position.set(lx, 0.28, 0.01);
      legParts.push(shin);
      const boot = MeshBuilder.CreateBox(`g-boot${lx}`, { width: 0.15, height: 0.13, depth: 0.27 }, this.scene);
      boot.position.set(lx, 0.07, 0.04);
      legParts.push(boot);
    }
    const legs = Mesh.MergeMeshes(legParts, true, true, undefined, false, false)!;
    legs.material = leather;
    legs.isPickable = false;

    // body group: everything rotates together for dodge-roll / death (RiderController)
    const body = new TransformNode("gBody", this.scene);
    body.parent = root;
    torsoPivot.parent = body;
    legs.parent = body;
    const bodyProxy = MeshBuilder.CreateBox("g-bodyProxy", { width: 0.01, height: 0.01, depth: 0.01 }, this.scene);
    bodyProxy.isVisible = false;
    bodyProxy.parent = body;

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
