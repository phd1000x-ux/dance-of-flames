// tests/noise.test.ts
import { describe, test, expect } from "vitest";
import { valueNoise, fbm, hash01 } from "../src/world/Noise";

describe("noise helpers", () => {
  test("deterministic for same inputs", () => {
    expect(valueNoise(3.2, 7.7, 42)).toBe(valueNoise(3.2, 7.7, 42));
    expect(fbm(10.5, -3.1, 99)).toBe(fbm(10.5, -3.1, 99));
    expect(hash01(1234567)).toBe(hash01(1234567));
  });
  test("valueNoise and fbm stay in [0,1]", () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 1.37 - 250, y = i * -2.11 + 90;
      const v = valueNoise(x, y, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const f = fbm(x, y, i);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
  test("hash01 deterministic and in [0,1)", () => {
    for (let n = 0; n < 200; n++) {
      const h = hash01(n * 7919);
      expect(h).toBe(hash01(n * 7919));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});
