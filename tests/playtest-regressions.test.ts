import { describe, expect, it } from "vitest";
import { Vector3 } from "@babylonjs/core";
import { DragonController, HARD_BOUND_FACTOR, boundsSteer } from "../src/player/DragonController";
import { PlayerState } from "../src/player/PlayerState";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { RELICS } from "../src/data/items";
import type { DragonRig } from "../src/world/DragonRig";
import type { Terrain } from "../src/world/Terrain";
import type { InputManager } from "../src/input/InputManager";
import type { EventBus } from "../src/core/EventBus";
import type { GameEvents } from "../src/core/Events";

function rig(): DragonRig {
  return { root: { position: new Vector3(), rotationQuaternion: null }, flapPhase: 0, animate() {} } as unknown as DragonRig;
}

function input(down: Set<string>): InputManager {
  return {
    isDown: (a: string) => down.has(a),
    pressed: () => false,
    consumeMouse: () => ({ dx: 0, dy: 0 }),
    lookYaw: 0,
    lookPitch: 0,
  } as unknown as InputManager;
}

function flight(shop = {}) {
  const player = new PlayerState(DRAGONS[0], RIDERS[0], shop);
  const events: string[] = [];
  const bus = { emit: (e: string) => events.push(e), on() {} } as unknown as EventBus<GameEvents>;
  const terrain = { heightAt: () => 0 } as unknown as Terrain;
  const ctrl = new DragonController(player, rig(), terrain, bus, 760);
  ctrl.spawn(new Vector3(0, 150, 0), 0);
  return { ctrl, player, events };
}

function fly(ctrl: DragonController, keys: string[], seconds: number): void {
  const inp = input(new Set(keys));
  for (let i = 0; i < Math.round(seconds * 60); i++) ctrl.update(1 / 60, inp, false);
}

describe("BUG-01 vertical controls keep their direction while held", () => {
  for (const s of [0.5, 3, 6]) {
    it(`climb held ${s}s gains altitude, descend held ${s}s loses it`, () => {
      const up = flight();
      fly(up.ctrl, ["accelerate", "climb"], s);
      expect(up.ctrl.pos.y).toBeGreaterThan(150);
      const down = flight();
      fly(down.ctrl, ["accelerate", "descend"], s);
      expect(down.ctrl.pos.y).toBeLessThan(150);
    });
  }

  it("climbing is never classified as a dive and does not speed the dragon up", () => {
    const { ctrl } = flight();
    fly(ctrl, ["accelerate"], 2);
    const cruise = ctrl.speed;
    fly(ctrl, ["accelerate", "climb"], 3);
    expect(ctrl.pitch).toBeLessThan(0); // nose up
    expect(ctrl.state).not.toBe("DIVE");
    expect(ctrl.speed).toBeLessThanOrEqual(cruise + 0.5);
  });

  it("reversing climb → descend turns the altitude trend around", () => {
    const { ctrl } = flight();
    fly(ctrl, ["accelerate", "climb"], 3);
    const top = ctrl.pos.y;
    fly(ctrl, ["accelerate", "descend"], 3);
    expect(ctrl.pos.y).toBeLessThan(top);
  });

  it("descend at the ceiling leaves it", () => {
    const { ctrl } = flight();
    ctrl.pos.y = 380;
    fly(ctrl, ["accelerate", "descend"], 2);
    expect(ctrl.pos.y).toBeLessThan(370);
  });
});

describe("BUG-02 world bound", () => {
  it("boundsSteer points at the origin", () => {
    // at +X heading +X (yaw PI/2): turn ~PI to face -X
    expect(Math.abs(boundsSteer(Math.PI / 2, 800, 0))).toBeCloseTo(Math.PI, 3);
    // at +Z heading -Z (yaw PI): already facing the center
    expect(boundsSteer(Math.PI, 0, 800)).toBeCloseTo(0, 6);
  });

  it("boosting straight out never passes the hard wall and turns back", () => {
    const { ctrl, events } = flight();
    ctrl.pos.set(600, 150, 0);
    ctrl.yaw = Math.PI / 2; // +X, straight outward
    let maxR = 0;
    const inp = input(new Set(["accelerate", "boost"]));
    for (let i = 0; i < 60 * 20; i++) {
      ctrl.update(1 / 60, inp, false);
      maxR = Math.max(maxR, Math.hypot(ctrl.pos.x, ctrl.pos.z));
    }
    expect(maxR).toBeLessThanOrEqual(760 * HARD_BOUND_FACTOR + 1e-6);
    expect(events).toContain("bounds-warning");
    // after 20s of holding "out", the dragon is heading back inside
    expect(Math.hypot(ctrl.pos.x, ctrl.pos.z)).toBeLessThan(760 * HARD_BOUND_FACTOR);
  });
});

