import { afterEach, describe, expect, it } from "vitest";
import { NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { RiderController, type GroundEnemyLike } from "../src/player/RiderController";
import { PlayerState } from "../src/player/PlayerState";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { EventBus } from "../src/core/EventBus";

const engines: NullEngine[] = [];
afterEach(() => engines.splice(0).forEach(e => e.dispose()));

function setup() {
  const engine = new NullEngine(); engines.push(engine); const scene = new Scene(engine);
  const player = new PlayerState(DRAGONS[0], RIDERS[0], {}); player.mode = "ground";
  const node = () => new TransformNode("f", scene);
  const ctrl = new RiderController(player, { root: node(), body: node(), swordPivot: node(), shieldMesh: node() }, { heightAt: () => 0 } as any, new EventBus<any>() as any);
  const pressed = new Set<string>();
  const input = { isDownCode: () => false, isDown: () => false, pressed: (a: string) => pressed.delete(a) } as any;
  const cam = { groundForward: () => new Vector3(0, 0, 1) } as any;
  return { ctrl, input, cam, pressed };
}
const enemy = (x: number, z: number): GroundEnemyLike => ({ pos: new Vector3(x, 0, z), yaw: 0, hp: 50, alive: true, isShielded: false, staggered: 0 });

describe("melee soft aim", () => {
  it("a light attack turns the rider onto a nearby enemy off to the side, so the swing connects", () => {
    const { ctrl, input, cam, pressed } = setup();
    const foe = enemy(2.5, 1.2); // ~64° right of facing, 2.8m away
    let hitFwd: Vector3 | null = null;
    ctrl.onHitCallback = (fwd) => { hitFwd = fwd.clone(); };
    pressed.add("lightAttack");
    for (let i = 0; i < 30; i++) ctrl.update(1 / 60, input, cam, [foe]);
    expect(hitFwd).not.toBeNull();
    const toFoe = foe.pos.subtract(ctrl.pos).normalize();
    expect(Vector3.Dot(hitFwd!, toFoe)).toBeGreaterThan(0.62); // inside the light-attack arc
  });

  it("ignores enemies behind the rider or out of reach", () => {
    const { ctrl, input, cam, pressed } = setup();
    let hitFwd: Vector3 | null = null;
    ctrl.onHitCallback = (fwd) => { hitFwd = fwd.clone(); };
    pressed.add("lightAttack");
    for (let i = 0; i < 30; i++) ctrl.update(1 / 60, input, cam, [enemy(0, -2), enemy(9, 0)]);
    expect(hitFwd).not.toBeNull();
    expect(hitFwd!.z).toBeGreaterThan(0.95); // still swinging straight ahead
  });
});

import { swingPose } from "../src/world/CharacterPrototype";

describe("GLB knight swing keyframes", () => {
  for (const attack of ["light1", "light2", "light3", "heavy"]) {
    it(`${attack}: starts and ends at rest, winds up, then strikes in front`, () => {
      for (const t of [0, 1]) {
        const p = swingPose(attack, t);
        expect(Math.abs(p.armX) + Math.abs(p.armZ) + Math.abs(p.twist) + Math.abs(p.lean)).toBeLessThan(1e-6);
      }
      const wind = swingPose(attack, attack === "heavy" ? 0.38 : 0.3);
      const strike = swingPose(attack, attack === "heavy" ? 0.6 : 0.55);
      // a real swing: the arm travels a wide arc (vertical chop or horizontal sweep)…
      expect(Math.max(Math.abs(strike.armX - wind.armX), Math.abs(strike.armZ - wind.armZ))).toBeGreaterThan(1.5);
      // …and contact happens with the arm raised in front (+armX), not behind
      expect(strike.armX).toBeGreaterThan(0.8);
    });
  }
});
