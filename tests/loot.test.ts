import { describe, it, expect } from "vitest";
import { SeededRng } from "../src/core/SeededRng";
import { rollLoot, coinValue, LootRoll } from "../src/loot/LootTables";

describe("rollLoot", () => {
  it("produces deterministic results for the same seed", () => {
    const a = rollLoot(new SeededRng(1));
    const b = rollLoot(new SeededRng(1));
    expect(a).toEqual(b);
  });

  it("returns only valid loot kinds", () => {
    const rng = new SeededRng(3);
    const valid: LootRoll["kind"][] = ["none", "coin", "healSmall", "healLarge", "buff"];
    for (let i = 0; i < 500; i++) {
      const r = rollLoot(rng);
      expect(valid).toContain(r.kind);
    }
  });

  it("approximates configured probabilities (coin ~60%)", () => {
    const rng = new SeededRng(777);
    let coins = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) if (rollLoot(rng).kind === "coin") coins++;
    expect(coins / n).toBeGreaterThan(0.55);
    expect(coins / n).toBeLessThan(0.65);
  });

  it("healing drop rate scales with difficulty heal modifier", () => {
    const count = (mod: number) => {
      const rng = new SeededRng(4242);
      let heals = 0;
      for (let i = 0; i < 2000; i++) if (rollLoot(rng, { healMod: mod }).kind.startsWith("heal")) heals++;
      return heals;
    };
    expect(count(2.0)).toBeGreaterThan(count(1.0));
  });
});

describe("coinValue", () => {
  it("returns only valid coin denominations", () => {
    const rng = new SeededRng(55);
    for (let i = 0; i < 300; i++) expect([1, 2, 5, 10]).toContain(coinValue(rng));
  });

  it("is mostly small denominations", () => {
    const rng = new SeededRng(909);
    let ones = 0;
    for (let i = 0; i < 1000; i++) if (coinValue(rng) === 1) ones++;
    expect(ones).toBeGreaterThan(600);
  });
});
