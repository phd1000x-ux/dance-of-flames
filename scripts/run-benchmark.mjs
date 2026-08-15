#!/usr/bin/env node
/**
 * Performance benchmark: launches the game in headed Chrome (real GPU),
 * runs the scripted stress scenario (fire, troops, ballistae, buildings),
 * and prints the measured report.
 *
 * Usage: npm run benchmark [-- mission=harrenhal seconds=30]
 * Set BENCH_HEADLESS=1 for CI (SwiftShader — not representative of real hardware).
 */
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.split("=")).map(([k, v]) => [k, v])
);
const mission = args.mission ?? "riverlands";
const seconds = Number(args.seconds ?? 30);
const base = args.url ?? "http://localhost:5173";
const headless = process.env.BENCH_HEADLESS === "1";

const browser = await chromium.launch({ headless });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.text().includes("[benchmark]")) console.log(msg.text());
});
console.log(`[benchmark] launching ${mission} for ${seconds}s (${headless ? "headless" : "headed"})…`);
await page.goto(`${base}/?benchmark=1&test=1&mission=${mission}&seconds=${seconds}&rider=daemon&dragon=caraxes`);

const result = await page.waitForFunction(() => window.__BENCH, null, { timeout: (seconds + 60) * 1000 });
const report = await result.jsonValue();

// recompute honest percentiles from the raw frame times captured in-page
const recomputed = await page.evaluate(() => {
  const app = window.__GAME.app;
  const times = app ? [...app.benchFrameTimes] : [];
  times.sort((a, b) => a - b);
  if (!times.length) return null;
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    frames: times.length,
    averageFps: Math.round(1000 / avg),
    p5Fps: Math.round(1000 / q(0.95)), // fps exceeded 95% of the time
    p1Fps: Math.round(1000 / q(0.99)),
    maxFrameMs: +times[times.length - 1].toFixed(1),
    avgFrameMs: +avg.toFixed(2),
  };
});

console.log("\n===== BENCHMARK RESULT =====");
const merged = { ...report, ...(recomputed ?? {}) };
for (const [k, v] of Object.entries(merged)) console.log(`${k}: ${v}`);
await browser.close();
process.exit(0);
