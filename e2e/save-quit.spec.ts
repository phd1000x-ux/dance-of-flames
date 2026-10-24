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

test("character select → SAVE & MAIN MENU stores the pairing and enables CONTINUE", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => document.querySelector("#screen-main-menu")?.classList.contains("visible"), undefined, { timeout: 90000 });
  await page.locator('#screen-main-menu [data-act="new"]').click();
  await page.waitForFunction(() => document.querySelector("#screen-character-select")?.classList.contains("visible"));
  await page.locator("#rider-list .roster-item").nth(1).click();
  await page.locator("#dragon-list .roster-item").nth(1).click();
  const picked = await page.evaluate(() => (window as any).__UI.getSelection());
  // the bar stays on screen without scrolling the panel
  const btn = page.locator('#screen-character-select [data-act="savequit"]');
  const box = await btn.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await btn.click();

  await page.waitForFunction(() => document.querySelector("#screen-main-menu")?.classList.contains("visible"));
  const after = await page.evaluate(() => ({
    rider: (window as any).__APP.save.selectedRider,
    dragon: (window as any).__APP.save.selectedDragon,
    continueEnabled: !(document.querySelector('#screen-main-menu [data-act="continue"]') as HTMLButtonElement).disabled,
  }));
  expect(after).toEqual({ rider: picked.rider, dragon: picked.dragon, continueEnabled: true });
  expect(await visible(page, "character-select")).toBe(false);
});
