import { test, expect, type Page } from "@playwright/test";

/**
 * Blackstone finale E2E — the full cinematic chain plus the two safety valves:
 *   1. organic chain: courtyard → land → ground duel → transition → remount → chase → aerial duel → VICTORY
 *   2. dragon dies first → converted ground chain stays completable → ground VICTORY
 *   3. skip API walks the legal phase chain (AWAIT_LANDING → DUEL_AIR) with Vharax revealed
 *
 * All gameplay waits poll game state / mission.time (the fixed-timestep sim clock) —
 * never wall-clock. SwiftShader headless runs at 2-6 FPS; the staged cinematics are
 * wall-clock bounded in BlackstoneFinale (STAGE_BUDGET ×1.8) so they advance anyway.
 */

const PHASES_AFTER_GROUND_DUEL = ["TRANSITION", "REVEAL", "MOUNT", "REMOUNT", "CHASE", "DUEL_AIR", "RESOLVED"];

/** simWait — wait on mission.time (the fixed-timestep clock), never wall-clock */
async function simWait(page: Page, simSeconds: number, timeoutMs = 60000) {
  const t0 = await page.evaluate(() => (window as any).__GAME.mission?.time ?? 0);
  await page.waitForFunction(
    (t) => (window as any).__GAME.mission?.time >= t,
    t0 + simSeconds,
    { timeout: timeoutMs }
  );
}

async function bootBlackstone(page: Page) {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.waitForTimeout(1500); // shader-compile settle (repo convention)
}

/** clear the four siege objectives — in chain order, since kills/destroys only count toward the current objective */
async function clearSiege(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killBallistae(6);
    g.api.collapseBuildingsWithTag("wallTower", 4);
    g.api.collapseBuildingsWithTag("gatehouse", 1);
    g.api.killByType("soldier", 12);
  });
}

test("finale: courtyard → land → ground duel → transition → remount → chase → duel → VICTORY", async ({ page }) => {
  test.setTimeout(660000); // full organic chain incl. a 75 sim-second survive objective under SwiftShader
  await bootBlackstone(page);
  await clearSiege(page);

  // courtyard objective completes → finale waits for landing
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "AWAIT_LANDING", null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__GAME.api.forceLand());
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "ground", null, { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "DUEL_GROUND", null, { timeout: 10000 });

  // ground duel: setCastellanHp(150) re-arms the one-shot transition (restoreHp
  // clears `transitioned` when HP lands above the floor), then dipping the puppet
  // below the floor makes CastellanBoss.update clamp and fire the transition
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.setCastellanHp(150); // > floor 128 → restoreHp re-arms the transition
    const s = g.mission.enemies.soldiers.find((x: any) => x.def.role === "commander");
    s.hp = 120; // below floor
  });
  await simWait(page, 1, 30000);
  await page.waitForFunction(
    (list) => list.includes((window as any).__GAME.api.getFinale()?.phase),
    PHASES_AFTER_GROUND_DUEL,
    { timeout: 10000 }
  );

  // staged cinematics are wall-clock bounded → remount happens without input
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "dragon", null, { timeout: 90000 });
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY", null, { timeout: 15000 });

  // wait for the aerial duel itself — damageWarDragon deliberately waits for
  // DUEL_AIR so the organic chase→duel chain is exercised end-to-end (player fire
  // is duel-gated in WarDragon.applyFire, and a mid-chase flee now resolves via
  // the CHASE un-strand instead of dead-ending the loop)
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "DUEL_AIR", null, { timeout: 120000 });

  // aerial duel: war dragon is revealed; damage floors at 40% → resolve/flee (not death)
  const v = await page.evaluate(() => (window as any).__GAME.api.getFinale()?.vharax);
  expect(v).not.toBeNull();
  await page.evaluate(() => (window as any).__GAME.api.damageWarDragon(99999));
  await page.waitForFunction(() => ["FLEEING", "GONE"].includes((window as any).__GAME.api.getFinale()?.vharax?.state ?? ""), null, { timeout: 20000 });

  // final assault (bs-final, survive 75 sim seconds) → VICTORY
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 180000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
});

test("finale: dragon dies first → commander killable → ground VICTORY (no dead-end)", async ({ page }) => {
  test.setTimeout(180000);
  await bootBlackstone(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 40000 });

  // the finale never engages on this path (bs-castellan was converted, not completed —
  // nobody claims the commander, so he stays killable through the real damage path)
  const finalePhase = await page.evaluate(() => (window as any).__GAME.api.getFinale()?.phase ?? null);
  expect(finalePhase).toBe("INACTIVE");

  // drive the converted chain in order until victory (§91 convention: kills through
  // the real damage path, survive waves fast-forwarded via the pure tracker)
  await page.evaluate(async () => {
    const g = (window as any).__GAME;
    const m = g.mission;
    for (let guard = 0; guard < 40 && g.state !== "VICTORY"; guard++) {
      const cur = m.tracker.current();
      if (!cur) break;
      if (cur.type === "kill") {
        g.api.killByType(cur.targetType === "commander" ? "commander" : "soldier", cur.count ?? 1);
      } else if (cur.type === "survive") {
        for (let i = 0; i < (cur.seconds ?? 10) + 2; i++) m.tracker.update(1);
      } else if (cur.type === "destroy") {
        g.api.collapseBuildingsWithTag(cur.targetTag ?? "house", cur.count ?? 1);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 30000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
  const survived = await page.evaluate(() => (window as any).__GAME.mission.stats.dragonSurvived);
  expect(survived).toBe(false);
});

test("finale: skip API walks the legal chain", async ({ page }) => {
  test.setTimeout(120000);
  await bootBlackstone(page);
  await clearSiege(page);
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "AWAIT_LANDING", null, { timeout: 30000 });
  const ok = await page.evaluate(() => (window as any).__GAME.api.setFinalePhase("DUEL_AIR"));
  expect(ok).toBe(true);
  const f = await page.evaluate(() => (window as any).__GAME.api.getFinale());
  expect(f.phase).toBe("DUEL_AIR");
  expect(f.vharax).not.toBeNull();
});
