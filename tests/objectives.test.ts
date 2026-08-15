import { describe, it, expect } from "vitest";
import { ObjectiveTracker } from "../src/mission/Objectives";

const killObjective = {
  id: "kill-soldiers",
  type: "kill" as const,
  description: "Burn enemy soldiers",
  targetType: "soldier",
  count: 5,
  groundAlternative: { id: "kill-soldiers-g", type: "kill" as const, description: "Cut down enemy soldiers", targetType: "soldier", count: 3 },
};
const destroyObjective = {
  id: "destroy-tower",
  type: "destroy" as const,
  description: "Destroy the watchtower",
  targetTag: "watchtower",
  count: 1,
  groundAlternative: { id: "destroy-tower-g", type: "survive" as const, description: "Survive the counterattack", seconds: 60 },
};

describe("ObjectiveTracker", () => {
  it("counts progress and completes at target", () => {
    const t = new ObjectiveTracker([killObjective]);
    for (let i = 0; i < 4; i++) t.notifyKill("soldier");
    expect(t.current()?.completed).toBe(false);
    t.notifyKill("soldier");
    expect(t.objectives()[0].completed).toBe(true);
    expect(t.allCompleted()).toBe(true);
  });

  it("only counts matching target types", () => {
    const t = new ObjectiveTracker([killObjective]);
    t.notifyKill("elite");
    t.notifyKill("commander");
    expect(t.current()?.progress).toBe(0);
  });

  it("advance objective only after previous completes", () => {
    const t = new ObjectiveTracker([killObjective, destroyObjective]);
    expect(t.current()?.id).toBe("kill-soldiers");
    t.notifyBuildingDestroyed("house");
    expect(t.current()?.id).toBe("kill-soldiers");
    for (let i = 0; i < 5; i++) t.notifyKill("soldier");
    expect(t.current()?.id).toBe("destroy-tower");
  });

  it("destroy objective counts tagged buildings", () => {
    const t = new ObjectiveTracker([destroyObjective]);
    t.notifyBuildingDestroyed("house");
    expect(t.current()?.progress).toBe(0);
    t.notifyBuildingDestroyed("watchtower");
    expect(t.objectives()[0].completed).toBe(true);
  });

  it("fires completion events", () => {
    const t = new ObjectiveTracker([killObjective]);
    const events: string[] = [];
    t.onObjectiveComplete((o) => events.push(o.id));
    for (let i = 0; i < 5; i++) t.notifyKill("soldier");
    expect(events).toEqual(["kill-soldiers"]);
  });

  it("allComplete only when every objective done", () => {
    const t = new ObjectiveTracker([killObjective, destroyObjective]);
    for (let i = 0; i < 5; i++) t.notifyKill("soldier");
    expect(t.allCompleted()).toBe(false);
    t.notifyBuildingDestroyed("watchtower");
    expect(t.allCompleted()).toBe(true);
  });

  it("survive objective completes after elapsed time", () => {
    const t = new ObjectiveTracker([{ id: "s", type: "survive", description: "Hold the field", seconds: 3 }]);
    t.update(2.9);
    expect(t.allCompleted()).toBe(false);
    t.update(0.2);
    expect(t.allCompleted()).toBe(true);
  });

  it("ground conversion replaces incomplete flight-only objectives with alternatives", () => {
    const t = new ObjectiveTracker([killObjective, destroyObjective]);
    for (let i = 0; i < 5; i++) t.notifyKill("soldier");
    t.convertToGround();
    const cur = t.current();
    expect(cur?.type).toBe("survive");
    expect(cur?.description).toContain("Survive");
  });

  it("ground conversion keeps completed objectives completed", () => {
    const t = new ObjectiveTracker([killObjective, destroyObjective]);
    for (let i = 0; i < 5; i++) t.notifyKill("soldier");
    t.convertToGround();
    expect(t.objectives()[0].completed).toBe(true);
  });

  it("kill commander objective completes on elite commander kill", () => {
    const t = new ObjectiveTracker([{ id: "cmd", type: "kill", description: "Slay the commander", targetType: "commander", count: 1, groundAlternative: { id: "cmd-g", type: "kill", description: "Slay the commander", targetType: "commander", count: 1 } }]);
    t.notifyKill("commander");
    expect(t.allCompleted()).toBe(true);
  });
});
