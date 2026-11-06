import { describe, expect, it } from "vitest";
import { closeCallReward, diveFuryMult, emberChainBonus, emberChainWindow } from "../src/combat/Techniques";
import { FireStreak, STREAK_WINDOW, streakBonus } from "../src/combat/FireStreak";
import { UpgradeSystem } from "../src/progression/UpgradeSystem";
import { SHOP_UPGRADES } from "../src/data/upgrades";
import { shopEffectText } from "../src/ui/UIManager";

describe("shop techniques", () => {
  it("Stooping Strike only pays during a fast nose-down dive", () => {
    expect(diveFuryMult(0, 0.6, 60, 45)).toBe(1);
    expect(diveFuryMult(1, 0.6, 60, 45)).toBeCloseTo(1.25);
    expect(diveFuryMult(2, 0.6, 60, 45)).toBeCloseTo(1.5);
    expect(diveFuryMult(2, 0.1, 60, 45)).toBe(1); // level flight
    expect(diveFuryMult(2, 0.6, 20, 45)).toBe(1); // slow nose-down hover
  });

  it("Ember Chain lengthens the streak window and its payout", () => {
    expect(emberChainWindow(0)).toBe(STREAK_WINDOW);
    expect(emberChainWindow(2)).toBeCloseTo(STREAK_WINDOW + 1);
    expect(emberChainBonus(5, 0)).toBe(streakBonus(5));
    expect(emberChainBonus(5, 2)).toBe(streakBonus(5) * 2);
    // a kill 2.0s after the previous chains only with the longer window
    const base = new FireStreak();
    base.kill();
    base.update(2.0);
    expect(base.kill()).toBe(1);
    const chained = new FireStreak(emberChainWindow(1));
    chained.kill();
    chained.update(2.0);
    expect(chained.kill()).toBe(2);
  });

  it("Close Call rewards scale with rank and are zero when unlearned", () => {
    expect(closeCallReward(0)).toEqual({ fireFraction: 0, super: 0 });
    expect(closeCallReward(2).fireFraction).toBeCloseTo(0.6);
  });

  it("techniques never leak into stat multipliers", () => {
    const u = new UpgradeSystem(5000);
    for (const id of ["diveFury", "emberChain", "closeCall"]) expect(u.purchase(id).ok).toBe(true);
    const mods = u.getStatMods();
    expect(mods.diveFury).toBeUndefined();
    expect(mods.emberChain).toBeUndefined();
    expect(mods.closeCall).toBeUndefined();
  });

  it("old saves without technique levels load with every technique unlearned", () => {
    const u = UpgradeSystem.deserialize({ coins: 10, levels: { fireDamage: 2 } });
    expect(u.getLevel("diveFury")).toBe(0);
    expect(u.getLevel("fireDamage")).toBe(2);
  });

  it("shop text reads as ranks", () => {
    const t = SHOP_UPGRADES.find((x) => x.id === "closeCall")!;
    expect(shopEffectText(t, 0)).toBe("not learned → rank 1");
    expect(shopEffectText(t, 2)).toBe("rank 2 (max)");
  });
});
