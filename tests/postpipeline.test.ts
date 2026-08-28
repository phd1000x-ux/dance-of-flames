import { describe, test, expect } from "vitest";
import { postConfigForTier } from "../src/engine/PostPipeline";

describe("postConfigForTier", () => {
  test("disabled → everything off", () => {
    expect(postConfigForTier(0, false)).toEqual({ fxaa: false, imageProcessing: false, toneMapping: false, vignette: false });
  });
  test("tier 0/1 → fxaa + image processing", () => {
    for (const tier of [0, 1] as const) {
      const c = postConfigForTier(tier, true);
      expect(c.fxaa).toBe(true);
      expect(c.imageProcessing).toBe(true);
      expect(c.toneMapping).toBe(true);
      expect(c.vignette).toBe(true);
    }
  });
  test("tier 2/3 → fxaa only (perf-first)", () => {
    for (const tier of [2, 3] as const) {
      const c = postConfigForTier(tier, true);
      expect(c.fxaa).toBe(true);
      expect(c.imageProcessing).toBe(false);
      expect(c.toneMapping).toBe(false);
      expect(c.vignette).toBe(false);
    }
  });
});
