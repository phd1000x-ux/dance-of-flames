import {
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { DragonDefinition } from "../data/dragons";
import { damp } from "../core/MathUtils";

export interface DragonAnimParams {
  flapRate: number; // rad/s
  flapAmp: number; // 0..1
  sweep: number; // 0..1 wing fold for dive/boost
  jawOpen: number; // 0..1
  dt: number;
}

/**
 * Procedural low-poly dragon: body / neck / head / jaw / wings / legs / tail / saddle + rider.
 * Forward is +Z. All sizes scale with the dragon definition.
 */
export class DragonRig {
  readonly root: TransformNode;
  readonly headTip: TransformNode;
  readonly headPivot: TransformNode;
  private wingInnerL: TransformNode;
  private wingInnerR: TransformNode;
  private wingOuterL: TransformNode;
  private wingOuterR: TransformNode;
  private tailSegs: TransformNode[] = [];
  private neckPivot: TransformNode;
  private jawPivot: TransformNode;
  private riderFigure: TransformNode;
  private flapPhase = 0;
  private flapSmooth = 0;
  private tailPhase = 0;
  private readonly mat: StandardMaterial;

  constructor(private scene: Scene, private def: DragonDefinition) {
    const s = def.scale;
    this.root = new TransformNode(`dragon-${def.id}`, scene);

    this.mat = new StandardMaterial(`dragonMat-${def.id}`, scene);
    const body = Color3.FromHexString(def.bodyColor);
    this.mat.diffuseColor = body;
    this.mat.specularColor = new Color3(0.12, 0.12, 0.12);
    this.mat.emissiveColor = body.scale(0.12);

    const wingMat = new StandardMaterial(`wingMat-${def.id}`, scene);
    const wing = Color3.FromHexString(def.wingColor);
    wingMat.diffuseColor = wing;
    wingMat.emissiveColor = wing.scale(0.1);
    wingMat.specularColor = new Color3(0.05, 0.05, 0.05);
    wingMat.backFaceCulling = false;
    wingMat.alpha = 0.96;

    const accentMat = new StandardMaterial(`accentMat-${def.id}`, scene);
    const accent = Color3.FromHexString(def.accentColor);
    accentMat.diffuseColor = accent;
    accentMat.emissiveColor = accent.scale(0.08);

    // ---- body (merged: torso + chest + legs + spikes) ----
    const parts: Mesh[] = [];
    const torso = MeshBuilder.CreateCapsule(`torso`, { height: 5.4 * s, radius: 0.95 * s, tessellation: 8, subdivisions: 2 }, scene);
    torso.rotation.x = Math.PI / 2;
    parts.push(torso);
    const chest = MeshBuilder.CreateCapsule(`chest`, { height: 3.2 * s, radius: 1.12 * s, tessellation: 8, subdivisions: 2 }, scene);
    chest.rotation.x = Math.PI / 2;
    chest.position.set(0, 0.06 * s, 1.1 * s);
    parts.push(chest);
    for (let i = 0; i < 6; i++) {
      const spike = MeshBuilder.CreateCylinder(`spike${i}`, { diameterTop: 0, diameterBottom: 0.34 * s, height: (0.55 - i * 0.05) * s, tessellation: 4 }, scene);
      spike.position.set(0, (0.95 - i * 0.06) * s, (1.8 - i * 0.75) * s);
      parts.push(spike);
    }
    // 4 tucked legs
    const legDefs: [number, number][] = [
      [0.8, 0.9], [-0.8, 0.9], [0.85, -1.3], [-0.85, -1.3],
    ];
    for (const [lx, lz] of legDefs) {
      const leg = MeshBuilder.CreateCapsule(`leg${lx}${lz}`, { height: 1.5 * s, radius: 0.24 * s, tessellation: 6, subdivisions: 1 }, scene);
      leg.position.set(lx * s, -0.55 * s, lz * s);
      leg.rotation.z = lx > 0 ? -0.5 : 0.5;
      leg.rotation.x = -0.45;
      parts.push(leg);
    }
    const bodyMesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    bodyMesh.material = accentMat;
    bodyMesh.parent = this.root;
    bodyMesh.name = `dragon-${def.id}-body`;

    // ---- neck ----
    this.neckPivot = new TransformNode("neckPivot", scene);
    this.neckPivot.parent = this.root;
    this.neckPivot.position.set(0, 0.55 * s, 2.5 * s);
    const neckParts: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const seg = MeshBuilder.CreateCapsule(`neckSeg${i}`, { height: 1.5 * s, radius: (0.52 - i * 0.07) * s, tessellation: 8, subdivisions: 1 }, scene);
      seg.rotation.x = Math.PI / 2 - 0.55 - i * 0.1;
      seg.position.set(0, (0.42 + i * 0.5) * s, (0.55 + i * 0.72) * s);
      neckParts.push(seg);
    }
    const neckMesh = Mesh.MergeMeshes(neckParts, true, true, undefined, false, false)!;
    neckMesh.material = this.mat;
    neckMesh.parent = this.neckPivot;

    // ---- head ----
    this.headPivot = new TransformNode("headPivot", scene);
    this.headPivot.parent = this.neckPivot;
    this.headPivot.position.set(0, 2.1 * s, 2.6 * s);
    const headParts: Mesh[] = [];
    const skull = MeshBuilder.CreateBox(`skull`, { width: 0.85 * s, height: 0.62 * s, depth: 1.15 * s }, scene);
    headParts.push(skull);
    const snout = MeshBuilder.CreateBox(`snout`, { width: 0.55 * s, height: 0.4 * s, depth: 0.7 * s }, scene);
    snout.position.set(0, -0.08 * s, 0.85 * s);
    headParts.push(snout);
    for (const hx of [-0.28, 0.28]) {
      const horn = MeshBuilder.CreateCylinder(`horn${hx}`, { diameterTop: 0, diameterBottom: 0.16 * s, height: 0.85 * s, tessellation: 5 }, scene);
      horn.position.set(hx * s, 0.42 * s, -0.32 * s);
      horn.rotation.x = -0.8;
      headParts.push(horn);
    }
    const brow = MeshBuilder.CreateBox(`brow`, { width: 0.9 * s, height: 0.14 * s, depth: 0.3 * s }, scene);
    brow.position.set(0, 0.3 * s, 0.42 * s);
    headParts.push(brow);
    const headMesh = Mesh.MergeMeshes(headParts, true, true, undefined, false, false)!;
    headMesh.material = this.mat;
    headMesh.parent = this.headPivot;

    // jaw (animated for fire)
    this.jawPivot = new TransformNode("jawPivot", scene);
    this.jawPivot.parent = this.headPivot;
    this.jawPivot.position.set(0, -0.2 * s, 0.15 * s);
    const jaw = MeshBuilder.CreateBox(`jaw`, { width: 0.5 * s, height: 0.14 * s, depth: 0.9 * s }, scene);
    jaw.position.set(0, -0.05 * s, 0.45 * s);
    jaw.material = accentMat;
    jaw.parent = this.jawPivot;

    this.headTip = new TransformNode("headTip", scene);
    this.headTip.parent = this.headPivot;
    this.headTip.position.set(0, -0.05 * s, 1.35 * s);

    // ---- tail ----
    let tailParent: TransformNode = new TransformNode("tailPivot", scene);
    tailParent.parent = this.root;
    tailParent.position.set(0, 0.15 * s, -2.6 * s);
    for (let i = 0; i < 5; i++) {
      const segPivot = new TransformNode(`tailSeg${i}`, scene);
      segPivot.parent = tailParent;
      segPivot.position.set(0, i === 0 ? 0 : 0, -1.05 * s);
      const seg = MeshBuilder.CreateCapsule(`tailM${i}`, { height: 1.15 * s, radius: (0.5 - i * 0.08) * s, tessellation: 6, subdivisions: 1 }, scene);
      seg.rotation.x = Math.PI / 2;
      seg.position.z = -0.5 * s;
      seg.material = this.mat;
      seg.parent = segPivot;
      this.tailSegs.push(segPivot);
      tailParent = segPivot;
    }
    const fin = MeshBuilder.CreateBox(`tailFin`, { width: 0.06 * s, height: 0.9 * s, depth: 0.7 * s }, scene);
    fin.position.set(0, 0, -1.1 * s);
    fin.material = wingMat;
    fin.parent = tailParent;

    // ---- wings ----
    const makeWing = (side: 1 | -1): { inner: TransformNode; outer: TransformNode } => {
      const inner = new TransformNode(`wingInner${side}`, scene);
      inner.parent = this.root;
      inner.position.set(side * 0.85 * s, 0.62 * s, 0.55 * s);
      const armBone = MeshBuilder.CreateCapsule(`armBone${side}`, { height: 3.1 * s, radius: 0.13 * s, tessellation: 6, subdivisions: 1 }, scene);
      armBone.rotation.z = Math.PI / 2;
      armBone.position.set(side * 1.5 * s, 0, 0);
      armBone.material = this.mat;
      armBone.parent = inner;
      const membrane1 = MeshBuilder.CreatePlane(`membrane1-${side}`, { width: 2.6 * s, height: 3.4 * s }, scene);
      membrane1.rotation.x = Math.PI / 2;
      membrane1.rotation.y = Math.PI / 2;
      membrane1.position.set(side * 1.35 * s, -0.28 * s, -0.7 * s);
      membrane1.material = wingMat;
      membrane1.parent = inner;

      const outer = new TransformNode(`wingOuter${side}`, scene);
      outer.parent = inner;
      outer.position.set(side * 3.0 * s, 0, 0);
      const outerBone = MeshBuilder.CreateCapsule(`outerBone${side}`, { height: 3.3 * s, radius: 0.09 * s, tessellation: 6, subdivisions: 1 }, scene);
      outerBone.rotation.z = Math.PI / 2;
      outerBone.position.set(side * 1.6 * s, 0, 0);
      outerBone.material = this.mat;
      outerBone.parent = outer;
      const membrane2 = MeshBuilder.CreatePlane(`membrane2-${side}`, { width: 3.1 * s, height: 2.9 * s }, scene);
      membrane2.rotation.x = Math.PI / 2;
      membrane2.rotation.y = Math.PI / 2;
      membrane2.position.set(side * 1.5 * s, -0.2 * s, -0.5 * s);
      membrane2.material = wingMat;
      membrane2.parent = outer;
      const claw = MeshBuilder.CreateCylinder(`claw${side}`, { diameterTop: 0, diameterBottom: 0.12 * s, height: 0.3 * s, tessellation: 4 }, scene);
      claw.position.set(side * 3.2 * s, 0, 0);
      claw.material = this.mat;
      claw.parent = outer;
      return { inner, outer };
    };
    const wl = makeWing(1);
    const wr = makeWing(-1);
    this.wingInnerL = wl.inner;
    this.wingOuterL = wl.outer;
    this.wingInnerR = wr.inner;
    this.wingOuterR = wr.outer;

    // ---- saddle + seated rider ----
    this.riderFigure = new TransformNode("riderFigure", scene);
    this.riderFigure.parent = this.root;
    this.riderFigure.position.set(0, 1.05 * s, 0.1 * s);
    const saddle = MeshBuilder.CreateBox(`saddle`, { width: 0.9 * s, height: 0.22 * s, depth: 1.0 * s }, scene);
    saddle.material = accentMat;
    saddle.parent = this.riderFigure;
    const riderMat = new StandardMaterial(`riderMat-${def.id}`, scene);
    riderMat.diffuseColor = new Color3(0.2, 0.2, 0.24);
    riderMat.emissiveColor = new Color3(0.05, 0.05, 0.06);
    const rTorso = MeshBuilder.CreateCapsule(`rTorso`, { height: 0.75, radius: 0.22, tessellation: 6, subdivisions: 1 }, scene);
    rTorso.position.y = 0.48;
    rTorso.material = riderMat;
    rTorso.parent = this.riderFigure;
    const rHead = MeshBuilder.CreateSphere(`rHead`, { diameter: 0.36, segments: 5 }, scene);
    rHead.position.y = 1.0;
    rHead.material = riderMat;
    rHead.parent = this.riderFigure;
    const rCloak = MeshBuilder.CreateBox(`rCloak`, { width: 0.55, height: 0.7, depth: 0.08 }, scene);
    rCloak.position.set(0, 0.42, -0.24);
    rCloak.rotation.x = 0.25;
    rCloak.material = riderMat;
    rCloak.parent = this.riderFigure;

    this.root.rotationQuaternion = Quaternion.Identity();
  }

  setRiderVisible(v: boolean): void {
    this.riderFigure.getChildMeshes().forEach((m) => (m.isVisible = v));
  }

  animate(p: DragonAnimParams): void {
    this.flapPhase += p.flapRate * p.dt;
    this.flapSmooth = damp(this.flapSmooth, p.flapAmp, 6, p.dt);
    this.tailPhase += p.dt * 2.2;
    const flap = Math.sin(this.flapPhase);
    const flapLag = Math.sin(this.flapPhase - 0.6);
    const amp = this.flapSmooth * 0.75;

    const dihedral = 0.18;
    // left wing (side +X): positive z-rotation lifts tip
    this.wingInnerL.rotation.z = dihedral + flap * amp;
    this.wingInnerL.rotation.y = -p.sweep * 0.95;
    this.wingOuterL.rotation.z = -0.2 + flapLag * amp * 1.25;
    this.wingOuterL.rotation.y = -p.sweep * 0.65;
    // right wing mirrored
    this.wingInnerR.rotation.z = -(dihedral + flap * amp);
    this.wingInnerR.rotation.y = p.sweep * 0.95;
    this.wingOuterR.rotation.z = -(-0.2 + flapLag * amp * 1.25);
    this.wingOuterR.rotation.y = p.sweep * 0.65;

    // tail sway
    for (let i = 0; i < this.tailSegs.length; i++) {
      this.tailSegs[i].rotation.y = Math.sin(this.tailPhase - i * 0.55) * 0.16;
    }
    // neck bob & aim pose
    this.neckPivot.rotation.x = 0.08 + Math.sin(this.flapPhase * 0.5) * 0.03;
    // jaw
    this.jawPivot.rotation.x = p.jawOpen * 0.5;
  }

  /** wing position (world) for audio/flap effects */
  get leftWingWorld(): Vector3 {
    return this.wingInnerL.getAbsolutePosition();
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.mat.dispose();
  }
}
