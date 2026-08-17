import { describe, test, expect } from "vitest";
import { selectPattern, assaultBand, assaultProfile, bandChanged, validateSnapshot, type AssaultBand, type FinaleSnapshot } from "../src/mission/blackstone/FinalePatterns";
import { AudioManager } from "../src/audio/AudioManager";

const rng = { range: (a: number, _b: number) => a }; // deterministic low roll (0)
const rngMid = { range: (_a: number, _b: number) => 0.5 };
const rngHi = { range: (_a: number, b: number) => b }; // deterministic high roll (1)

describe("aerial pattern selection", () => {
  test("phase weights: high hp favors sweep, low-mid favors charge, return favors dive", () => {
    // Cumulative buckets ordered [charge, sweep, dive]; row for hpFrac > 0.7 is sweep .6 / charge .3 / dive .1.
    expect(selectPattern(0.9, null, rng)).toBe("charge"); // low roll lands first bucket (charge .3)
    expect(selectPattern(0.9, null, rngMid)).toBe("sweep"); // mid roll consumed charge .3 → sweep .6 dominates
    // Row for 0.4 < hpFrac ≤ 0.7 is sweep .3 / charge .45 / dive .25.
    expect(selectPattern(0.5, null, rng)).toBe("charge"); // low roll lands first bucket (charge .45)
    expect(selectPattern(0.5, null, rngHi)).toBe("dive"); // high roll exhausts charge+sweep → dive
    // Row for 0.25 < hpFrac ≤ 0.4 is sweep .15 / charge .35 / dive .5.
    expect(selectPattern(0.3, null, rngHi)).toBe("dive");
  });

  test("anti-repeat: never same twice in a row (re-roll once)", () => {
    // r=0 → charge → equals last → re-roll excludes charge → r=0 − sweep .3 → sweep
    expect(selectPattern(0.5, "charge", rng)).not.toBe("charge");
    expect(selectPattern(0.5, "charge", rng)).toBe("sweep");
    // r=1 → dive → equals last → re-roll excludes dive; remaining weights (.45+.3=.75) exhausted → fallback last positive bucket
    expect(selectPattern(0.5, "dive", rngHi)).not.toBe("dive");
    expect(selectPattern(0.5, "dive", rngHi)).toBe("sweep");
  });
});

describe("assault escalation", () => {
  test("bands by remaining time (remaining = duration - elapsed; >45→0, >20→1, >5→2, else 3)", () => {
    expect(assaultBand(0, 75)).toBe(0); // 75 remaining
    expect(assaultBand(25, 75)).toBe(0); // 50 remaining
    expect(assaultBand(30, 75)).toBe(1); // 45 remaining (boundary: not >45)
    expect(assaultBand(40, 75)).toBe(1); // 35 remaining
    expect(assaultBand(45, 75)).toBe(1); // 30 remaining
    expect(assaultBand(55, 75)).toBe(2); // 20 remaining (boundary: not >20)
    expect(assaultBand(60, 75)).toBe(2); // 15 remaining
    expect(assaultBand(69, 75)).toBe(2); // 6 remaining
    expect(assaultBand(70, 75)).toBe(3); // 5 remaining (boundary: not >5)
    expect(assaultBand(72, 75)).toBe(3); // 3 remaining
  });

  test("default duration is 75", () => {
    expect(assaultBand(0)).toBe(0);
    expect(assaultBand(72)).toBe(3);
  });

  test("profiles escalate monotonically", () => {
    const p = ([0, 1, 2, 3] as AssaultBand[]).map(assaultProfile);
    for (let i = 1; i < 4; i++) {
      expect(p[i].intervalMult).toBeLessThan(p[i - 1].intervalMult);
      expect(p[i].eliteBoost).toBeGreaterThanOrEqual(p[i - 1].eliteBoost);
      expect(p[i].musicPeak).toBeGreaterThanOrEqual(p[i - 1].musicPeak);
    }
  });

  test("bandChanged fires exactly at band boundaries (30/55/70 elapsed of 75)", () => {
    expect(bandChanged(0, 0)).toBe(false); // same band 0
    expect(bandChanged(0, 29)).toBe(false);
    expect(bandChanged(0, 30)).toBe(true); // → band 1
    expect(bandChanged(1, 54)).toBe(false);
    expect(bandChanged(1, 55)).toBe(true); // → band 2
    expect(bandChanged(2, 69)).toBe(false);
    expect(bandChanged(2, 70)).toBe(true); // → band 3
    expect(bandChanged(3, 74)).toBe(false); // stays band 3 to the end
    // custom duration boundaries shift with it (40s survive: >45→0 is never true past t=0)
    expect(bandChanged(0, 0, 40)).toBe(true); // remaining 40 ≤ 45 → band 1 immediately
  });
});

