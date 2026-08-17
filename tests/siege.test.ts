import { describe, test, expect } from "vitest";
import { damageStateFor, DAMAGE_VISUALS, type DamageState } from "../src/world/DamageStates";

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
