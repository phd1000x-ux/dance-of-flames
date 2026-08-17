import { test, expect, type Page } from "@playwright/test";

/**
 * Siege systems E2E — slice-2 blackstone machinery:
 *   1. tower damage-state progression (SCORCHED → DAMAGED → CRITICAL) → collapse
 *      kills ballistae mounted on the falling tower (horizontal-radius impact)
 *   2. gatehouse breach-ready hint at CRITICAL + rubble falls inward (courtyard)
 *   3. coordinated volley: forceVolley fires 2+ bolts within a tight sim window
 *   4. ambient battle pairs: 25 spawned, tier histogram sums to count
 *   5. §90-style phased castle completion still reaches VICTORY on the new build
 *
 * SwiftShader headless (2-6 FPS): every gameplay wait polls game state or the
 * fixed-timestep sim clock (mission.time) — never wall-clock. The §90 survive
 * objective is fast-forwarded through the tracker (repo convention).
 */

async function bootBlackstone(page: Page) {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.waitForTimeout(1500); // shader-compile settle (repo convention)
}

/**
 * Pick the tower to burn: prefer a tower with a live ballista within 40m
 * horizontal (crown/wall-walk mounts die inside the collapse impact radius),
 * then nearest to the dragon. Avoids the pre-damaged "ruined" tower edge case
 * where SCORCHED can never appear (it starts at 45% hp = DAMAGED).
 */
function nearestTower(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__GAME;
    const dragon = g.mission.dragonCtrl.pos;
    const nearBallista = (t: any) =>
      g.mission.enemies.ballistae.filter(
        (b: any) => !b.dead && Math.hypot(b.pos.x - t.pos.x, b.pos.z - t.pos.z) < 40
      ).length;
    const towers = g.mission.buildings.buildings.filter((b: any) => b.tag === "wallTower" && !b.collapsed);
    const scored = towers.map((t: any) => ({
      t,
      near: nearBallista(t),
      dist: Math.hypot(t.pos.x - dragon.x, t.pos.z - dragon.z),
    }));
    scored.sort((a: any, b: any) => (b.near > 0 ? 1 : 0) - (a.near > 0 ? 1 : 0) || a.dist - b.dist);
    const pick = scored[0];
    (window as any).__tower = pick.t;
    return { hp: pick.t.hp, state: pick.t.visualState, nearBallistae: pick.near };
  });
}

test("siege: tower damage-state progression → collapse → ballistae destroyed", async ({ page }) => {
  await bootBlackstone(page);
  const picked = await nearestTower(page);
  expect(picked.state).toBe("INTACT");
  // robustness guard: the chosen tower must own a nearby ballista to kill
  expect(picked.nearBallistae).toBeGreaterThan(0);
  // teleport next to the tower and burn it down via test damage, checking states
  const states: string[] = [];
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const t = (window as any).__tower;
    g.mission.dragonCtrl.pos.set(t.pos.x + 25, t.pos.y + 20, t.pos.z + 25);
    (window as any).__burn = () => {
      const b = (window as any).__tower;
      b.hp -= b.maxHp * 0.2;
      g.mission.buildings.refreshDamageVisuals(b);
      if (b.hp <= 0) g.mission.buildings.damageBuilding(b, 1);
    };
  });
  for (let i = 0; i < 6; i++) {
    const res = await page.evaluate(() => {
      (window as any).__burn();
      const b = (window as any).__tower;
      return { state: b.visualState, collapsed: b.collapsed, hp: Math.max(0, Math.round(b.hp)) };
    });
    if (!res.collapsed && states[states.length - 1] !== res.state) states.push(res.state);
    if (res.collapsed) break;
    await page.waitForTimeout(200);
  }
  expect(states).toContain("SCORCHED");
  expect(states).toContain("DAMAGED");
  expect(states).toContain("CRITICAL");
  // collapse killed nearby ballistae (blackstone has 6 total; crown mounts die
  // inside the horizontal collapse-impact radius)
  const ballistae = await page.evaluate(() => {
    const g = (window as any).__GAME;
    const t = (window as any).__tower;
    const near = g.mission.enemies.ballistae.filter((b: any) => Math.hypot(b.pos.x - t.pos.x, b.pos.z - t.pos.z) < 40);
    return { total: g.mission.enemies.ballistae.length, nearDead: near.filter((b: any) => b.dead).length, nearCount: near.length };
  });
  expect(ballistae.total).toBe(6);
  expect(ballistae.nearCount).toBeGreaterThan(0);
  expect(ballistae.nearDead).toBe(ballistae.nearCount);
});

