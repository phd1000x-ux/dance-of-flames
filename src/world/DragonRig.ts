import {
  Color3,
  VertexData,
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
import { buildDragonMaterials, animateJawHeat, assertMaterialsInScene, type DragonMaterialSet } from "./DragonMaterials";



export interface DragonAnimParams {
  flapRate: number; // rad/s
  flapAmp: number; // 0..1
  sweep: number; // 0..1 wing fold for dive/boost
  jawOpen: number; // 0..1
  dt: number;
  /** rider procedural animation inputs */
  riderRoll?: number; // dragon roll (rad)
  riderPitchIn?: number; // dragon pitch (rad)
  riderSpeedT?: number; // 0..1 speed fraction
  riderBoost?: boolean;
}

/**
 * Procedural dragon with PBR-style material stack (procedural scale normal maps,
 * roughness and albedo variation), distinct head/body/wing/accent/jaw surfaces,
 * eyes, teeth, detailed saddle and an articulated multi-material rider that
 * leans with flight. Forward is +Z.
 */
export class DragonRig {
  readonly root: TransformNode;
  readonly headTip: TransformNode;
  readonly headPivot: TransformNode;
  readonly materials: DragonMaterialSet;
  private wingInnerL: TransformNode;
  private wingInnerR: TransformNode;
  private wingOuterL: TransformNode;
  private wingOuterR: TransformNode;
  private tailSegs: TransformNode[] = [];
  private neckPivot: TransformNode;
  private jawPivot: TransformNode;
  private riderFigure!: TransformNode;
  private riderTorso!: TransformNode;
  private riderHead!: TransformNode;
  /** visual identity of the mounted rider (gendered frame + hairstyle) */
  private riderLook: import("../data/riders").RiderLook;
  /** exposed so the controller can time wingbeat audio to the animation */
  flapPhase = 0;
  private flapSmooth = 0;
  private tailPhase = 0;
  private riderSway = 0;

  constructor(private scene: Scene, private def: DragonDefinition, riderDef?: import("../data/riders").RiderDefinition) {
    const s = def.scale;
    const bulk = def.bulk ?? 1;
    this.riderLook = riderDef?.look ?? { gender: "male", hairStyle: "short", hairColor: "#6b543c", skin: "#d9b48f", build: 1 };
    this.root = new TransformNode(`dragon-${def.id}`, scene);
    this.materials = buildDragonMaterials(scene, def);
    // invisible-dragon guard: refuse cross-scene/dead materials loudly
    assertMaterialsInScene(this.materials, scene);
    const M = this.materials;

    // ---- body (torso + chest + legs + back spikes) ----
    const parts: Mesh[] = [];
    const torso = MeshBuilder.CreateCapsule(`torso`, { height: 5.4 * s, radius: 0.95 * s, tessellation: 10, subdivisions: 2 }, scene);
    torso.rotation.x = Math.PI / 2;
    parts.push(torso);
    const chest = MeshBuilder.CreateCapsule(`chest`, { height: 3.2 * s, radius: 1.12 * s * bulk, tessellation: 10, subdivisions: 2 }, scene);
    chest.rotation.x = Math.PI / 2;
    chest.position.set(0, 0.06 * s, 1.1 * s);
    parts.push(chest);
    for (let i = 0; i < 6; i++) {
      const spike = MeshBuilder.CreateCylinder(`spike${i}`, { diameterTop: 0, diameterBottom: 0.34 * s, height: (0.55 - i * 0.05) * s, tessellation: 4 }, scene);
      spike.position.set(0, (0.95 - i * 0.06) * s, (1.8 - i * 0.75) * s);
      parts.push(spike);
    }
    const legDefs: [number, number][] = [
      [0.8, 0.9], [-0.8, 0.9], [0.85, -1.3], [-0.85, -1.3],
    ];
    for (const [lx, lz] of legDefs) {
      const leg = MeshBuilder.CreateCapsule(`leg${lx}${lz}`, { height: 1.5 * s, radius: 0.26 * s, tessellation: 8, subdivisions: 1 }, scene);
      leg.position.set(lx * s, -0.55 * s, lz * s);
      leg.rotation.z = lx > 0 ? -0.5 : 0.5;
      leg.rotation.x = -0.45;
      parts.push(leg);
      const claw = MeshBuilder.CreateCylinder(`clawf${lx}${lz}`, { diameterTop: 0, diameterBottom: 0.2 * s, height: 0.4 * s, tessellation: 4 }, scene);
      claw.position.set(lx * 1.1 * s, -1.28 * s, (lz + 0.3) * s);
      parts.push(claw);
    }
    const bodyMesh = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
    bodyMesh.material = M.body;
    bodyMesh.parent = this.root;
    bodyMesh.name = `dragon-${def.id}-body`;

    // ---- neck (medium directional scales) ----
    this.neckPivot = new TransformNode("neckPivot", scene);
    this.neckPivot.parent = this.root;
    this.neckPivot.position.set(0, 0.55 * s, 2.5 * s);
    const neckParts: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const seg = MeshBuilder.CreateCapsule(`neckSeg${i}`, { height: 1.5 * s, radius: (0.52 - i * 0.07) * s * bulk, tessellation: 10, subdivisions: 1 }, scene);
      seg.rotation.x = Math.PI / 2 - 0.55 - i * 0.1;
      seg.position.set(0, (0.42 + i * 0.5) * s, (0.55 + i * 0.72) * s);
      neckParts.push(seg);
    }
    const neckMesh = Mesh.MergeMeshes(neckParts, true, true, undefined, false, false)!;
    neckMesh.material = M.head;
    neckMesh.parent = this.neckPivot;

    // ---- head (fine dense scales + horns + brow) ----
    this.headPivot = new TransformNode("headPivot", scene);
    this.headPivot.parent = this.neckPivot;
    this.headPivot.position.set(0, 2.1 * s, 2.6 * s);
    const headParts: Mesh[] = [];
    const skull = MeshBuilder.CreateBox(`skull`, { width: 0.85 * s, height: 0.62 * s, depth: 1.15 * s }, scene);
    headParts.push(skull);
    const snout = MeshBuilder.CreateBox(`snout`, { width: 0.55 * s, height: 0.4 * s, depth: 0.7 * s }, scene);
    snout.position.set(0, -0.08 * s, 0.85 * s);
    headParts.push(snout);
    const noseHorn = MeshBuilder.CreateCylinder(`noseHorn`, { diameterTop: 0, diameterBottom: 0.14 * s, height: 0.3 * s, tessellation: 5 }, scene);
    noseHorn.position.set(0, 0.18 * s, 1.1 * s);
    noseHorn.rotation.x = -0.5;
    headParts.push(noseHorn);
    for (const hx of [-0.28, 0.28]) {
      const horn = MeshBuilder.CreateCylinder(`horn${hx}`, { diameterTop: 0, diameterBottom: 0.16 * s, height: 0.85 * s, tessellation: 5 }, scene);
      horn.position.set(hx * s, 0.42 * s, -0.32 * s);
      horn.rotation.x = -0.8;
      horn.rotation.z = hx > 0 ? 0.25 : -0.25;
      headParts.push(horn);
      const cheek = MeshBuilder.CreateCylinder(`cheek${hx}`, { diameterTop: 0, diameterBottom: 0.1 * s, height: 0.34 * s, tessellation: 4 }, scene);
      cheek.position.set(hx * 1.2 * s, 0.05 * s, 0.35 * s);
      cheek.rotation.z = hx > 0 ? 1.4 : -1.4;
      headParts.push(cheek);
    }
    const brow = MeshBuilder.CreateBox(`brow`, { width: 0.9 * s, height: 0.14 * s, depth: 0.3 * s }, scene);
    brow.position.set(0, 0.3 * s, 0.42 * s);
    headParts.push(brow);
    const headMesh = Mesh.MergeMeshes(headParts, true, true, undefined, false, false)!;
    headMesh.material = M.head;
    headMesh.parent = this.headPivot;

    // eyes: glossy orbs w/ dark pupils + ember glint
    const eyeMat = new StandardMaterial(`eyeMat-${def.id}`, scene);
    eyeMat.diffuseColor = new Color3(0.08, 0.05, 0.02);
    eyeMat.emissiveColor = Color3.FromHexString(def.fireColor).scale(0.35);
    eyeMat.specularColor = new Color3(1, 0.95, 0.85);
    eyeMat.specularPower = 128;
    const pupilMat = new StandardMaterial(`pupilMat-${def.id}`, scene);
    pupilMat.diffuseColor = Color3.Black();
    pupilMat.specularColor = new Color3(0.2, 0.2, 0.2);
    for (const ex of [-0.3, 0.3]) {
      const eye = MeshBuilder.CreateSphere(`eye${ex}`, { diameter: 0.19 * s, segments: 6 }, scene);
      eye.position.set(ex * s, 0.13 * s, 0.55 * s);
      eye.material = eyeMat;
      eye.parent = this.headPivot;
      const pupil = MeshBuilder.CreateSphere(`pupil${ex}`, { diameter: 0.09 * s, segments: 5 }, scene);
      pupil.position.set(ex * 1.18 * s, 0.13 * s, 0.63 * s);
      pupil.material = pupilMat;
      pupil.parent = this.headPivot;
    }

    // jaw + teeth (heat-reactive material)
    this.jawPivot = new TransformNode("jawPivot", scene);
    this.jawPivot.parent = this.headPivot;
    this.jawPivot.position.set(0, -0.2 * s, 0.15 * s);
    const jaw = MeshBuilder.CreateBox(`jaw`, { width: 0.5 * s, height: 0.14 * s, depth: 0.9 * s }, scene);
    jaw.position.set(0, -0.05 * s, 0.45 * s);
    jaw.material = M.jaw;
    jaw.parent = this.jawPivot;
    const toothMat = new StandardMaterial(`toothMat-${def.id}`, scene);
    toothMat.diffuseColor = new Color3(0.85, 0.8, 0.68);
    toothMat.specularColor = new Color3(0.4, 0.38, 0.32);
    for (let i = 0; i < 5; i++) {
      for (const tx of [-0.18, 0.18]) {
        const tooth = MeshBuilder.CreateCylinder(`tooth${i}${tx}`, { diameterTop: 0.01, diameterBottom: 0.05 * s, height: 0.16 * s, tessellation: 4 }, scene);
        tooth.position.set(tx * s, 0.03 * s, (0.85 - i * 0.16) * s);
        tooth.rotation.x = Math.PI;
        tooth.material = toothMat;
        tooth.parent = this.jawPivot;
      }
    }
    const mouth = MeshBuilder.CreateBox(`mouthIn`, { width: 0.42 * s, height: 0.1 * s, depth: 0.6 * s }, scene);
    mouth.position.set(0, -0.12 * s, 0.5 * s);
    const mouthMat = new StandardMaterial(`mouthMat-${def.id}`, scene);
    mouthMat.diffuseColor = new Color3(0.1, 0.02, 0.02);
    mouthMat.emissiveColor = Color3.FromHexString(def.fireColor).scale(0.12);
    mouth.material = mouthMat;
    mouth.parent = this.headPivot;

    this.headTip = new TransformNode("headTip", scene);
    this.headTip.parent = this.headPivot;
    this.headTip.position.set(0, -0.05 * s, 1.35 * s);

    // ---- tail (elongated scales) ----
    let tailParent: TransformNode = new TransformNode("tailPivot", scene);
    tailParent.parent = this.root;
    tailParent.position.set(0, 0.15 * s, -2.6 * s);
    for (let i = 0; i < 5; i++) {
      const segPivot = new TransformNode(`tailSeg${i}`, scene);
      segPivot.parent = tailParent;
      segPivot.position.set(0, 0, -1.05 * s);
      const seg = MeshBuilder.CreateCapsule(`tailM${i}`, { height: 1.15 * s, radius: (0.5 - i * 0.08) * s, tessellation: 8, subdivisions: 1 }, scene);
      seg.rotation.x = Math.PI / 2;
      seg.position.z = -0.5 * s;
      seg.material = M.body;
      seg.parent = segPivot;
      this.tailSegs.push(segPivot);
      tailParent = segPivot;
    }
    const fin = MeshBuilder.CreateBox(`tailFin`, { width: 0.06 * s, height: 0.9 * s, depth: 0.7 * s }, scene);
    fin.position.set(0, 0, -1.1 * s);
    fin.material = M.wing;
    fin.parent = tailParent;

    // ---- wings (procedural silhouette per dragon: span/chord/fingers/notch/sweep) ----
    const wshape = def.wingShape;
    /**
     * Wing membrane in WING-LOCAL space matching the bones:
     *   +x = out along the span, -z = toward the trailing edge (behind the arm),
     *   y  = camber (gentle billow between spars).
     * The trailing edge is scalloped into `fingers` arcs (notch = cut depth) so
     * the membrane reads as bat-wing skin stretched between finger spars.
     * The result is a filled, double-sided skin — NOT a flat ribbon.
     */
    const buildMembrane = (name: string, width: number, rootChord: number): Mesh => {
      const positions: number[] = [];
      const indices: number[] = [];
      const uvs: number[] = [];
      const SEG = 8; // span-wise strips
      const fingers = Math.max(3, Math.min(5, wshape.fingers));
      const notch = wshape.membraneNotch;

      // chord at span fraction t (taper toward the tip)
      const chordAt = (t: number) => rootChord * (1 - t * 0.3);
      // trailing-edge depth at span fraction t: base curve + scallop cut
      const trailDepth = (t: number) => {
        const base = -chordAt(t); // full chord behind the leading-edge bone
        const scallop = Math.abs(Math.sin(t * fingers * Math.PI)) * notch * chordAt(t) * 0.34;
        return base + scallop; // pulled toward LE between finger tips
      };

      const vid = (x: number, y: number, z: number) => {
        positions.push(x, y, z);
        uvs.push(x / (width || 1), z / (rootChord || 1));
        return positions.length / 3 - 1;
      };

      // strip grid: leading edge (z≈0, on the bone) → trailing edge (scallop)
      const grid: number[][] = [];
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const x = t * width;
        const chord = chordAt(t);
        const td = trailDepth(t);
        const row: number[] = [];
        // 3 depth-wise vertices: leading (0), mid (billow peak), trailing (scallop)
        const camber = Math.sin(t * Math.PI) * rootChord * 0.09; // billow scales with wing
        const midZ = td * 0.52;
        const midY = Math.sin(Math.PI * 0.5) * camber * Math.sin((0.52) * Math.PI); // peak near mid
        row.push(vid(x, 0, 0));
        row.push(vid(x, midY * 0.9, midZ));
        row.push(vid(x, 0, td));
        grid.push(row);
      }
      for (let i = 0; i < SEG; i++) {
        for (let j = 0; j < 3 - 1; j++) {
          const a = grid[i][j];
          const b = grid[i + 1][j];
          const c = grid[i + 1][j + 1];
          const d = grid[i][j + 1];
          indices.push(a, b, c, a, c, d);
        }
      }

      const mesh = new Mesh(name, scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      vd.normals = normals;
      vd.uvs = uvs;
      vd.applyToMesh(mesh);
      return mesh;
    };

    const makeWing = (side: 1 | -1): { inner: TransformNode; outer: TransformNode } => {
      const inner = new TransformNode(`wingInner${side}`, scene);
      inner.parent = this.root;
      inner.position.set(side * 0.85 * s, 0.62 * s, 0.55 * s);

      // ---- inner panel: arm bone + membrane filling behind it ----
      const armLen = 3.1 * s * wshape.span;
      const armBone = MeshBuilder.CreateCapsule(`armBone${side}`, { height: armLen, radius: 0.13 * s, tessellation: 8, subdivisions: 1 }, scene);
      armBone.rotation.z = Math.PI / 2; // lie along the span (+X)
      armBone.position.set(side * (armLen / 2), 0, 0);
      armBone.material = M.body;
      armBone.parent = inner;

      const membrane1 = buildMembrane(`membrane1-${side}`, 2.7 * s * wshape.span, 3.2 * s * wshape.chord);
      // mirror (not rotate!) for the left wing so the trailing edge stays BEHIND
      membrane1.scaling.x = side;
      membrane1.position.set(0, -0.02 * s, 0);
      membrane1.material = M.wing;
      membrane1.parent = inner;

      // ---- outer panel: whole node sweeps back; contents stay in the wing plane ----
      const outer = new TransformNode(`wingOuter${side}`, scene);
      outer.parent = inner;
      outer.position.set(side * armLen, 0, 0);
      outer.rotation.y = wshape.sweepAngle * side; // base sweep (animate() only touches rotation.z)

      const outerLen = 3.3 * s * wshape.span;
      const outerBone = MeshBuilder.CreateCapsule(`outerBone${side}`, { height: outerLen, radius: 0.09 * s, tessellation: 8, subdivisions: 1 }, scene);
      outerBone.rotation.z = Math.PI / 2;
      outerBone.position.set(side * (outerLen / 2), 0, 0);
      outerBone.material = M.body;
      outerBone.parent = outer;

      // finger spars: FLAT in the wing plane, fanning from the tip joint
      // backward-outward toward the membrane scallop valleys
      const fingers = Math.max(3, Math.min(5, wshape.fingers));
      for (let f = 1; f < fingers; f++) {
        const t = f / fingers;
        const len = 2.6 * s * wshape.span * (1 - t * 0.22);
        const spar = MeshBuilder.CreateCapsule(`fingerSpar${side}-${f}`, { height: len, radius: 0.05 * s, tessellation: 5, subdivisions: 1 }, scene);
        spar.rotation.x = -Math.PI / 2; // capsule +Y → flat along -Z (trailing)
        spar.rotation.y = -(t * 0.85) * side; // fan outward
        spar.position.set(side * 0.12 * s, -0.04 * s, -0.12 * s);
        spar.material = M.body;
        spar.parent = outer;
      }

      const membrane2 = buildMembrane(`membrane2-${side}`, outerLen * 0.97, 2.9 * s * wshape.chord);
      membrane2.scaling.x = side; // mirror for the left wing
      membrane2.position.set(0, -0.02 * s, 0);
      membrane2.material = M.wing;
      membrane2.parent = outer;

      const claw = MeshBuilder.CreateCylinder(`claw${side}`, { diameterTop: 0, diameterBottom: 0.12 * s, height: 0.3 * s, tessellation: 4 }, scene);
      claw.position.set(side * outerLen, 0, 0);
      claw.material = M.accent;
      claw.parent = outer;
      return { inner, outer };
    };
    const wl = makeWing(1);
    const wr = makeWing(-1);
    this.wingInnerL = wl.inner;
    this.wingOuterL = wl.outer;
    this.wingInnerR = wr.inner;
    this.wingOuterR = wr.outer;

    // ---- saddle + articulated rider ----
    this.buildRider(s, M);

    if (def.bulk) this.buildWarArmor();

    this.root.rotationQuaternion = Quaternion.Identity();
  }

  /** detailed saddle + multi-material humanoid rider reading as a real character */
  private buildRider(s: number, M: DragonMaterialSet): void {
    const scene = this.scene;
    const look = this.riderLook;
    const female = look.gender === "female";
    const build = look.build;

    // ---- materials (leather / metal / cloth / hair / skin, per look colors) ----
    const leather = new StandardMaterial(`riderLeather-${this.def.id}`, scene);
    leather.diffuseColor = new Color3(0.22, 0.14, 0.09);
    leather.specularColor = new Color3(0.08, 0.06, 0.05);
    leather.specularPower = 24;
    const metal = new StandardMaterial(`riderMetal-${this.def.id}`, scene);
    metal.diffuseColor = new Color3(0.55, 0.56, 0.6);
    metal.specularColor = new Color3(0.85, 0.86, 0.9);
    metal.specularPower = 96;
    const cloth = new StandardMaterial(`riderCloth-${this.def.id}`, scene);
    cloth.diffuseColor = Color3.FromHexString(this.def.accentColor).scale(female ? 0.9 : 0.8);
    cloth.specularColor = new Color3(0.03, 0.03, 0.03);
    const hairMat = new StandardMaterial(`riderHair-${this.def.id}`, scene);
    hairMat.diffuseColor = Color3.FromHexString(look.hairColor);
    hairMat.specularColor = new Color3(0.14, 0.12, 0.1);
    const skinMat = new StandardMaterial(`riderSkin-${this.def.id}`, scene);
    skinMat.diffuseColor = Color3.FromHexString(look.skin);
    skinMat.specularColor = new Color3(0.16, 0.13, 0.11);

    // ---- mount node: PROTAGONIST SCALE 1.5x (whole rider grows as one unit) ----
    this.riderFigure = new TransformNode("riderFigure", scene);
    this.riderFigure.parent = this.root;
    this.riderFigure.position.set(0, 1.02 * s, 0.1 * s);
    this.riderFigure.scaling.setAll(1.5);

    // saddle with pommel + girth strap
    const saddle = MeshBuilder.CreateBox(`saddle`, { width: 0.98 * s, height: 0.22 * s, depth: 1.05 * s }, scene);
    saddle.material = leather;
    saddle.parent = this.riderFigure;
    const pommel = MeshBuilder.CreateCylinder(`pommel`, { diameter: 0.14 * s, height: 0.26 * s, tessellation: 6 }, scene);
    pommel.position.set(0, 0.22 * s, 0.5 * s);
    pommel.material = metal;
    pommel.parent = this.riderFigure;
    const strap = MeshBuilder.CreateBox(`strap`, { width: 2.05 * s, height: 0.1, depth: 0.13 }, scene);
    strap.position.set(0, -0.06 * s, 0.38 * s);
    strap.material = leather;
    strap.parent = this.riderFigure;

    // ---- gendered frame ----
    const shoulderW = (female ? 0.86 : 1.0) * build; // shoulder spread multiplier
    const hipW = female ? 1.1 : 1.0;

    this.riderTorso = new TransformNode("riderTorso", scene);
    this.riderTorso.parent = this.riderFigure;
    this.riderTorso.position.y = 0.12 * s;
    const pelvis = MeshBuilder.CreateBox(`rPelvis`, { width: 0.42 * hipW, height: 0.2, depth: 0.3 }, scene);
    pelvis.position.y = 0.05;
    pelvis.material = cloth;
    pelvis.parent = this.riderTorso;
    const chestBox = MeshBuilder.CreateCapsule(`rChest`, { height: 0.62, radius: 0.19 * (female ? 0.94 : 1) * build, tessellation: 8, subdivisions: 1 }, scene);
    chestBox.position.y = 0.42;
    chestBox.material = leather;
    chestBox.parent = this.riderTorso;
    // breastplate: broad flat for men, shaped cuirass for women
    const plate = MeshBuilder.CreateBox(`rPlate`, { width: 0.44 * shoulderW, height: 0.4, depth: 0.3 }, scene);
    plate.position.set(0, 0.44, 0.02);
    plate.material = metal;
    plate.parent = this.riderTorso;
    const belt = MeshBuilder.CreateBox(`rBelt`, { width: 0.46 * hipW, height: 0.07, depth: 0.33 }, scene);
    belt.position.y = 0.2;
    belt.material = leather;
    belt.parent = this.riderTorso;
    for (const sx of [-0.24, 0.24]) {
      const pauldron = MeshBuilder.CreateSphere(`rPauldron${sx}`, { diameterX: 0.2 * shoulderW, diameterY: 0.14, diameterZ: 0.22, segments: 6 }, scene);
      pauldron.position.set(sx * shoulderW, 0.66, 0);
      pauldron.material = metal;
      pauldron.parent = this.riderTorso;
    }
    // cloak down the dragon's back (longer for women)
    const cloak = MeshBuilder.CreateBox(`rCloak`, { width: 0.5, height: female ? 1.0 : 0.85, depth: 0.05 }, scene);
    cloak.position.set(0, 0.4, -0.2);
    cloak.rotation.x = 0.4;
    cloak.material = cloth;
    cloak.parent = this.riderTorso;

    // ---- head + HAIRSTYLE + face identity ----
    this.riderHead = new TransformNode("riderHead", scene);
    this.riderHead.parent = this.riderTorso;
    this.riderHead.position.y = 0.82;
    const skullM = MeshBuilder.CreateSphere(`rSkull`, { diameterX: 0.19, diameterY: 0.23, diameterZ: 0.21, segments: 6 }, scene);
    skullM.material = skinMat;
    skullM.parent = this.riderHead;
    const nose = MeshBuilder.CreateBox(`rNose`, { width: 0.04, height: 0.07, depth: 0.06 }, scene);
    nose.position.set(0, -0.01, 0.1);
    nose.material = skinMat;
    nose.parent = this.riderHead;

    // shared hair cap (all styles)
    const hairCap = MeshBuilder.CreateSphere(`rHair`, { diameterX: 0.21, diameterY: 0.22, diameterZ: 0.21, segments: 6 }, scene);
    hairCap.position.set(0, 0.045, -0.025);
    hairCap.scaling.y = 0.8;
    hairCap.material = hairMat;
    hairCap.parent = this.riderHead;

    switch (look.hairStyle) {
      case "long": {
        // long flowing back sheet + two front strands
        const back = MeshBuilder.CreateBox(`rHairL`, { width: 0.2, height: 0.72, depth: 0.05 }, scene);
        back.position.set(0, -0.28, -0.11);
        back.material = hairMat;
        back.parent = this.riderHead;
        for (const fx of [-0.11, 0.11]) {
          const strand = MeshBuilder.CreateBox(`rHairS${fx}`, { width: 0.045, height: 0.5, depth: 0.045 }, scene);
          strand.position.set(fx, -0.16, 0.075);
          strand.material = hairMat;
          strand.parent = this.riderHead;
        }
        break;
      }
      case "braids": {
        // two thick side braids hanging down the back
        for (const bx of [-0.1, 0.1]) {
          const braid = MeshBuilder.CreateCylinder(`rBraid${bx}`, { diameter: 0.06, height: 0.6, tessellation: 5 }, scene);
          braid.position.set(bx, -0.32, -0.1);
          braid.rotation.x = 0.12;
          braid.material = hairMat;
          braid.parent = this.riderHead;
          const tie = MeshBuilder.CreateSphere(`rTie${bx}`, { diameter: 0.07, segments: 4 }, scene);
          tie.position.set(bx, -0.62, -0.06);
          tie.material = metal;
          tie.parent = this.riderHead;
        }
        break;
      }
      case "topknot": {
        const bun = MeshBuilder.CreateSphere(`rBun`, { diameter: 0.13, segments: 6 }, scene);
        bun.position.set(0, 0.16, -0.02);
        bun.material = hairMat;
        bun.parent = this.riderHead;
        break;
      }
      case "ponytail": {
        const tail = MeshBuilder.CreateCapsule(`rTail`, { height: 0.5, radius: 0.05, tessellation: 6, subdivisions: 1 }, scene);
        tail.position.set(0, -0.16, -0.16);
        tail.rotation.x = 0.5;
        tail.material = hairMat;
        tail.parent = this.riderHead;
        break;
      }
      case "buzz": {
        hairCap.scaling.scaleInPlace(0.94); // tight cap only
        break;
      }
      case "short":
      default: {
        const back = MeshBuilder.CreateBox(`rHairSh`, { width: 0.17, height: 0.22, depth: 0.06 }, scene);
        back.position.set(0, -0.02, -0.1);
        back.material = hairMat;
        back.parent = this.riderHead;
        break;
      }
    }

    // face identity
    if (look.face === "eyepatch") {
      const patch = MeshBuilder.CreateBox(`rPatch`, { width: 0.085, height: 0.07, depth: 0.03 }, scene);
      patch.position.set(0.055, 0.02, 0.1);
      const patchMat = new StandardMaterial(`rPatchM-${this.def.id}`, scene);
      patchMat.diffuseColor = new Color3(0.05, 0.04, 0.03);
      patch.material = patchMat;
      patch.parent = this.riderHead;
      const band = MeshBuilder.CreateBox(`rBand`, { width: 0.24, height: 0.025, depth: 0.22 }, scene);
      band.position.set(0, 0.03, 0);
      band.material = patchMat;
      band.parent = this.riderHead;
    } else if (look.face === "beard") {
      const beard = MeshBuilder.CreateBox(`rBeard`, { width: 0.14, height: 0.1, depth: 0.06 }, scene);
      beard.position.set(0, -0.09, 0.075);
      beard.material = hairMat;
      beard.parent = this.riderHead;
    } else if (look.face === "crownBraid") {
      const circlet = MeshBuilder.CreateCylinder(`rCirclet`, { diameter: 0.2, height: 0.03, tessellation: 10 }, scene);
      circlet.position.set(0, 0.1, 0);
      const gold = new StandardMaterial(`rGoldM-${this.def.id}`, scene);
      gold.diffuseColor = new Color3(0.85, 0.68, 0.3);
      gold.specularColor = new Color3(0.9, 0.8, 0.5);
      gold.specularPower = 64;
      circlet.material = gold;
      circlet.parent = this.riderHead;
    }

    // arms: upper + forearm + glove, hands forward to the reins
    const armRig = (side: number) => {
      const upper = MeshBuilder.CreateCapsule(`rArmU${side}`, { height: 0.34, radius: 0.055, tessellation: 6, subdivisions: 1 }, scene);
      upper.position.set(side * 0.26 * shoulderW, 0.58, 0.08);
      upper.rotation.z = side * 0.55;
      upper.rotation.x = 0.5;
      upper.material = leather;
      upper.parent = this.riderTorso;
      const fore = MeshBuilder.CreateCapsule(`rArmF${side}`, { height: 0.32, radius: 0.05, tessellation: 6, subdivisions: 1 }, scene);
      fore.position.set(side * 0.32 * shoulderW, 0.6, 0.3);
      fore.rotation.x = 1.15;
      fore.material = cloth;
      fore.parent = this.riderTorso;
      const glove = MeshBuilder.CreateSphere(`rGlove${side}`, { diameter: 0.1, segments: 5 }, scene);
      glove.position.set(side * 0.3 * shoulderW, 0.63, 0.44);
      glove.material = leather;
      glove.parent = this.riderTorso;
    };
    armRig(1);
    armRig(-1);
    // reins from hands toward the neck base
    for (const rx of [-0.3, 0.3]) {
      const rein = MeshBuilder.CreateCylinder(`rein${rx}`, { diameter: 0.025, height: 0.95, tessellation: 4 }, scene);
      rein.position.set(rx * 0.8 * shoulderW, 0.78, 0.7);
      rein.rotation.x = 1.35;
      rein.material = leather;
      rein.parent = this.riderTorso;
    }

    // legs: thigh along flank + shin + boot in stirrup
    const legRig = (side: number) => {
      const thigh = MeshBuilder.CreateCapsule(`rThigh${side}`, { height: 0.42, radius: 0.08 * hipW, tessellation: 6, subdivisions: 1 }, scene);
      thigh.position.set(side * 0.26, 0.0, 0.12);
      thigh.rotation.z = side * 0.85;
      thigh.material = cloth;
      thigh.parent = this.riderTorso;
      const shin = MeshBuilder.CreateCapsule(`rShin${side}`, { height: 0.36, radius: 0.065, tessellation: 6, subdivisions: 1 }, scene);
      shin.position.set(side * 0.42, -0.18, 0.16);
      shin.rotation.z = side * 0.12;
      shin.material = leather;
      shin.parent = this.riderTorso;
      const boot = MeshBuilder.CreateBox(`rBoot${side}`, { width: 0.13, height: 0.12, depth: 0.24 }, scene);
      boot.position.set(side * 0.44, -0.36, 0.2);
      boot.material = leather;
      boot.parent = this.riderTorso;
    };
    legRig(1);
    legRig(-1);
    void M;
  }

  setRiderVisible(v: boolean): void {
    this.riderFigure.getChildMeshes().forEach((m) => (m.isVisible = v));
  }

  /** partial war armor (~25% coverage). Brow plate rides headPivot and the neck
   *  rings ride neckPivot at the segment positions, so they follow neck/head
   *  animation; chest plate, war-saddle and chains stay on the root. */
  private buildWarArmor(): void {
    const s = this.def.scale;
    const bulk = this.def.bulk ?? 1;
    const mat = new StandardMaterial(`war-armor-${this.def.id}`, this.scene);
    mat.diffuseColor = Color3.FromHexString("#2e2a26");
    mat.specularColor = new Color3(0.22, 0.2, 0.18);
    mat.specularPower = 60;
    const mount = (name: string, part: Mesh, parent: TransformNode): void => {
      part.name = `armor-${this.def.id}-${name}`;
      part.material = mat;
      part.parent = parent;
      part.isPickable = false;
      part.receiveShadows = false;
    };

    // brow plate — proud of the head's brow ridge (headPivot-local)
    const brow = MeshBuilder.CreateBox(`armor-${this.def.id}-brow`, { width: 1.0 * s, height: 0.22 * s, depth: 0.4 * s }, this.scene);
    brow.position.set(0, 0.33 * s, 0.44 * s);
    mount("brow", brow, this.headPivot);

    // neck rings — one per neck segment, hole axis aligned with the capsule tilt
    for (let i = 0; i < 3; i++) {
      const ring = MeshBuilder.CreateTorus(`armor-${this.def.id}-neck${i}`, { diameter: (1.3 - i * 0.17) * s * bulk, thickness: 0.13 * s, tessellation: 10 }, this.scene);
      ring.position.set(0, (0.42 + i * 0.5) * s, (0.55 + i * 0.72) * s);
      ring.rotation.x = Math.PI / 2 - 0.55 - i * 0.1; // same tilt as neckSeg capsules
      mount(`neck${i}`, ring, this.neckPivot);
    }

    // chest plate — straddles the crest of the chest capsule (root-local)
    const plate = MeshBuilder.CreateBox(`armor-${this.def.id}-chest`, { width: 2.3 * s * bulk, height: 0.45 * s, depth: 1.9 * s }, this.scene);
    plate.position.set(0, (0.06 + 1.12 * bulk * 0.95) * s, 0.9 * s);
    mount("chest", plate, this.root);

    // war-saddle on the chest crest + girth chains down the flanks
    const saddle = MeshBuilder.CreateBox(`armor-${this.def.id}-saddle`, { width: 1.0 * s, height: 0.25 * s, depth: 1.4 * s }, this.scene);
    saddle.position.set(0, (0.06 + 1.12 * bulk) * s, 0.2 * s);
    mount("saddle", saddle, this.root);
    for (const side of [-1, 1]) {
      const chain = MeshBuilder.CreateCylinder(`armor-${this.def.id}-chain${side}`, { diameter: 0.07 * s, height: 1.1 * s, tessellation: 4 }, this.scene);
      chain.position.set(side * 1.18 * s * bulk, (0.06 + 1.12 * bulk * 0.55) * s, 0.9 * s);
      chain.rotation.z = side * 0.25;
      mount(`chain${side}`, chain, this.root);
    }
  }

  animate(p: DragonAnimParams): void {
    this.flapPhase += p.flapRate * p.dt;
    this.flapSmooth = damp(this.flapSmooth, p.flapAmp, 6, p.dt);
    this.tailPhase += p.dt * 2.2;
    const flap = Math.sin(this.flapPhase);
    const flapLag = Math.sin(this.flapPhase - 0.6);
    const amp = this.flapSmooth * 0.75;

    const dihedral = 0.18;
    this.wingInnerL.rotation.z = dihedral + flap * amp;
    this.wingInnerL.rotation.y = -p.sweep * 0.95;
    this.wingOuterL.rotation.z = -0.2 + flapLag * amp * 1.25;
    this.wingOuterL.rotation.y = -p.sweep * 0.65;
    this.wingInnerR.rotation.z = -(dihedral + flap * amp);
    this.wingInnerR.rotation.y = p.sweep * 0.95;
    this.wingOuterR.rotation.z = -(-0.2 + flapLag * amp * 1.25);
    this.wingOuterR.rotation.y = p.sweep * 0.65;

    for (let i = 0; i < this.tailSegs.length; i++) {
      this.tailSegs[i].rotation.y = Math.sin(this.tailPhase - i * 0.55) * 0.16;
    }
    this.neckPivot.rotation.x = 0.08 + Math.sin(this.flapPhase * 0.5) * 0.03;
    this.jawPivot.rotation.x = p.jawOpen * 0.5;
    // mouth interior + jaw glow with fire intensity
    animateJawHeat(this.materials.jaw, p.jawOpen, this.def.fireColor);

    // ---- procedural rider animation: compensating lean ----
    const roll = p.riderRoll ?? 0;
    const pitch = p.riderPitchIn ?? 0;
    const speedT = p.riderSpeedT ?? 0;
    const boost = p.riderBoost ? 1 : 0;
    // counter-bank into turns (rider stays more upright than the dragon)
    this.riderSway = damp(this.riderSway, -roll * 0.55, 5, p.dt);
    this.riderFigure.rotation.z = this.riderSway;
    // crouch forward with acceleration/boost, sit back when decelerating
    const leanF = 0.16 + speedT * 0.2 + boost * 0.22 - Math.max(0, -pitch) * 0.12;
    this.riderFigure.rotation.x = damp(this.riderFigure.rotation.x, leanF, 5, p.dt);
    // head looks into the turn
    this.riderHead.rotation.y = damp(this.riderHead.rotation.y, this.riderSway * 1.2, 6, p.dt);
    this.riderTorso.rotation.y = damp(this.riderTorso.rotation.y, this.riderSway * 0.35, 5, p.dt);
  }

  /** wing position (world) for audio/flap effects */
  get leftWingWorld(): Vector3 {
    return this.wingInnerL.getAbsolutePosition();
  }

  dispose(): void {
    // Dispose ONLY the mesh hierarchy. Materials/textures are owned by the
    // scene-scoped cache (DragonMaterials) and intentionally survive rig swaps
    // (menu preview cycling, mission restarts) — disposing them here poisoned
    // the cache and made the dragon render invisible the next time the same
    // dragon id was built in this scene. The cache (WeakMap keyed by scene)
    // releases everything when the scene itself is disposed.
    this.root.dispose(false, false);
  }
}
