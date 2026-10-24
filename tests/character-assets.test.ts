import { afterEach, describe, expect, it } from "vitest";
import { AssetContainer, Color3, MeshBuilder, NullEngine, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CharacterModel, anchorDragon, tintCharacter } from "../src/world/CharacterAssets";

const engines: NullEngine[] = [];
afterEach(() => engines.splice(0).forEach(e => e.dispose()));

function setup() {
  const engine = new NullEngine(); engines.push(engine);
  const scene = new Scene(engine);
  const container = new AssetContainer(scene);
  const source = new TransformNode("source", scene);
  const pelvis = new TransformNode("pelvis.test", scene); pelvis.parent = source;
  pelvis.position.set(3, 2, 4);
  const body = MeshBuilder.CreateBox("body", {}, scene); body.parent = pelvis;
  const material = new PBRMaterial("source-material", scene); body.material = material;
  container.rootNodes.push(source);
  container.transformNodes.push(source, pelvis);
  container.meshes.push(body); container.materials.push(material);
  container.removeAllFromScene();
  return { scene, container, material };
}

describe("imported character lifecycle", () => {
  it("rejects model archives from another scene before creating a visual", () => {
    const { scene, container } = setup();
    const other = new Scene(scene.getEngine());
    expect(() => new CharacterModel(container, "cross-scene", other)).toThrow(/destination scene/);
    expect(other.transformNodes).toHaveLength(0);
  });
  it("anchors animated root motion under a translated, rotated, scaled flight pivot", () => {
    const { scene, container } = setup();
    const model = new CharacterModel(container, "dragon", scene);
    const pivot = new TransformNode("flight", scene);
    pivot.position.set(90, 40, -30); pivot.rotation.set(0.3, 1.1, -0.4); pivot.scaling.setAll(1.7);
    model.root.parent = pivot; model.root.scaling.setAll(0.6);
    anchorDragon(model);
    expect(Vector3.Distance(model.node("pelvis.")!.getAbsolutePosition(), pivot.getAbsolutePosition())).toBeLessThan(0.0001);
    model.node("pelvis.")!.position.addInPlace(new Vector3(2, -1, 6));
    anchorDragon(model);
    expect(Vector3.Distance(model.node("pelvis.")!.getAbsolutePosition(), pivot.getAbsolutePosition())).toBeLessThan(0.0001);
    anchorDragon(model);
    expect(Vector3.Distance(model.node("pelvis.")!.getAbsolutePosition(), pivot.getAbsolutePosition())).toBeLessThan(0.0001);
  });

  it("tints roster instances independently and releases their cloned materials on selection swaps", () => {
    const { scene, container, material } = setup();
    const first = new CharacterModel(container, "first", scene);
    const second = new CharacterModel(container, "second", scene);
    const firstMat = first.root.getChildMeshes()[0].material as PBRMaterial;
    const secondMat = second.root.getChildMeshes()[0].material as PBRMaterial;
    tintCharacter(first, "#aa1122", 0.7);
    expect(firstMat).not.toBe(secondMat);
    expect(firstMat).not.toBe(material);
    expect(secondMat.albedoColor.equals(Color3.White())).toBe(true);
    expect(material.albedoColor.equals(Color3.White())).toBe(true);
    first.root.dispose(false, false);
    expect(scene.materials.includes(firstMat)).toBe(false);
    expect(scene.materials.includes(secondMat)).toBe(true);
    expect(second.root.isDisposed()).toBe(false);
  });
});