test("siege: gatehouse breach-ready hint + enhanced collapse", async ({ page }) => {
  await bootBlackstone(page);
  const hintSeen = await page.evaluate(() => {
    const g = (window as any).__GAME;
    const gate = g.mission.buildings.buildings.find((b: any) => b.tag === "gatehouse");
    (window as any).__gate = gate;
    return gate !== undefined;
  });
  expect(hintSeen).toBe(true);
  // damage to just below the CRITICAL threshold (35%) → breach-ready hint
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const gate = (window as any).__gate;
    gate.hp = gate.maxHp * 0.34;
    g.mission.buildings.refreshDamageVisuals(gate);
  });
  await page.waitForFunction(() => document.querySelector(".hud-hint")?.textContent?.includes("BREACH"), null, { timeout: 5000 });
  // final blow collapses
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.buildings.damageBuilding((window as any).__gate, 99999);
  });
  await page.waitForFunction(() => (window as any).__gate.collapsed === true, null, { timeout: 5000 });
  // rubble is root-parented (local coords): collapse offsets it -z local; the
  // gate rotY is 0 and the courtyard lies at -z world → fell inward
  const rubble = await page.evaluate(() => {
    const gate = (window as any).__gate;
    return { z: gate.rubble.position.z, rootZ: gate.root.position.z };
  });
  expect(rubble.z).toBeLessThan(rubble.rootZ);
  expect(rubble.z).toBeLessThan(0);
});

test("siege: volley fires 2+ bolts in a tight window", async ({ page }) => {
  await bootBlackstone(page);
  // teleport inside the wall ballistae's range ring (range 260; ~110-180m from
  // the wall mounts), instrument ProjectileSystem.spawn, then trigger
  const fired = await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(0, 120, 0);
    (window as any).__bolts = [];
    const orig = g.mission.projectiles.spawn.bind(g.mission.projectiles);
    g.mission.projectiles.spawn = (kind: any, origin: any, dir: any, speed: any, dmg: any, spread: any) => {
      if (kind === "bolt") (window as any).__bolts.push(g.mission.time);
      return orig(kind, origin, dir, speed, dmg, spread);
    };
    return g.api.triggerVolley();
  });
  // insurance: if <2 alive at first try, retry over ~10s (fresh page → all 6 alive)
  let ok = fired;
  for (let i = 0; i < 10 && !ok; i++) {
    await page.waitForTimeout(1000);
    ok = await page.evaluate(() => (window as any).__GAME.api.triggerVolley());
  }
  expect(ok).toBe(true);
  await page.waitForFunction(() => (window as any).__bolts.length >= 2, null, { timeout: 15000 });
  const windowSpan = await page.evaluate(() => {
    const b = (window as any).__bolts;
    return Math.max(...b) - Math.min(...b);
  });
  expect(windowSpan).toBeLessThanOrEqual(1.5); // sim seconds incl. aim settle
});

test("siege: ambient pairs spawn and tier", async ({ page }) => {
  await bootBlackstone(page);
  const pairs = await page.evaluate(() => (window as any).__GAME.api.getAmbientPairs());
  expect(pairs).not.toBeNull();
  expect(pairs.count).toBeGreaterThanOrEqual(20);
  expect(pairs.tiers[0] + pairs.tiers[1] + pairs.tiers[2]).toBe(pairs.count);
});

test("siege: no regression — §90 phased castle completion", async ({ page }) => {
  await page.goto("/?test=1&autostart=1&mission=blackstone");
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // clear the siege chain in one synchronous pass (kills only count toward the
  // current objective — order matters); the commander dies unclaimed, so the
  // finale short-circuits the event chain instead of engaging
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.api.killBallistae(6);
    g.api.collapseBuildingsWithTag("wallTower", 4);
    g.api.collapseBuildingWithTag("gatehouse");
    g.api.killByType("soldier", 12);
    g.api.killByType("commander", 1);
  });
  // short-circuit resolves bs-castellan/pursue/vharax → bs-final survives becomes current
  await page.waitForFunction(
    () => (document.querySelector("#objective-text")?.textContent ?? "").toLowerCase().includes("counterattack"),
    null,
    { timeout: 30000 }
  );
  // fast-forward the 75 sim-second survive objective through the tracker
  // (never wall-clock: at 2 FPS 75 sim s would exceed 180 wall s)
  await page.evaluate(() => {
    const m = (window as any).__GAME.mission;
    for (let i = 0; i < 90; i++) m.tracker.update(1);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 15000 });
  await expect(page.locator("#results-title")).toHaveText("VICTORY");
});
