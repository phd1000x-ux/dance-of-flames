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
        if (ev.insertObjective) {
          // AGENTS.md: every objective stays completable after dragon death
          expect(ev.insertObjective.groundAlternative).toBeDefined();
          expect(m.objectives.map((o) => o.id)).not.toContain(ev.insertObjective.id);
        }
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

describe("objective twists", () => {
  it("inserted objective becomes current and ignores kills made before it", () => {
    const t = new ObjectiveTracker([
      { id: "o1", type: "kill", description: "", targetType: "soldier", count: 2 },
      { id: "o2", type: "destroy", description: "", targetTag: "camp", count: 1 },
    ]);
    t.notifyBuildingDestroyed("camp"); // early camp kill still counts for o2 later
    t.notifyKill("swordsman");
    t.notifyKill("swordsman");
    expect(t.current()?.id).toBe("o2");
    // o2 completed retroactively on update; insert before checking that
    t.insertAfter("o1", { id: "tw", type: "kill", description: "", targetType: "soldier", count: 2 });
    t.update(0);
    expect(t.current()?.id).toBe("tw");
    expect(t.current()?.progress).toBe(0);
    t.notifyKill("archer");
    t.notifyKill("spearman");
    expect(t.objectives().find((o) => o.id === "tw")?.completed).toBe(true);
    t.update(0);
    expect(t.allCompleted()).toBe(true);
  });

  it("inserted destroy objective counts only new destruction; duplicate insert is ignored", () => {
    const t = new ObjectiveTracker([{ id: "o1", type: "kill", description: "", targetType: "any", count: 1 }]);
    t.notifyBuildingDestroyed("camp");
    t.notifyKill("swordsman");
    t.insertAfter("o1", { id: "tw", type: "destroy", description: "", targetTag: "camp", count: 1 });
    t.insertAfter("o1", { id: "tw", type: "destroy", description: "", targetTag: "camp", count: 1 });
    expect(t.objectives().length).toBe(2);
    t.update(0);
    expect(t.current()?.id).toBe("tw");
    t.notifyBuildingDestroyed("camp");
    expect(t.allCompleted()).toBe(true);
  });

  it("dragon death converts an inserted objective to its ground alternative", () => {
    const t = new ObjectiveTracker([{ id: "o1", type: "kill", description: "", targetType: "any", count: 1 }]);
    t.notifyKill("swordsman");
    t.insertAfter("o1", {
      id: "tw", type: "kill", description: "", targetType: "elite", count: 2,
      groundAlternative: { id: "g-tw", type: "survive", description: "", seconds: 30 },
    });
    t.convertToGround();
    expect(t.current()?.id).toBe("g-tw");
  });

  it("elevated squads take the highest sampled ground", () => {
    let i = 0;
    const rand = () => ((i++ * 0.37) % 1);
    const hill = (x: number) => x; // terrain rises to the east
    const def = { id: "e", afterObjective: "o", subtitle: "", reinforce: { archer: 4 } };
    const flat = reinforcementPoints(def, { x: 0, z: 0 }, rand, hill);
    i = 0;
    const high = reinforcementPoints({ ...def, elevated: true }, { x: 0, z: 0 }, rand, hill);
    const avg = (ps: { x: number }[]) => ps.reduce((a, p) => a + p.x, 0) / ps.length;
    expect(avg(high)).toBeGreaterThan(avg(flat) + 10);
  });
});
