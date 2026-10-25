/**
 * Mid-mission scripted beats: when a named objective completes, the battlefield
 * answers — a subtitle, a war horn, and a reinforcement squad at a meaningful
 * place (a building group or ahead of the player). Data lives in missions.ts.
 * An event may also insert a new objective right after the one that triggered it
 * (a mid-mission twist), and may place its squad on the high ground.
 * Pure logic — no rendering dependencies (unit-testable).
 */
import type { ObjectiveDef } from "./Objectives";

export interface MissionEventDef {
  id: string;
  /** fires once, when the objective with this id completes */
  afterObjective: string;
  subtitle: string;
  /** enemy type id → count */
  reinforce?: Record<string, number>;
  /** building tag the squad musters at (first standing one), or "player" (ahead of the player) */
  anchor?: string;
  /** squad takes the highest ground around the anchor (archers on ridges) */
  elevated?: boolean;
  /** new objective inserted right after the trigger — needs its own groundAlternative */
  insertObjective?: ObjectiveDef;
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
 *  reads as one muster rather than a stacked pile. `elevated` squads try a few
 *  wider spots (up to 45 m) per soldier and keep the highest. */
export function reinforcementPoints(
  def: MissionEventDef,
  anchor: { x: number; z: number },
  rand: () => number,
  heightAt?: (x: number, z: number) => number
): SpawnPoint[] {
  const pts: SpawnPoint[] = [];
  const tries = def.elevated && heightAt ? 6 : 1;
  const reach = def.elevated && heightAt ? 33 : 16;
  for (const [type, n] of Object.entries(def.reinforce ?? {})) {
    for (let i = 0; i < n; i++) {
      let best: SpawnPoint | null = null;
      let bestH = -Infinity;
      for (let t = 0; t < tries; t++) {
        const a = rand() * Math.PI * 2;
        const r = 12 + rand() * reach;
        const p = { type, x: anchor.x + Math.cos(a) * r, z: anchor.z + Math.sin(a) * r };
        const h = heightAt && tries > 1 ? heightAt(p.x, p.z) : 0;
        if (!best || h > bestH) {
          best = p;
          bestH = h;
        }
      }
      pts.push(best!);
    }
  }
  return pts;
}

/** "player" anchor: a point on the ground 80 m ahead along the heading, so the
 *  new squad arrives in view instead of behind the camera. */
export function aheadOfPlayer(pos: { x: number; z: number }, yaw: number, dist = 80): { x: number; z: number } {
  return { x: pos.x + Math.sin(yaw) * dist, z: pos.z + Math.cos(yaw) * dist };
}
