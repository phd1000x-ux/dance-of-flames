import {
  AnimationGroup, AssetContainer, type BaseTexture, Color3, Constants, LoadAssetContainerAsync,
  Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, RawCubeTexture, RawTexture, Scene,
  StandardMaterial, Texture, TransformNode, Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { DragonDefinition } from "../data/dragons";
/** One disposable instance; containers, materials and textures never cross scenes. */
export class CharacterModel {
  readonly root: TransformNode;
  readonly nodes: TransformNode[];
  readonly clips: AnimationGroup[];
  readonly rest = new Map<TransformNode, Quaternion>();
  private clock = 0;

  /**
   * aliases: knight bone name → this rig's bone prefix, so poses, weapons and
   * baked clips written against the Strong Knight skeleton drive other rigs
   */
  constructor(container: AssetContainer, name: string, scene: Scene, private aliases: Record<string, string> = {}) {
    if (container.scene !== scene) throw new Error("Character containers must belong to the destination scene");
    this.root = new TransformNode(name, scene);
    const instance = container.instantiateModelsToScene(n => `${name}:${n}`, true, { doNotInstantiate: true });
    for (const node of instance.rootNodes) node.parent = this.root;
    this.nodes = this.root.getChildTransformNodes(false);
    this.clips = instance.animationGroups;
    const selected = this.clips.find(c => /Flying|idle1/i.test(c.name)) ?? this.clips[0];
    for (const clip of this.clips) if (clip !== selected) clip.stop();
    this.clips = selected ? [selected] : [];
    for (const clip of this.clips) { clip.start(true); clip.pause(); clip.goToFrame(clip.from); }
    for (const node of this.nodes) {
      this.rest.set(node, node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(node.rotation));
    }
    for (const mesh of this.root.getChildMeshes()) { mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; }
    const ownedMaterials = new Set(this.root.getChildMeshes().map(m => m.material));
    this.root.onDisposeObservable.addOnce(() => {
      for (const clip of instance.animationGroups) clip.dispose();
      for (const skeleton of instance.skeletons) skeleton.dispose();
      for (const mat of ownedMaterials) mat?.dispose(false, false);
    });
  }

  node(prefix: string): TransformNode | undefined {
    const p = this.aliases[prefix] ?? prefix;
    return this.nodes.find(n => n.name.split(":").pop()!.startsWith(p));
  }

  bounds() {
    this.root.computeWorldMatrix(true);
    for (const mesh of this.root.getChildMeshes()) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo({ applySkeleton: true });
    }
    return this.root.getHierarchyBoundingVectors(true);
  }

  sample(dt: number, speed = 1): void {
    this.clock += dt * speed;
    // Some source joints have no animation channel: never accumulate additive poses.
    for (const [node, rest] of this.rest) node.rotationQuaternion = rest.clone();
    for (const clip of this.clips) {
      const fps = clip.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      const length = clip.to - clip.from;
      clip.goToFrame(clip.from + (length > 0 ? (this.clock * fps) % length : 0));
    }
  }

  /**
   * Add a pose about the CHARACTER's own axes (root space: +X right, +Y up,
   * +Z forward), accounting for imported bone axes. World axes would only be
   * right while the figure faces +Z — at any other yaw a forward sword swing
   * or leg stride twisted sideways/backward.
   */
  pose(prefix: string, x = 0, y = 0, z = 0): void {
    const node = this.node(prefix);
    if (!node || !(node.parent instanceof TransformNode)) return;
    const inv = Matrix.Invert(node.parent.computeWorldMatrix(true));
    const rootWorld = this.root.computeWorldMatrix(true);
    const axes = [Vector3.Right(), Vector3.Up(), Vector3.Forward()];
    let q = node.rotationQuaternion?.clone() ?? this.rest.get(node)!.clone();
    for (const [i, angle] of [x, y, z].entries()) {
      if (angle === 0) continue;
      const axis = Vector3.TransformNormal(Vector3.TransformNormal(axes[i], rootWorld), inv).normalize();
      q = Quaternion.RotationAxis(axis, angle).multiply(q);
    }
    node.rotationQuaternion = q;
    node.computeWorldMatrix(true);
  }
}

