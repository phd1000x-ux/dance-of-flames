import { test, expect, type Page } from "@playwright/test";

/**
 * E2E gameplay tests. The game runs in ?test=1 mode which exposes window.__GAME
 * with a test API (synthetic input, mission hooks) — same engine paths as real play.
 */

async function bootMission(page: Page, opts: { mission?: string; rider?: string; dragon?: string } = {}) {
  const q = new URLSearchParams({
    test: "1",
    autostart: "1",
    mission: opts.mission ?? "dragonstone",
    rider: opts.rider ?? "daemon",
    dragon: opts.dragon ?? "caraxes",
  });
  await page.goto(`/?${q.toString()}`);
  await page.waitForFunction(() => (window as any).__GAME?.mission != null, null, { timeout: 30000 });
  await page.waitForFunction(() => (window as any).__GAME.mission.phase === "dragon", null, { timeout: 15000 });
}

function game(page: Page) {
  return page.evaluate(() => (window as any).__GAME);
}

test("E2E 1: boot → main menu → character select → mission select → launch", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForSelector("#screen-main-menu.visible", { timeout: 20000 });
  await expect(page.locator(".game-title")).toHaveText("DANCE OF FLAMES");

  // NEW CAMPAIGN → character select
  await page.getByRole("button", { name: "NEW CAMPAIGN" }).click();
  await page.waitForSelector("#screen-character-select.visible");
  const riders = page.locator("#rider-list .roster-item");
  await expect(riders).toHaveCount(6);
  const dragons = page.locator("#dragon-list .roster-item");
  await expect(dragons).toHaveCount(6);

  // pick Aemond → Vhagar auto-selected
  await page.locator("#rider-list .roster-item", { hasText: "Aemond Targaryen" }).click();
  await expect(page.locator("#cs-dragon-name")).toHaveText("VHAGAR");

  // confirm → mission select
  await page.getByRole("button", { name: "CONFIRM" }).click();
  await page.waitForSelector("#screen-mission-select.visible");
  await expect(page.locator(".map-marker")).toHaveCount(5);

  // launch Dragonstone
  await page.getByRole("button", { name: "LAUNCH" }).click();
  await page.waitForFunction(() => (window as any).__GAME?.state === "DRAGON_GAMEPLAY", null, { timeout: 30000 });
  const g = await game(page);
  expect(g.renderer).toMatch(/WebGPU|WebGL2/);
  // HUD visible
  await expect(page.locator("#objective-text")).toContainText(/Burn/i, { timeout: 10000 });
});

test("E2E 2: kill enemy → coin spawns → collected → counter increases", async ({ page }) => {
  await bootMission(page);
  const before = await page.evaluate(() => ({
    coins: (window as any).__GAME.coins,
    kills: (window as any).__GAME.mission.stats.kills,
  }));
  expect(before.kills).toBe(0);

  // kill several soldiers (loot rolls are probabilistic; killing many guarantees coins)
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) (window as any).__GAME.api.killNearestEnemy();
  });
  // fly the dragon to the dropped loot so the magnet + auto-collect trigger
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const loot = g.mission.loot.entities.find((l: any) => l.kind === "coin");
    g.mission.dragonCtrl.pos.set(loot.pos.x, loot.pos.y + 6, loot.pos.z);
  });
  await page.waitForFunction(
    ([coins]) => (window as any).__GAME.coins > coins,
    [before.coins] as any,
    { timeout: 15000 }
  );
  const after = await page.evaluate(() => ({
    coins: (window as any).__GAME.coins,
    kills: (window as any).__GAME.mission.stats.kills,
    hudCoins: document.querySelector("#coin-count")!.textContent,
  }));
  expect(after.kills).toBeGreaterThanOrEqual(10);
  expect(after.coins).toBeGreaterThan(before.coins);
  expect(Number(after.hudCoins)).toBe(after.coins);
});

test("E2E 3: damage → healing pickup → HP increases", async ({ page }) => {
  await bootMission(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.player.dragonHp = 400;
    g.mission.loot.spawn("healSmall", 0.2, g.mission.dragonCtrl.pos);
  });
  await page.waitForFunction(
    () => (window as any).__GAME.player.dragonHp > 400,
    null,
    { timeout: 10000 }
  );
  const hp = await page.evaluate(() => (window as any).__GAME.player.dragonHp);
  expect(hp).toBeCloseTo(400 + 0.2 * 950, -1); // Caraxes maxHp 950
});

