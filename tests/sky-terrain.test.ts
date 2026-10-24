import { describe, expect, it } from "vitest";
import { Color3, Vector3 } from "@babylonjs/core";
import { skyColorAt, type SkyColors } from "../src/world/SkyDome";
import { MOUNTAIN_FULL, MOUNTAIN_START, TerrainHeightSampler } from "../src/world/Terrain";
import { MISSIONS } from "../src/data/missions";

const sky: SkyColors = {
  skyTop: "#203050",
  skyBottom: "#a0a8b0",
  fogColor: "#8890a0",
  sunColor: "#ffd090",
  sunDirection: [0, -0.5, 1],
};
const dist = (a: Color3, b: Color3) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

describe("skyColorAt", () => {
  it("zenith away from the sun is the sky-top color", () => {
    const c = skyColorAt(new Vector3(0, 1, 0), { ...sky, sunDirection: [0, 1, 0] });
    expect(dist(c, Color3.FromHexString(sky.skyTop))).toBeLessThan(0.02);
  });

  it("horizon melts into the fog color (no seam against fogged terrain)", () => {
    const c = skyColorAt(new Vector3(-1, 0, 0), sky);
    expect(dist(c, Color3.FromHexString(sky.fogColor))).toBeLessThan(0.05);
  });

  it("looking toward the sun is brighter than looking away", () => {
    const toSun = new Vector3(0, 0.5, -1).normalize();
    const away = new Vector3(0, 0.5, 1).normalize();
    const lum = (c: Color3) => c.r + c.g + c.b;
    expect(lum(skyColorAt(toSun, sky))).toBeGreaterThan(lum(skyColorAt(away, sky)) + 0.5);
  });

  it("every mission environment produces in-range colors", () => {
    for (const m of MISSIONS) {
      for (const d of [new Vector3(0, 1, 0), new Vector3(1, 0.1, 0).normalize(), new Vector3(0, -1, 0)]) {
        const c = skyColorAt(d, m.environment);
        for (const v of [c.r, c.g, c.b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("mountain ring", () => {
  const withRing = new TerrainHeightSampler(7);

  it("leaves the playable area below the ring untouched", () => {
    // reference: same sampler math, sampled just inside the ring start, must stay low
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const r = MOUNTAIN_START - 5;
      expect(withRing.height(Math.cos(a) * r, Math.sin(a) * r)).toBeLessThan(40);
    }
  });

  it("rises into a range at the map edge", () => {
    let total = 0;
    let n = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      total += withRing.height(Math.cos(a) * (MOUNTAIN_FULL + 20), Math.sin(a) * (MOUNTAIN_FULL + 20));
      n++;
    }
    expect(total / n).toBeGreaterThan(60);
  });

  it("is deterministic per seed", () => {
    const again = new TerrainHeightSampler(7);
    expect(again.height(700, -300)).toBe(withRing.height(700, -300));
  });
});