describe("BUG-03 shop upgrades survive relics and buffs", () => {
  const shop = { maxHealth: 1.1, armor: 1.1 };

  it("a relic stacks on top of shop upgrades and HP stays within max", () => {
    const { player } = flight(shop);
    const before = player.maxDragonHp;
    const armorBefore = player.dragonStats.armor!;
    const relic = RELICS.find((r) => !("healFlat" in r.effect))!;
    player.addRelic(relic.id);
    expect(player.maxDragonHp).toBeGreaterThanOrEqual(before * (relic.effect.maxHealth ?? 1) - 1e-6);
    expect(player.dragonStats.armor!).toBeGreaterThanOrEqual(armorBefore * (relic.effect.armor ?? 1) - 1e-6);
    expect(player.dragonHp).toBeLessThanOrEqual(player.maxDragonHp);
  });

  it("a buff expiring restores the shop-upgraded stats, not base", () => {
    const { player } = flight(shop);
    const upgraded = player.maxDragonHp;
    player.addBuff({ id: "t", label: "t", stat: "fireDamage", mult: 1.5, remaining: 0.5 });
    player.update(1);
    expect(player.maxDragonHp).toBeCloseTo(upgraded, 6);
  });

  it("the heal relic heals and leaves the shared relic data untouched", () => {
    const heal = RELICS.find((r) => "healFlat" in r.effect)!;
    for (let run = 0; run < 2; run++) {
      const { player } = flight(shop);
      player.dragonHp = 100;
      player.addRelic(heal.id);
      expect(player.dragonHp).toBeGreaterThan(100);
      expect("healFlat" in heal.effect).toBe(true);
    }
  });
});

import { ObjectiveTracker } from "../src/mission/Objectives";
import { MISSIONS } from "../src/data/missions";
import { pickLandingSpot } from "../src/mission/GroundLanding";
import { SaveSystem, MemoryStorage } from "../src/save/SaveSystem";

describe("BUG-05 ground phase", () => {
  it("on-foot kill objectives ignore kills made from the dragon", () => {
    const t = new ObjectiveTracker(MISSIONS.find((m) => m.id === "riverlands")!.objectives);
    for (let i = 0; i < 10; i++) t.notifyKill("archer"); // burned from the air
    t.convertToGround();
    t.update(0.1);
    const cur = t.current()!;
    expect(cur.id).toBe("g-kill");
    expect(cur.progress).toBe(0);
    for (let i = 0; i < cur.count!; i++) t.notifyKill("swordsman");
    expect(cur.completed).toBe(true);
  });

  it("no mission converts into the same ground task twice in a row", () => {
    for (const m of MISSIONS) {
      const t = new ObjectiveTracker(m.objectives);
      t.convertToGround();
      const ids = t.objectives().map((o) => o.id);
      for (let i = 1; i < ids.length; i++) expect(ids[i], `${m.id}: ${ids.join(",")}`).not.toBe(ids[i - 1]);
    }
  });

  it("tracker drops a back-to-back duplicate alternative", () => {
    const alt = { id: "g-survive", type: "survive" as const, description: "Survive", seconds: 5 };
    const t = new ObjectiveTracker([
      { id: "a", type: "destroy", description: "a", targetTag: "x", count: 1, groundAlternative: alt },
      { id: "b", type: "destroy", description: "b", targetTag: "y", count: 1, groundAlternative: alt },
    ]);
    t.convertToGround();
    expect(t.objectives().length).toBe(1);
  });

  it("lands within fighting range of a distant squad, clear of obstacles", () => {
    const crash = { x: 0, z: 0 };
    const squad = [{ x: 540, z: 0 }, { x: 548, z: 6 }];
    const spot = pickLandingSpot(crash, squad, [{ x: 495, z: 0, r: 10 }], () => true, () => 0.5);
    const d = Math.hypot(spot.x - 540, spot.z);
    expect(d).toBeLessThanOrEqual(60);
    expect(d).toBeGreaterThan(20);
    expect(Math.hypot(spot.x - 495, spot.z)).toBeGreaterThan(13);
  });

  it("stays near the wreck when enemies are already close", () => {
    const spot = pickLandingSpot({ x: 0, z: 0 }, [{ x: 30, z: 0 }], [], () => true, () => 0.5);
    expect(Math.hypot(spot.x, spot.z)).toBeLessThan(40);
  });
});

describe("BUG-03 upgrades persist through save/load", () => {
  it("upgrade levels round-trip", async () => {
    const sys = new SaveSystem(new MemoryStorage());
    const data = await sys.load();
    data.upgrades = { thickHide: 2 };
    data.coins = 40;
    await sys.save(data);
    const back = await sys.load();
    expect(back.upgrades.thickHide).toBe(2);
    expect(back.coins).toBe(40);
  });
});

import { shopEffectText } from "../src/ui/UIManager";
import { getShopUpgrade } from "../src/data/upgrades";

describe("shop effect preview", () => {
  it("shows the before → after bonus in plain numbers", () => {
    expect(shopEffectText(getShopUpgrade("dragonMaxHp"), 1)).toBe("+10% → +20%");
    expect(shopEffectText(getShopUpgrade("dragonMaxHp"), 4)).toBe("+40% (max)");
    expect(shopEffectText(getShopUpgrade("startHeal"), 0)).toBe("0 charges → 1 charge");
  });
});
