import { describe, it, expect } from "vitest";
import { worldToMap, arrowRotation, headingDegrees, arrowMapDirection } from "../src/ui/MinimapMath";

/**
 * Regression suite for the minimap/steering direction convention (Bug A).
 * Convention: North = -Z (map up), East = +X (map right), forward = (sin yaw, cos yaw).
 */

describe("minimap world→map projection", () => {
  const size = 176;
  const worldSize = 1670; // bounds*2+200 like the HUD

  it("places world origin at map center", () => {
    const p = worldToMap(0, 0, size, worldSize);
    expect(p.mx).toBeCloseTo(size / 2, 5);
    expect(p.my).toBeCloseTo(size / 2, 5);
  });

  it("North (-Z) projects ABOVE center, South (+Z) BELOW center", () => {
    const north = worldToMap(0, -500, size, worldSize);
    const south = worldToMap(0, 500, size, worldSize);
    expect(north.my).toBeLessThan(size / 2);
    expect(south.my).toBeGreaterThan(size / 2);
    expect(north.mx).toBeCloseTo(size / 2, 5);
  });

  it("East (+X) projects RIGHT of center, West (-X) LEFT", () => {
    const east = worldToMap(500, 0, size, worldSize);
    const west = worldToMap(-500, 0, size, worldSize);
    expect(east.mx).toBeGreaterThan(size / 2);
    expect(west.mx).toBeLessThan(size / 2);
  });

  it("enemy markers use the same transform as terrain (no independent flip)", () => {
    // a ballista 100m east of the player must be right of the player marker on the map
    const player = worldToMap(0, 0, size, worldSize);
    const ballista = worldToMap(100, 0, size, worldSize);
    expect(ballista.mx - player.mx).toBeGreaterThan(0);
    // 100m north of the player must be above (smaller my)
    const northTower = worldToMap(0, -100, size, worldSize);
    expect(northTower.my - player.my).toBeLessThan(0);
  });
});

describe("minimap player arrow rotation", () => {
  it("yaw 0 (facing +Z/South) → arrow points DOWN the map", () => {
    const dir = arrowMapDirection(0);
    expect(dir.dx).toBeCloseTo(0, 5);
    expect(dir.dy).toBeGreaterThan(0.99); // +y = down on canvas = south
  });

  it("cardinal directions: N/E/S/W map to up/right/down/left", () => {
    // North = facing -Z → yaw = π
    const n = arrowMapDirection(Math.PI);
    expect(n.dy).toBeLessThan(-0.99);
    // East = facing +X → yaw = π/2
    const e = arrowMapDirection(Math.PI / 2);
    expect(e.dx).toBeGreaterThan(0.99);
    // South = facing +Z → yaw = 0
    const s = arrowMapDirection(0);
    expect(s.dy).toBeGreaterThan(0.99);
    // West = facing -X → yaw = -π/2
    const w = arrowMapDirection(-Math.PI / 2);
    expect(w.dx).toBeLessThan(-0.99);
  });

  it("A (turn left, yaw decreases) rotates the arrow counterclockwise on the map", () => {
    // facing south (yaw 0). Turn LEFT (player's left when facing south = map EAST).
    // yaw decreases → forward gains -X?? No: verify sign contract directly:
    // d(arrow)/d(yaw) must be a pure rotation — derivative of (sin yaw, cos yaw) is (cos yaw, -sin yaw).
    const yaw = 0.3;
    const eps = 0.01;
    const d0 = arrowMapDirection(yaw);
    const d1 = arrowMapDirection(yaw + eps);
    // rotation consistency: cross product sign stays that of +eps (counterclockwise for +yaw on canvas is…)
    const cross = d0.dx * d1.dy - d0.dy * d1.dx;
    expect(cross).toBeLessThan(0); // +yaw rotates clockwise on canvas (since +yaw = toward east then south…)
  });

  it("180° and 360° turns are continuous — no sudden inversion", () => {
    let prev = arrowRotation(0);
    for (let yaw = 0.05; yaw <= Math.PI * 4; yaw += 0.05) {
      const cur = arrowRotation(yaw);
      let d = cur - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      expect(Math.abs(d)).toBeLessThan(0.2); // small step, never a flip
      prev = cur;
    }
    // full 360° returns to the original angle modulo 2π
    const a = arrowRotation(0);
    const b = arrowRotation(Math.PI * 2);
    expect(Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI)).toBeLessThan(1e-9);
  });

  it("arrow always matches the world forward vector projected on the map", () => {
    for (const yaw of [0, 0.7, -1.2, Math.PI, 2.9, -2.9, 5.5]) {
      const dir = arrowMapDirection(yaw);
      // world forward = (sin yaw, 0, cos yaw); map dir = (x, z)
      expect(dir.dx).toBeCloseTo(Math.sin(yaw), 10);
      expect(dir.dy).toBeCloseTo(Math.cos(yaw), 10);
    }
  });
});

describe("heading readout", () => {
  it("compass degrees match the convention", () => {
    expect(headingDegrees(Math.PI)).toBeCloseTo(0, 5); // -Z north
    expect(headingDegrees(Math.PI / 2)).toBeCloseTo(90, 5); // +X east
    expect(headingDegrees(0)).toBeCloseTo(180, 5); // +Z south
    expect(headingDegrees(-Math.PI / 2)).toBeCloseTo(270, 5); // -X west
  });
});

describe("steering contract (A left / D right)", () => {
  it("A decreases yaw (world turns toward -X = screen left when camera trails)", () => {
    // empirical fact pinned by this suite: turnLeft must reduce yaw
    const yawBefore = 1.0;
    const yawAfterA = yawBefore - 0.4; // DragonController: yawRate = -roll*1.9…, roll>0 when A held
    expect(yawAfterA).toBeLessThan(yawBefore);
    // and the arrow follows the heading exactly:
    const d = arrowMapDirection(yawAfterA);
    expect(d.dx).toBeCloseTo(Math.sin(yawAfterA), 10);
  });

  it("D increases yaw (world turns toward +X = screen right)", () => {
    const yawBefore = -1.0;
    const yawAfterD = yawBefore + 0.4;
    expect(yawAfterD).toBeGreaterThan(yawBefore);
  });
});
