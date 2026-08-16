import { describe, test, expect } from "vitest";
import { PhaseMachine, canTransition, FINALE_TRANSITIONS, type FinalePhase } from "../src/mission/blackstone/FinalePhases";
import { CastellanDuel, selectCastellanPattern, type CastellanPattern } from "../src/mission/blackstone/CastellanDuel";

describe("finale phase machine", () => {
  test("legal forward chain", () => {
    const m = new PhaseMachine();
    for (const p of ["AWAIT_LANDING", "DUEL_GROUND", "TRANSITION", "REVEAL", "MOUNT", "REMOUNT", "CHASE", "DUEL_AIR", "RESOLVED"] as FinalePhase[]) {
      expect(m.transition(p), `→ ${p}`).toBe(true);
      expect(m.current).toBe(p);
    }
    expect(m.isTerminal()).toBe(true);
  });

  test("illegal transitions rejected without state change", () => {
    const m = new PhaseMachine();
    expect(m.transition("CHASE")).toBe(false);
    expect(m.current).toBe("INACTIVE");
  });

  test("skips to RESOLVED are legal from active phases (dragon-death/fallback)", () => {
    for (const from of ["AWAIT_LANDING", "DUEL_GROUND", "CHASE", "DUEL_AIR"] as FinalePhase[]) {
      expect(canTransition(from, "RESOLVED"), from).toBe(true);
    }
  });

  test("terminal phase accepts nothing", () => {
    const m = new PhaseMachine();
    m.transition("AWAIT_LANDING");
    m.transition("RESOLVED");
    expect(m.transition("RESOLVED")).toBe(false);
    expect(FINALE_TRANSITIONS.RESOLVED).toEqual([]);
  });
});

describe("castellan duel core", () => {
  test("damage above floor applies fully, no transition", () => {
    const d = new CastellanDuel(320); // floor 0.4 → 128
    const r = d.damage(100);
    expect(r).toEqual({ applied: 100, clamped: false, transitionNow: false });
    expect(d.hp).toBe(220);
  });

  test("damage below floor clamps and fires transition exactly once", () => {
    const d = new CastellanDuel(320);
    d.damage(150); // hp 170, above floor 128
    const hit = d.damage(100); // would be 70 — below floor
    expect(hit.clamped).toBe(true);
    expect(hit.transitionNow).toBe(true);
    expect(d.hp).toBe(128);
    const again = d.damage(50);
    expect(again.transitionNow).toBe(false);
    expect(again.applied).toBe(0);
    expect(d.hp).toBe(128);
  });

  test("burst multi-hit cannot double-transition", () => {
    const d = new CastellanDuel(320);
    expect(d.damage(200).transitionNow).toBe(true);
    expect(d.damage(50).transitionNow).toBe(false);
    expect(d.damage(50).transitionNow).toBe(false);
  });

  test("reinforce triggers once below 70%", () => {
    const d = new CastellanDuel(320);
    expect(d.shouldReinforce()).toBe(false);
    d.damage(100); // 220/320 ≈ 0.69
    expect(d.shouldReinforce()).toBe(true);
    d.reinforceFired = true;
    expect(d.shouldReinforce()).toBe(false);
  });

  test("pattern selection: javelin at range, melee close, no immediate repeats", () => {
    const seq: CastellanPattern[] = [];
    let last: CastellanPattern | null = null;
    let i = 0;
    const rand = () => [0.1, 0.1, 0.1, 0.1][i++ % 4];
    expect(selectCastellanPattern(rand, 30, null, false)).toBe("javelin");
    last = selectCastellanPattern(rand, 4, last, false); seq.push(last);
    last = selectCastellanPattern(rand, 4, last, false); seq.push(last);
    expect(seq[0]).toMatch(/combo|shieldBreaker/);
    expect(seq[1]).not.toBe(seq[0]);
    expect(selectCastellanPattern(rand, 4, null, false)).toMatch(/combo|shieldBreaker/);
    expect(selectCastellanPattern(rand, 4, null, true)).toBe("reinforce");
  });
});
