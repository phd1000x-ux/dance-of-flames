import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { collideFlight, type FlightSolid } from "../src/world/SolidCollision";
const wall: FlightSolid = { x: 0, z: 0, hx: 10, hz: 0.5, minY: 0, maxY: 20 };
describe("height-aware swept flight collision", () => {
  it("prevents a high-speed body from tunneling through a thin wall and preserves lateral movement", () => {
    const end = new Vector3(5, 10, 20);
    expect(collideFlight(new Vector3(0, 10, -20), end, 2, [wall])).toBe(true);
    expect(end.z).toBeLessThanOrEqual(-2.5); expect(end.x).toBeCloseTo(5);
  });
  it("permits flight above a wall and through removed solids", () => {
    const end = new Vector3(0, 23, 20);
    expect(collideFlight(new Vector3(0, 23, -20), end, 2, [wall])).toBe(false);
    expect(end.z).toBe(20);
    expect(collideFlight(new Vector3(0, 10, -20), end, 2, [])).toBe(false);
  });
  it("stops a dive on the roof and resolves an oriented building footprint", () => {
    const box = { x: 0, z: 0, hx: 8, hz: 2, minY: 0, maxY: 12, yaw: Math.PI / 2 };
    const dive = new Vector3(0, 0, 0);
    expect(collideFlight(new Vector3(0, 30, 0), dive, 1, [box])).toBe(true);
    expect(dive.y).toBeGreaterThanOrEqual(13);
    const end = new Vector3(10, 5, 6);
    expect(collideFlight(new Vector3(-10, 5, 6), end, 1, [box])).toBe(true);
    expect(end.x).toBeLessThanOrEqual(-3);
  });
});
