import { test, expect, type Page } from "@playwright/test";

/**
 * Regression + new-content E2E:
 *  §7/§8  minimap direction (real keypresses + minimap canvas pixel reading)
 *  §12    dragon death (Scenario A) and true defeat (Scenario B)
 *  §90/91 castle mission completion + castle dragon-death path
 */

async function bootMission(page: Page, mission = "dragonstone") {
  await page.goto(`/?test=1&autostart=1&mission=${mission}`);
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 40000 });
  await page.waitForTimeout(1800); // shader-compile settle
}

/** read the player arrow direction + a marker blob from the minimap canvas */
async function readMinimap(page: Page) {
  return page.evaluate(() => {
    const cv = document.querySelector("#minimap") as HTMLCanvasElement;
    const ctx = cv.getContext("2d")!;
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const collect = (test: (r: number, g: number, b: number) => boolean) => {
      const pts: [number, number][] = [];
      for (let y = 0; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (test(img[i], img[i + 1], img[i + 2]) && img[i + 3] > 100) pts.push([x, y]);
        }
      return pts;
    };
    // player arrow #7ac8f0
    const arrowPts = collect((r, g, b) => Math.abs(r - 0x7a) < 12 && Math.abs(g - 0xc8) < 14 && Math.abs(b - 0xf0) < 14);
    if (!arrowPts.length) return { arrow: null };
    const cx = arrowPts.reduce((a, p) => a + p[0], 0) / arrowPts.length;
    const cy = arrowPts.reduce((a, p) => a + p[1], 0) / arrowPts.length;
    let tip = arrowPts[0];
    let td = -1;
    for (const p of arrowPts) {
      const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (d > td) {
        td = d;
        tip = p;
      }
    }
    return { arrow: { cx, cy, dx: tip[0] - cx, dy: tip[1] - cy } };
  });
}

test("minimap regression: A/D steering + arrow agreement + enemy markers (§7/§8)", async ({ page }) => {
  await bootMission(page);
  // deterministic setup: dragon at origin, yaw=0 (facing +Z), one enemy at +X (east)
  await page.evaluate(() => {
    const m = (window as any).__GAME.mission;
    const c = m.dragonCtrl;
    c.pos.set(0, 120, 0);
    c.yaw = 0;
    c.pitch = 0;
    c.roll = 0;
    const e = m.enemies.getGroundEnemies()[0];
    e.pos.set(120, e.pos.y, 0);
  });
  await page.waitForTimeout(300);

  // yaw=0 → arrow points DOWN the map (south = +Z), enemy east shows RIGHT of the arrow
  const base = await readMinimap(page);
  expect(base.arrow).not.toBeNull();
  expect(base.arrow!.dy).toBeGreaterThan(3); // pointing down
  expect(Math.abs(base.arrow!.dx)).toBeLessThan(3);

  // A → dragon turns left (toward -X): arrow rotates to point LEFT (toward west on map)
  await page.keyboard.down("a");
  await page.waitForFunction(() => (window as any).__GAME.mission.dragonCtrl.yaw < -0.3, null, { timeout: 20000 });
  await page.keyboard.up("a");
  const afterA = await readMinimap(page);
  const yawA = await page.evaluate(() => (window as any).__GAME.mission.dragonCtrl.yaw);
  expect(yawA).toBeLessThan(-0.3); // turned left in world (verified convention)
  expect(afterA.arrow!.dx).toBeLessThan(-1); // arrow tip now left-ish

  // D returns past center to the right
  await page.keyboard.down("d");
  await page.waitForFunction(
    ([target]) => (window as any).__GAME.mission.dragonCtrl.yaw > target,
    [yawA + 0.6] as any,
    { timeout: 20000 }
  );
  await page.keyboard.up("d");
  const afterD = await readMinimap(page);
  const yawD = await page.evaluate(() => (window as any).__GAME.mission.dragonCtrl.yaw);
  expect(yawD).toBeGreaterThan(yawA + 0.3);
  expect(afterD.arrow!.dx).toBeGreaterThan(1); // arrow tip right-ish

  // 360° sweep: arrow angle tracks heading continuously (no flips)
  const sweep = await page.evaluate(async () => {
    const m = (window as any).__GAME.mission;
    const c = m.dragonCtrl;
    const samples: { yaw: number; dx: number; dy: number }[] = [];
    for (let step = 0; step < 24; step++) {
      c.yaw = (step / 24) * Math.PI * 2;
      c.pitch = 0;
      c.roll = 0;
      (window as any).__GAME.app.updateHud();
      await new Promise((r) => setTimeout(r, 40));
      const cv = document.querySelector("#minimap") as HTMLCanvasElement;
      const ctx = cv.getContext("2d")!;
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const pts: [number, number][] = [];
      for (let y = 0; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          if (Math.abs(img[i] - 0x7a) < 12 && Math.abs(img[i + 1] - 0xc8) < 14 && Math.abs(img[i + 2] - 0xf0) < 14)
            pts.push([x, y]);
        }
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      let tip = pts[0];
      let td = -1;
      for (const p of pts) {
        const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
        if (d > td) {
          td = d;
          tip = p;
        }
      }
      samples.push({ yaw: c.yaw, dx: tip[0] - cx, dy: tip[1] - cy });
    }
    return samples;
  });
  for (const s of sweep) {
    // map direction from yaw: (sin yaw, cos yaw); compare with measured tip direction
    const expectDx = Math.sin(s.yaw);
    const expectDy = Math.cos(s.yaw);
    const len = Math.hypot(s.dx, s.dy) || 1;
    const dot = (s.dx / len) * expectDx + (s.dy / len) * expectDy;
    expect(dot).toBeGreaterThan(0.75); // arrow agrees with heading everywhere
  }
});

