#!/usr/bin/env node
/**
 * Headed ground-combat benchmark for the imported-character path: dismount,
 * crowd the riverlands soldiers around the knight, measure frame times.
 * Needs the dev server. Usage: node scripts/bench-ground.mjs [seconds=15]
 *   variants: mocap (imported characters + mocap soldiers) vs procedural (test=1 only)
 */
import { chromium } from "@playwright/test";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=")));
const seconds = Number(args.seconds ?? 15);
const base = args.url ?? "http://localhost:5173";

const browser = await chromium.launch({
  headless: false,
  // uncap from display vsync so the number reflects headroom, not the monitor
  args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--enable-unsafe-webgpu"],
});

async function run(label, query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/?test=1${query}`);
  await page.waitForFunction(() => window.__GAME?.api, undefined, { timeout: 90000 });
  await page.evaluate(() => window.__GAME.api.startMission("rhaenyra", "syrax", "riverlands"));
  await page.waitForFunction(() => window.__GAME?.mission?.time > 0.5, undefined, { timeout: 90000 });
  if (query.includes("characters=1")) await page.waitForFunction(() => window.__CHARACTER_PROTOTYPE?.enabled === true, undefined, { timeout: 90000 });
  await page.evaluate(() => {
    const m = window.__GAME.mission;
    const p = m.dragonCtrl.pos.clone(); p.y = m.world.terrain.heightAt(p.x, p.z);
    m.scriptedDismount(p);
    const c = m.riderCtrl; c.invulnerable = 1e9;
    document.getElementById("character-prototype-panel")?.remove();
    // everyone alive within 6–25m, in a ring the camera sees
    m.enemies.soldiers.filter(s => s.state !== "dead").forEach((s, i) => {
      const a = i * 2.39996, d = 6 + (i % 7) * 3;
      s.pos.set(c.pos.x + Math.sin(a) * d, 0, c.pos.z + Math.cos(a) * d);
      s.pos.y = m.world.terrain.heightAt(s.pos.x, s.pos.z);
      s.root.position.copyFrom(s.pos);
    });
  });
  await page.waitForTimeout(4000); // puppet assignment + shader warmup
  const r = await page.evaluate(async (sec) => {
    const times = [];
    let last = performance.now();
    const end = last + sec * 1000;
    await new Promise(res => {
      const tick = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const pct = q => times[Math.min(times.length - 1, Math.floor(times.length * q))];
    return {
      fps: +(1000 / avg).toFixed(1), p50ms: +pct(0.5).toFixed(2), p95ms: +pct(0.95).toFixed(2), p99ms: +pct(0.99).toFixed(2),
      frames: times.length,
      puppets: window.__SOLDIER_VISUALS?.assigned ?? 0,
      mocap: window.__SOLDIER_VISUALS?.puppets().filter(p => p.mocap).length ?? 0,
      engine: window.__APP?.engine?.constructor?.name ?? "?",
    };
  }, seconds);
  console.log(`${label.padEnd(12)} ${JSON.stringify(r)}`);
  await page.close();
}

await run("mocap", "&characters=1");
await run("procedural", "");
await browser.close();
