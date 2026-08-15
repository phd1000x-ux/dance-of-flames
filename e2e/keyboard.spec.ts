import { test, expect, type Page } from "@playwright/test";

/**
 * KEYBOARD-ONLY E2E tests (§47–49).
 * These tests never touch page.mouse — all gameplay input is real keyboard input.
 * The __GAME test API is used only for setup/inspection, never for input.
 */

const KEY = {
  enter: "Enter",
  esc: "Escape",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

async function visible(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sel) => document.querySelector(sel)?.classList.contains("visible") ?? false, `#screen-${id}`);
}

/** deterministic fresh save (keyboard focus starts on NEW CAMPAIGN) */
async function cleanBoot(page: Page) {
  await page.goto("/?test=1");
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const req = indexedDB.deleteDatabase("dance-of-flames");
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })
  );
  await page.reload();
  await page.waitForSelector("#screen-main-menu.visible", { timeout: 20000 });
}

/**
 * Wait for N seconds of *simulated* mission time (renderer-speed independent —
 * works identically on a 75fps GPU and a throttled headless SwiftShader run).
 */
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

test("keyboard menu navigation + manual open/close (no mouse)", async ({ page }) => {
  await cleanBoot(page);

  // keyboard focus begins on the first enabled item (CONTINUE is disabled on fresh save)
  const focused0 = await page.evaluate(() => document.querySelector(".menu-btn.kb-focused")?.textContent);
  expect(focused0).toBe("NEW CAMPAIGN");

  // navigate down to MANUAL: NEW CAMPAIGN → BATTLE → MANUAL
  await page.keyboard.press(KEY.down);
  await page.keyboard.press(KEY.down);
  const focused = await page.evaluate(() => document.querySelector(".menu-btn.kb-focused")?.textContent);
  expect(focused).toBe("MANUAL");

  // Enter opens the manual
  await page.keyboard.press(KEY.enter);
  expect(await visible(page, "manual")).toBe(true);
  await expect(page.locator(".manual-tab.active")).toHaveText("FLIGHT");
  await expect(page.locator(".man-keys").first()).toHaveText("W");

  // D switches to the next section
  await page.keyboard.press("d");
  await expect(page.locator(".manual-tab.active")).toHaveText("COMBAT");
  // A switches back
  await page.keyboard.press("a");
  await expect(page.locator(".manual-tab.active")).toHaveText("FLIGHT");

  // Esc returns to the main menu
  await page.keyboard.press(KEY.esc);
  expect(await visible(page, "main-menu")).toBe(true);
});

