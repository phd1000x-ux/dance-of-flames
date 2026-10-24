import { describe, it, expect } from "vitest";
import { SaveSystem, MemoryStorage, SaveData, CURRENT_SAVE_VERSION } from "../src/save/SaveSystem";

describe("SaveSystem", () => {
  it("returns defaults when no save exists", async () => {
    const s = new SaveSystem(new MemoryStorage());
    const data = await s.load();
    expect(data.version).toBe(CURRENT_SAVE_VERSION);
    expect(data.coins).toBe(0);
    expect(data.unlockedMissions).toEqual(["dragonstone"]);
  });

  it("persists and reloads data", async () => {
    const storage = new MemoryStorage();
    const s = new SaveSystem(storage);
    const d = await s.load();
    d.coins = 250;
    d.upgrades["fireDamage"] = 2;
    d.unlockedMissions.push("riverlands");
    await s.save(d);
    const s2 = new SaveSystem(storage);
    const d2 = await s2.load();
    expect(d2.coins).toBe(250);
    expect(d2.upgrades["fireDamage"]).toBe(2);
    expect(d2.unlockedMissions).toContain("riverlands");
  });

  it("migrates version 0 saves (mission list renamed)", async () => {
    const storage = new MemoryStorage();
    const legacy: any = {
      version: 0,
      coins: 100,
      unlockedMissions: ["m1", "m2"],
      upgrades: {},
      bestScores: {},
    };
    await storage.set("dof-save", JSON.stringify(legacy));
    const s = new SaveSystem(storage);
    const d = await s.load();
    expect(d.version).toBe(CURRENT_SAVE_VERSION);
    expect(d.coins).toBe(100);
    expect(d.unlockedMissions).toEqual(["dragonstone"]);
  });

  it("discards corrupted saves and returns defaults", async () => {
    const storage = new MemoryStorage();
    await storage.set("dof-save", "{not json");
    const s = new SaveSystem(storage);
    const d = await s.load();
    expect(d.version).toBe(CURRENT_SAVE_VERSION);
  });

  it("records best scores only when higher", async () => {
    const storage = new MemoryStorage();
    const s = new SaveSystem(storage);
    const d = await s.load();
    d.bestScores["dragonstone"] = 500;
    await s.save(d);
    const better = { ...d, bestScores: { ...d.bestScores, dragonstone: 900 } };
    await s.save(better);
    const worse = { ...better, bestScores: { ...better.bestScores, dragonstone: 100 } };
    await s.save(worse);
    const final = await new SaveSystem(storage).load();
    expect(final.bestScores["dragonstone"]).toBe(900);
  });
});

describe("music preference migration", () => {
  it("adds enabled music to old saves and preserves the independently saved volume", async () => {
    const storage = new MemoryStorage();
    await storage.set("dof-save", JSON.stringify({ version: 1, settings: { musicVolume: 0.27 } }));
    const data = await new SaveSystem(storage).load();
    expect(data.settings.musicEnabled).toBe(true);
    expect(data.settings.musicVolume).toBe(0.27);
  });

  it("persists disabled music without discarding the preferred volume", async () => {
    const system = new SaveSystem(new MemoryStorage());
    const data = await system.load();
    data.settings.musicEnabled = false;
    data.settings.musicVolume = 0.42;
    await system.save(data);
    const loaded = await system.load();
    expect(loaded.settings.musicEnabled).toBe(false);
    expect(loaded.settings.musicVolume).toBe(0.42);
  });
});
