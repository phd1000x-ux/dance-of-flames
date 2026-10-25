import { afterEach, describe, expect, it, vi } from "vitest";
import { Color3, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { EventBus } from "../src/core/EventBus";
import { MissionScene } from "../src/mission/MissionScene";
import { RiderController } from "../src/player/RiderController";
import { PlayerState } from "../src/player/PlayerState";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { CastellanBoss } from "../src/mission/blackstone/CastellanBoss";
import { WarDragon } from "../src/mission/blackstone/WarDragon";
import { FireStreak } from "../src/combat/FireStreak";

const engines: NullEngine[] = [];
afterEach(() => { engines.splice(0).forEach(e => e.dispose()); vi.restoreAllMocks(); });
function riderSetup() {
  const engine = new NullEngine(); engines.push(engine); const scene = new Scene(engine);
  const player = new PlayerState(DRAGONS[0], RIDERS[0], {}); player.mode = "ground";
  const node = () => new TransformNode("test-figure", scene);
  const bus = new EventBus<any>();
  vi.spyOn(bus, "emit");
  const ctrl = new RiderController(player, { root: node(), body: node(), swordPivot: node(), shieldMesh: node() }, { heightAt: () => 0 } as any, bus as any);
  return { player, ctrl, bus };
}
function projectileMission() {
  const { player, ctrl, bus } = riderSetup();
  const m = Object.create(MissionScene.prototype) as any;
  const stop = new Error("stop after projectile wiring");
  Object.assign(m, { ended: false, phase: "ground", player, riderCtrl: ctrl, slowmoT: 0, hitStopT: 0, time: 0, streak: new FireStreak(),
    groundCam: { addShake: vi.fn() }, dragonCam: { addShake: vi.fn() },
    stats: { damageTaken: 0 }, projectiles: {}, dragonCtrl: { pos: Vector3.Zero(), forward: Vector3.Forward(), invulnerable: 0 },
    deps: { bus, audio: { playerHurt: vi.fn() } } });
  m.wireEvents();
  vi.spyOn(player, "update").mockImplementation(() => { throw stop; });
  expect(() => m.update(1 / 60)).toThrow(stop);
  return { m, player, ctrl, bus };
}

describe("real combat boundaries", () => {
  it("routes a ground projectile to rider damage exactly once and retains dodge immunity", () => {
    const { m, player, ctrl, bus } = projectileMission();
    const before = player.riderHp;
    m.projectiles.onPlayerHit(30, 0, -5, "arrow");
    expect(player.riderHp).toBeLessThan(before);
    expect(m.stats.damageTaken).toBeCloseTo(before - player.riderHp);
    expect(vi.mocked(bus.emit).mock.calls.filter(c => c[0] === "player-damaged")).toHaveLength(1);
    ctrl.invulnerable = 1;
    const after = player.riderHp;
    m.projectiles.onPlayerHit(30, 0, -5, "arrow");
    expect(player.riderHp).toBe(after);
  });
  it("allows a frontal arrow to be blocked while a rear arrow hits", () => {
    const { m, player, ctrl } = projectileMission();
    ctrl.blocking = true; ctrl.blockTime = 0.4; ctrl.yaw = 0;
    const before = player.riderHp;
    m.projectiles.onPlayerHit(30, 0, -5, "arrow");
    const blocked = before - player.riderHp;
    m.projectiles.onPlayerHit(30, 0, 5, "arrow");
    expect(blocked).toBeGreaterThan(0);
    expect(before - blocked - player.riderHp).toBeGreaterThan(blocked);
  });
  it("keeps ordinary parries but lets the shield breaker pass an active guard", () => {
    const { ctrl, player } = riderSetup();
    ctrl.blocking = true; ctrl.blockTime = 0.1;
    expect(ctrl.takeHit(40, Vector3.Forward(), "melee").parried).toBe(true);
    const before = player.riderHp;
    expect(ctrl.takeHit(40, Vector3.Forward(), "shieldBreaker").parried).toBe(false);
    expect(player.riderHp).toBeLessThan(before);
  });
  it("drops a lock whose enemy is absent from the new live enemy list", () => {
    const { ctrl } = riderSetup();
    ctrl.lockTarget = { pos: new Vector3(0, 0, 3), yaw: 0, hp: 1, alive: true, isShielded: false, staggered: 0 };
    ctrl.update(1 / 60, { isDownCode: () => false, isDown: () => false, pressed: () => false } as any,
      { groundForward: () => Vector3.Forward() } as any, []);
    expect(ctrl.lockTarget).toBeNull();
  });
  it("refreshes a surviving lock from the latest enemy snapshot", () => {
    const { ctrl } = riderSetup();
    const target = { pos: new Vector3(0, 0, 3), yaw: 0, hp: 10, alive: true, isShielded: false, staggered: 0 };
    ctrl.lockTarget = target;
    const current = { ...target, hp: 5 };
    ctrl.update(1 / 60, { isDownCode: () => false, isDown: () => false, pressed: () => false } as any,
      { groundForward: () => Vector3.Forward() } as any, [current]);
    expect(ctrl.lockTarget).toBe(current);
  });
  it("tracks actual commander health through the reinforcement gate without rearming transition", () => {
    const s = { maxHp: 100, hp: 60, state: "alert", burnTime: 0, pos: Vector3.Zero(), yaw: 0, cooldown: 1,
      material: { emissiveColor: new Color3() }, baseEmissive: new Color3(), def: { range: 3 } };
    const boss = new CastellanBoss(s as any, {} as any, {} as any, { emit() {} } as any);
    boss.update(1 / 60, new Vector3(0, 0, 2), "ground");
    expect(boss.duel.hp).toBe(60); expect(boss.duel.shouldReinforce()).toBe(true);
    s.hp = 30; boss.update(1 / 60, new Vector3(0, 0, 2), "ground");
    expect(boss.duel.transitioned).toBe(true);
    s.hp = 80; boss.update(1 / 60, new Vector3(0, 0, 2), "ground");
    expect(boss.duel.transitioned).toBe(true);
  });
  it("rejects dragon fire aimed vertically away from the airborne target", () => {
    const v = Object.create(WarDragon.prototype) as any;
    Object.assign(v, { pos: new Vector3(0, 30, 20), yaw: 0, state_: "ORBIT", hp: 100, maxHp: 100, floor: 10, bus: { emit() {} } });
    expect(v.applyFire(Vector3.Zero(), new Vector3(0, -0.999, 0.045), 100, 0.1, 20, 1)).toBe(false);
    expect(v.hp).toBe(100);
    const aim = v.pos.subtract(new Vector3(0, 0, 0)).normalize();
    expect(v.applyFire(Vector3.Zero(), aim, 100, 0.3, 20, 1)).toBe(true);
    expect(v.hp).toBeLessThan(100);
  });
});
