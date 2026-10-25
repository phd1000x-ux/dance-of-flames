import { describe, expect, it } from "vitest";
import { FireStreak, STREAK_WINDOW, streakBonus } from "../src/combat/FireStreak";

describe("FireStreak", () => {
  it("chains kills inside the window and reports the streak when it lapses", () => {
    const s = new FireStreak();
    expect(s.kill()).toBe(1);
    s.update(STREAK_WINDOW * 0.5);
    expect(s.kill()).toBe(2);
    s.update(STREAK_WINDOW * 0.9);
    expect(s.kill()).toBe(3);
    expect(s.update(STREAK_WINDOW * 0.5)).toBe(0);
    expect(s.update(STREAK_WINDOW)).toBe(3);
    expect(s.update(1)).toBe(0);
    expect(s.kill()).toBe(1);
  });

  it("only streaks of 3+ pay, growing with length", () => {
    expect(streakBonus(2)).toBe(0);
    expect(streakBonus(3)).toBeGreaterThan(0);
    expect(streakBonus(6)).toBeGreaterThan(streakBonus(3));
  });
});
