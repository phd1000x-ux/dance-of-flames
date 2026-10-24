import { test, expect } from "@playwright/test";

test("selection preview matches roster after leaving and entering through either menu", async ({ page }) => {
  await page.goto("/?test=1");
  await page.locator('#screen-main-menu.visible [data-act="new"]').click();
  for (const entry of ["new", "battle"]) {
    await page.locator('[data-rider="baela"]').click();
    await page.locator('[data-dragon="vhagar"]').click();
    await page.locator('#screen-character-select [data-act="back"]').click();
    await page.locator(`#screen-main-menu [data-act="${entry}"]`).click();
    const view = await page.evaluate(() => {
      const app = (window as any).__APP;
      return {
        selectedRider: (document.querySelector("#rider-list .selected") as HTMLElement).dataset.rider,
        selectedDragon: (document.querySelector("#dragon-list .selected") as HTMLElement).dataset.dragon,
        previewRider: app.showcase.riderDef.id,
        previewDragon: app.showcase.rigDef.id,
      };
    });
    expect(view.previewRider).toBe(view.selectedRider);
    expect(view.previewDragon).toBe(view.selectedDragon);
  }
});

test("dragging the selection preview rotates the model instead of the UI intercepting it", async ({ page }) => {
  await page.goto("/?test=1");
  await page.locator('#screen-main-menu.visible [data-act="new"]').click();
  const area = await page.locator(".charselect-center").boundingBox();
  expect(area).not.toBeNull();
  const before = await page.evaluate(() => (window as any).__APP.showcase.theta);
  const x = area!.x + area!.width * 0.3;
  const y = area!.y + area!.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 5 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({ theta: (window as any).__APP.showcase.theta, orbit: (window as any).__APP.showcase.autoOrbit }));
  expect(after.orbit).toBe(0);
  expect(Math.abs(after.theta - before)).toBeGreaterThan(0.5);
});

test("music toggle persists, settings agrees, and M toggles during gameplay", async ({ page }) => {
  await page.goto("/?test=1");
  await page.locator("#music-toggle").click();
  await expect(page.locator("#music-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator('#screen-main-menu [data-act="settings"]').click();
  await expect(page.locator("#set-music-enabled")).toHaveText("OFF");
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open("dance-of-flames", 1);
    req.onsuccess = () => {
      const db = req.result;
      const read = db.transaction("saves", "readonly").objectStore("saves").get("dof-save");
      read.onsuccess = () => { resolve(read.result ? JSON.parse(read.result).settings.musicEnabled : null); db.close(); };
      read.onerror = () => { resolve(null); db.close(); };
    };
    req.onerror = () => resolve(null);
  }))).toBe(false);
  await page.reload();
  await expect(page.locator("#music-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => (window as any).__GAME.api.startMission());
  await page.keyboard.press("m");
  await expect(page.locator("#music-toggle")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__APP.settings.musicVolume)).toBeGreaterThan(0);
});

test("continue uses saved characters and mission-map Escape is not stranded", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => !!(window as any).__GAME);
  await page.evaluate(() => {
    const app = (window as any).__APP;
    app.save.selectedRider = "daemon";
    app.save.selectedDragon = "caraxes";
    app.save.unlockedMissions = ["dragonstone", "riverlands"];
    app.ui.setContinueEnabled(true);
  });
  await page.locator('#screen-main-menu [data-act="continue"]').click();
  expect(await page.evaluate(() => (window as any).__APP.ui.getCharacterSelection())).toEqual({ rider: "daemon", dragon: "caraxes" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#screen-character-select")).toHaveClass(/visible/);
});
