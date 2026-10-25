import { describe, expect, it } from "vitest";
import { fireStreamColors } from "../src/world/EffectsLibrary";
import { greyscalePixels } from "../src/world/CharacterAssets";

describe("roster colors reach the screen", () => {
  it("a teal breath stays teal (core and body)", () => {
    const { core, body } = fireStreamColors("#7ff0d8");
    expect(body.g).toBeGreaterThan(body.r);
    expect(body.b).toBeGreaterThan(body.r);
    expect(core.g).toBeGreaterThan(core.r);
  });
  it("an orange breath stays orange", () => {
    const { body } = fireStreamColors("#ff8a2a");
    expect(body.r).toBeGreaterThan(body.b);
  });
  it("the grey skin drops hue but keeps shading", () => {
    const red = new Uint8Array([200, 40, 30, 255, 100, 20, 15, 255]);
    const g = greyscalePixels(red);
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    expect(g[0]).toBeGreaterThan(g[4]);
    expect(g[3]).toBe(255);
  });
});