function reflection(scene: Scene): RawCubeTexture {
  const size = 32;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sky = face === 2 ? 0.8 : face === 3 ? 0.12 : 0.22 + 0.4 * (1 - y / size);
      const i = (y * size + x) * 4;
      data[i] = sky * 214; data[i + 1] = sky * 224; data[i + 2] = sky * 240; data[i + 3] = 255;
    }
    return data;
  });
  return new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
}


const sceneAssets = new WeakMap<Scene, Promise<AssetContainer[]>>();

/** Scene owns the archive once; repeated roster swaps only create disposable instances. */
export function loadCharacterAssets(scene: Scene): Promise<AssetContainer[]> {
  const cached = sceneAssets.get(scene);
  if (cached) return cached;
  const promise = Promise.allSettled([
    LoadAssetContainerAsync("/character-prototype/dragon.glb", scene),
    LoadAssetContainerAsync("/character-prototype/knight.glb", scene),
  ]).then(results => {
    const containers = results.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
    if (scene.isDisposed || containers.length !== 2) {
      containers.forEach(c => c.dispose());
      throw new Error("Character assets unavailable; retaining procedural characters");
    }
    for (const c of containers) {
      // Skinning plus unused UV streams exceeds WebGPU's eight-buffer baseline.
      for (const mesh of c.meshes) if (mesh instanceof Mesh)
        for (const unused of ["uv4", "uv5", "uv6"]) mesh.removeVerticesData(unused);
      for (const mat of c.materials) if (mat instanceof PBRMaterial) {
        mat.environmentIntensity = 0.85;
        mat.backFaceCulling = false;
      }
    }
    if (!scene.environmentTexture) scene.environmentTexture = reflection(scene);
    scene.onDisposeObservable.addOnce(() => containers.forEach(c => c.dispose()));
    return containers;
  });
  sceneAssets.set(scene, promise);
  return promise;
}

export function prepareDragon(model: CharacterModel, def: DragonDefinition): void {
  const box = model.bounds();
  model.root.scaling.setAll(17 * def.scale / Math.max(0.001, box.max.z - box.min.z));
  // Shared authored mesh, with roster scale, body tint and modest proportion variants.
  model.root.scaling.x *= 0.92 + def.wingShape.span * 0.08;
  model.root.scaling.y *= def.bulk ?? 1;
  // the authored skin is red-brown: a multiply tint can only darken it, so every
  // dragon read as the same red. Swap in a grey (shading-only) copy and paint
  // the roster color over it; until the copy is ready the old tint stands in.
  tintCharacter(model, def.bodyColor, 0.68);
  void paintDragon(model, def.bodyColor);
  anchorDragon(model);
}

const greySkins = new WeakMap<BaseTexture, Promise<BaseTexture | null>>();

/** luminance-only copy of a texture, normalized so its mean sits at 0.62 (unit tested) */
export function greyscalePixels(src: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(src.length);
  let sum = 0;
  const n = src.length / 4;
  for (let i = 0; i < src.length; i += 4) sum += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
  const k = (0.62 * 255) / Math.max(1, sum / n);
  for (let i = 0; i < src.length; i += 4) {
    const l = Math.min(255, (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) * k);
    out[i] = out[i + 1] = out[i + 2] = l;
    out[i + 3] = src[i + 3];
  }
  return out;
}

function greySkin(tex: BaseTexture, scene: Scene): Promise<BaseTexture | null> {
  let p = greySkins.get(tex);
  if (!p) {
    p = (async () => {
      const { width, height } = tex.getSize();
      const px = await tex.readPixels();
      if (!px || scene.isDisposed) return null;
      const bytes = px instanceof Uint8Array || px instanceof Uint8ClampedArray ? px : new Uint8Array(px.buffer);
      const grey = RawTexture.CreateRGBATexture(greyscalePixels(bytes), width, height, scene, true, false);
      grey.name = `${tex.name}-grey`;
      if (tex instanceof Texture) { grey.wrapU = tex.wrapU; grey.wrapV = tex.wrapV; }
      return grey;
    })().catch(() => null);
    greySkins.set(tex, p);
  }
  return p;
}

