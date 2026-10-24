import { afterEach, describe, expect, it, vi } from "vitest";
import { Color3, Mesh, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { SeededRng } from "../src/core/SeededRng";
import { EventBus } from "../src/core/EventBus";
import type { GameEvents } from "../src/core/Events";
import { BuildingFactory } from "../src/world/BuildingFactory";
import { BuildingSystem } from "../src/world/BuildingSystem";
import { CastleBuilder } from "../src/world/CastleBuilder";
import type { EffectsLibrary } from "../src/world/EffectsLibrary";
import type { PropLibrary } from "../src/world/PropLibrary";
import type { Terrain } from "../src/world/Terrain";
import type { WorldLayout } from "../src/world/WorldBuilder";
import { TerrainHeightSampler } from "../src/world/Terrain";
import { branchingTree, gabledRoof, weatheredRock } from "../src/world/SceneryGeometry";

const engines: NullEngine[] = [];
function scene() { const engine = new NullEngine(); engines.push(engine); return new Scene(engine); }
afterEach(() => engines.splice(0).forEach((e) => e.dispose()));

describe("scenery geometry", () => {
  it("gabled roof covers all eaves and has a full-depth ridge", () => {
    const mesh = gabledRoof("roof", 8, 12, 3, scene());
    const pos = mesh.getVerticesData("position")!;
    const ridgeZ: number[] = [];
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] === 3) ridgeZ.push(pos[i + 2]);
    expect(Math.min(...ridgeZ)).toBe(-6);
    expect(Math.max(...ridgeZ)).toBe(6);
    expect(mesh.getBoundingInfo().boundingBox.extendSize.asArray()).toEqual([4, 1.5, 6]);
    expect(mesh.getTotalIndices()).toBe(24);
  });

  it("trees remain two bounded shared templates with the trunk rooted at ground", () => {
    const s = scene();
    for (const broadleaf of [false, true]) {
      const tree = branchingTree("tree", 42, broadleaf, s);
      expect(tree.trunk.getBoundingInfo().boundingBox.minimum.y).toBeLessThan(0);
      expect(tree.crown.getBoundingInfo().boundingBox.maximum.y).toBeGreaterThan(6);
      expect(tree.trunk.getTotalVertices() + tree.crown.getTotalVertices()).toBeLessThan(2300);
      const instance = tree.crown.createInstance("another-tree");
      expect(instance.sourceMesh).toBe(tree.crown);
    }
    expect(s.meshes.filter((m) => m instanceof Mesh)).toHaveLength(4);
  });

  it("rock variants change silhouette while retaining finite normalized normals", () => {
    const s = scene();
    const a = weatheredRock("a", 42, s), b = weatheredRock("b", 61, s);
    expect(a.getVerticesData("position")).not.toEqual(b.getVerticesData("position"));
    const normals = a.getVerticesData("normal")!;
    for (let i = 0; i < normals.length; i += 3) {
      const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeCloseTo(1, 4);
    }
  });
});

describe("architecture and destruction", () => {
  it("military and ruined towers do not regain hidden roofs during merge", () => {
    const s = scene(), factory = new BuildingFactory(s, new SeededRng(10));
    for (const variant of ["military", "artillery", "ruined"]) {
      const b = factory.create("grandTower", undefined, variant);
      expect(b.materials.filter((m) => m.name.startsWith("rmat-"))).toHaveLength(0);
      expect(b.meshes.every((m) => m.parent === b.root)).toBe(true);
    }
    const roofed = factory.create("grandTower", undefined, "gate");
    expect(roofed.materials.filter((m) => m.name.startsWith("rmat-"))).toHaveLength(1);
  });

  it("castle walls follow collision AABBs and battlements sit above wall bodies", () => {
    const s = scene();
    const props = new Proxy({}, { get: () => () => {} }) as PropLibrary;
    const result = new CastleBuilder(s, new TerrainHeightSampler(10), new SeededRng(10)).build(0, 0, props);
    const walls = s.transformNodes.filter((n) => n.name === "wsegHolder");
    expect(walls.length).toBeGreaterThan(5);
    walls.forEach((holder, i) => {
      const mesh = holder.getChildMeshes()[0];
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const collision = result.wallAabbs[i];
      expect(bounds.extendSizeWorld.x > bounds.extendSizeWorld.z).toBe(collision.hx > collision.hz);
      const worldTop = bounds.maximumWorld.y - holder.position.y;
      expect(worldTop).toBeGreaterThan(i < 5 ? 20 : 11);
    });
    expect(s.transformNodes.some((n) => n.name === "stowHolder" && n.position.y > 40)).toBe(false);
  });

  it("scorch/burn chars roof and beams, creates one smoke column, then hides all intact geometry", () => {
    const s = scene();
    const particle = () => ({ emitter: Vector3.Zero(), start: vi.fn(), emitRate: 0, gravity: Vector3.Zero(), dispose: vi.fn() });
    const effects = { createSmokeColumn: vi.fn(particle), createFireStream: vi.fn(particle), dust: vi.fn(), explosion: vi.fn() };
    const system = new BuildingSystem(s, {} as Terrain, effects as unknown as EffectsLibrary, new EventBus<GameEvents>(), new SeededRng(42), null);
    system.spawnFromLayout({ buildings: [{ kind: "house", tag: "house", pos: Vector3.Zero(), rotY: 0 }] } as WorldLayout);
    const b = system.buildings[0];
    const initial = b.materials.map((m) => m.diffuseColor.clone());
    system.damageBuilding(b, 90);
    system.damageBuilding(b, 60);
    expect(effects.createSmokeColumn).toHaveBeenCalledTimes(1);
    expect(effects.createFireStream).toHaveBeenCalledTimes(1);
    b.materials.forEach((m, i) => {
      if (m === b.rubble.material) expect(m.diffuseColor.equals(initial[i])).toBe(true);
      else expect(m.diffuseColor.r).toBeCloseTo(initial[i].r * 0.68);
    });
    const destroyed = vi.fn(); system.onDestroyed = destroyed;
    system.damageBuilding(b, 1000);
    system.damageBuilding(b, 1000);
    expect(b.visualState).toBe("DESTROYED");
    expect(b.meshes.every((m) => !m.isVisible)).toBe(true);
    expect(b.rubble.isVisible).toBe(true);
    expect(b.root.position.y + b.rubble.position.y).toBeCloseTo(0);
    expect(destroyed).toHaveBeenCalledTimes(1);
    const windowMaterial = s.getMaterialByName("worldWindowMat")!;
    expect((windowMaterial as import("@babylonjs/core").StandardMaterial).diffuseColor.equals(new Color3(0.03, 0.03, 0.04))).toBe(true);
  });
});
