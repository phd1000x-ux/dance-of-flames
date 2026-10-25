import { test, expect, type Page } from "@playwright/test";

/**
 * Flight tutorial progression (Dragonstone). Real keyboard input; the test API
 * is used only to start the mission and read the current step label. Waits are
 * on game state (step label / mission time), never wall-clock.
 */

const label = (page: Page) => page.evaluate(() => (window as any).__GAME.mission.currentTutorialLabel() as string | null);

async function holdUntilStepChanges(page: Page, key: string) {
  const before = await label(page);
  await page.keyboard.down(key);
  await page.waitForFunction((b) => (window as any).__GAME.mission.currentTutorialLabel() !== b, before, { timeout: 60000 });
  await page.keyboard.up(key);
}

test("tutorial teaches Space/C and never parks on the optional aim step", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => (window as any).__GAME?.api, null, { timeout: 60000 });
  await page.evaluate(() => (window as any).__GAME.api.startMission("rhaenyra", "syrax", "dragonstone", "normal"));
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY", null, { timeout: 60000 });

  expect(await label(page)).toContain("Accelerate");
  await holdUntilStepChanges(page, "KeyW");
  expect(await label(page)).toContain("Turn");
  await holdUntilStepChanges(page, "KeyD");
  expect(await label(page)).toContain("Climb / Descend");
  await holdUntilStepChanges(page, "Space");
  expect(await label(page)).toContain("optional");

  // no arrow keys: the optional step advances on its own after 8s of sim time
  await page.waitForFunction(() => (window as any).__GAME.mission.currentTutorialLabel()?.includes("Breathe Fire"), null, { timeout: 90000 });
  await holdUntilStepChanges(page, "KeyF");
  expect(await label(page)).toContain("Boost");
  await holdUntilStepChanges(page, "ShiftLeft");
  expect(await label(page)).toBeNull();
});
