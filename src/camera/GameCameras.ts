import { AbstractMesh, Matrix, Ray, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import type { DragonController } from "../player/DragonController";
import type { InputManager } from "../input/InputManager";
import { clamp, damp } from "../core/MathUtils";
import type { Terrain } from "../world/Terrain";
import type { GameSettings } from "../save/SaveSystem";
import { cameraSpeedFeel } from "../player/FlightFeel";

/**
 * Third-person back view camera for dragon flight.
 * Behind + above the dragon, dynamic FOV (boost), partial roll influence (~28%),
 * subtle shake (user-scalable), terrain clipping prevention.
 */
export class DragonCamera {
  readonly camera: UniversalCamera;
  /** Optional framing for imported models with a larger animated silhouette. */
  visualFraming: { distance: number; height: number; lookAhead: number; minDistance: number } | null = null;
  private shake = 0;
  private fov = 68;
  private camPos = new Vector3(0, 130, -20);
  private rollInfluence = 0.28;
  private lastYaw = 0;
  private turnLead = 0;

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

  update(dt: number, ctrl: DragonController, input: InputManager, biasTarget?: Vector3 | null): void {
    void input;
    const scale = ctrl.player.dragonDef.scale;
    const boosting = ctrl.state === "BOOST";
    const diving = ctrl.state === "DIVE";
    const framing = this.visualFraming;
    const stats = ctrl.player.dragonStats;
    const feel = cameraSpeedFeel(ctrl.speed, stats.maxSpeed ?? 40, stats.boostSpeed ?? 60, boosting, diving);
    const dist = (framing?.distance ?? (10.5 + scale * 2.2)) * feel.distScale;
    const height = framing?.height ?? (3.6 + scale * 1.6);
    const chaseUp = framing
      ? Vector3.TransformNormal(Vector3.Up(), Matrix.RotationYawPitchRoll(ctrl.yaw, ctrl.pitch, 0))
      : Vector3.Up();

    // desired position behind & above (world-space blend, not full dragon up)
    const behind = ctrl.pos.subtract(ctrl.forward.scale(dist));
    behind.addInPlace(chaseUp.scale(height));

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

    // Smoothing across a steep turn can cut through the larger model even if
    // both endpoints are clear. Enforce clearance after smoothing and shake.
    if (framing) {
      const offset = finalPos.subtract(ctrl.pos);
      if (offset.lengthSquared() < framing.minDistance ** 2) {
        const direction = offset.lengthSquared() > 0.001 ? offset.normalize() : behind.subtract(ctrl.pos).normalize();
        finalPos.copyFrom(ctrl.pos.add(direction.scale(framing.minDistance)));
      }
    }

    this.camera.position.copyFrom(finalPos);

    // look at point ahead of the dragon; target lock gently biases the view
    const target = ctrl.pos.add(ctrl.forward.scale(framing?.lookAhead ?? (14 * scale))).add(chaseUp.scale(1.2));
    // turn lead: look into the turn so the exit line is on screen before the nose gets there
    const yawDelta = Math.atan2(Math.sin(ctrl.yaw - this.lastYaw), Math.cos(ctrl.yaw - this.lastYaw));
    this.lastYaw = ctrl.yaw;
    this.turnLead = damp(this.turnLead, dt > 0 ? clamp(yawDelta / dt, -2.5, 2.5) : 0, 4, dt);
    const side = new Vector3(ctrl.forward.z, 0, -ctrl.forward.x);
    if (side.lengthSquared() > 1e-4) target.addInPlace(side.normalize().scale(this.turnLead * 2.2 * scale));
    if (biasTarget) {
      const offset = biasTarget.subtract(target);
      const len = offset.length();
      if (len > 0.5) {
        const pull = Math.min(len, 10) * 0.25;
        target.addInPlace(offset.scale(pull / len));
      }
    }

    // partial roll via up-vector
    const worldUp = chaseUp;
    const roll = ctrl.roll * this.rollInfluence;
    const rot = Matrix.RotationAxis(ctrl.forward, roll);
    const up = Vector3.TransformNormal(worldUp, rot);
    this.camera.upVector.copyFrom(up);

    this.camera.setTarget(target);

    // dynamic FOV
    this.fov = damp(this.fov, feel.fov, 3, dt);
    this.camera.fov = this.fov * (Math.PI / 180);
  }

  reset(ctrl: DragonController): void {
    this.lastYaw = ctrl.yaw;
    this.turnLead = 0;
    if (this.visualFraming) {
      // Remount updates pitch before the controller has refreshed its forward vector.
      const basis = Matrix.RotationYawPitchRoll(ctrl.yaw, ctrl.pitch, 0);
      const forward = Vector3.TransformNormal(Vector3.Forward(), basis);
      const up = Vector3.TransformNormal(Vector3.Up(), basis);
      this.camPos.copyFrom(ctrl.pos.subtract(forward.scale(this.visualFraming.distance)).add(up.scale(this.visualFraming.height)));
      this.camera.position.copyFrom(this.camPos);
      this.camera.upVector.copyFrom(up);
      this.camera.setTarget(ctrl.pos.add(forward.scale(this.visualFraming.lookAhead)));
      return;
    }
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
 * Classic third-person shoulder camera for ground combat.
 * Mouse OR Arrow Keys rotate; Z recenters behind the rider; soft lock-on bias.
 */
/**
 * Buildings and castle walls only — characters, dragons, props and the terrain
 * never pull the camera. Merged building meshes are non-pickable, so match the
 * hierarchy instead (building-* holders, wseg wall segments).
 */
const OCCLUDER_NAME = /^(building-|wseg)/;
function isCameraOccluder(mesh: AbstractMesh): boolean {
  if (!mesh.isVisible || !mesh.isEnabled()) return false;
  for (let n: { name: string; parent: unknown } | null = mesh; n; n = n.parent as typeof n) {
    if (OCCLUDER_NAME.test(n.name)) return true;
  }
  return false;
}

/** keyboard look speed on foot: ~110°/s turn, ~70°/s pitch */
export const KEY_YAW_RATE = 1.9;
export const KEY_PITCH_RATE = 1.2;

export class GroundCamera {
  readonly camera: UniversalCamera;
  yaw = 0;
  pitch = 0.18;
  private recenterTimer = 0;
  private shake = 0;
  /** current occlusion-limited distance from the rider pivot */
  private reach = Infinity;

  constructor(scene: Scene, private terrain: Terrain) {
    this.camera = new UniversalCamera("groundCam", new Vector3(0, 5, -8), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.25;
    this.camera.maxZ = 2600;
    this.camera.fov = 68 * (Math.PI / 180);
  }

  update(
    dt: number,
    targetPos: Vector3,
    targetYaw: number,
    input: InputManager,
    settings: GameSettings,
    lockTargetPos?: Vector3 | null
  ): void {
    const mouse = input.consumeMouse();
    const sens = settings.mouseSensitivity;
    const invert = settings.invertY ? -1 : 1;
    // mouse + smoothed arrow-key look
    // arrow keys are a rate (rad/s), so they must scale by dt — mouse deltas are already per-frame
    this.yaw += mouse.dx * 2.6 * sens + input.lookYaw * KEY_YAW_RATE * dt;
    this.pitch = clamp(this.pitch + mouse.dy * 2.0 * sens * invert - input.lookPitch * KEY_PITCH_RATE * dt, -0.55, 1.0);

    // Z recenter: smoothly return behind the rider
    if (this.recenterTimer > 0) {
      this.recenterTimer -= dt;
      let d = targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 10);
      this.pitch = damp(this.pitch, 0.18, 10, dt);
    } else if (lockTargetPos) {
      // gentle camera bias toward the locked target
      const wantYaw = Math.atan2(lockTargetPos.x - targetPos.x, lockTargetPos.z - targetPos.z);
      let d = wantYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 3.5);
    }

    const dist = 5.8; // rider is 1.5x scale — pull the shoulder cam back accordingly
    const shoulder = 1.0;
    const dirH = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(dirH.z, 0, -dirH.x);
    const pitchFactor = 1 - Math.abs(this.pitch) * 0.3;
    const camPos = targetPos
      .subtract(dirH.scale(dist * pitchFactor))
      .add(right.scale(shoulder))
      .add(new Vector3(0, 1.7 + this.pitch * 2.4, 0));

    const groundY = this.terrain.heightAt(camPos.x, camPos.z) + 0.5;
    camPos.y = Math.max(camPos.y, groundY);

    // occlusion: a keep or tower between rider and camera pulls the camera in
    // (snap in, ease back out so it doesn't pump when the wall edge flickers)
    const pivot = targetPos.add(new Vector3(0, 1.8, 0));
    const toCam = camPos.subtract(pivot);
    const full = toCam.length();
    let reach = full;
    if (full > 0.01) {
      const hit = this.camera.getScene().pickWithRay(new Ray(pivot, toCam.scale(1 / full), full), isCameraOccluder, true);
      if (hit?.hit) reach = Math.max(1.2, hit.distance - 0.4);
    }
    this.reach = reach < this.reach ? reach : damp(this.reach, reach, 4, dt);
    if (this.reach < full - 0.01) camPos.copyFrom(pivot.add(toCam.scale(this.reach / full)));

    this.camera.position.copyFrom(camPos);
    const look = targetPos.add(new Vector3(0, 2.1, 0)).add(dirH.scale(2));
    // shake: the shoulder cam sits ~6m away, so jitter the aim point (reads as
    // a jolt) with a much smaller positional component than the flight camera
    this.shake = Math.max(0, this.shake - dt * 3.2);
    const sh = this.shake * settings.cameraShake;
    if (sh > 0.01) {
      look.x += (Math.random() - 0.5) * sh * 0.5;
      look.y += (Math.random() - 0.5) * sh * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * sh * 0.12;
    }
    this.camera.setTarget(look);
    this.camera.upVector.copyFrom(Vector3.Up());
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  startRecenter(): void {
    this.recenterTimer = 0.35;
  }

  /** forward direction projected on ground plane (movement reference) */
  groundForward(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  reset(targetPos: Vector3): void {
    this.camera.position.copyFrom(targetPos.add(new Vector3(0, 3, -6)));
  }
}
