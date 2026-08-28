// tests/worldmaterials.test.ts
import { describe, test, expect } from "vitest";
import { stoneMaps, woodMaps, roofMaps, heightToNormalRGBA } from "../src/world/WorldMaterials";

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
