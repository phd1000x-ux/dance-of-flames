import { describe, it, expect } from "vitest";
import {
  mitigateDamage,
  applyDamage,
  healEntity,
  FireEnergy,
} from "../src/combat/DamageCalculator";

describe("mitigateDamage", () => {
  it("armor reduces damage", () => {
    expect(mitigateDamage(100, 25)).toBeLessThan(100);
    expect(mitigateDamage(100, 25)).toBeGreaterThan(50);
  });

  it("zero armor deals full damage", () => {
    expect(mitigateDamage(100, 0)).toBe(100);
  });

  it("damage never drops below 1", () => {
    expect(mitigateDamage(5, 500)).toBe(1);
  });

  it("higher armor never increases damage", () => {
    expect(mitigateDamage(100, 50)).toBeLessThan(mitigateDamage(100, 10));
  });
});

describe("applyDamage", () => {
  it("reduces hp and reports not dead", () => {
    const e = { hp: 100, maxHp: 100 };
    const res = applyDamage(e, 30);
    expect(e.hp).toBe(70);
    expect(res.died).toBe(false);
  });

  it("clamps hp at zero and reports death", () => {
    const e = { hp: 20, maxHp: 100 };
    const res = applyDamage(e, 50);
    expect(e.hp).toBe(0);
    expect(res.died).toBe(true);
  });

  it("dead entities take no further damage", () => {
    const e = { hp: 0, maxHp: 100 };
    const res = applyDamage(e, 50);
    expect(e.hp).toBe(0);
    expect(res.died).toBe(false);
  });
});

describe("healEntity", () => {
  it("heals but clamps to max", () => {
    const e = { hp: 80, maxHp: 100 };
    healEntity(e, 50);
    expect(e.hp).toBe(100);
  });

  it("heal by fraction of max hp", () => {
    const e = { hp: 0, maxHp: 200 };
    healEntity(e, 0, 0.2);
    expect(e.hp).toBe(40);
  });
});

describe("FireEnergy", () => {
  it("drains while firing and prevents firing when empty", () => {
    const f = new FireEnergy(100, 20, 20, 0); // capacity, drain/s, recharge/s, delay
    expect(f.canFire()).toBe(true);
    f.update(2, true);
    expect(f.current).toBe(60);
    f.update(3, true);
    expect(f.current).toBe(0);
    expect(f.canFire()).toBe(false);
  });

  it("recharges after stopping", () => {
    const f = new FireEnergy(100, 100, 50, 0);
    f.update(1, true);
    expect(f.current).toBe(0);
    f.update(2, false);
    expect(f.current).toBe(100);
  });

  it("recharge delay is respected", () => {
    const f = new FireEnergy(100, 100, 50, 1.5);
    f.update(1, true);
    f.update(1, false); // within delay, no recharge yet
    expect(f.current).toBe(0);
    f.update(1, false); // 2s > 1.5s delay, recharges 0.5s worth
    expect(f.current).toBe(25);
  });

  it("after full depletion refire requires recovery threshold", () => {
    const f = new FireEnergy(100, 100, 50, 0);
    f.update(1, true);
    expect(f.canFire()).toBe(false);
    f.update(0.3, false);
    expect(f.current).toBe(15);
    expect(f.canFire()).toBe(false); // below 20% recovery threshold
    f.update(0.5, false);
    expect(f.canFire()).toBe(true);
  });

  it("drain stops at zero and does not go negative", () => {
    const f = new FireEnergy(100, 30, 10, 0);
    f.update(10, true);
    expect(f.current).toBeGreaterThanOrEqual(0);
  });
});
