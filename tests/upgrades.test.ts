import { describe, it, expect } from "vitest";
import { UpgradeSystem } from "../src/progression/UpgradeSystem";
import { SHOP_UPGRADES } from "../src/data/upgrades";
import { StatBlock, computeFinalStats } from "../src/progression/StatBlock";
import { DRAGONS } from "../src/data/dragons";
import { RIDERS } from "../src/data/riders";
import { RELICS } from "../src/data/items";

describe("UpgradeSystem", () => {
  it("cannot purchase without enough coins", () => {
    const s = new UpgradeSystem(10);
    expect(s.purchase("fireDamage").ok).toBe(false);
    expect(s.coins).toBe(10);
  });

  it("purchases deduct coins and raise level", () => {
    const s = new UpgradeSystem(500);
    const res = s.purchase("fireDamage");
    expect(res.ok).toBe(true);
    expect(s.coins).toBe(500 - 50);
    expect(s.getLevel("fireDamage")).toBe(1);
  });

  it("rejects invalid upgrade ids", () => {
    const s = new UpgradeSystem(9999);
    expect(s.purchase("nonsense").ok).toBe(false);
  });

  it("respects price progression 50/120/250/500", () => {
    const s = new UpgradeSystem(10000);
    s.purchase("fireDamage");
    s.purchase("fireDamage");
    s.purchase("fireDamage");
    expect(s.coins).toBe(10000 - 50 - 120 - 250);
  });

  it("cannot exceed max level", () => {
    const s = new UpgradeSystem(100000);
    for (let i = 0; i < 10; i++) s.purchase("fireDamage");
    expect(s.getLevel("fireDamage")).toBe(4);
    expect(s.purchase("fireDamage").ok).toBe(false);
  });

  it("serializes and restores state", () => {
    const s = new UpgradeSystem(250);
    s.purchase("fireDamage");
    const data = s.serialize();
    const s2 = UpgradeSystem.deserialize(data);
    expect(s2.coins).toBe(200);
    expect(s2.getLevel("fireDamage")).toBe(1);
  });

  it("every shop upgrade has 4 levels and prices", () => {
    for (const u of SHOP_UPGRADES) {
      expect(u.maxLevel).toBe(4);
      expect(u.prices).toHaveLength(4);
      expect(u.id).toBeTruthy();
    }
  });
});

describe("stat composition", () => {
  it("shop upgrades multiply base stats", () => {
    const base: StatBlock = { fireDamage: 100 };
    const shopMods = { fireDamage: 1.1 }; // level gives +10%
    const out = computeFinalStats(base, [shopMods]);
    expect(out.fireDamage).toBeCloseTo(110, 5);
  });

  it("rider bond bonus applies to dragon stats", () => {
    const syrax = DRAGONS.find((d) => d.id === "syrax")!;
    const rhaenyra = RIDERS.find((r) => r.id === "rhaenyra")!;
    const out = computeFinalStats(
      { maxSpeed: syrax.maxSpeed, turnRate: syrax.turnRate },
      [rhaenyra.dragonBonus]
    );
    expect(out.maxSpeed).toBeGreaterThan(syrax.maxSpeed);
    expect(out.turnRate).toBeGreaterThan(syrax.turnRate);
  });

  it("relic effects stack multiplicatively and are mission-scoped", () => {
    const relic1 = RELICS.find((r) => r.id === "dragonfireCore")!;
    const relic2 = RELICS.find((r) => r.id === "ancientFlameGland")!;
    const out = computeFinalStats({ fireDamage: 100, fireRange: 50 }, [relic1.effect, relic2.effect]);
    expect(out.fireDamage).toBeCloseTo(115);
    expect(out.fireRange).toBeCloseTo(60);
  });

  it("all six starter dragons have complete stat blocks", () => {
    expect(DRAGONS).toHaveLength(6);
    for (const d of DRAGONS) {
      expect(d.maxHealth).toBeGreaterThan(0);
      expect(d.fireDamage).toBeGreaterThan(0);
      expect(d.maxSpeed).toBeGreaterThan(0);
      expect(d.turnRate).toBeGreaterThan(0);
      expect(d.fireCapacity).toBeGreaterThan(0);
      expect(d.fireRecharge).toBeGreaterThan(0);
    }
  });

  it("every dragon has a distinct wing silhouette (wingShape)", () => {
    const sigs = DRAGONS.map((d) => `${d.wingShape.span}/${d.wingShape.chord}/${d.wingShape.fingers}/${d.wingShape.membraneNotch}/${d.wingShape.sweepAngle}`);
    expect(new Set(sigs).size).toBe(DRAGONS.length); // all unique
    // canonical identities preserved:
    const vhagar = DRAGONS.find((d) => d.id === "vhagar")!;
    const moondancer = DRAGONS.find((d) => d.id === "moondancer")!;
    const caraxes = DRAGONS.find((d) => d.id === "caraxes")!;
    expect(vhagar.wingShape.chord).toBeGreaterThan(1.2); // broad battle-planes
    expect(vhagar.wingShape.fingers).toBe(5);
    expect(moondancer.wingShape.chord).toBeLessThan(0.75); // slim slivers
    expect(moondancer.wingShape.membraneNotch).toBeGreaterThan(0.6); // deep scallops
    expect(caraxes.wingShape.chord).toBeLessThan(0.8); // narrow serpentine
    for (const d of DRAGONS) {
      expect(d.wingShape.fingers).toBeGreaterThanOrEqual(3);
      expect(d.wingShape.fingers).toBeLessThanOrEqual(5);
      expect(d.wingShape.membraneNotch).toBeGreaterThanOrEqual(0);
      expect(d.wingShape.membraneNotch).toBeLessThanOrEqual(1);
    }
  });

  it("Vhagar is tankier but slower than Moondancer", () => {
    const vhagar = DRAGONS.find((d) => d.id === "vhagar")!;
    const moondancer = DRAGONS.find((d) => d.id === "moondancer")!;
    expect(vhagar.maxHealth).toBeGreaterThan(moondancer.maxHealth);
    expect(vhagar.armor).toBeGreaterThan(moondancer.armor);
    expect(moondancer.turnRate).toBeGreaterThan(vhagar.turnRate);
    expect(moondancer.maxSpeed).toBeGreaterThan(vhagar.maxSpeed);
  });

  it("all relics have valid stat effects", () => {
    expect(RELICS.length).toBeGreaterThanOrEqual(9);
    for (const r of RELICS) {
      const entries = Object.entries(r.effect);
      expect(entries.length).toBeGreaterThan(0);
      for (const [k, v] of entries) {
        expect(k).toBeTruthy();
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});
