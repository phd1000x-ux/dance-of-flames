import { test, expect, type Page } from "@playwright/test";

// The shipped game renders the imported GLB dragon + knight, but every other
// E2E runs ?test=1 with procedural characters. ?characters=1 opts test mode into
// the real asset path so a broken GLB load cannot hide behind a silent fallback.

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

/** enabled-in-hierarchy mesh counts under a named root, plus the procedural rig's */
function visuals(page: Page) {
  return page.evaluate(() => {
    const proto = (window as any).__CHARACTER_PROTOTYPE;
    const mission = proto.mission;
    const count = (root: any) => root.getChildMeshes().filter((m: any) => m.isEnabled() && m.getTotalVertices() > 0).length;
    return {
      phase: mission.phase,
      dragon: count(proto.dragon.root),
      mounted: count(proto.mounted.root),
      ground: count(proto.ground.root),
      procedural: mission.rig.root.getChildMeshes().filter((m: any) => m.isEnabled() && !m.name.startsWith("prototype-")).length,
      groundOnFigure: !!mission.riderCtrl && proto.ground.root.parent === mission.riderCtrl.figure.body,
      fireFromGlbHead: mission.rig.headTip.parent?.name.startsWith("prototype-dragon:") ?? false,
    };
  });
}

test("imported GLB characters render through menu, flight, ground and remount", async ({ page }) => {
  const fallbacks: string[] = [];
  page.on("console", (msg) => {
    if (/procedural fallback|character fallback|soldiers\]/i.test(msg.text())) fallbacks.push(msg.text());
  });
  await page.goto("/?test=1&characters=1");

  // menu showcase swaps its procedural rig for the imported models
  await page.waitForFunction(() => (window as any).__APP?.showcase?.imported != null, undefined, { timeout: 90000 });
  const menu = await page.evaluate(() => {
    const imported = (window as any).__APP.showcase.imported;
    const n = (root: any) => root.getChildMeshes().filter((m: any) => m.isEnabled()).length;
    return { dragon: n(imported.dragon.root), knight: n(imported.knight.root) };
  });
  expect(menu.dragon).toBeGreaterThan(0);
  expect(menu.knight).toBeGreaterThan(0);

  await page.evaluate(() => (window as any).__GAME.api.startMission("rhaenyra", "syrax", "riverlands"));
  await page.waitForFunction(() => (window as any).__CHARACTER_PROTOTYPE?.enabled === true, undefined, { timeout: 90000 });
  await simWait(page, 0.5);

  const flight = await visuals(page);
  expect(flight.phase).toBe("dragon");
  expect(flight.dragon).toBeGreaterThan(0);
  expect(flight.mounted).toBeGreaterThan(0);
  expect(flight.ground).toBe(0);
  expect(flight.procedural).toBe(0);
  expect(flight.fireFromGlbHead).toBe(true);

  await page.evaluate(() => {
    const mission = (window as any).__CHARACTER_PROTOTYPE.mission;
    const p = mission.dragonCtrl.pos.clone();
    p.y = mission.world.terrain.heightAt(p.x, p.z);
    mission.scriptedDismount(p);
  });
  await simWait(page, 0.5);
  const ground = await visuals(page);
  expect(ground.phase).toBe("ground");
  expect(ground.ground).toBeGreaterThan(0);
  expect(ground.groundOnFigure).toBe(true);
  expect(ground.mounted).toBe(0);

  // the hero's downloaded axe replaces its stand-in and rides the right wrist
  await page.waitForFunction(() => (window as any).__CHARACTER_PROTOTYPE.mission.scene.meshes
    .some((m: any) => m.name.startsWith("prototype-axe:") && m.isEnabled() && m.getTotalVertices() > 0), undefined, { timeout: 30000 });
  const axe = await page.evaluate(() => {
    const scene = (window as any).__CHARACTER_PROTOTYPE.mission.scene;
    let n = scene.meshes.find((m: any) => m.name.startsWith("prototype-axe:"));
    while (n && !n.name.includes("R_wrist_")) n = n.parent;
    return { onWrist: !!n, standIn: scene.meshes.filter((m: any) => /^prototype-axe-(haft|head)$/.test(m.name)).length };
  });
  expect(axe).toEqual({ onWrist: true, standIn: 0 });

  // retargeted Mixamo clips take over from the procedural animator
  await page.waitForFunction(() => (window as any).__CHARACTER_PROTOTYPE.mocap === true, undefined, { timeout: 30000 });

  // nearby soldiers are drawn as animated imported knights, their blocky mesh hidden
  await page.evaluate(() => {
    const mission = (window as any).__CHARACTER_PROTOTYPE.mission;
    const rider = mission.riderCtrl;
    const s = mission.enemies.soldiers.find((x: any) => x.state !== "dead");
    s.pos.set(rider.pos.x + 6, rider.pos.y, rider.pos.z + 6);
    s.root.position.copyFrom(s.pos);
  });
  await page.waitForFunction(() => (window as any).__SOLDIER_VISUALS?.assigned > 0, undefined, { timeout: 30000 });
  const soldiers = await page.evaluate(() => (window as any).__SOLDIER_VISUALS.puppets());
  expect(soldiers.length).toBeGreaterThan(0);
  for (const s of soldiers) {
    expect(s.visible).toBe(true);
    expect(s.procedural).toBe(false);
    expect(s.mocap).toBe(true);
  }

  await page.evaluate(() => (window as any).__CHARACTER_PROTOTYPE.mission.remountDragon());
  await simWait(page, 0.5);
  const remounted = await visuals(page);
  expect(remounted.phase).toBe("dragon");
  expect(remounted.dragon).toBeGreaterThan(0);
  expect(remounted.mounted).toBeGreaterThan(0);
  expect(remounted.ground).toBe(0);
  expect(remounted.procedural).toBe(0);

  expect(fallbacks).toEqual([]);
});
