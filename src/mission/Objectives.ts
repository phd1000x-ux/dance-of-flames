export type ObjectiveType = "kill" | "destroy" | "survive";

export interface ObjectiveDef {
  id: string;
  type: ObjectiveType;
  description: string;
  /** kill: enemy type id or role ("soldier" = any infantry/archer/spear/shield) */
  targetType?: string;
  /** destroy: building tag */
  targetTag?: string;
  count?: number;
  seconds?: number;
  /** objective shown in the HUD while active */
  hint?: string;
  /** replacement objective when the dragon dies and this one is incomplete */
  groundAlternative?: ObjectiveDef;
}

export interface ObjectiveState extends ObjectiveDef {
  progress: number;
  completed: boolean;
}

type CompleteCallback = (o: ObjectiveState) => void;

/**
 * Sequential objective chain with dragon-death ground conversion.
 * Pure logic — no rendering dependencies (unit-testable).
 */
export class ObjectiveTracker {
  private items: ObjectiveState[];
  private listeners: CompleteCallback[] = [];
  private surviveTimer = 0;

  constructor(defs: ObjectiveDef[]) {
    this.items = defs.map((d) => ({ ...d, progress: 0, completed: false }));
  }

  onObjectiveComplete(cb: CompleteCallback): void {
    this.listeners.push(cb);
  }

  objectives(): readonly ObjectiveState[] {
    return this.items;
  }

  current(): ObjectiveState | undefined {
    return this.items.find((o) => !o.completed);
  }

  allCompleted(): boolean {
    return this.items.every((o) => o.completed);
  }

  /** Advance objective counters; only the current (first incomplete) objective accepts progress. */
  notifyKill(enemyType: string): void {
    const cur = this.current();
    if (!cur || cur.type !== "kill") return;
    if (!this.matchesTarget(cur, enemyType)) return;
    cur.progress++;
    this.checkDone(cur);
  }

  notifyBuildingDestroyed(tag: string): void {
    const cur = this.current();
    if (!cur || cur.type !== "destroy") return;
    if (cur.targetTag !== tag) return;
    cur.progress++;
    this.checkDone(cur);
  }

  /** Time-based progress for survive objectives. */
  update(dt: number): void {
    const cur = this.current();
    if (cur && cur.type === "survive" && !cur.completed) {
      this.surviveTimer += dt;
      cur.progress = Math.min(cur.seconds ?? 0, this.surviveTimer);
      this.checkDone(cur);
    }
  }

  /** Replace incomplete objectives with their ground-play alternatives. */
  convertToGround(): void {
    for (let i = 0; i < this.items.length; i++) {
      const o = this.items[i];
      if (o.completed) continue;
      const alt = o.groundAlternative;
      if (alt) {
        this.items[i] = { ...alt, progress: 0, completed: false };
      } else {
        // No alternative defined: remove so the mission stays completable.
        this.items.splice(i, 1);
        i--;
      }
    }
    this.surviveTimer = 0;
  }

  private matchesTarget(obj: ObjectiveState, enemyType: string): boolean {
    const t = obj.targetType;
    if (!t || t === "any") return true;
    if (t === enemyType) return true;
    if (t === "soldier") {
      return ["swordsman", "archer", "spearman", "shieldman"].includes(enemyType);
    }
    return false;
  }

  private checkDone(o: ObjectiveState): void {
    if (o.completed) return;
    const need = o.type === "survive" ? o.seconds ?? 0 : o.count ?? 1;
    if (o.progress >= need) {
      o.completed = true;
      this.surviveTimer = 0;
      for (const cb of this.listeners) cb(o);
    }
  }
}
