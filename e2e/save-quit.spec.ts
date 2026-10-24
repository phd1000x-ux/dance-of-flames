import { test, expect, type Page } from "@playwright/test";

async function visible(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sel) => document.querySelector(sel)?.classList.contains("visible") ?? false, `#screen-${id}`);
}

test("pause → SAVE & MAIN MENU keeps the selection and banks picked-up coins", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => (window as any).__GAME?.api, undefined, { timeout: 90000 });
  await page.evaluate(() => (window as any).__GAME.api.startMission("rhaenyra", "syrax", "riverlands"));
  await page.waitForFunction(() => (window as any).__GAME?.mission?.time > 0.3, undefined, { timeout: 90000 });

  const before = await page.evaluate(() => {
    const app = (window as any).__APP;
    app.mission.stats.coinsCollected = 50; // as if picked up during the run
    return app.upgrades.coins;
  });

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" })));
  await page.waitForFunction(() => document.querySelector("#screen-pause")?.classList.contains("visible"));
  await page.locator('#screen-pause [data-act="savequit"]').click();

  await page.waitForFunction(() => document.querySelector("#screen-main-menu")?.classList.contains("visible"), undefined, { timeout: 30000 });
  expect(await visible(page, "pause")).toBe(false);
  const after = await page.evaluate(() => {
    const app = (window as any).__APP;
    return { coins: app.upgrades.coins, saved: app.save.coins, rider: app.save.selectedRider, dragon: app.save.selectedDragon, mission: app.mission };
  });
  expect(after.coins).toBe(before + 20); // 50 picked up × 0.4 defeat rate
  expect(after.saved).toBe(after.coins);
  expect(after.rider).toBe("rhaenyra");
  expect(after.dragon).toBe("syrax");
  expect(after.mission).toBeNull();
});
