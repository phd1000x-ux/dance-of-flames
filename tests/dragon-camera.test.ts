import { describe, expect, it } from "vitest";
import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { DragonCamera } from "../src/camera/GameCameras";
import { defaultSettings } from "../src/save/SaveSystem";
import type { DragonController } from "../src/player/DragonController";
import type { Terrain } from "../src/world/Terrain";
import type { InputManager } from "../src/input/InputManager";

describe("imported dragon camera clearance", () => {
  it("frames remount from current angles even when the previous forward vector is stale", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new DragonCamera(scene, defaultSettings(), { heightAt: () => -1000 } as unknown as Terrain);
    camera.visualFraming = { distance: 26, height: 9, lookAhead: 6, minDistance: 26 };
    const ctrl = {
      pos: new Vector3(0, 100, 0), pitch: 0.12, yaw: Math.PI / 2, roll: 0,
      forward: new Vector3(0, 1, 0),
    } as unknown as DragonController;
    camera.reset(ctrl);
    const forward = Vector3.TransformNormal(Vector3.Forward(), Matrix.RotationYawPitchRoll(ctrl.yaw, ctrl.pitch, 0));
    expect(Vector3.Dot(camera.camera.position.subtract(ctrl.pos), forward)).toBeLessThan(-25);
    expect(Vector3.Distance(camera.camera.position, ctrl.pos)).toBeGreaterThanOrEqual(26);
    scene.dispose(); engine.dispose();
  });

  it("stays outside the larger model envelope at steep pitches and after a sudden reversal", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new DragonCamera(scene, defaultSettings(), { heightAt: () => -1000 } as unknown as Terrain);
    camera.visualFraming = { distance: 26, height: 9, lookAhead: 6, minDistance: 26 };
    const ctrl = {
      pos: new Vector3(0, 100, 0), pitch: 0, yaw: 0, roll: 0, forward: Vector3.Forward(),
      speed: 20, state: "FLY", player: { dragonDef: { scale: 1 }, dragonStats: { boostSpeed: 60 } },
    } as unknown as DragonController;
    camera.reset(ctrl);
    for (const pitch of [-1.2, 1.15, -1.2, 0]) {
      ctrl.pitch = pitch;
      ctrl.forward = Vector3.TransformNormal(Vector3.Forward(), Matrix.RotationYawPitchRoll(0, pitch, 0));
      for (let step = 0; step < 30; step++) {
        camera.update(1 / 60, ctrl, null as unknown as InputManager);
        expect(Vector3.Distance(camera.camera.position, ctrl.pos)).toBeGreaterThanOrEqual(25.99);
      }
    }
    scene.dispose(); engine.dispose();
  });
});
