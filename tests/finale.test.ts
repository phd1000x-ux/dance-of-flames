import { describe, test, expect } from "vitest";
import { PhaseMachine, canTransition, FINALE_TRANSITIONS, type FinalePhase } from "../src/mission/blackstone/FinalePhases";

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
