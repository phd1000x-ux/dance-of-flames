import { test, expect, type Page } from "@playwright/test";

/**
 * Blackstone finale slice 3 — staged crash chain, in-memory checkpoints, assault escalation.
 *
 *   1. full crash chain: DUEL_AIR → floor-clamped api damage → RETURN/FINAL_STAGGER →
 *      FINAL_CRASH (slow-mo sample + crown detach) → RESOLVED → long war horn +
 *      band-escalated short horns on the final assault → fast-forwarded bs-final → VICTORY
 *   2. checkpoint restore: reach DUEL_AIR (checkpoint captured at entry), kill the
 *      dragon (finale resolves silently, mission continues on foot), kill the rider →
 *      DEFEAT with RETRY (CHECKPOINT) → mission rebuilt at DUEL_AIR (phase, collapsed
 *      wall towers, vharax hp, airborne dragon) → crash chain → VICTORY
 *
 * All gameplay waits poll game state / mission.time (the fixed-timestep sim clock) —
 * never wall-clock. The staged cinematics are wall-clock bounded in BlackstoneFinale
 * (STAGE_BUDGET ×1.8) so they advance even under SwiftShader (2-6 FPS).
 */

const AFTER_DAMAGE = ["RETURN", "FINAL_STAGGER", "FINAL_CRASH", "RESOLVED"];

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

/** siege → land → ground duel → transition → remount; resolves in DRAGON_GAMEPLAY (finale in CHASE) */
async function reachChase(page: Page) {
  await clearSiege(page);
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "AWAIT_LANDING", null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__GAME.api.forceLand());
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "ground", null, { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "DUEL_GROUND", null, { timeout: 10000 });

  // setCastellanHp(150) re-arms the one-shot transition (restoreHp clears
  // `transitioned` above the floor), then dipping the puppet below the floor
  // makes CastellanBoss.update clamp and fire the transition
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.setCastellanHp(150); // > floor 128
    const s = g.mission.enemies.soldiers.find((x: any) => x.def.role === "commander");
    s.hp = 120; // below floor
  });
  await simWait(page, 1, 30000);
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "dragon", null, { timeout: 90000 });
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY", null, { timeout: 15000 });
}

/** floor-clamped damage → RETURN; stage budgets carry the chain through the authored crash into RESOLVED */
async function crashToResolved(page: Page) {
  await page.evaluate(() => (window as any).__GAME.api.damageWarDragon(99999));
  await page.waitForFunction(
    (list) => list.includes((window as any).__GAME.api.getFinale()?.phase),
    AFTER_DAMAGE,
    { timeout: 90000 }
  );
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "RESOLVED", null, { timeout: 150000 });
}

/** fast-forward the bs-final survive window via the pure tracker (§91 precedent) → VICTORY */
async function finishFinalObjective(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    for (let i = 0; i < 90; i++) g.mission.tracker.update(1);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 30000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
}

