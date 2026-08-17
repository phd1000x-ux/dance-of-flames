import { describe, it, test, expect } from "vitest";
import { ObjectiveTracker, ObjectiveDef } from "../src/mission/Objectives";

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

describe("event objectives", () => {
  const ev = (id: string, event: string, alt?: ObjectiveDef): ObjectiveDef => ({
    id, type: "event", description: `event ${id}`, event, groundAlternative: alt,
  });

  test("notifyEvent completes matching current objective", () => {
    const t = new ObjectiveTracker([ev("a", "thing")]);
    t.notifyEvent("other");
    expect(t.allCompleted()).toBe(false);
    t.notifyEvent("thing");
    expect(t.allCompleted()).toBe(true);
  });

  test("notifyEvent completes ALL matching objectives regardless of chain position", () => {
    const t = new ObjectiveTracker([
      { id: "first", type: "kill", description: "x", targetType: "soldier", count: 2 },
      ev("b", "castellan-transition"),
      ev("c", "chase-complete"),
    ]);
    t.notifyEvent("castellan-transition");
    t.notifyEvent("chase-complete");
    // head not yet complete, but the events are already done behind it
    expect(t.objectives()[1].completed).toBe(true);
    expect(t.objectives()[2].completed).toBe(true);
    expect(t.current()?.id).toBe("first");
  });

  test("convertToGround removes event objectives without alternatives", () => {
    const t = new ObjectiveTracker([
      ev("a", "x", { id: "alt", type: "survive", description: "live", seconds: 5 }),
      ev("b", "y"),
    ]);
    t.convertToGround();
    expect(t.objectives().map((o) => o.id)).toEqual(["alt"]);
  });

  test("event objective completion fires listeners", () => {
    const t = new ObjectiveTracker([ev("a", "x")]);
    let fired = 0;
    t.onObjectiveComplete(() => fired++);
    t.notifyEvent("x");
    expect(fired).toBe(1);
    t.notifyEvent("x"); // idempotent
    expect(fired).toBe(1);
  });
});

describe("restoreState (checkpoint retry)", () => {
  const defs: ObjectiveDef[] = [
    { id: "a", type: "kill", description: "x", targetType: "soldier", count: 5 },
    { id: "b", type: "event", description: "y", event: "boom" },
    { id: "c", type: "survive", description: "z", seconds: 75 },
  ];

  test("sets exact progress and completion", () => {
    const t = new ObjectiveTracker(defs);
    t.restoreState([
      { id: "a", progress: 3, completed: false },
      { id: "b", progress: 1, completed: true },
      { id: "c", progress: 0, completed: false },
    ]);
    const [a, b, c] = t.objectives();
    expect(a.progress).toBe(3);
    expect(a.completed).toBe(false);
    expect(b.completed).toBe(true);
    expect(c.progress).toBe(0);
    expect(t.current()?.id).toBe("a");
  });

  test("keeps the listener list — completion after restore still fires", () => {
    const t = new ObjectiveTracker(defs);
    const fired: string[] = [];
    t.onObjectiveComplete((o) => fired.push(o.id));
    t.restoreState([{ id: "a", progress: 4, completed: false }]);
    t.notifyKill("soldier");
    expect(fired).toEqual(["a"]);
  });

  test("restoring an already-complete chain leaves no current objective", () => {
    const t = new ObjectiveTracker(defs);
    t.restoreState([
      { id: "a", progress: 5, completed: true },
      { id: "b", progress: 1, completed: true },
      { id: "c", progress: 75, completed: true },
    ]);
    expect(t.current()).toBeUndefined();
    expect(t.allCompleted()).toBe(true);
  });

  test("resumes a partially-survived survive objective from restored progress", () => {
    const t = new ObjectiveTracker(defs);
    t.restoreState([
      { id: "a", progress: 5, completed: true },
      { id: "b", progress: 1, completed: true },
      { id: "c", progress: 30, completed: false },
    ]);
    expect(t.current()?.id).toBe("c");
    t.update(1);
    expect(t.objectives()[2].progress).toBe(31);
    t.update(44);
    expect(t.objectives()[2].completed).toBe(true);
  });

  test("unknown ids are ignored", () => {
    const t = new ObjectiveTracker(defs);
    t.restoreState([{ id: "nope", progress: 9, completed: true }]);
    expect(t.allCompleted()).toBe(false);
    expect(t.objectives().every((o) => o.progress === 0)).toBe(true);
  });
});

