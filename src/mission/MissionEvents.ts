/**
 * Mid-mission scripted beats: when a named objective completes, the battlefield
 * answers — a subtitle, a war horn, and a reinforcement squad at a meaningful
 * place (a building group or ahead of the player). Data lives in missions.ts.
 * Pure logic — no rendering dependencies (unit-testable).
 */
export interface MissionEventDef {
  id: string;
  /** fires once, when the objective with this id completes */
  afterObjective: string;
  subtitle: string;
  /** enemy type id → count */
  reinforce?: Record<string, number>;
  /** building tag the squad musters at (first standing one), or "player" (ahead of the player) */
  anchor?: string;
}

export interface SpawnPoint {
  type: string;
  x: number;
  z: number;
}

export class MissionEventDirector {
  private fired = new Set<string>();

  constructor(private defs: readonly MissionEventDef[]) {}

  /** events triggered by this objective completing — each fires at most once */
  onObjectiveComplete(objectiveId: string): MissionEventDef[] {
    const out: MissionEventDef[] = [];
    for (const e of this.defs) {
      if (e.afterObjective !== objectiveId || this.fired.has(e.id)) continue;
      this.fired.add(e.id);
      out.push(e);
    }
    return out;
  }

  hasFired(id: string): boolean {
    return this.fired.has(id);
  }
}

/** Squad placement: a loose ring around the anchor, 12–28 m out, so the group
 *  reads as one muster rather than a stacked pile. */
export function reinforcementPoints(
  def: MissionEventDef,
  anchor: { x: number; z: number },
  rand: () => number
): SpawnPoint[] {
  const pts: SpawnPoint[] = [];
  for (const [type, n] of Object.entries(def.reinforce ?? {})) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 12 + rand() * 16;
      pts.push({ type, x: anchor.x + Math.cos(a) * r, z: anchor.z + Math.sin(a) * r });
    }
  }
  return pts;
}

/** "player" anchor: a point on the ground 80 m ahead along the heading, so the
 *  new squad arrives in view instead of behind the camera. */
export function aheadOfPlayer(pos: { x: number; z: number }, yaw: number, dist = 80): { x: number; z: number } {
  return { x: pos.x + Math.sin(yaw) * dist, z: pos.z + Math.cos(yaw) * dist };
}
