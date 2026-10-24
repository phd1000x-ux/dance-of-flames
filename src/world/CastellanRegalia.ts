import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CharacterModel } from "./CharacterAssets";

/**
 * Marks the Castellan apart from the elites who share his knight.glb and tint:
 * an iron-and-gold crown and a long crimson cape. Built on the unrotated puppet
 * (knight faces +Z, so the back is −Z) and attached with setParent so the
 * pieces ride the mocap bones. Materials are scene-scoped and released with them.
 */
export function addCastellanRegalia(model: CharacterModel, scene: Scene): Mesh[] {
  const gold = new PBRMaterial("castellan-gold", scene);
  gold.albedoColor = Color3.FromHexString("#c9a24a");
  gold.metallic = 1;
  gold.roughness = 0.3;
  const cloth = new PBRMaterial("castellan-cape", scene);
  cloth.albedoColor = Color3.FromHexString("#5c0d0d");
  cloth.metallic = 0;
  cloth.roughness = 0.9;
  cloth.backFaceCulling = false;

  // blackened, polished plate: the elites' matte steel stays the contrast
  for (const mat of new Set(model.root.getChildMeshes().map(m => m.material))) {
    if (mat instanceof PBRMaterial) {
      mat.albedoColor.scaleInPlace(0.6);
      mat.metallic = 1;
      mat.roughness = 0.22;
    }
  }

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

  const band = MeshBuilder.CreateTorus("castellan-crown", { diameter: 0.3, thickness: 0.035, tessellation: 16 }, scene);
  band.material = gold;
  attach(band, "head_", new Vector3(0, 0.2, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = MeshBuilder.CreateCylinder(`castellan-crown-spike-${i}`, { diameterTop: 0, diameterBottom: 0.05, height: 0.12, tessellation: 4 }, scene);
    spike.material = gold;
    attach(spike, "head_", new Vector3(Math.sin(a) * 0.15, 0.27, Math.cos(a) * 0.15));
  }

  const cape = MeshBuilder.CreatePlane("castellan-cape", { width: 0.75, height: 1.35 }, scene);
  cape.material = cloth;
  cape.rotation.x = 0.12; // hangs slightly away from the legs
  attach(cape, "chest_", new Vector3(0, -0.5, -0.2));

  pieces[0]?.onDisposeObservable.addOnce(() => { gold.dispose(); cloth.dispose(); });
  return pieces;
}