async function paintDragon(model: CharacterModel, color: string): Promise<void> {
  const tint = Color3.FromHexString(color);
  for (const mat of new Set(model.root.getChildMeshes().map(m => m.material))) {
    if (!(mat instanceof PBRMaterial) || !mat.albedoTexture) continue;
    const grey = await greySkin(mat.albedoTexture, mat.getScene());
    if (!grey || mat.getScene().isDisposed) return;
    mat.albedoTexture = grey;
    mat.albedoColor = tint.clone();
  }
}

export function tintCharacter(model: CharacterModel, color: string, amount = 0.3): void {
  const tint = Color3.Lerp(Color3.White(), Color3.FromHexString(color), amount);
  for (const mat of new Set(model.root.getChildMeshes().map(m => m.material))) {
    if (mat instanceof PBRMaterial) mat.albedoColor.multiplyInPlace(tint);
  }
}

/** Remove authored root motion in the current parent's coordinate system. */
export function anchorDragon(model: CharacterModel): void {
  const pelvis = model.node("pelvis.");
  if (!pelvis) return;
  pelvis.computeWorldMatrix(true);
  const parent = model.root.parent;
  const anchor = parent instanceof TransformNode
    ? Vector3.TransformCoordinates(pelvis.getAbsolutePosition(), Matrix.Invert(parent.computeWorldMatrix(true)))
    : pelvis.getAbsolutePosition();
  model.root.position.subtractInPlace(anchor);
  model.root.computeWorldMatrix(true);
  pelvis.computeWorldMatrix(true);
}

const sceneGuard = new WeakMap<Scene, Promise<AssetContainer>>();

/** Armored Guard Knight (CC BY, see public/character-prototype/sources.json): the soldiers' body, so they no longer share the hero's knight */
export function loadGuardAsset(scene: Scene): Promise<AssetContainer> {
  const cached = sceneGuard.get(scene);
  if (cached) return cached;
  const promise = LoadAssetContainerAsync("/character-prototype/guard.glb", scene).then(c => {
    if (scene.isDisposed) { c.dispose(); throw new Error("scene disposed"); }
    for (const mesh of c.meshes) if (mesh instanceof Mesh)
      for (const unused of ["uv4", "uv5", "uv6"]) mesh.removeVerticesData(unused);
    for (const mat of c.materials) if (mat instanceof PBRMaterial) {
      mat.environmentIntensity = 0.85;
      mat.backFaceCulling = false;
    }
    scene.onDisposeObservable.addOnce(() => c.dispose());
    return c;
  });
  sceneGuard.set(scene, promise);
  return promise;
}

/** fit the guard to soldier height; his own spear is replaced by the role's HeldWeapon */
export function prepareGuard(model: CharacterModel): void {
  for (const mesh of model.root.getChildMeshes()) if (/Spear/i.test(mesh.material?.name ?? "")) mesh.setEnabled(false);
  const box = model.bounds();
  model.root.scaling.setAll(2.05 / Math.max(0.001, box.max.y - box.min.y));
  const fitted = model.bounds();
  model.root.position.y = -fitted.min.y;
}

export function prepareKnight(model: CharacterModel, color?: string): void {
  const box = model.bounds();
  model.root.scaling.setAll(2.05 / Math.max(0.001, box.max.y - box.min.y));
  const fitted = model.bounds();
  model.root.position.y = -fitted.min.y;
  for (const mesh of model.root.getChildMeshes()) if (/Maul/i.test(mesh.name)) mesh.setEnabled(false);
  if (color) tintCharacter(model, color);
}

export function poseMountedKnight(model: CharacterModel): void {
  model.pose("L_leg_", -1.05, 0, -0.32); model.pose("R_leg_", -1.05, 0, 0.32);
  model.pose("L_knee_", 1.25); model.pose("R_knee_", 1.25);
  model.pose("L_arm_", -0.65); model.pose("R_arm_", -0.65);
}

export function seatKnight(dragon: CharacterModel, knight: CharacterModel, parent: TransformNode, scale: number): void {
  const seat = dragon.node("spine_03."); const hips = knight.node("hips_");
  if (!seat || !hips) return;
  const inverse = Matrix.Invert(parent.computeWorldMatrix(true));
  seat.computeWorldMatrix(true); hips.computeWorldMatrix(true);
  const desired = Vector3.TransformCoordinates(seat.getAbsolutePosition(), inverse).add(new Vector3(0, 0.65 * scale, 0));
  const actual = Vector3.TransformCoordinates(hips.getAbsolutePosition(), inverse);
  knight.root.position.addInPlace(desired.subtract(actual));
}

