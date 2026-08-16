import { describe, test, expect } from "vitest";
import { PhaseMachine, canTransition, FINALE_TRANSITIONS, type FinalePhase } from "../src/mission/blackstone/FinalePhases";
import { CastellanDuel, selectCastellanPattern, type CastellanPattern } from "../src/mission/blackstone/CastellanDuel";
import { rubberBandFactor, advanceWaypoint, FlameSweepSM, type PathPoint } from "../src/mission/blackstone/BossAI";

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

  test("markTransitioned sets transitioned and clamps hp to floor", () => {
    const d = new CastellanDuel(320);
    d.damage(100); // 220, above floor
    d.markTransitioned();
    expect(d.transitioned).toBe(true);
    expect(d.hp).toBe(128);
    expect(d.damage(50).applied).toBe(0);
  });

  test("restoreHp un-clamps: next floor-crossing fires transitionNow again", () => {
    const d = new CastellanDuel(320);
    expect(d.damage(200).transitionNow).toBe(true); // hp → floor 128
    d.restoreHp(220);
    expect(d.hp).toBe(220);
    expect(d.transitioned).toBe(false);
    const hit = d.damage(100); // would be 120 — below floor
    expect(hit.transitionNow).toBe(true);
    expect(hit.clamped).toBe(true);
    expect(d.hp).toBe(128);
  });
});

describe("boss ai core", () => {
  test("rubber band: slows when player far, speeds when crowding, neutral in band", () => {
    expect(rubberBandFactor(140)).toBeCloseTo(-0.1);
    expect(rubberBandFactor(30)).toBeCloseTo(0.1);
    expect(rubberBandFactor(75)).toBeCloseTo(0);
  });

  test("waypoint advance on reach, wraps at path end", () => {
    const path: PathPoint[] = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    expect(advanceWaypoint(0, 0, path, 0)).toBe(1);
    expect(advanceWaypoint(70, 0, path, 1)).toBe(1);
    expect(advanceWaypoint(95, 0, path, 1)).toBe(0); // wrapped
  });

  test("flame sweep SM: telegraph → attack → recovery → idle with correct durations", () => {
    const sm = new FlameSweepSM({ telegraph: 1.1, attack: 1.4, recovery: 2.2 });
    expect(sm.state).toBe("IDLE");
    expect(sm.start()).toBe(true);
    expect(sm.start()).toBe(false); // already running
    expect(sm.state).toBe("TELEGRAPH");
    sm.update(1.0);
    expect(sm.state).toBe("TELEGRAPH");
    sm.update(0.2);
    expect(sm.state).toBe("ATTACK");
    sm.update(1.3);
    expect(sm.state).toBe("ATTACK");
    sm.update(0.2);
    expect(sm.state).toBe("RECOVERY");
    sm.update(2.2);
    expect(sm.state).toBe("IDLE"); // recovery window is the player's attack opening
    expect(sm.start()).toBe(true); // can re-arm
  });
});
