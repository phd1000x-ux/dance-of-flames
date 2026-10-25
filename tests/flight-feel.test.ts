import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { DragonController } from "../src/player/DragonController";
import { PlayerState } from "../src/player/PlayerState";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { assistCone, assistPull, cameraSpeedFeel, turnAgility } from "../src/player/FlightFeel";
import type { DragonRig } from "../src/world/DragonRig";
import type { Terrain } from "../src/world/Terrain";
import type { InputManager } from "../src/input/InputManager";
import type { EventBus } from "../src/core/EventBus";
import type { GameEvents } from "../src/core/Events";

const DT = 1 / 60;

/** turn radius (m) measured on the real controller holding `throttle` + turnRight */
function turnRadius(throttle: "coast" | "accelerate" | "boost"): { radius: number; speed: number } {
  const player = new PlayerState(DRAGONS[0], RIDERS[0], {});
  const bus = { emit() {}, on() {} } as unknown as EventBus<GameEvents>;
  const terrain = { heightAt: () => 0 } as unknown as Terrain;
  const rig = { root: { position: new Vector3(), rotationQuaternion: null }, flapPhase: 0, animate() {} } as unknown as DragonRig;
  const ctrl = new DragonController(player, rig, terrain, bus, 5000);
  ctrl.spawn(new Vector3(0, 150, 0), 0);
  const held = new Set<string>([throttle === "boost" ? "accelerate" : throttle]);
  if (throttle === "boost") held.add("boost");
  const input = {
    isDown: (a: string) => held.has(a),
    pressed: () => false,
    consumeMouse: () => ({ dx: 0, dy: 0 }),
    lookYaw: 0,
    lookPitch: 0,
  } as unknown as InputManager;
  for (let i = 0; i < 240; i++) ctrl.update(DT, input, false);
  held.add("turnRight");
  for (let i = 0; i < 60; i++) ctrl.update(DT, input, false);
  player.boost = 1;
  const y0 = ctrl.yaw;
  const speed = ctrl.speed;
  for (let i = 0; i < 30; i++) ctrl.update(DT, input, false);
  const yawRate = Math.abs(ctrl.yaw - y0) / (30 * DT);
  return { radius: ctrl.speed / yawRate, speed };
}

describe("flight feel", () => {
  it("agility falls with airspeed", () => {
    expect(turnAgility(5, 40, 60)).toBeGreaterThan(turnAgility(40, 40, 60));
    expect(turnAgility(40, 40, 60)).toBeCloseTo(1);
    expect(turnAgility(60, 40, 60)).toBeLessThan(0.8);
  });

  it("slow flight turns visibly tighter than boost (real controller)", () => {
    const slow = turnRadius("coast");
    const cruise = turnRadius("accelerate");
    const boost = turnRadius("boost");
    // eslint-disable-next-line no-console
    console.log("turn radius m:", { slow, cruise, boost });
    expect(slow.radius).toBeLessThan(cruise.radius * 0.7);
    expect(boost.radius).toBeGreaterThan(cruise.radius * 1.3);
  });

  it("assist widens and pulls harder up close, never beyond the base far out", () => {
    expect(assistCone(0.3, 10)).toBeCloseTo(0.6);
    expect(assistCone(0.3, 120)).toBeCloseTo(0.3);
    expect(assistPull(0.5, 10)).toBeGreaterThan(assistPull(0.5, 120));
    expect(assistPull(0.5, 120)).toBeCloseTo(0.25);
    expect(assistPull(0, 10)).toBe(0);
  });

  it("camera widens and pulls back with speed; slow flight frames tighter", () => {
    const slow = cameraSpeedFeel(10, 40, 60, false, false);
    const cruise = cameraSpeedFeel(40, 40, 60, false, false);
    const dive = cameraSpeedFeel(70, 40, 60, false, true);
    expect(slow.fov).toBeLessThan(cruise.fov);
    expect(slow.distScale).toBeLessThan(1);
    expect(dive.fov).toBeGreaterThan(cruise.fov + 10);
    expect(dive.fov).toBeLessThanOrEqual(90);
  });
});

describe("braking", () => {
  it("holding decelerate settles into a hover instead of flying backwards", () => {
    const player = new PlayerState(DRAGONS[0], RIDERS[0], {});
    const bus = { emit() {}, on() {} } as unknown as EventBus<GameEvents>;
    const terrain = { heightAt: () => 0 } as unknown as Terrain;
    const rig = { root: { position: new Vector3(), rotationQuaternion: null }, flapPhase: 0, animate() {} } as unknown as DragonRig;
    const ctrl = new DragonController(player, rig, terrain, bus, 5000);
    ctrl.spawn(new Vector3(0, 150, 0), 0);
    const input = {
      isDown: (a: string) => a === "decelerate",
      pressed: () => false,
      consumeMouse: () => ({ dx: 0, dy: 0 }),
      lookYaw: 0,
      lookPitch: 0,
    } as unknown as InputManager;
    for (let i = 0; i < 600; i++) ctrl.update(DT, input, false);
    expect(ctrl.speed).toBeGreaterThanOrEqual(0);
    expect(ctrl.state).toBe("HOVER");
  });
});