export type WeaponKind = "sword" | "greatsword" | "spear" | "bow" | "shield" | "axe";

const sceneAxe = new WeakMap<Scene, Promise<AssetContainer>>();

/** Viking battle axe (CC BY, see public/character-prototype/sources.json); scene-scoped like the characters. */
export function loadAxeAsset(scene: Scene): Promise<AssetContainer> {
  const cached = sceneAxe.get(scene);
  if (cached) return cached;
  const promise = LoadAssetContainerAsync("/character-prototype/axe.glb", scene).then(c => {
    if (scene.isDisposed) { c.dispose(); throw new Error("scene disposed"); }
    for (const mat of c.materials) if (mat instanceof PBRMaterial) mat.environmentIntensity = 0.9;
    scene.onDisposeObservable.addOnce(() => c.dispose());
    return c;
  });
  sceneAxe.set(scene, promise);
  return promise;
}

/** imported axe: haft length (m), grip point as a fraction of the haft from its butt */
const AXE_LENGTH = 0.95;
const AXE_GRIP = 0.12;

/**
 * A weapon held in an imported character's hand. The source wrist holds things
 * pointing up-back, so posing the arm alone never brings a blade forward:
 * aim() blends the idle grip toward a direction (default: along the
 * shoulder→wrist line, so a swing sweeps the arm's whole arc).
 */