describe("retroactive progress (out-of-order actions)", () => {
  const obj = (id: string, type: ObjectiveDef["type"], opts: Partial<ObjectiveDef> = {}): ObjectiveDef =>
    ({ id, type, description: id, ...opts });

  test("building destroyed before its objective becomes current counts retroactively", () => {
    const t = new ObjectiveTracker([
      obj("first", "kill", { targetType: "swordsman", count: 1 }),
      obj("gate", "destroy", { targetTag: "gatehouse", count: 1 }),
    ]);
    t.notifyBuildingDestroyed("gatehouse");
    expect(t.current()?.id).toBe("first");
    t.notifyKill("swordsman");
    t.update(0);
    expect(t.objectives()[1].completed).toBe(true);
    expect(t.allCompleted()).toBe(true);
  });

  test("partial retroactive destroy counts (2 of 4 pre-destroyed)", () => {
    const t = new ObjectiveTracker([
      obj("first", "kill", { targetType: "archer", count: 2 }),
      obj("towers", "destroy", { targetTag: "wallTower", count: 4 }),
    ]);
    t.notifyBuildingDestroyed("wallTower");
    t.notifyBuildingDestroyed("watchtower");
    t.notifyBuildingDestroyed("wallTower");
    t.notifyKill("archer");
    t.notifyKill("archer");
    t.update(0);
    expect(t.objectives()[1].progress).toBe(2);
    t.notifyBuildingDestroyed("wallTower");
    t.notifyBuildingDestroyed("wallTower");
    expect(t.objectives()[1].completed).toBe(true);
  });

  test("any-tag counts each destroyed building once (no synthetic-key double count)", () => {
    const t = new ObjectiveTracker([obj("any", "destroy", { targetTag: "any", count: 2 })]);
    t.notifyBuildingDestroyed("wallTower");
    t.notifyBuildingDestroyed("relic-building");
    t.notifyBuildingDestroyed("any");
    t.update(0);
    expect(t.objectives()[0].progress).toBe(1);
    t.notifyBuildingDestroyed("gatehouse");
    t.update(0);
    expect(t.objectives()[0].completed).toBe(true);
  });

  test("kills before objective current count retroactively", () => {
    const t = new ObjectiveTracker([
      obj("first", "destroy", { targetTag: "watchtower", count: 1 }),
      obj("archers", "kill", { targetType: "archer", count: 2 }),
    ]);
    t.notifyKill("archer");
    t.notifyKill("archer");
    t.notifyKill("swordsman");
    t.notifyBuildingDestroyed("watchtower");
    t.update(0);
    expect(t.objectives()[1].completed).toBe(true);
  });

  test("progress clamps at need", () => {
    const t = new ObjectiveTracker([obj("t", "destroy", { targetTag: "wallTower", count: 2 })]);
    t.notifyBuildingDestroyed("wallTower");
    t.notifyBuildingDestroyed("wallTower");
    t.notifyBuildingDestroyed("wallTower");
    expect(t.objectives()[0].progress).toBe(2);
    expect(t.objectives()[0].completed).toBe(true);
  });

  test("soldier-role kills accumulate per concrete type across the role", () => {
    const t = new ObjectiveTracker([
      obj("first", "survive", { seconds: 1 }),
      obj("inf", "kill", { targetType: "soldier", count: 3 }),
    ]);
    t.notifyKill("swordsman");
    t.notifyKill("archer");
    t.notifyKill("spearman");
    t.update(1);
    expect(t.objectives()[1].completed).toBe(true);
  });
});