test("E2E 4: destroy building → hidden relic → dragon stat increases", async ({ page }) => {
  await bootMission(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    for (let i = 0; i < 8; i++) g.api.killNearestEnemy(); // finish objective 1
    g.__fireBefore = g.player.dragonStats.fireDamage;
    g.api.collapseBuildingWithTag("watchtower"); // contains dragonfireCore (+15% fire dmg)
  });
  await page.waitForFunction(
    () => (window as any).__GAME.player.relicIds.includes("dragonfireCore"),
    null,
    { timeout: 10000 }
  );
  const res = await page.evaluate(() => {
    const g = (window as any).__GAME;
    return {
      fireBefore: g.__fireBefore,
      fireAfter: g.player.dragonStats.fireDamage,
      toastShown: document.querySelector(".relic-toast")!.classList.contains("show"),
    };
  });
  expect(res.fireAfter / res.fireBefore).toBeCloseTo(1.15, 1);
  expect(res.toastShown).toBe(true);
});

test("E2E 5: dragon dies → death sequence → rider spawns → ground camera → sword works", async ({ page }) => {
  await bootMission(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200); // away from the horde
    g.api.damageDragon(99999);
  });
  // death sequence → ground mode (HUD sync is throttled to ~33ms, so the state
  // can flip before .hud-ground becomes visible — poll for both)
  await page.waitForFunction(
    () =>
      (window as any).__GAME.state === "GROUND_GAMEPLAY" &&
      getComputedStyle(document.querySelector(".hud-ground")!).display === "block",
    null,
    { timeout: 30000 },
  );
  const ground = await page.evaluate(() => {
    const g = (window as any).__GAME;
    return {
      riderSpawned: !!g.mission.riderCtrl,
      riderHp: g.mission.riderCtrl.player.riderHp,
      hudGroundVisible: getComputedStyle(document.querySelector(".hud-ground")!).display,
      objective: document.querySelector("#objective-text")!.textContent,
      activeCamera: g.mission.scene.activeCamera.name,
    };
  });
  expect(ground.riderSpawned).toBe(true);
  expect(ground.riderHp).toBeGreaterThan(0);
  expect(ground.hudGroundVisible).toBe("block");
  expect(ground.activeCamera).toBe("groundCam"); // renderer must follow the rider, not the frozen dragonCam
  expect(ground.objective.length).toBeGreaterThan(5); // converted objective text

  // place an enemy in front and swing — archers kite, so re-pin the victim in
  // range and re-edge the attack until the kill lands (load-dependent timing)
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const rider = g.mission.riderCtrl;
    const victim = g.mission.enemies.getGroundEnemies().find((s: any) => s.hp > 20);
    (window as any).__victim = victim;
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const dead = await page.evaluate(() => {
      const g = (window as any).__GAME;
      const v = (window as any).__victim;
      if (v.hp <= 0) return true;
      const rider = g.mission.riderCtrl;
      v.pos.set(rider.pos.x + Math.sin(rider.yaw) * 1.6, rider.pos.y, rider.pos.z + Math.cos(rider.yaw) * 1.6);
      g.api.mouse(0, true);
      g.api.mouse(0, false);
      return false;
    });
    if (dead) break;
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => (window as any).__victim.hp <= 0, null, { timeout: 2000 });
  const victimState = await page.evaluate(() => (window as any).__victim.state);
  expect(victimState).toBe("dead");
});

test("E2E 6: complete final objective → victory screen", async ({ page }) => {
  await bootMission(page);
  // complete both objectives via gameplay hooks
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    for (let i = 0; i < 8; i++) g.api.killNearestEnemy();
    g.api.collapseBuildingWithTag("watchtower");
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 15000 });
  await page.waitForSelector("#screen-results.visible");
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
  expect(await page.locator("#results-rank").textContent()).toMatch(/^[SABC]$/);

  // continue → shop
  await page.locator("#screen-results [data-act='continue']").click();
  await page.waitForSelector("#screen-shop.visible");
  // buy an upgrade
  const coins1 = await page.evaluate(() => (window as any).__GAME.coins);
  await page.locator("#shop-dragon [data-act='buy']").first().click();
  const after = await page.evaluate(() => ({
    coins: (window as any).__GAME.coins,
    lvl: (window as any).__GAME.app.upgrades.getLevel("fireDamage"),
  }));
  expect(after.lvl).toBe(1);
  expect(after.coins).toBe(coins1 - 50);
});

test("console stays clean during gameplay", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await bootMission(page, { mission: "riverlands" });
  await page.waitForTimeout(6000);
  expect(errors).toEqual([]);
});
