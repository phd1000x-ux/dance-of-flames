import { SHOP_UPGRADES, getShopUpgrade } from "../data/upgrades";
import type { StatModSource } from "./StatBlock";

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
}

/** Coin wallet + persistent upgrade levels. Pure logic. */
export class UpgradeSystem {
  coins: number;
  private levels: Record<string, number> = {};

  constructor(coins = 0) {
    this.coins = coins;
  }

  getLevel(id: string): number {
    return this.levels[id] ?? 0;
  }

  priceFor(id: string): number | undefined {
    const def = SHOP_UPGRADES.find((u) => u.id === id);
    if (!def) return undefined;
    const lvl = this.getLevel(id);
    if (lvl >= def.maxLevel) return undefined;
    return def.prices[lvl];
  }

  purchase(id: string): PurchaseResult {
    const price = this.priceFor(id);
    if (price === undefined) return { ok: false, reason: "unavailable" };
    if (this.coins < price) return { ok: false, reason: "insufficient-coins" };
    this.coins -= price;
    this.levels[id] = this.getLevel(id) + 1;
    return { ok: true };
  }

  /** Aggregate stat multipliers from all purchased levels. */
  getStatMods(): StatModSource {
    const totals: Record<string, number> = {};
    for (const def of SHOP_UPGRADES) {
      const lvl = this.getLevel(def.id);
      if (lvl > 0) totals[def.stat] = (totals[def.stat] ?? 0) + def.perLevel * lvl;
    }
    const mods: StatModSource = {};
    for (const [stat, bonus] of Object.entries(totals)) mods[stat] = 1 + bonus;
    return mods;
  }

  addCoins(n: number): void {
    this.coins += n;
  }

  serialize(): { coins: number; levels: Record<string, number> } {
    return { coins: this.coins, levels: { ...this.levels } };
  }

  static deserialize(data: { coins: number; levels?: Record<string, number> }): UpgradeSystem {
    const s = new UpgradeSystem(data.coins ?? 0);
    s.levels = { ...(data.levels ?? {}) };
    // clamp to defined max levels
    for (const u of SHOP_UPGRADES) {
      if ((s.levels[u.id] ?? 0) > u.maxLevel) s.levels[u.id] = u.maxLevel;
    }
    return s;
  }

  describe(id: string): string | undefined {
    return getShopUpgrade(id).description;
  }
}