export class HeldWeapon {
  readonly node: TransformNode;
  private weight = 0;
  private static readonly idleGrip = Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2);
  /** grip used when the weapon is not being aimed (overridden by fistGrip) */
  private restGrip = HeldWeapon.idleGrip.clone();

  constructor(private model: CharacterModel, kind: WeaponKind, name: string, scene: Scene, hand = "R_wrist_") {
    this.node = new TransformNode(name, scene);
    this.node.parent = model.node(hand) ?? model.root;
    // the wrist inherits the model's import scale (plus any unit scale inside the
    // GLB, e.g. the guard's centimetre armature); weapons are authored in meters
    // (measured relative to whatever the model root hangs under, so a scaled
    // soldier/rider parent still scales the weapon with the body)
    const parent = this.node.parent as TransformNode;
    parent.computeWorldMatrix(true);
    const outer = model.root.parent instanceof TransformNode ? Math.abs(model.root.parent.absoluteScaling.x) : 1;
    this.node.scaling.setAll(outer / Math.max(1e-6, Math.abs(parent.absoluteScaling.x)));
    this.node.rotationQuaternion = HeldWeapon.idleGrip.clone();
    const metal = new StandardMaterial(`${name}-metal`, scene);
    metal.diffuseColor = new Color3(0.56, 0.6, 0.66);
    metal.specularColor = new Color3(0.9, 0.9, 0.95);
    const wood = new StandardMaterial(`${name}-wood`, scene);
    wood.diffuseColor = new Color3(0.36, 0.24, 0.14);
    wood.specularColor = new Color3(0.08, 0.08, 0.08);
    this.node.onDisposeObservable.addOnce(() => { metal.dispose(false, false); wood.dispose(false, false); });
    const add = (mesh: Mesh, mat: StandardMaterial, y: number) => {
      mesh.parent = this.node; mesh.position.y = y; mesh.material = mat; mesh.isPickable = false;
      return mesh;
    };
    if (kind === "sword" || kind === "greatsword") {
      const len = kind === "greatsword" ? 1.35 : 0.9;
      add(MeshBuilder.CreateBox(`${name}-blade`, { width: kind === "greatsword" ? 0.085 : 0.055, height: len, depth: 0.025 }, scene), metal, 0.05 + len / 2);
      add(MeshBuilder.CreateBox(`${name}-guard`, { width: kind === "greatsword" ? 0.34 : 0.23, height: 0.04, depth: 0.06 }, scene), metal, 0);
      add(MeshBuilder.CreateCylinder(`${name}-grip`, { diameter: 0.04, height: kind === "greatsword" ? 0.34 : 0.17, tessellation: 6 }, scene), wood, kind === "greatsword" ? -0.15 : -0.08);
    } else if (kind === "spear") {
      add(MeshBuilder.CreateCylinder(`${name}-haft`, { diameter: 0.045, height: 2.5, tessellation: 6 }, scene), wood, 0.55);
      add(MeshBuilder.CreateCylinder(`${name}-point`, { diameterTop: 0, diameterBottom: 0.09, height: 0.32, tessellation: 4 }, scene), metal, 1.96);
    } else if (kind === "shield") {
      // round heater on the forearm: face points out of the back of the hand
      const face = add(MeshBuilder.CreateCylinder(`${name}-face`, { diameter: 0.72, height: 0.05, tessellation: 18 }, scene), wood, 0.05);
      face.rotation.z = Math.PI / 2;
      face.position.x = -0.08;
      const boss = add(MeshBuilder.CreateSphere(`${name}-boss`, { diameter: 0.16, segments: 8 }, scene), metal, 0.05);
      boss.position.x = -0.12;
      const rim = add(MeshBuilder.CreateTorus(`${name}-rim`, { diameter: 0.72, thickness: 0.035, tessellation: 24 }, scene), metal, 0.05);
      rim.rotation.z = Math.PI / 2;
      rim.position.x = -0.08;
    } else if (kind === "axe") {
      // stand-in until the imported axe arrives (or if it fails to load)
      add(MeshBuilder.CreateCylinder(`${name}-haft`, { diameter: 0.04, height: AXE_LENGTH, tessellation: 6 }, scene), wood, AXE_LENGTH * (0.5 - AXE_GRIP));
      const head = add(MeshBuilder.CreateBox(`${name}-head`, { width: 0.26, height: 0.18, depth: 0.02 }, scene), metal, AXE_LENGTH * (0.88 - AXE_GRIP));
      head.position.x = 0.11;
    } else {
      // recurve bow held vertically: two limbs angled back from the grip + string
      for (const sgn of [-1, 1]) {
        const limb = add(MeshBuilder.CreateBox(`${name}-limb`, { width: 0.035, height: 0.62, depth: 0.045 }, scene), wood, sgn * 0.3);
        limb.position.z = -0.06;
        limb.rotation.x = sgn * 0.22;
      }
      const string = add(MeshBuilder.CreateBox(`${name}-string`, { width: 0.008, height: 1.12, depth: 0.008 }, scene), metal, 0);
      string.position.z = -0.17;
    }
  }

  /** target 1 = aimed (attacking/guarding), 0 = idle grip; dir null = along the arm */
  aim(target: number, dt: number, dir: Vector3 | null = null, shoulder = "R_arm_", hand = "R_wrist_"): void {
    this.weight += (target - this.weight) * Math.min(1, dt * 28);
    const wrist = this.model.node(hand);
    const upper = this.model.node(shoulder);
    if (!wrist || !upper || this.weight < 0.01) {
      this.node.rotationQuaternion = this.restGrip.clone();
      return;
    }
    // poses refresh only the node they touch: rebuild the chain top-down
    this.model.root.computeWorldMatrix(true);
    for (const node of this.model.nodes) node.computeWorldMatrix(true);
    const want = dir ?? wrist.getAbsolutePosition().subtract(upper.getAbsolutePosition());
    const local = Vector3.TransformNormal(want, Matrix.Invert(wrist.getWorldMatrix()));
    if (local.lengthSquared() < 1e-8) return;
    local.normalize();
    const aimed = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), local, aimed);
    this.node.rotationQuaternion = Quaternion.Slerp(this.restGrip, aimed, Math.min(1, this.weight));
  }

  /**
   * Seat the weapon in a closed fist the way mocap hands hold a hilt: haft out
   * of the thumb side, perpendicular to the knuckles, blade facing the knuckles,
   * grip centered in the palm. Measured from the hand's own joints, so it holds
   * for whatever pose the animation puts the wrist in.
   */
  fistGrip(side: "L" | "R" = "R"): void {
    const wrist = this.model.node(`${side}_wrist_`);
    const middle = this.model.node(`${side}_middle1_`);
    const thumb = this.model.node(`${side}_thumb1_`);
    if (!wrist || !middle || !thumb) return;
    const fingers = middle.position.clone().normalize();
    const t = thumb.position.clone();
    const haft = t.subtract(fingers.scale(Vector3.Dot(t, fingers))).normalize();
    const blade = fingers;
    const third = Vector3.Cross(blade, haft);
    // columns: weapon +X → knuckles, +Y → haft, +Z → completes the basis
    const basis = Matrix.FromValues(
      blade.x, blade.y, blade.z, 0,
      haft.x, haft.y, haft.z, 0,
      third.x, third.y, third.z, 0,
      0, 0, 0, 1);
    this.restGrip = Quaternion.FromRotationMatrix(basis);
    this.node.rotationQuaternion = this.restGrip.clone();
    // palm center: partway from the wrist joint toward the knuckles (node units are the wrist's)
    this.node.position.copyFrom(middle.position.scale(0.55));
  }

  /**
   * Swap the stand-in meshes for an imported model: its longest axis becomes the
   * haft (+Y), scaled to AXE_LENGTH with the grip at the origin, and the head's
   * mass (blade) on +X so it leads forehand swings.
   */
  useImported(container: AssetContainer, name: string): void {
    if (this.node.isDisposed()) return;
    const holder = new TransformNode(`${name}-imported`, this.node.getScene());
    const inst = container.instantiateModelsToScene(n => `${name}:${n}`, true, { doNotInstantiate: true });
    for (const n of inst.rootNodes) n.parent = holder;
    const { min, max } = holder.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    const center = min.add(max).scale(0.5);
    const meshes = holder.getChildMeshes();
    const pts: Vector3[] = [];
    for (const m of meshes) {
      const pos = m.getVerticesData("position"); if (!pos) continue;
      const w = m.computeWorldMatrix(true);
      for (let i = 0; i < pos.length; i += 3) pts.push(Vector3.TransformCoordinates(new Vector3(pos[i], pos[i + 1], pos[i + 2]), w).subtractInPlace(center));
    }
    const axes = [Vector3.Right(), Vector3.Up(), Vector3.Forward()];
    const dims = [size.x, size.y, size.z];
    const long = dims.indexOf(Math.max(...dims));
    const thin = dims.indexOf(Math.min(...dims));
    const side = 3 - long - thin;
    const comp = (v: Vector3, i: number) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
    // the head is the end of the haft that spreads widest across it; the blade
    // is the side of that end with the furthest reach
    const band = dims[long] * 0.3;
    let spreadHi = 0, spreadLo = 0;
    for (const v of pts) {
      const l = comp(v, long), w = Math.abs(comp(v, side));
      if (l > dims[long] / 2 - band) spreadHi = Math.max(spreadHi, w);
      if (l < -dims[long] / 2 + band) spreadLo = Math.max(spreadLo, w);
    }
    const headSign = spreadHi >= spreadLo ? 1 : -1;
    let reachPos = 0, reachNeg = 0;
    for (const v of pts) {
      if (comp(v, long) * headSign < dims[long] / 2 - band) continue;
      const w = comp(v, side);
      reachPos = Math.max(reachPos, w); reachNeg = Math.max(reachNeg, -w);
    }
    const up = axes[long].scale(headSign);
    const out = axes[side].scale(reachPos >= reachNeg ? 1 : -1);
    const basis = Matrix.FromValues(
      out.x, up.x, Vector3.Cross(out, up).x, 0,
      out.y, up.y, Vector3.Cross(out, up).y, 0,
      out.z, up.z, Vector3.Cross(out, up).z, 0,
      0, 0, 0, 1);
    const k = AXE_LENGTH / dims[long];
    const pivot = new TransformNode(`${name}-pivot`, this.node.getScene());
    pivot.parent = this.node;
    pivot.rotationQuaternion = Quaternion.FromRotationMatrix(basis);
    pivot.scaling.setAll(k);
    // butt end + grip fraction sits in the hand
    const grip = center.subtract(up.scale(dims[long] * (0.5 - AXE_GRIP)));
    holder.parent = pivot;
    holder.position.copyFrom(grip.scale(-1));
    for (const child of this.node.getChildMeshes(true)) child.dispose(false, false);
    for (const m of meshes) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    this.node.onDisposeObservable.addOnce(() => { for (const g of inst.animationGroups) g.dispose(); });
  }

  dispose(): void {
    this.node.dispose(false, true);
  }
}