test("Scenario A: dragon death → DRAGON FALLEN overlay → ground combat (not defeat)", async ({ page }) => {
  await bootMission(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  // overlay appears within a second of death
  await page.waitForFunction(() => document.querySelector(".dragon-fallen-overlay")?.classList.contains("show"), null, { timeout: 5000 });
  const text = await page.evaluate(() => ({
    title: document.querySelector(".df-title")?.textContent,
    cta: document.querySelector(".df-cta")?.textContent,
  }));
  expect(text.title).toBe("DRAGON FALLEN");
  expect(text.cta).toBe("CONTINUE THE BATTLE ON FOOT");
  // ground mode follows; NOT a defeat
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".dragon-fallen-overlay")?.classList.contains("show"), null, { timeout: 8000 });
  const state = await page.evaluate(() => ({
    state: (window as any).__GAME.state,
    rider: !!(window as any).__GAME.mission.riderCtrl,
    music: (window as any).__GAME.app.music.currentState,
  }));
  expect(state.state).toBe("GROUND_GAMEPLAY");
  expect(state.rider).toBe(true);
  await page.waitForFunction(() => (window as any).__GAME.app.music.currentState === "ground", null, { timeout: 15000 });
});

test("Scenario B: rider death after ground mode → DEFEAT with options", async ({ page }) => {
  await bootMission(page);
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    const r = g.mission.riderCtrl;
    r.invulnerable = 0;
    // route through the real damage path (melee hit wiring)
    g.player.damageRider(99999);
    r.alive = false;
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "DEFEAT", null, { timeout: 10000 });
  await page.waitForSelector("#screen-results.visible");
  const out = await page.evaluate(() => ({
    title: document.querySelector("#results-title")?.textContent,
    buttons: [...document.querySelectorAll("#results-btns .btn")].map((b) => b.textContent),
    music: (window as any).__GAME.app.music.currentState,
  }));
  expect(out.title).toBe("DEFEAT");
  expect(out.buttons).toEqual(["RETRY", "RETURN TO MISSION SELECT", "MAIN MENU"]);
  expect(out.music).toBe("defeat");
  // keyboard: Esc-back is not a trap; Enter on focused RETRY restarts the mission
  await page.keyboard.press("ArrowDown"); // MISSION SELECT focused
  const focus = await page.evaluate(() => document.querySelector(".kb-focused")?.textContent);
  expect(focus).toBe("RETURN TO MISSION SELECT");
  await page.keyboard.press("ArrowUp"); // back to RETRY
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY", null, { timeout: 40000 });
});

