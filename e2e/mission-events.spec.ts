import { test, expect } from "@playwright/test";

/**
 * Mid-mission beats: completing the Riverlands supply objective sends a relief
 * squad to the watchtowers with a subtitle. Polls game state only (SwiftShader).
 */
test("riverlands: burning the supply camp triggers the relief column", async ({ page }) => {
  await page.goto("/?test=1&autostart=1&mission=riverlands");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });

  const liveSoldiers = () =>
    page.evaluate(() => (window as any).__GAME.mission.enemies.soldiers.filter((s: any) => s.state !== "dead").length);

  // archers first (chain head), then the supply camp
  await page.evaluate(() => (window as any).__GAME.api.killByType("archer", 12));
  await page.waitForFunction(() => (window as any).__GAME.mission.tracker.current()?.id === "obj-supply");
  expect(await page.evaluate(() => (window as any).__GAME.mission.missionEvents.hasFired("ev-relief"))).toBe(false);
  const before = await liveSoldiers();

  await page.evaluate(() => (window as any).__GAME.api.collapseBuildingsWithTag("supply", 2));
  await page.waitForFunction(() => (window as any).__GAME.mission.missionEvents.hasFired("ev-relief"), null, {
    timeout: 30000,
  });
  expect(await liveSoldiers()).toBeGreaterThanOrEqual(before + 7);
  await expect(page.locator("text=relief column")).toBeVisible();
});
