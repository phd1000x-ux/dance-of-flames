import {
  AnimationGroup, AssetContainer, Color3, Constants, LoadAssetContainerAsync,
  Matrix, Mesh, PBRMaterial, Quaternion, RawCubeTexture, Scene,
  Texture, TransformNode, Vector3,
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

  constructor(container: AssetContainer, name: string, scene: Scene) {
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
    return this.nodes.find(n => n.name.split(":").pop()!.startsWith(prefix));
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

  /** Add a world-axis pose to the sampled skeleton, accounting for imported bone axes. */
  pose(prefix: string, x = 0, y = 0, z = 0): void {
    const node = this.node(prefix);
    if (!node || !(node.parent instanceof TransformNode)) return;
    const inv = Matrix.Invert(node.parent.computeWorldMatrix(true));
    const axes = [Vector3.Right(), Vector3.Up(), Vector3.Forward()];
    let q = node.rotationQuaternion?.clone() ?? this.rest.get(node)!.clone();
    for (const [i, angle] of [x, y, z].entries()) {
      if (angle === 0) continue;
      const axis = Vector3.TransformNormal(axes[i], inv).normalize();
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
  tintCharacter(model, def.bodyColor, 0.68);
  anchorDragon(model);
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
