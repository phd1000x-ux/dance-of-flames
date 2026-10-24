import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { CharacterModel } from "./CharacterAssets";

/**
 * Vharax's riveted iron: plates, helm, horns and ember eyes bolted onto the
 * shared dragon.glb so the boss no longer reads as a recoloured player dragon.
 * Pieces are sized in world metres and attached with setParent (keeps the world
 * transform), so they follow the bones however the rig is scaled.
 * Materials are created per call (scene-scoped) and released with the pieces.
 */
export function armorWarDragon(model: CharacterModel, scene: Scene, length: number): Mesh[] {
  const iron = new PBRMaterial("vharax-iron", scene);
  iron.albedoColor = Color3.FromHexString("#2a2624");
  iron.metallic = 0.85;
  iron.roughness = 0.45;
  const rust = new PBRMaterial("vharax-rust", scene);
  rust.albedoColor = Color3.FromHexString("#4a1a12");
  rust.metallic = 0.6;
  rust.roughness = 0.6;
  const bone = new PBRMaterial("vharax-horn", scene);
  bone.albedoColor = Color3.FromHexString("#cbbfa6");
  bone.metallic = 0;
  bone.roughness = 0.7;
  const ember = new StandardMaterial("vharax-ember", scene);
  ember.emissiveColor = new Color3(1, 0.42, 0.08);
  ember.disableLighting = true;

  // scorched hide: prepareDragon's tint leaves the shared texture too pale for a boss
  // (materials are cloned per CharacterModel instance, so the player dragon is untouched)
  for (const mat of new Set(model.root.getChildMeshes().map(m => m.material))) {
    // albedo only: the mission GlowLayer blooms any emissive into a red haze over the whole body
    if (mat instanceof PBRMaterial) mat.albedoColor.scaleInPlace(0.42);
  }

  const u = length / 37; // tuned on the 37 m boss (17 m × scale 2.2)
  const pieces: Mesh[] = [];
  const attach = (mesh: Mesh, boneName: string, offset = Vector3.Zero()): void => {
    const b = model.node(boneName);
    if (!b) { mesh.dispose(); return; }
    b.computeWorldMatrix(true);
    mesh.position.copyFrom(b.getAbsolutePosition().add(offset.scale(u)));
    mesh.isPickable = false;
    mesh.setParent(b as TransformNode);
    pieces.push(mesh);
  };

  // dorsal plates down the spine, widest over the shoulders
  const spine = ["spine_02.", "spine_03.", "spine_04.", "spine_05.", "spine_06.", "spine_07."];
  spine.forEach((name, i) => {
    const w = (3.4 - Math.abs(i - 3) * 0.35) * u;
    const plate = MeshBuilder.CreateBox(`vharax-plate-${i}`, { width: w, height: 0.35 * u, depth: 2.1 * u }, scene);
    plate.material = i % 2 ? rust : iron;
    plate.rotation.x = 0.12;
    attach(plate, name, new Vector3(0, 1.05, 0));
    const ridge = MeshBuilder.CreateCylinder(`vharax-ridge-${i}`, { diameterTop: 0, diameterBottom: 0.55 * u, height: 1.1 * u, tessellation: 4 }, scene);
    ridge.material = iron;
    ridge.rotation.x = -0.5;
    attach(ridge, name, new Vector3(0, 1.6, -0.2));
  });

  // neck collars
  ["neck_02.", "neck_05.", "neck_08."].forEach((name, i) => {
    const collar = MeshBuilder.CreateTorus(`vharax-collar-${i}`, { diameter: (2.3 - i * 0.35) * u, thickness: 0.35 * u, tessellation: 12 }, scene);
    collar.material = iron;
    collar.rotation.x = Math.PI / 2;
    attach(collar, name);
  });

  // helm + swept horns + ember eyes
  const helm = MeshBuilder.CreateBox("vharax-helm", { width: 1.5 * u, height: 0.3 * u, depth: 1.9 * u }, scene);
  helm.material = iron;
  attach(helm, "head.", new Vector3(0, 0.55, 0.2));
  for (const side of [-1, 1]) {
    const horn = MeshBuilder.CreateCylinder(`vharax-horn-${side}`, { diameterTop: 0, diameterBottom: 0.5 * u, height: 2.4 * u, tessellation: 8 }, scene);
    horn.material = bone;
    horn.rotation.set(-1.15, 0, side * 0.35);
    attach(horn, "head.", new Vector3(side * 0.55, 0.85, -0.7));
  }
  for (const eye of ["l_eye.", "r_eye."]) {
    const glow = MeshBuilder.CreateSphere(`vharax-${eye}glow`, { diameter: 0.32 * u, segments: 6 }, scene);
    glow.material = ember;
    attach(glow, eye);
  }

  // furnace glow between the jaws — rides jaw_01 so it shows when the mouth opens
  const maw = MeshBuilder.CreateSphere("vharax-maw", { diameter: 0.6 * u, segments: 8 }, scene);
  maw.material = ember;
  maw.scaling.set(1, 0.35, 1.6);
  attach(maw, "jaw_01.", new Vector3(0, 0.12, 0.35));

  const owned = [iron, rust, bone, ember];
  pieces[0]?.onDisposeObservable.addOnce(() => { for (const m of owned) m.dispose(); });
  return pieces;
}