test("castle mission: full phased completion → VICTORY (§90)", async ({ page }) => {
  await bootMission(page, "blackstone");
  const check = () =>
    page.evaluate(() => ({
      state: (window as any).__GAME.state,
      objective: document.querySelector("#objective-text")?.textContent,
      buildings: (window as any).__GAME.mission.buildings.buildings.length,
      ballistae: (window as any).__GAME.mission.enemies.ballistae.filter((b: any) => !b.dead).length,
      music: (window as any).__GAME.app.music.currentState,
      zone: (window as any).__GAME.mission.getAmbientZone(),
    }));
  const initial = await check();
  expect(initial.buildings).toBeGreaterThanOrEqual(12);
  expect(initial.ballistae).toBe(6);
  // adaptive music ticks at ~1 Hz of frame time (slow headless pipelines need a poll)
  await page.waitForFunction(() => (window as any).__GAME.app.music.currentState === "castle", null, { timeout: 20000 });

  // Phase 1: destroy all 6 ballistae
  await page.evaluate(() => (window as any).__GAME.api.killBallistae(6));
  await page.waitForFunction(() => (window as any).__GAME.state === "DRAGON_GAMEPLAY" && document.querySelector("#objective-text")!.textContent.includes("wall towers"), null, { timeout: 8000 });
  // Phase 2: shatter 4 wall towers
  await page.evaluate(() => (window as any).__GAME.api.collapseBuildingsWithTag("wallTower", 4));
  await page.waitForFunction(() => document.querySelector("#objective-text")!.textContent.includes("gatehouse"), null, { timeout: 8000 });
  // Phase 3: breach the gatehouse
  await page.evaluate(() => (window as any).__GAME.api.collapseBuildingWithTag("gatehouse"));
  await page.waitForFunction(() => document.querySelector("#objective-text")!.textContent.includes("courtyard"), null, { timeout: 8000 });
  // Phase 4: clear courtyard defenders
  await page.evaluate(() => (window as any).__GAME.api.killByType("soldier", 12));
  await page.waitForFunction(() => document.querySelector("#objective-text")!.textContent.includes("castellan"), null, { timeout: 8000 });
  // Phase 5: eliminate the castellan
  await page.evaluate(() => (window as any).__GAME.api.killByType("commander", 1));
  await page.waitForFunction(() => document.querySelector("#objective-text")!.textContent.includes("counterattack"), null, { timeout: 8000 });
  // Phase 6: survive the final wave (fast-forward)
  await page.evaluate(() => {
    const m = (window as any).__GAME.mission;
    for (let i = 0; i < 90; i++) m.tracker.update(1);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 15000 });
  await page.waitForSelector("#screen-results.visible");
  expect(await page.locator("#results-title").textContent()).toBe("VICTORY");
});

