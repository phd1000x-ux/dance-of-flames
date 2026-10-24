import { Vector3 } from "@babylonjs/core";

/** Box bounds in world units. yaw rotates the local horizontal rectangle. */
export interface FlightSolid {
  x: number; z: number; hx: number; hz: number;
  minY: number; maxY: number;
  yaw?: number;
}

function local(point: Vector3, box: FlightSolid): Vector3 {
  const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
  const x = point.x - box.x, z = point.z - box.z;
  return new Vector3(x * c - z * s, point.y, x * s + z * c);
}
function worldDirection(v: Vector3, box: FlightSolid): Vector3 {
  const c = Math.cos(box.yaw ?? 0), s = Math.sin(box.yaw ?? 0);
  return new Vector3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

function contact(start: Vector3, end: Vector3, box: FlightSolid, radius: number) {
  const a = local(start, box), b = local(end, box), delta = b.subtract(a);
  const lo = [-box.hx - radius, box.minY - radius, -box.hz - radius];
  const hi = [box.hx + radius, box.maxY + radius, box.hz + radius];
  const av = [a.x, a.y, a.z], dv = [delta.x, delta.y, delta.z];
  // A restored/spawned body inside a solid leaves through its nearest face.
  if (av.every((v, i) => v > lo[i] && v < hi[i])) {
    let depth = Infinity, axis = 0, sign = 1;
    for (let i = 0; i < 3; i++) {
      if (av[i] - lo[i] < depth) { depth = av[i] - lo[i]; axis = i; sign = -1; }
      if (hi[i] - av[i] < depth) { depth = hi[i] - av[i]; axis = i; sign = 1; }
    }
    const normal = new Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    return { t: 0, normal: worldDirection(normal, box), depth };
  }
  let enter = 0, exit = 1, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dv[i]) < 1e-10) {
      if (av[i] < lo[i] || av[i] > hi[i]) return null;
      continue;
    }
    let near = (lo[i] - av[i]) / dv[i], far = (hi[i] - av[i]) / dv[i];
    const face = dv[i] > 0 ? -1 : 1;
    if (near > far) [near, far] = [far, near];
    if (near >= enter) { enter = near; axis = i; sign = face; }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (axis < 0 || enter < 0 || enter > 1 || exit < 0) return null;
  const normal = new Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return { t: enter, normal: worldDirection(normal, box), depth: 0 };
}

/** Swept conservative body box; stops tunneling and slides along walls/roofs. */
export function collideFlight(start: Vector3, desired: Vector3, radius: number, solids: readonly FlightSolid[]): boolean {
  let current = start.clone(), remaining = desired.subtract(start), hit = false;
  for (let iteration = 0; iteration < 4; iteration++) {
    let earliest: ReturnType<typeof contact> = null;
    const end = current.add(remaining);
    for (const box of solids) {
      const candidate = contact(current, end, box, radius);
      if (candidate && (!earliest || candidate.t < earliest.t)) earliest = candidate;
    }
    if (!earliest) { current = end; remaining.setAll(0); break; }
    hit = true;
    current.addInPlace(remaining.scale(earliest.t)).addInPlace(earliest.normal.scale(earliest.depth + 0.001));
    remaining.scaleInPlace(1 - earliest.t);
    const inward = Vector3.Dot(remaining, earliest.normal);
    if (inward < 0) remaining.subtractInPlace(earliest.normal.scale(inward));
  }
  desired.copyFrom(current);
  return hit;
}
