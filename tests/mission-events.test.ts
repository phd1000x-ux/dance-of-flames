import { describe, expect, it } from "vitest";
import { MISSIONS } from "../src/data/missions";
import { ENEMIES } from "../src/data/enemies";
import { MissionEventDirector, aheadOfPlayer, reinforcementPoints } from "../src/mission/MissionEvents";
import { ObjectiveTracker } from "../src/mission/Objectives";

describe("mission events data", () => {
  for (const m of MISSIONS) {
    for (const ev of m.events ?? []) {
      it(`${m.id}/${ev.id} references a real objective, enemy types and anchor`, () => {
        expect(m.objectives.map((o) => o.id)).toContain(ev.afterObjective);
        for (const type of Object.keys(ev.reinforce ?? {})) expect(ENEMIES[type]).toBeDefined();
        if (ev.anchor && ev.anchor !== "player") {
          expect(m.buildings.map((b) => b.tag)).toContain(ev.anchor);
        }
        expect(ev.subtitle.length).toBeGreaterThan(0);
      });
    }
  }

  it("every non-finale combat mission after the tutorial has a mid-mission beat", () => {
    for (const id of ["riverlands", "harrenhal", "kingslanding"]) {
      expect(MISSIONS.find((m) => m.id === id)!.events?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("MissionEventDirector", () => {
  const defs = [
    { id: "a", afterObjective: "o1", subtitle: "A", reinforce: { swordsman: 2 }, anchor: "player" },
    { id: "b", afterObjective: "o2", subtitle: "B" },
  ];

  it("fires the matching event once only", () => {
    const d = new MissionEventDirector(defs);
    expect(d.onObjectiveComplete("o1").map((e) => e.id)).toEqual(["a"]);
    expect(d.onObjectiveComplete("o1")).toEqual([]);
    expect(d.onObjectiveComplete("nope")).toEqual([]);
    expect(d.hasFired("a")).toBe(true);
    expect(d.hasFired("b")).toBe(false);
  });

  it("fires from real objective completion in chain order", () => {
    const tracker = new ObjectiveTracker([
      { id: "o1", type: "kill", description: "", targetType: "soldier", count: 1 },
      { id: "o2", type: "kill", description: "", targetType: "soldier", count: 1 },
    ]);
    const d = new MissionEventDirector(defs);
    const fired: string[] = [];
    tracker.onObjectiveComplete((o) => fired.push(...d.onObjectiveComplete(o.id).map((e) => e.id)));
    tracker.notifyKill("swordsman");
    expect(fired).toEqual(["a"]);
    tracker.notifyKill("archer");
    expect(fired).toEqual(["a", "b"]);
  });

  it("places the squad in a ring around the anchor", () => {
    let i = 0;
    const seq = [0, 0, 0.25, 1, 0.5, 0.5];
    const pts = reinforcementPoints(
      { id: "x", afterObjective: "o", subtitle: "", reinforce: { swordsman: 2, archer: 1 } },
      { x: 100, z: -50 },
      () => seq[i++ % seq.length]
    );
    expect(pts.map((p) => p.type)).toEqual(["swordsman", "swordsman", "archer"]);
    for (const p of pts) {
      const r = Math.hypot(p.x - 100, p.z + 50);
      expect(r).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(r).toBeLessThanOrEqual(28 + 1e-9);
    }
  });

  it("'player' anchor sits ahead along the heading (+Z = yaw 0)", () => {
    const a = aheadOfPlayer({ x: 0, z: 0 }, 0);
    expect(a.x).toBeCloseTo(0);
    expect(a.z).toBeCloseTo(80);
  });
});