test("finale3: full crash chain", async ({ page }) => {
  test.setTimeout(540000); // staged chain is wall-clock budget-bounded (~110 s) under SwiftShader
  await bootBlackstone(page);
  await reachChase(page);

  // skip the organic chase loop — the crash chain is ahead of it, not inside it
  const ok = await page.evaluate(() => (window as any).__GAME.api.setFinalePhase("DUEL_AIR"));
  expect(ok).toBe(true);

  const yHome = await page.evaluate(() => (window as any).__GAME.api.getFinale()?.crownY);
  expect(yHome).not.toBeNull();

  await crashToResolved(page);

  // crash evidence: slow-mo opened (latched spy), crown detached and fell >30 m
  const slowmoSeen = await page.evaluate(async () => {
    const g = (window as any).__GAME;
    const deadline = performance.now() + 90000;
    while (performance.now() < deadline) {
      if (g.api.getFinale()?.slowmoSeen) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  expect(slowmoSeen).toBe(true);

  const fin = await page.evaluate(() => (window as any).__GAME.api.getFinale());
  expect(fin.crashDetached).toBe(true);
  expect(fin.crownY).toBeLessThan((yHome as number) - 30);

  // final assault: long war horn at start, band 0, then escalate (progress 35/75 →
  // band 1) for a short horn stab — proves the T4 escalation wiring end to end
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.warHorns >= 1, null, { timeout: 30000 });
  const assault0 = await page.evaluate(() => (window as any).__GAME.api.assaultInfo());
  expect(assault0.active).toBe(true);
  expect(assault0.band).toBe(0);

  await page.evaluate(() => {
    const g = (window as any).__GAME;
    for (let i = 0; i < 35; i++) g.mission.tracker.update(1);
  });
  await simWait(page, 3, 30000); // band poll fires once per sim second
  const assault1 = await page.evaluate(() => (window as any).__GAME.api.assaultInfo());
  const warHorns = await page.evaluate(() => (window as any).__GAME.api.getFinale()?.warHorns);
  expect(assault1.active).toBe(true);
  expect(assault1.band).toBeGreaterThanOrEqual(1);
  expect(warHorns).toBeGreaterThanOrEqual(2);

  await finishFinalObjective(page);
});

test("finale3: checkpoint restore", async ({ page }) => {
  test.setTimeout(600000);
  await bootBlackstone(page);
  await reachChase(page);

  // hold climb (Space — direct vertical, all flight states) through the organic
  // chase so the DUEL_AIR-entry checkpoint is airborne (skipTo does NOT capture —
  // the organic entry is what snapshots DUEL_AIR)
  await page.evaluate(() => (window as any).__GAME.api.key("Space", true));
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "DUEL_AIR", null, { timeout: 150000 });
  await page.evaluate(() => (window as any).__GAME.api.key("Space", false));

  const snap = await page.evaluate(() => (window as any).__GAME.api.checkpoint());
  expect(snap).not.toBeNull();
  expect(snap.finalePhase).toBe("DUEL_AIR");
  const snapVharaxHp: number = snap.vharax?.hp;

  const collapsedBefore = await page.evaluate(
    () => (window as any).__GAME.api.getBuildingStates().filter((b: any) => b.tag === "wallTower" && b.collapsed).length
  );
  expect(collapsedBefore).toBe(4);

  // dragon dies mid-duel → finale resolves silently; the mission continues on foot
  await page.evaluate(() => (window as any).__GAME.api.damageDragon(99999));
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "ground", null, { timeout: 40000 });
  await page.waitForFunction(() => (window as any).__GAME.api.getFinale()?.phase === "RESOLVED", null, { timeout: 15000 });

  // rider death (post-crash-protection window) → DEFEAT with the checkpoint still held
  await page.waitForFunction(() => {
    const rc = (window as any).__GAME.mission?.riderCtrl;
    return !!rc && rc.invulnerable <= 0;
  }, null, { timeout: 30000 });
  await page.evaluate(() => {
    (window as any).__GAME.mission.riderCtrl.takeHit(99999, { x: 1, y: 0, z: 0 }, "e2e");
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "DEFEAT", null, { timeout: 20000 });
  await expect(page.locator("#results-title")).toHaveText("DEFEAT");

  await page.click('[data-act="retryCheckpoint"]');

  // mission rebuilt from the checkpoint: DUEL_AIR restored, buildings replayed collapsed,
  // boss hp reapplied, dragon airborne (T5: airborne restores skip landing side effects)
  await page.waitForFunction(() => {
    const g = (window as any).__GAME;
    return !!g.mission && g.api.getFinale()?.phase === "DUEL_AIR";
  }, null, { timeout: 60000 });
  const restored = await page.evaluate(() => {
    const g = (window as any).__GAME;
    return {
      missionPhase: g.mission.phase,
      dragonY: g.mission.dragonCtrl.pos.y,
      vharax: g.api.getFinale()?.vharax,
      wallTowers: g.api.getBuildingStates().filter((b: any) => b.tag === "wallTower" && b.collapsed).length,
      checkpointHeld: !!g.api.checkpoint(),
    };
  });
  expect(restored.missionPhase).toBe("dragon");
  expect(restored.dragonY).toBeGreaterThan(30);
  expect(restored.vharax.hp).toBeLessThanOrEqual(snapVharaxHp);
  expect(restored.wallTowers).toBe(4);
  expect(restored.checkpointHeld).toBe(true);

  // finish from the restored duel: crash chain → fast-forwarded assault → VICTORY
  await crashToResolved(page);
  await finishFinalObjective(page);
});