describe("snapshot validation", () => {
  const good: FinaleSnapshot = {
    finalePhase: "DUEL_AIR", castellan: { hp: 128, transitioned: true }, vharax: { hp: 800 },
    destroyedBuildings: [1, 2], deadBallistae: [0, 2],
    objectiveProgress: [{ id: "bs-ballistae", progress: 6, completed: true }],
    player: { dragonHp: 400, riderHp: 200, mode: "dragon", x: 0, y: 80, z: 0, yaw: 1 },
    charges: { heal: 1, fireBoost: 0, armorWard: 0 }, time: 123.4,
  };
  test("valid snapshot passes through", () => {
    expect(validateSnapshot(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  test("missing field throws", () => {
    const bad = { ...good } as Record<string, unknown>;
    delete bad.player;
    expect(() => validateSnapshot(bad)).toThrow();
  });
  test("vharax defaults to null when absent (dragon may be dead)", () => {
    const noVharax = { ...good, vharax: undefined };
    expect(validateSnapshot(noVharax).vharax).toBeNull();
  });
});

describe("stereo panFor (AudioManager)", () => {
  // listener at origin facing +Z (yaw 0): forward (0,1), right +X
  const L = { x: 0, z: 0, yaw: 0 };
  test("source directly right of listener → +1; left → −1", () => {
    expect(AudioManager.panFor({ x: 50, z: 0 }, L)).toBeCloseTo(1, 5);
    expect(AudioManager.panFor({ x: -50, z: 0 }, L)).toBeCloseTo(-1, 5);
  });
  test("source dead ahead and directly behind → ~0 (sin front/back ambiguity)", () => {
    expect(Math.abs(AudioManager.panFor({ x: 0, z: 40 }, L))).toBeLessThan(0.1);
    expect(Math.abs(AudioManager.panFor({ x: 0, z: -40 }, L))).toBeLessThan(0.1);
  });
  test("diagonal right-front → ~+0.71", () => {
    expect(AudioManager.panFor({ x: 40, z: 40 }, L)).toBeCloseTo(Math.SQRT1_2, 5);
  });
  test("listener yaw rotates the frame: east-facing listener (yaw π/2) hears a +Z source on its left", () => {
    expect(AudioManager.panFor({ x: 0, z: 40 }, { x: 0, z: 0, yaw: Math.PI / 2 })).toBeCloseTo(-1, 5);
    expect(AudioManager.panFor({ x: 50, z: 0 }, { x: 0, z: 0, yaw: Math.PI / 2 })).toBeCloseTo(0, 5);
  });
  test("bearing is computed from the listener position, not the origin", () => {
    expect(AudioManager.panFor({ x: 60, z: -100 }, { x: 10, z: -100, yaw: 0 })).toBeCloseTo(1, 5);
  });
  test("unwrapped listener yaw is normalized (5π/2 ≡ π/2)", () => {
    expect(AudioManager.panFor({ x: 0, z: 40 }, { x: 0, z: 0, yaw: Math.PI * 2.5 })).toBeCloseTo(-1, 5);
  });
  test("pan is distance-invariant along a bearing", () => {
    expect(AudioManager.panFor({ x: 5, z: 0 }, L)).toBeCloseTo(AudioManager.panFor({ x: 500, z: 0 }, L), 5);
  });
});
