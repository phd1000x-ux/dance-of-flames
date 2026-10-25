/**
 * Flight kill streak: fire kills landing within WINDOW of each other chain.
 * A sweeping strafe through a squad reads as one "×N INFERNO" beat instead of
 * N separate +1s, and a finished streak of 3+ pays a coin bonus so the
 * dive → burn → climb pass is the rewarded way to play. Pure (unit tested).
 */
export const STREAK_WINDOW = 1.6;
export const STREAK_MIN = 3;

export function streakBonus(count: number): number {
  return count < STREAK_MIN ? 0 : (count - STREAK_MIN + 1) * 4;
}

export class FireStreak {
  count = 0;
  private timer = 0;

  /** a fire kill landed; returns the running streak length */
  kill(): number {
    this.count = this.timer > 0 ? this.count + 1 : 1;
    this.timer = STREAK_WINDOW;
    return this.count;
  }

  /** advance; returns the length of a streak that just ended (0 if none ended) */
  update(dt: number): number {
    if (this.timer <= 0) return 0;
    this.timer -= dt;
    if (this.timer > 0) return 0;
    const ended = this.count;
    this.count = 0;
    return ended;
  }

  reset(): void {
    this.count = 0;
    this.timer = 0;
  }
}
