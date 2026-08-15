/**
 * Minimap coordinate math — single source of truth.
 *
 * CONVENTION (verified empirically against the 3D camera):
 *   North = world -Z  (map up)     East = world +X  (map right)
 *   Player forward  = (sin yaw, 0, cos yaw)
 *   Map is NORTH-UP: the map never rotates; the player arrow rotates.
 *
 * Canvas specifics: y grows DOWNWARD on the 2D canvas, so world +Z maps to
 * canvas +y (down/south). Canvas rotate() is clockwise-positive.
 */

/** world (x,z) → minimap canvas px for a square map of `size` px covering worldSize */
export function worldToMap(x: number, z: number, size: number, worldSize: number): { mx: number; my: number } {
  return {
    mx: (x / worldSize) * size + size / 2,
    my: (z / worldSize) * size + size / 2, // +Z = south = down
  };
}

/**
 * Canvas rotation (radians, clockwise) for a player arrow drawn pointing UP (0,-1)
 * so it points along the world heading `(sin yaw, cos yaw)` on the map.
 * Derived: rotate(φ) maps (0,-1)→(sinφ,-cosφ); require (sin yaw, cos yaw)
 * ⟹ sinφ = sin yaw and cosφ = -cos yaw ⟹ φ = π − yaw.
 */
export function arrowRotation(yaw: number): number {
  return Math.PI - yaw;
}

/** heading in compass degrees [0,360): 0=N(-Z), 90=E(+X), 180=S(+Z), 270=W(-X) */
export function headingDegrees(yaw: number): number {
  // map dir = (sin yaw, cos yaw); compass = atan2(east, north) = atan2(sin yaw, -cos yaw)
  const deg = (Math.atan2(Math.sin(yaw), -Math.cos(yaw)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** expected map-space unit direction of the player arrow for a given yaw */
export function arrowMapDirection(yaw: number): { dx: number; dy: number } {
  return { dx: Math.sin(yaw), dy: Math.cos(yaw) };
}
