export type ObjectiveType = "kill" | "destroy" | "survive" | "event";

export interface ObjectiveDef {
  id: string;
  type: ObjectiveType;
  description: string;
  /** kill: enemy type id or role ("soldier" = any infantry/archer/spear/shield) */
  targetType?: string;
  /** destroy: building tag */
  targetTag?: string;
  /** event: finale event id — completes when that scripted event fires */
  event?: string;
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
  /** every destroy/kill ever notified, so objectives activated late catch up
   *  (the world does not wait for the chain head — out-of-order play must not soft-lock) */
  private destroyedByTag = new Map<string, number>();
  private killsByType = new Map<string, number>();
  /** matched events already reflected in the current objective's progress —
   *  fresh activations absorb nothing (retroactive jump); restored progress
   *  absorbs the full history so replayed events are not double-counted */
  private absorbedKillKey: string | null = null;
  private absorbedKill = 0;
  private absorbedDestroyKey: string | null = null;
  private absorbedDestroy = 0;

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

  /** Advance objective counters; progress derives from the full event history,
   *  so actions taken before an objective becomes current still count. */
  notifyKill(enemyType: string): void {
    this.killsByType.set(enemyType, (this.killsByType.get(enemyType) ?? 0) + 1);
    this.applyKillProgress();
  }

  notifyBuildingDestroyed(tag: string): void {
    this.destroyedByTag.set(tag, (this.destroyedByTag.get(tag) ?? 0) + 1);
    this.applyDestroyProgress();
  }

  /** Complete event objectives whose event id matches — anywhere in the chain,
   *  so short-circuits work regardless of chain position. */
  notifyEvent(eventId: string): void {
    for (const o of this.items) {
      if (!o.completed && o.type === "event" && o.event === eventId) {
        o.progress = 1;
        this.checkDone(o);
      }
    }
  }

  /** Time-based progress for survive objectives + retroactive catch-up for the
   *  current kill/destroy objective (covers objectives activated after the fact). */
  update(dt: number): void {
    const cur = this.current();
    if (cur && cur.type === "survive" && !cur.completed) {
      this.surviveTimer += dt;
      cur.progress = Math.min(cur.seconds ?? 0, this.surviveTimer);
      this.checkDone(cur);
    }
    const now = this.current();
    if (now && now.type === "kill") this.applyKillProgress();
    if (now && now.type === "destroy") this.applyDestroyProgress();
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

  /** Restore exact progress/completion from a checkpoint snapshot.
   *  Pure: no listener callbacks fire; the listener list itself is kept.
   *  A partially-survived current survive objective resumes from its progress. */
  restoreState(list: { id: string; progress: number; completed: boolean }[]): void {
    for (const r of list) {
      const item = this.items.find((o) => o.id === r.id);
      if (!item) continue;
      item.progress = r.progress;
      item.completed = r.completed;
    }
    const cur = this.current();
    this.surviveTimer = cur && cur.type === "survive" && !cur.completed ? cur.progress : 0;
    // absorb the FULL history into the restored current objective — its progress
    // already embeds those events; only events after this restore may add to it
    if (cur && cur.type === "kill") {
      this.absorbedKillKey = cur.id;
      this.absorbedKill = this.matchedKillTotal(cur);
    } else {
      this.absorbedKillKey = null;
      this.absorbedKill = 0;
    }
    if (cur && cur.type === "destroy") {
      this.absorbedDestroyKey = cur.id;
      this.absorbedDestroy = this.matchedDestroyTotal(cur);
    } else {
      this.absorbedDestroyKey = null;
      this.absorbedDestroy = 0;
    }
  }

  private matchedKillTotal(cur: ObjectiveState): number {
    let total = 0;
    for (const [type, n] of this.killsByType) {
      if (this.matchesTarget(cur, type)) total += n;
    }
    return total;
  }

  private matchedDestroyTotal(cur: ObjectiveState): number {
    if (!cur.targetTag || cur.targetTag === "any") {
      // synthetic bookkeeping keys are not buildings — each real tag counts once
      let total = 0;
      for (const [tag, n] of this.destroyedByTag) {
        if (tag === "any" || tag === "relic-building") continue;
        total += n;
      }
      return total;
    }
    return this.destroyedByTag.get(cur.targetTag) ?? 0;
  }

  private applyKillProgress(): void {
    const cur = this.current();
    if (!cur || cur.type !== "kill" || cur.completed) return;
    const total = this.matchedKillTotal(cur);
    if (this.absorbedKillKey !== cur.id) {
      this.absorbedKillKey = cur.id;
      this.absorbedKill = cur.progress > 0 ? total : 0;
    }
    const next = Math.min(cur.count ?? 1, cur.progress + Math.max(0, total - this.absorbedKill));
    if (next > cur.progress) {
      cur.progress = next;
      this.absorbedKill = total;
      this.checkDone(cur);
    }
  }

  private applyDestroyProgress(): void {
    const cur = this.current();
    if (!cur || cur.type !== "destroy" || cur.completed) return;
    const total = this.matchedDestroyTotal(cur);
    if (this.absorbedDestroyKey !== cur.id) {
      this.absorbedDestroyKey = cur.id;
      this.absorbedDestroy = cur.progress > 0 ? total : 0;
    }
    const next = Math.min(cur.count ?? 1, cur.progress + Math.max(0, total - this.absorbedDestroy));
    if (next > cur.progress) {
      cur.progress = next;
      this.absorbedDestroy = total;
      this.checkDone(cur);
    }
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