test("keyboard-only full flow: menu → rider → dragon → mission → flight", async ({ page }) => {
  await cleanBoot(page);

  // NEW CAMPAIGN (focused by default)
  await page.keyboard.press(KEY.enter);
  await page.waitForSelector("#screen-character-select.visible");

  // select rider (Enter on focused roster item)
  await page.keyboard.press(KEY.enter);
  // D → dragon panel, S → second dragon, Enter selects it
  await page.keyboard.press("d");
  await page.keyboard.press("s");
  await page.keyboard.press(KEY.enter);
  // D → action buttons (BACK focused), S → CONFIRM, Enter
  await page.keyboard.press("d");
  await page.keyboard.press("s");
  await page.keyboard.press(KEY.enter);
  await page.waitForSelector("#screen-mission-select.visible");

  // mission select: D → options panel (difficulty list then BACK/LAUNCH), S×4 → LAUNCH, Enter
  await page.keyboard.press("d");
  await page.keyboard.press("s");
  await page.keyboard.press("s");
  await page.keyboard.press("s");
  await page.keyboard.press("s");
  const launchLabel = await page.evaluate(() => document.querySelector(".kb-focused")?.textContent);
  expect(launchLabel).toBe("LAUNCH");
  await page.keyboard.press(KEY.enter);

  await page.waitForFunction(() => (window as any).__GAME?.state === "DRAGON_GAMEPLAY", null, { timeout: 30000 });
  // settle (sim time also absorbs the one-time shader-compilation stall)
  await simWait(page, 2);
  const g = await page.evaluate(() => (window as any).__GAME);

  // ---- flight controls, real keyboard input only ----
  const read = () =>
    page.evaluate(() => {
      const c = (window as any).__GAME.mission.dragonCtrl;
      return { x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, pitch: c.pitch, roll: c.roll, speed: c.speed, state: c.state };
    });

  // W accelerates (position advances along heading)
  const before = await read();
  await page.keyboard.down("w");
  await simWait(page, 1.4);
  const afterW = await read();
  await page.keyboard.up("w");
  const moved = Math.hypot(afterW.x - before.x, afterW.z - before.z);
  expect(moved).toBeGreaterThan(20);

  // A turns left (yaw decreases)
  const yaw0 = (await read()).yaw;
  await page.keyboard.down("a");
  await simWait(page, 1.0);
  await page.keyboard.up("a");
  const yawA = (await read()).yaw;
  expect(yawA).toBeLessThan(yaw0 - 0.3);

  // D turns right (yaw increases)
  await page.keyboard.down("d");
  await simWait(page, 1.0);
  await page.keyboard.up("d");
  const yawD = (await read()).yaw;
  expect(yawD).toBeGreaterThan(yawA + 0.3);

  // Space climbs
  const y0 = (await read()).y;
  await page.keyboard.down(" ");
  await simWait(page, 0.9);
  await page.keyboard.up(" ");
  const yUp = (await read()).y;
  expect(yUp).toBeGreaterThan(y0 + 5);

  // C descends
  await page.keyboard.down("c");
  await simWait(page, 0.9);
  await page.keyboard.up("c");
  const yDown = (await read()).y;
  expect(yDown).toBeLessThan(yUp - 5);

  // Arrow keys steer the aim/camera (yaw changes)
  const yawAr0 = (await read()).yaw;
  await page.keyboard.down(KEY.right);
  await simWait(page, 1.0);
  await page.keyboard.up(KEY.right);
  const yawAr = (await read()).yaw;
  expect(yawAr).toBeGreaterThan(yawAr0 + 0.3);

  // F breathes fire (fire energy drains)
  const fire0 = await page.evaluate(() => (window as any).__GAME.player.fireEnergy.fraction);
  await page.keyboard.down("f");
  await simWait(page, 0.8);
  const firingNow = await page.evaluate(() => (window as any).__GAME.mission.fire.firing);
  const fire1 = await page.evaluate(() => (window as any).__GAME.player.fireEnergy.fraction);
  await page.keyboard.up("f");
  expect(fire1).toBeLessThan(fire0);
  expect(firingNow).toBe(true);

  // Shift boosts
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await simWait(page, 0.7);
  const boostState = await page.evaluate(() => ({
    state: (window as any).__GAME.mission.dragonCtrl.state,
    boost: (window as any).__GAME.player.boost,
  }));
  await page.keyboard.up("Shift");
  await page.keyboard.up("w");
  expect(boostState.boost).toBeLessThan(1);

  // Q dodges (i-frames activate)
  await page.keyboard.press("q");
  await page.waitForFunction(() => (window as any).__GAME.mission.dragonCtrl.invulnerable > 0, null, { timeout: 5000 });
  const dodge = await page.evaluate(() => ({
    inv: (window as any).__GAME.mission.dragonCtrl.invulnerable,
    cd: (window as any).__GAME.mission.dragonCtrl.dodgeCooldown,
  }));
  expect(dodge.inv).toBeGreaterThan(0);

  // X target lock: point the dragon at the enemy village first
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const m = g.mission;
    const victim = m.enemies.getGroundEnemies()[0];
    m.dragonCtrl.pos.set(victim.pos.x - 80, victim.pos.y + 45, victim.pos.z - 80);
    m.dragonCtrl.yaw = Math.PI / 4;
    m.dragonCtrl.pitch = 0;
  });
  await page.keyboard.press("x");
  await page.waitForFunction(() => (window as any).__GAME.mission.lockTargetKind !== null, null, { timeout: 5000 });
  const lock = await page.evaluate(() => ({
    kind: (window as any).__GAME.mission.lockTargetKind,
    bracket: getComputedStyle(document.querySelector(".lock-bracket")!).display,
  }));
  expect(lock.kind).toBeTruthy();
  expect(lock.bracket).toBe("block");
  // X again unlocks
  await page.keyboard.press("x");
  await page.waitForFunction(() => (window as any).__GAME.mission.lockTargetKind === null, null, { timeout: 5000 });

  // Z recenters (levels flight)
  await page.evaluate(() => {
    const c = (window as any).__GAME.mission.dragonCtrl;
    c.pitch = 0.7;
    c.roll = 0.6;
  });
  await page.keyboard.press("z");
  await simWait(page, 0.9);
  const leveled = await read();
  expect(Math.abs(leveled.pitch)).toBeLessThan(0.1);
  expect(Math.abs(leveled.roll)).toBeLessThan(0.15);

  // Tab opens objectives panel
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".objectives-panel")!).display === "block", null, { timeout: 5000 });
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".objectives-panel")!).display === "none", null, { timeout: 5000 });

  // R with empty super gauge → NOT READY hint
  await page.evaluate(() => {
    (window as any).__GAME.player.superCharge = 10;
  });
  await page.keyboard.press("r");
  await page.waitForFunction(() => document.querySelector(".hud-hint")!.textContent.includes("SUPER CHARGE NOT READY"), null, { timeout: 5000 });

  // Esc pauses; Enter on RESUME resumes
  await page.keyboard.press(KEY.esc);
  await page.waitForTimeout(200);
  expect(await visible(page, "pause")).toBe(true);
  const paused = await page.evaluate(() => (window as any).__GAME.state);
  expect(paused).toBe("PAUSED");
  // navigate pause menu by keyboard: CONTROLS exists, then back to RESUME
  await page.keyboard.press(KEY.down);
  const pauseFocus = await page.evaluate(() => document.querySelector(".kb-focused")?.textContent);
  expect(pauseFocus).toBe("CONTROLS");
  await page.keyboard.press(KEY.enter);
  expect(await visible(page, "manual")).toBe(true);
  await page.keyboard.press(KEY.esc); // manual back → pause
  expect(await visible(page, "pause")).toBe(true);
  await page.keyboard.press(KEY.enter); // RESUME focused again
  await page.waitForTimeout(200);
  const resumed = await page.evaluate(() => (window as any).__GAME.state);
  expect(resumed).toBe("DRAGON_GAMEPLAY");
  void g;
});

