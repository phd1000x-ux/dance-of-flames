import { describe, test, expect } from "vitest";
import { damageStateFor, DAMAGE_VISUALS, type DamageState } from "../src/world/DamageStates";
import { planVolley } from "../src/ai/EnemyManager";
import { tierFor, shouldLookUp, pairPhase } from "../src/world/AmbientBattle";

describe("damage states", () => {
  test("threshold boundaries", () => {
    expect(damageStateFor(1)).toBe("INTACT");
    expect(damageStateFor(0.85)).toBe("SCORCHED");
    expect(damageStateFor(0.6)).toBe("DAMAGED");
    expect(damageStateFor(0.35)).toBe("CRITICAL");
    expect(damageStateFor(0)).toBe("CRITICAL");
  });

  test("monotonic escalation with damage", () => {
    let last = -1;
    const order: DamageState[] = ["INTACT", "SCORCHED", "DAMAGED", "CRITICAL"];
    for (let frac = 1; frac >= 0; frac -= 0.01) {
      const s = damageStateFor(frac);
      const idx = order.indexOf(s);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  test("visual params escalate monotonically", () => {
    const seq = ["INTACT", "SCORCHED", "DAMAGED", "CRITICAL"] as DamageState[];
    for (let i = 1; i < seq.length; i++) {
      expect(DAMAGE_VISUALS[seq[i]].diffuseScale).toBeLessThan(DAMAGE_VISUALS[seq[i - 1]].diffuseScale);
      expect(DAMAGE_VISUALS[seq[i]].fireRate).toBeGreaterThanOrEqual(DAMAGE_VISUALS[seq[i - 1]].fireRate);
      expect(DAMAGE_VISUALS[seq[i]].smokeRate).toBeGreaterThanOrEqual(DAMAGE_VISUALS[seq[i - 1]].smokeRate);
    }
    expect(DAMAGE_VISUALS.INTACT.fireRate).toBe(0);
    expect(DAMAGE_VISUALS.CRITICAL.ember[0]).toBeGreaterThan(DAMAGE_VISUALS.SCORCHED.ember[0]);
  });
});

describe("ballista volley planning", () => {
  const rng = { range: (a: number, b: number) => (a + b) / 2 };

  test("no volley below 2 alive", () => {
    expect(planVolley(0, rng).count).toBe(0);
    expect(planVolley(1, rng).count).toBe(0);
  });

  test("volley of 2-3 scaled by alive count", () => {
    expect(planVolley(2, rng).count).toBeGreaterThanOrEqual(2);
    expect(planVolley(6, rng).count).toBeLessThanOrEqual(3);
    expect(planVolley(6, rng).count).toBeGreaterThanOrEqual(2);
  });

  test("window is tight and fixed", () => {
    expect(planVolley(3, rng).window).toBe(0.6);
  });
});

describe("ambient battle helpers", () => {
  test("distance tiers", () => {
    expect(tierFor(50)).toBe(0);
    expect(tierFor(120)).toBe(1);
    expect(tierFor(300)).toBe(2);
  });

  test("look up only for low nearby dragons", () => {
    expect(shouldLookUp({ x: 0, y: 10, z: 0 }, { x: 30, z: 0 }, 8)).toBe(true);
    expect(shouldLookUp({ x: 0, y: 100, z: 0 }, { x: 30, z: 0 }, 95)).toBe(false);
    expect(shouldLookUp({ x: 0, y: 10, z: 0 }, { x: 90, z: 0 }, 8)).toBe(false);
  });

  test("pair phase deterministic per seed and bounded", () => {
    const a = pairPhase(3.5, 7);
    const b = pairPhase(3.5, 7);
    const c = pairPhase(3.5, 8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.abs(a.swayA)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.lunge)).toBeLessThanOrEqual(1);
  });
});
