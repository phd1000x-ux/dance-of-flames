import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { BODY_SEPARATION, separateFromBodies } from "../src/player/RiderController";

describe("rider body separation", () => {
  it("pushes the rider out to the separation radius", () => {
    const p = separateFromBodies(new Vector3(0, 0, 0.2), [{ pos: new Vector3(0, 0, 0) }]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(BODY_SEPARATION, 5);
    expect(p.z).toBeGreaterThan(0); // away from the body, not through it
  });
  it("leaves the rider alone at a normal sword distance", () => {
    const p = separateFromBodies(new Vector3(0, 0, 2), [{ pos: new Vector3(0, 0, 0) }]);
    expect(p.z).toBe(2);
  });
  it("resolves an exact overlap without NaN", () => {
    const p = separateFromBodies(new Vector3(3, 1, 3), [{ pos: new Vector3(3, 0, 3) }]);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(p.x - 3, p.z - 3)).toBeCloseTo(BODY_SEPARATION, 5);
    expect(p.y).toBe(1);
  });
});