test("keyboard-only ground combat after dragon death (no mouse)", async ({ page }) => {
  await page.goto("/?test=1&autostart=1&mission=dragonstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 30000 });
  await simWait(page, 1);

  // force dragon death away from the horde
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 30000 });

  const read = () =>
    page.evaluate(() => {
      const r = (window as any).__GAME.mission.riderCtrl;
      const cam = (window as any).__GAME.mission.groundCam;
      return { x: r.pos.x, z: r.pos.z, camYaw: cam.yaw, state: r.attackState, blocking: r.blocking, inv: r.invulnerable, lock: !!r.lockTarget };
    });

  // W moves the rider
  const p0 = await read();
  await page.keyboard.down("w");
  await simWait(page, 0.8);
  await page.keyboard.up("w");
  const p1 = await read();
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(2);

  // ArrowRight rotates the ground camera
  const cy0 = (await read()).camYaw;
  await page.keyboard.down(KEY.right);
  await simWait(page, 0.8);
  await page.keyboard.up(KEY.right);
  const cy1 = (await read()).camYaw;
  expect(cy1).toBeGreaterThan(cy0 + 0.3);

  // J light attack (waits for the swing to register)
  await page.keyboard.press("j");
  await page.waitForFunction(
    () => ["light1", "light2", "light3"].includes((window as any).__GAME.mission.riderCtrl.attackState),
    null,
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () => (window as any).__GAME.mission.riderCtrl.attackState === "none",
    null,
    { timeout: 10000 }
  );

  // K heavy attack
  await page.keyboard.press("k");
  await page.waitForFunction(
    () => (window as any).__GAME.mission.riderCtrl.attackState === "heavy",
    null,
    { timeout: 5000 }
  );
  await page.waitForFunction(
    () => (window as any).__GAME.mission.riderCtrl.attackState === "none",
    null,
    { timeout: 10000 }
  );

  // L block (held)
  await page.keyboard.down("l");
  await page.waitForFunction(() => (window as any).__GAME.mission.riderCtrl.blocking === true, null, { timeout: 5000 });
  await page.keyboard.up("l");

  // Space dodge (i-frames)
  await page.keyboard.press(" ");
  await page.waitForFunction(() => (window as any).__GAME.mission.riderCtrl.invulnerable > 0, null, { timeout: 5000 });

  // X target lock — place an enemy in front of the rider first
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const rider = g.mission.riderCtrl;
    const enemy = g.mission.enemies.getGroundEnemies()[0];
    enemy.pos.set(rider.pos.x + Math.sin(rider.yaw) * 6, rider.pos.y, rider.pos.z + Math.cos(rider.yaw) * 6);
  });
  await page.keyboard.press("x");
  await page.waitForFunction(() => !!(window as any).__GAME.mission.riderCtrl.lockTarget, null, { timeout: 5000 });
  const locked = (await read()).lock;
  expect(locked).toBe(true);
});
