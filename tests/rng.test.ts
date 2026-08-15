import { describe, it, expect } from "vitest";
import { SeededRng } from "../src/core/SeededRng";

describe("SeededRng", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = new SeededRng(12345);
    const b = new SeededRng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("returns values in [0,1)", () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("range stays within bounds", () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("int is inclusive of min and max", () => {
    const rng = new SeededRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
  });

  it("chance(1) always true, chance(0) always false", () => {
    const rng = new SeededRng(5);
    expect(rng.chance(1)).toBe(true);
    expect(rng.chance(0)).toBe(false);
  });

  it("pick returns an element of the array", () => {
    const rng = new SeededRng(11);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr).toContain(rng.pick(arr));
  });

  it("weighted respects deterministic distribution", () => {
    const rng = new SeededRng(2024);
    const items = [
      { value: "coin", weight: 60 },
      { value: "none", weight: 40 },
    ];
    let coins = 0;
    for (let i = 0; i < 1000; i++) if (rng.weighted(items).value === "coin") coins++;
    expect(coins).toBeGreaterThan(500);
    expect(coins).toBeLessThan(700);
  });
});
