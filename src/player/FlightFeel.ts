import { clamp, lerp } from "../core/MathUtils";

/**
 * Flight-feel curves shared by the controller, camera and fire assist.
 * Pure functions so the tuning is unit-testable.
 */

/**
 * Turn-rate multiplier by airspeed: slow flight carves tight circles over a
 * target, cruise is the baseline, boost/dive trade agility for speed.
 * 1.35 at hover → 1.0 at max cruise speed → 0.7 at boost speed and beyond.
 */
export function turnAgility(speed: number, maxSpeed: number, boostSpeed: number): number {
  if (speed <= maxSpeed) return lerp(1.35, 1, clamp(speed / maxSpeed, 0, 1));
  return lerp(1, 0.7, clamp((speed - maxSpeed) / Math.max(1, boostSpeed - maxSpeed), 0, 1));
}

/**
 * Soft-assist cone half-angle (rad) for a target `dist` m away. Up close a
 * soldier sweeps across the nose fast, so the cone widens (up to 2× inside 25 m)
 * and narrows back to the base beyond 70 m.
 */
export function assistCone(baseCone: number, dist: number): number {
  return baseCone * lerp(2, 1, clamp((dist - 25) / 45, 0, 1));
}

/** Assist blend weight: stronger up close, where small aim errors miss entirely. */
export function assistPull(assist: number, dist: number): number {
  return clamp(assist * lerp(0.8, 0.5, clamp((dist - 25) / 45, 0, 1)), 0, 0.85);
}

/**
 * Camera speed feel: FOV and chase-distance multiplier from airspeed.
 * A dive past cruise speed widens the FOV and pulls the camera back so the
 * ground rush reads; slow flight tightens the frame for close strafing.
 */
export function cameraSpeedFeel(speed: number, maxSpeed: number, boostSpeed: number, boosting: boolean, diving: boolean): { fov: number; distScale: number } {
  const cruiseT = clamp(speed / maxSpeed, 0, 1);
  const overT = clamp((speed - maxSpeed) / Math.max(1, boostSpeed - maxSpeed), 0, 1.5);
  let fov = lerp(62, 70, cruiseT) + overT * 10;
  let distScale = lerp(0.88, 1, cruiseT) + overT * 0.12;
  if (boosting) {
    fov = Math.max(fov, 82);
    distScale = Math.max(distScale, 1.18);
  }
  if (diving) {
    fov += 4;
    distScale += 0.04;
  }
  return { fov: Math.min(fov, 90), distScale };
}
