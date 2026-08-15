import { Matrix, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import type { DragonController } from "../player/DragonController";
import type { InputManager } from "../input/InputManager";
import { clamp, damp, lerp } from "../core/MathUtils";
import type { Terrain } from "../world/Terrain";
import type { GameSettings } from "../save/SaveSystem";

/**
 * Third-person back view camera for dragon flight.
 * Behind + above the dragon, dynamic FOV (boost), partial roll influence (~28%),
 * subtle shake (user-scalable), terrain clipping prevention.
 */
export class DragonCamera {
  readonly camera: UniversalCamera;
  private shake = 0;
  private fov = 68;
  private camPos = new Vector3(0, 130, -20);
  private rollInfluence = 0.28;

  constructor(
    scene: Scene,
    private settings: GameSettings,
    private terrain: Terrain
  ) {
    this.camera = new UniversalCamera("dragonCam", new Vector3(0, 130, -20), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.4;
    this.camera.maxZ = 2600;
    this.camera.fov = this.fov * (Math.PI / 180);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  update(dt: number, ctrl: DragonController, input: InputManager): void {
    void input;
    const scale = ctrl.player.dragonDef.scale;
    const boosting = ctrl.state === "BOOST";
    const diving = ctrl.state === "DIVE";
    const dist = (10.5 + scale * 2.2) * (boosting ? 1.18 : diving ? 1.1 : 1);
    const height = 3.6 + scale * 1.6;

    // desired position behind & above (world-space blend, not full dragon up)
    const behind = ctrl.pos.subtract(ctrl.forward.scale(dist));
    behind.y += height;

    // smooth follow
    const followRate = boosting ? 4.5 : 6.0;
    this.camPos.x = damp(this.camPos.x, behind.x, followRate, dt);
    this.camPos.y = damp(this.camPos.y, behind.y, followRate + 2, dt);
    this.camPos.z = damp(this.camPos.z, behind.z, followRate, dt);

    // terrain clip prevention
    const groundY = this.terrain.heightAt(this.camPos.x, this.camPos.z) + 1.6;
    const finalPos = new Vector3(this.camPos.x, Math.max(this.camPos.y, groundY), this.camPos.z);

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.settings.cameraShake;
    if (sh > 0.01) {
      finalPos.x += (Math.random() - 0.5) * sh;
      finalPos.y += (Math.random() - 0.5) * sh;
      finalPos.z += (Math.random() - 0.5) * sh;
    }

    this.camera.position.copyFrom(finalPos);

    // look at point ahead of the dragon
    const target = ctrl.pos.add(ctrl.forward.scale(14 * scale)).add(new Vector3(0, 1.2, 0));

    // partial roll via up-vector
    const worldUp = new Vector3(0, 1, 0);
    const roll = ctrl.roll * this.rollInfluence;
    const rot = Matrix.RotationAxis(ctrl.forward, roll);
    const up = Vector3.TransformNormal(worldUp, rot);
    this.camera.upVector.copyFrom(up);

    this.camera.setTarget(target);

    // dynamic FOV
    const speedT = clamp(ctrl.speed / (ctrl.player.dragonStats.boostSpeed ?? 60), 0, 1.2);
    const targetFov = lerp(66, 82, boosting ? 1 : speedT * 0.55);
    this.fov = damp(this.fov, targetFov, 3, dt);
    this.camera.fov = this.fov * (Math.PI / 180);
  }

  reset(ctrl: DragonController): void {
    const behind = ctrl.pos.subtract(ctrl.forward.scale(12));
    this.camPos.copyFrom(behind);
    this.camPos.y += 4;
    this.camera.position.copyFrom(this.camPos);
  }
}

interface SceneLike {
  // minimal structural type to avoid importing whole Scene
  _isReady?: boolean;
}

/**
 * Classic third-person shoulder camera for ground combat
 * (yaw/pitch controlled by mouse; movement is camera-relative).
 */
export class GroundCamera {
  readonly camera: UniversalCamera;
  yaw = 0;
  pitch = 0.18;

  constructor(scene: Scene, private terrain: Terrain) {
    this.camera = new UniversalCamera("groundCam", new Vector3(0, 5, -8), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.25;
    this.camera.maxZ = 2600;
    this.camera.fov = 68 * (Math.PI / 180);
  }

  update(dt: number, targetPos: Vector3, targetYaw: number, input: InputManager, settings: GameSettings): void {
    void dt;
    const mouse = input.consumeMouse();
    const sens = settings.mouseSensitivity;
    const invert = settings.invertY ? -1 : 1;
    this.yaw += mouse.dx * 2.6 * sens;
    this.pitch = clamp(this.pitch + mouse.dy * 2.0 * sens * invert, -0.55, 1.0);
    void targetYaw;

    const dist = 4.6;
    const shoulder = 0.85;
    const dirH = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(dirH.z, 0, -dirH.x);
    const pitchFactor = 1 - Math.abs(this.pitch) * 0.3;
    const camPos = targetPos
      .subtract(dirH.scale(dist * pitchFactor))
      .add(right.scale(shoulder))
      .add(new Vector3(0, 1.7 + this.pitch * 2.4, 0));

    const groundY = this.terrain.heightAt(camPos.x, camPos.z) + 0.5;
    camPos.y = Math.max(camPos.y, groundY);

    this.camera.position.copyFrom(camPos);
    const look = targetPos.add(new Vector3(0, 1.5, 0)).add(dirH.scale(2));
    this.camera.setTarget(look);
    this.camera.upVector.copyFrom(Vector3.Up());
  }

  /** forward direction projected on ground plane (movement reference) */
  groundForward(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  reset(targetPos: Vector3): void {
    this.camera.position.copyFrom(targetPos.add(new Vector3(0, 3, -6)));
  }
}