test("dragon never becomes invisible across scene/mission cycles (material cache poisoning)", async ({ page }) => {
  await bootMission(page, "dragonstone");
  /**
   * Root cause regression: the dragon material set was cached module-level by
   * dragon id and shared across the menu-showcase scene and mission scenes.
   * Starting a mission disposed the showcase scene (releasing the cached
   * textures' GPU resources), so the mission rig rendered dead textures —
   * mesh.isVisible true, alpha 1, body invisible while the rider stayed visible.
   * The cache is now scene-scoped; this test pins the invariant.
   */
  const audit = () =>
    page.evaluate(() => {
      const app = (window as any).__APP;
      const rig = app.mission.rig;
      const mats = [rig.materials.body, rig.materials.head, rig.materials.wing, rig.materials.accent, rig.materials.jaw];
      return {
        inScene: mats.every((m: any) => m.getScene() === app.mission.scene),
        alpha1: mats.every((m: any) => m.alpha === 1),
        gpuAlive: mats.every((m: any) => m.diffuseTexture && m.diffuseTexture._texture),
        bodyMeshesVisible: rig.root
          .getChildMeshes()
          .filter((x: any) => x.parent?.name !== "riderFigure" && x.name !== "saddle" && x.name !== "pommel" && x.name !== "strap")
          .every((x: any) => x.isVisible),
      };
    });

  // mission 1 invariants
  const m1 = await audit();
  expect(m1.inScene).toBe(true);
  expect(m1.alpha1).toBe(true);
  expect(m1.gpuAlive).toBe(true);
  expect(m1.bodyMeshesVisible).toBe(true);

  // menu (disposes the mission scene) then a second mission with another dragon
  await page.evaluate(() => (window as any).__APP.backToMenu());
  await page.waitForSelector("#screen-main-menu.visible");
  await page.evaluate(() => (window as any).__APP.startMission("riverlands", "daemon", "caraxes", "normal"));
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 40000 });
  await page.waitForTimeout(1500);
  const m2 = await audit();
  expect(m2.inScene).toBe(true);
  expect(m2.gpuAlive).toBe(true);
  expect(m2.bodyMeshesVisible).toBe(true);

  // and back to the FIRST dragon again (double-cycle)
  await page.evaluate(() => (window as any).__APP.backToMenu());
  await page.waitForSelector("#screen-main-menu.visible");
  await page.evaluate(() => (window as any).__APP.startMission("dragonstone", "rhaenyra", "syrax", "normal"));
  await page.waitForFunction(() => (window as any).__GAME?.mission?.phase === "dragon", null, { timeout: 40000 });
  await page.waitForTimeout(1500);
  const m3 = await audit();
  expect(m3.gpuAlive).toBe(true);
  expect(m3.bodyMeshesVisible).toBe(true);

  // death transition: dragon corpse stays visible (only mounted-rider group hides)
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(-200, 40, -200);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 30000 });
  const ground = await page.evaluate(() => {
    const app = (window as any).__APP;
    const rig = app.mission.rig;
    // mounted-rider group = anything under riderFigure (incl. saddle mounted on it)
    const inRiderGroup = (x: any) => {
      let p = x.parent;
      while (p && p !== rig.root) {
        if (p.name === "riderFigure") return true;
        p = p.parent;
      }
      return ["saddle", "pommel", "strap"].includes(x.name);
    };
    return {
      corpseVisible: rig.root.getChildMeshes().filter((x: any) => !inRiderGroup(x)).every((x: any) => x.isVisible),
      groundRiderVisible: app.mission.riderCtrl.figure.root.getChildMeshes().filter((x: any) => x.name !== "g-bodyProxy").every((x: any) => x.isVisible),
    };
  });
  expect(ground.corpseVisible).toBe(true);
  expect(ground.groundRiderVisible).toBe(true);
});

test("castle mission: dragon death → ground continuation → VICTORY (§91)", async ({ page }) => {
  await bootMission(page, "blackstone");
  // force dragon death near the gate approach
  await page.evaluate(() => {
    const g = (window as any).__GAME;
    g.mission.dragonCtrl.pos.set(0, 45, 300);
    g.api.damageDragon(99999);
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "GROUND_GAMEPLAY", null, { timeout: 30000 });
  // objectives converted to ground alternatives
  const converted = await page.evaluate(() => document.querySelector("#objective-text")?.textContent);
  expect(converted?.length).toBeGreaterThan(5);
  expect(converted).not.toContain("Silence the outer ballistae");
  // drive the converted chain in order until victory (kills + survive waves + commander)
  await page.evaluate(async () => {
    const g = (window as any).__GAME;
    const m = g.mission;
    for (let guard = 0; guard < 40 && g.state !== "VICTORY"; guard++) {
      const cur = m.tracker.current();
      if (!cur) break;
      if (cur.type === "kill") {
        const t = cur.targetType === "commander" ? "commander" : "soldier";
        g.api.killByType(t, cur.count ?? 1);
      } else if (cur.type === "survive") {
        for (let i = 0; i < (cur.seconds ?? 10) + 2; i++) m.tracker.update(1);
      } else if (cur.type === "destroy") {
        g.api.collapseBuildingsWithTag(cur.targetTag ?? "house", cur.count ?? 1);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForFunction(() => (window as any).__GAME.state === "VICTORY", null, { timeout: 15000 });
  await page.waitForSelector("#screen-results.visible");
  const survived = await page.evaluate(() => (window as any).__GAME.mission.stats.dragonSurvived);
  expect(survived).toBe(false);
});
