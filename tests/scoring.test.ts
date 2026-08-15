import { describe, it, expect } from "vitest";
import { MissionStats, scoreMission, rankFor, emptyStats } from "../src/mission/Scoring";
import { DIFFICULTIES, applyDifficulty } from "../src/data/difficulty";
import { MISSIONS } from "../src/data/missions";

describe("mission scoring", () => {
  const stats: MissionStats = {
    ...emptyStats(),
    kills: 30,
    buildingsDestroyed: 6,
    coinsCollected: 80,
    relicsFound: 2,
    damageTaken: 100,
    dragonSurvived: true,
    timeSeconds: 240,
  };

  it("produces positive scores", () => {
    expect(scoreMission(stats)).toBeGreaterThan(0);
  });

  it("rewards dragon survival and relics", () => {
    const dead = { ...stats, dragonSurvived: false };
    expect(scoreMission(stats)).toBeGreaterThan(scoreMission(dead));
    const noRelics = { ...stats, relicsFound: 0 };
    expect(scoreMission(stats)).toBeGreaterThan(scoreMission(noRelics));
  });

  it("less damage taken scores higher", () => {
    const hurt = { ...stats, damageTaken: 800 };
    expect(scoreMission(stats)).toBeGreaterThan(scoreMission(hurt));
  });

  it("rank thresholds are ordered S > A > B > C", () => {
    expect(rankFor(5000)).toBe("S");
    expect(["A", "S"]).toContain(rankFor(2500));
    expect(["B", "A"]).toContain(rankFor(1200));
    expect(rankFor(100)).toBe("C");
  });
});

describe("difficulty", () => {
  it("hard is more dangerous than normal, story less", () => {
    const story = applyDifficulty("story");
    const normal = applyDifficulty("normal");
    const hard = applyDifficulty("hard");
    expect(hard.enemyDamage).toBeGreaterThan(normal.enemyDamage);
    expect(normal.enemyDamage).toBeGreaterThan(story.enemyDamage);
    expect(story.healDropRate).toBeGreaterThan(hard.healDropRate);
  });

  it("all three difficulties exist", () => {
    expect(DIFFICULTIES.map((d) => d.id)).toEqual(["story", "normal", "hard"]);
  });
});

describe("mission definitions", () => {
  it("defines four playable missions", () => {
    expect(MISSIONS.length).toBe(4);
    expect(MISSIONS.map((m) => m.id)).toEqual([
      "dragonstone",
      "riverlands",
      "harrenhal",
      "kingslanding",
    ]);
  });

  it("every mission objective has a ground alternative", () => {
    for (const m of MISSIONS) {
      expect(m.objectives.length).toBeGreaterThan(0);
      for (const o of m.objectives) {
        expect(o.groundAlternative).toBeDefined();
      }
    }
  });

  it("difficulty ramps across missions", () => {
    const powers = MISSIONS.map((m) => m.enemyPower);
    for (let i = 1; i < powers.length; i++) {
      expect(powers[i]).toBeGreaterThan(powers[i - 1]);
    }
  });
});
