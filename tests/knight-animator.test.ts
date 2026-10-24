import { describe, expect, it } from "vitest";
import { AXE_SWINGS, READY, axeSwingPose, gaitPose } from "../src/world/KnightAnimator";
import { ATTACK_DURATION, ATTACK_HIT_AT } from "../src/player/RiderController";
import { KEY_YAW_RATE } from "../src/camera/GameCameras";

describe("axe swing keyframes", () => {
  it("every swing starts and ends in the ready stance, so combos chain without a pop", () => {
    for (const name of Object.keys(AXE_SWINGS)) {
      for (const t of [0, 1]) {
        const p = axeSwingPose(name, t);
        for (const k of Object.keys(READY) as (keyof typeof READY)[]) expect(p[k]).toBeCloseTo(READY[k], 5);
      }
    }
  });

  it("the spline is continuous: no frame-to-frame jump bigger than a fast strike allows", () => {
    for (const name of Object.keys(AXE_SWINGS)) {
      let prev = axeSwingPose(name, 0);
      for (let i = 1; i <= 200; i++) {
        const p = axeSwingPose(name, i / 200);
        expect(Math.abs(p.armX - prev.armX)).toBeLessThan(0.25);
        expect(Math.abs(p.armZ - prev.armZ)).toBeLessThan(0.25);
        prev = p;
      }
    }
  });

  it("contact happens on the strike: the arm is extended forward at the hit frame", () => {
    for (const name of ["light1", "light2", "light3"]) {
      const p = axeSwingPose(name, ATTACK_HIT_AT.light / ATTACK_DURATION.light);
      expect(p.armX).toBeGreaterThan(0.8);
      expect(p.elbow).toBeLessThan(0.6); // arm straightening through the blow
    }
    const heavy = axeSwingPose("heavy", ATTACK_HIT_AT.heavy / ATTACK_DURATION.heavy);
    expect(heavy.armX).toBeGreaterThan(1.0);
  });

  it("winds up before striking (anticipation), with a slower wind-up than strike", () => {
    const p = axeSwingPose("light3", 0.38);
    expect(p.armZ).toBeLessThan(-1.5); // raised overhead
    const keys = AXE_SWINGS.light3;
    expect(keys[1][0] - keys[0][0]).toBeGreaterThan(keys[2][0] - keys[1][0]);
  });
});

describe("gait", () => {
  it("legs and arms counter-swing, and the leg swinging forward bends its knee", () => {
    const g = gaitPose(0, 1, 0); // left thigh passing under the body, moving forward
    expect(g.lKnee).toBeLessThan(g.rKnee); // knee − = bend
    const fwd = gaitPose(Math.PI / 2, 1, 0);
    expect(fwd.lLeg).toBeGreaterThan(0);
    expect(fwd.rLeg).toBeLessThan(0);
    expect(Math.sign(fwd.lArm - 0.05)).toBe(-1); // left arm back with left leg forward
    expect(fwd.rArm).toBeGreaterThan(0);
  });

  it("fades fully out when standing still", () => {
    const g = gaitPose(1.3, 0, 0);
    for (const v of Object.values(g)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it("running reaches further and leans more than walking", () => {
    const walk = gaitPose(Math.PI / 2, 1, 0), run = gaitPose(Math.PI / 2, 1, 1);
    expect(run.lLeg).toBeGreaterThan(walk.lLeg);
    expect(run.lean).toBeGreaterThan(walk.lean);
  });
});

describe("ground keyboard look", () => {
  it("arrow-key turn is a sane rate (was applied per sim step: ~130 rad/s)", () => {
    expect(KEY_YAW_RATE).toBeGreaterThan(1);
    expect(KEY_YAW_RATE).toBeLessThan(3);
  });
});
