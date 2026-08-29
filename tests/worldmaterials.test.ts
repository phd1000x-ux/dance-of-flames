// tests/worldmaterials.test.ts
import { describe, test, expect } from "vitest";
import { NullEngine, Scene, Color3 } from "@babylonjs/core";
import { stoneMaps, woodMaps, roofMaps, heightToNormalRGBA, clothMaps, leatherMaps, metalMaps, barkMaps, rockMaps, groundMaps, getWorldTexture, texturedMaterial } from "../src/world/WorldMaterials";

describe("map generators", () => {
  test("deterministic for same seed", () => {
    const a = stoneMaps(128, 7);
    const b = stoneMaps(128, 7);
    expect([...a.albedo]).toEqual([...b.albedo]);
    expect([...a.normal]).toEqual([...b.normal]);
  });
  test("correct buffer sizes and opaque alpha", () => {
    for (const m of [stoneMaps(128, 1), woodMaps(128, 2), roofMaps(128, 3)]) {
      expect(m.albedo.length).toBe(128 * 128 * 4);
      expect(m.normal.length).toBe(128 * 128 * 4);
      for (let i = 3; i < m.albedo.length; i += 4) expect(m.albedo[i]).toBe(255);
    }
  });
  test("stone: mortar darker than brick faces; gloss present", () => {
    const size = 128;
    const m = stoneMaps(size, 5);
    expect(m.gloss).toBeDefined();
    const lum = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return (m.albedo[i] + m.albedo[i + 1] + m.albedo[i + 2]) / 3;
    };
    expect(lum(80, 12)).toBeGreaterThan(lum(64, 1) + 30);
  });
  test("wood/roof albedo averages tint-friendly (>0.75)", () => {
    for (const m of [woodMaps(128, 4), roofMaps(128, 5)]) {
      let s = 0;
      for (let i = 0; i < m.albedo.length; i += 4) s += m.albedo[i];
      const avg = s / (m.albedo.length / 4) / 255;
      expect(avg).toBeGreaterThan(0.75);
    }
  });
  test("heightToNormalRGBA encodes mostly-up normals", () => {
    const h = new Float32Array(64 * 64).fill(0.5);
    const n = heightToNormalRGBA(h, 64, 2, 0, 1);
    expect(n[(32 * 64 + 32) * 4 + 2]).toBeGreaterThan(200);
  });
});

describe("more map generators", () => {
  const GEN = { cloth: clothMaps, leather: leatherMaps, metal: metalMaps, bark: barkMaps, rock: rockMaps, ground: groundMaps };
  test("all deterministic, sized, opaque, tint-friendly", () => {
    for (const gen of Object.values(GEN)) {
      const a = gen(96, 13);
      const b = gen(96, 13);
      expect([...a.albedo]).toEqual([...b.albedo]);
      expect(a.albedo.length).toBe(96 * 96 * 4);
      for (let i = 3; i < a.albedo.length; i += 4) expect(a.albedo[i]).toBe(255);
      let s = 0;
      for (let i = 0; i < a.albedo.length; i += 4) s += a.albedo[i];
      const avg = s / (a.albedo.length / 4) / 255;
      expect(avg).toBeGreaterThan(0.7);
    }
  });
  test("bark is rougher than cloth (normal variance)", () => {
    const variance = (n: Uint8Array) => {
      let m = 0, m2 = 0;
      for (let i = 0; i < n.length; i += 4) { m += n[i]; m2 += n[i] * n[i]; }
      const c = m / (n.length / 4);
      return m2 / (n.length / 4) - c * c;
    };
    expect(variance(barkMaps(96, 1).normal)).toBeGreaterThan(variance(clothMaps(96, 1).normal));
  });
});

describe("scene-scoped texture cache", () => {
  test("same scene + key → same texture instance", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = getWorldTexture(scene, "stone", "albedo", 8, 8);
    expect(getWorldTexture(scene, "stone", "albedo", 8, 8)).toBe(a);
    engine.dispose();
  });
  test("different scale/channel/kind → different instance", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = getWorldTexture(scene, "stone", "albedo", 8, 8);
    expect(getWorldTexture(scene, "stone", "albedo", 4, 4)).not.toBe(a);
    expect(getWorldTexture(scene, "stone", "normal", 8, 8)).not.toBe(a);
    expect(getWorldTexture(scene, "wood", "albedo", 8, 8)).not.toBe(a);
    engine.dispose();
  });
  test("different scene → different instance (scene-scoped invariant)", () => {
    const e1 = new NullEngine(), e2 = new NullEngine();
    const s1 = new Scene(e1), s2 = new Scene(e2);
    expect(getWorldTexture(s1, "stone", "albedo", 8, 8)).not.toBe(getWorldTexture(s2, "stone", "albedo", 8, 8));
    e1.dispose(); e2.dispose();
  });
  test("texturedMaterial sets textures + tint", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const m = texturedMaterial(scene, "t", "wood", { uScale: 2, vScale: 2, tint: new Color3(0.3, 0.2, 0.1) });
    expect(m.diffuseTexture).toBeDefined();
    expect(m.bumpTexture).toBeDefined();
    expect(m.diffuseColor.r).toBeCloseTo(0.3);
    engine.dispose();
  });
});
