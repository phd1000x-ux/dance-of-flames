import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CharacterModel } from "./CharacterAssets";
import type { EnemyDefinition } from "../data/enemies";

type Role = EnemyDefinition["role"];

/** which extra pieces each role wears over the shared guard plate (unit tested) */
export function gearForRole(role: Role): { tabard: boolean; cape: boolean; plume: boolean; quiver: boolean } {
  return {
    tabard: role === "infantry" || role === "shield" || role === "spear",
    cape: role === "elite" || role === "commander",
    plume: role === "elite" || role === "commander" || role === "spear",
    quiver: role === "archer",
  };
}

/**
 * Role silhouettes for soldiers who all share one guard model: team-colored
 * cloth (tabard / cape), a helmet plume, an archer's quiver. Built on the
 * unrotated puppet (faces +Z, back is −Z) and parented to mocap bones, like
 * the Castellan regalia. Added after the puppet's material list so the
 * windup/hurt glow tints the plate, not the cloth.
 */
export function addRoleGear(model: CharacterModel, role: Role, teamColor: string, scene: Scene): Mesh[] {
  const gear = gearForRole(role);
  const cloth = new PBRMaterial(`${model.root.name}-cloth`, scene);
  cloth.albedoColor = Color3.FromHexString(teamColor).scale(0.75);
  cloth.metallic = 0;
  cloth.roughness = 0.92;
  cloth.backFaceCulling = false;
  const leather = new PBRMaterial(`${model.root.name}-leather`, scene);
  leather.albedoColor = new Color3(0.28, 0.17, 0.09);
  leather.metallic = 0;
  leather.roughness = 0.8;

  const pieces: Mesh[] = [];
  const attach = (mesh: Mesh, bone: string, offset: Vector3): void => {
    const b = model.node(bone);
    if (!b) { mesh.dispose(); return; }
    b.computeWorldMatrix(true);
    mesh.position.copyFrom(b.getAbsolutePosition().add(offset));
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    mesh.setParent(b as TransformNode);
    pieces.push(mesh);
  };
  const id = model.root.name;

  if (gear.tabard) {
    // hung from the chest and tilted out at the hem so striding thighs stay behind it
    const front = MeshBuilder.CreatePlane(`${id}-tabard`, { width: 0.28, height: 0.62 }, scene);
    front.material = cloth;
    front.rotation.x = -0.18;
    attach(front, "chest_", new Vector3(0, -0.42, 0.19));
  }
  if (gear.cape) {
    const cape = MeshBuilder.CreatePlane(`${id}-cape`, { width: 0.6, height: 1.05 }, scene);
    cape.material = cloth;
    cape.rotation.x = 0.12;
    attach(cape, "chest_", new Vector3(0, -0.4, -0.2));
  }
  if (gear.plume) {
    const plume = MeshBuilder.CreateCylinder(`${id}-plume`, { diameterTop: 0.05, diameterBottom: 0.025, height: role === "spear" ? 0.16 : 0.24, tessellation: 6 }, scene);
    plume.material = cloth;
    plume.rotation.x = -0.9; // a crest swept back off the helm, not a horn
    attach(plume, "head_", new Vector3(0, 0.24, -0.1));
  }
  if (gear.quiver) {
    const quiver = MeshBuilder.CreateCylinder(`${id}-quiver`, { diameter: 0.13, height: 0.55, tessellation: 8 }, scene);
    quiver.material = leather;
    quiver.rotation.z = 0.35;
    attach(quiver, "chest_", new Vector3(0.08, 0, -0.2));
    const fletch = MeshBuilder.CreateCylinder(`${id}-fletch`, { diameter: 0.11, height: 0.12, tessellation: 8 }, scene);
    fletch.material = cloth;
    fletch.rotation.z = 0.35;
    attach(fletch, "chest_", new Vector3(-0.03, 0.3, -0.2));
  }

  if (pieces.length) pieces[0].onDisposeObservable.addOnce(() => { cloth.dispose(); leather.dispose(); });
  else { cloth.dispose(); leather.dispose(); }
  return pieces;
}
