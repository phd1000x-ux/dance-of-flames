import { test, expect, type Page } from "@playwright/test";

async function simWait(page: Page, seconds: number) {
  await page.evaluate(() => {
    (window as any).__simWaitStart = (window as any).__GAME.mission.time;
  });
  await page.waitForFunction(
    (sec) => (window as any).__GAME.mission.time - (window as any).__simWaitStart >= sec,
    seconds,
    { timeout: 60000 }
  );
}

test("ground kill triggers hit-stop + camera jolt, then the sim resumes at full rate", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(() => (window as any).__GAME?.api != null, undefined, { timeout: 60000 });
  await page.evaluate(() => (window as any).__GAME.api.startMission("rhaenyra", "syrax", "riverlands"));
  await page.waitForFunction(() => (window as any).__GAME.mission?.time > 0.2, undefined, { timeout: 60000 });

  await page.evaluate(() => {
    const m = (window as any).__GAME.mission;
    const p = m.dragonCtrl.pos.clone();
    p.y = m.world.terrain.heightAt(p.x, p.z);
    m.scriptedDismount(p);
  });
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "ground", undefined, { timeout: 60000 });
  await simWait(page, 0.3);

  const atKill = await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killNearestEnemy();
    const m = g.mission;
    return { hitStop: m.hitStopT, shake: m.groundCam.shake };
  });
  expect(atKill.hitStop).toBeGreaterThan(0.05);
  expect(atKill.shake).toBeGreaterThan(0.2);

  // hit-stop is short: sim time keeps advancing and shake decays back to rest
  await simWait(page, 1.0);
  const after = await page.evaluate(() => {
    const m = (window as any).__GAME.mission;
    return { hitStop: m.hitStopT, shake: m.groundCam.shake };
  });
  expect(after.hitStop).toBeLessThanOrEqual(0);
  expect(after.shake).toBe(0);
});
