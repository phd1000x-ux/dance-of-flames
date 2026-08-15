# DANCE OF FLAMES: DRAGONRIDER

A third-person 3D dragon-combat action game for the browser, inspired by the world,
factions and atmosphere of the Dance of the Dragons civil war (fan project — no
copyrighted assets; everything is procedurally generated at runtime).

Ride a dragon over a war-torn battlefield, breathe fire on armies, raze fortifications,
loot coins and hidden relics, buy upgrades — and if your dragon falls, keep fighting
on foot with a sword until the mission is done.

## System Requirements

- **Target platform**: MacBook M1, latest Google Chrome (WebGPU renderer)
- Also runs in any Chromium browser with WebGL2 (automatic fallback)
- ~1.4 GB free disk for `node_modules`

## Node Version

Node.js 18+ (developed and verified on Node 24 LTS, npm 11).

## Installation

```bash
npm install
```

## Development Mode

```bash
npm run dev
```

Open http://localhost:5173 in Chrome.

First launch shows the main menu. `NEW CAMPAIGN` (or `BATTLE`) → pick rider & dragon →
`CONFIRM` → pick a mission + difficulty → `LAUNCH`.

> Tip: click once inside the game window to lock the mouse for flight controls.
> `Esc` pauses and releases the cursor.

## Production Build

```bash
npm run build     # typecheck + vite build → dist/
npm run preview   # serve the production build at http://localhost:4173
```

Chrome launch for a final smoke test:

```bash
npm run build && npm run preview
open -a "Google Chrome" http://localhost:4173
```

## Controls

### Dragon flight

| Key | Action |
|-----|--------|
| `W` / `S` | Accelerate / decelerate |
| `A` / `D` | Bank + turn |
| Mouse | Steer (pitch & yaw) |
| `Space` / `Ctrl` | Climb / descend (strongest in hover) |
| `Shift` | Boost |
| Left Click | Fire breath (uses fire energy) |
| Right Click | Focus/aim |
| `Q` | Barrel dodge (brief invulnerability) |
| `R` | Super Charge beam (when meter is full) |
| `E` | Use healing flask / consumable |
| `Tab` | Objectives |
| `Esc` | Pause |
| `F3` | Debug overlay (dev builds) |

### Rider on foot (after dragon death)

| Key | Action |
|-----|--------|
| `WASD` | Move (camera-relative) |
| Mouse | Shoulder camera |
| Left Click | Light attack (3-hit combo) |
| `Q` | Heavy attack (breaks shields) |
| Right Click | Block / parry (first 0.22s = parry) |
| `Space` | Dodge roll (i-frames) |
| `Shift` | Sprint |
| `F` | Soft lock-on toggle |
| `E` | Use healing flask |

## Game Rules

- **Mission flow**: each mission is a chain of objectives (burn troops, raze
  buildings, destroy ballistae, kill commanders, survive counterattacks).
- **Fire energy**: fire breath drains a meter (~5s continuous, ~4–7s recharge).
  After a full depletion you must recover 20% before re-igniting.
- **Super Charge**: fills from kills, destruction and time. `R` unleashes a
  devastating forward beam (13–16s cooldown by dragon).
- **Hidden relics**: specific buildings contain dragon upgrades — collected
  instantly on destruction (+15% fire damage, +30% armor, lifesteal, etc.).
- **Loot**: soldiers drop coins (magnetic pickup) and healing flasks (instant
  heal, no inventory).
- **Dragon death is not the end**: the mission converts its remaining objectives
  so it can always be completed on foot (kill squads / survive / reach victory).
- **Economy**: coins persist between missions; spend them in the Armory shop
  (dragon & rider stat upgrades, consumable charges). Prices 50/120/250/500.
- **Score & ranks**: C/B/A/S based on kills, destruction, relics, damage taken,
  time, and whether your dragon survived.

## Graphics Settings

Settings → Graphics Preset:

- `LOW` — reduced particles, shadows off, 1.5× hardware scaling
- `MEDIUM` — balanced
- `HIGH` — full quality
- `AUTO` (default) — dynamic PerformanceGovernor adjusts render scale,
  particle budget and shadows to hold 60 FPS

Also: camera-shake slider, speed-blur toggle, mouse sensitivity, invert-Y,
master/effects volume, FPS display. Settings persist via IndexedDB.

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md). Summary: TypeScript + Vite + Babylon.js 8
(WebGPU with automatic WebGL2 fallback), pure-logic simulation modules with unit
tests, DOM-based UI (no framework owns the render loop), data-driven riders /
dragons / enemies / missions / upgrades, IndexedDB save system.

## Testing

```bash
npm run test        # 65 unit tests (vitest) — combat, loot, upgrades, objectives, save, scoring
npm run test:e2e    # 7 Playwright browser tests — all six required gameplay flows + console cleanliness
npm run typecheck   # strict TypeScript, zero errors
```

The E2E suite boots the real game in Chromium with a test-input API
(`?test=1`) and verifies: menu flow, kill→coin→counter, healing pickup,
building→relic→stat-up, dragon-death→ground-combat→sword kill, victory→shop
purchase, and that the console stays error-free during combat.

## Performance Benchmark

```bash
npm run dev                      # in one terminal (server)
npm run benchmark                # in another — 30s scripted stress run
npm run benchmark -- mission=harrenhal seconds=20
```

Launches headed Chrome (real GPU), flies and fires automatically through the
mission, and prints: renderer, average FPS, 5th/1st percentile FPS, max frame
time, active NPC count, quality tier. Results on the reference machine are in
[PERFORMANCE.md](PERFORMANCE.md).

## Asset Licenses

All assets (3D meshes, textures, particles, UI, sounds) are **generated
procedurally at runtime** — no external art or audio files. Details:
[THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).

## Known Limitations

- Placeholder low-poly procedural dragons/soldiers (silhouette-first art)
- Rider ground combat is deliberately arcade-shallow (no stamina-gated combos)
- Relic upgrades last for the current mission (architecture supports persistence)
- One save slot per browser profile
- WebGL2 fallback is fully playable but slower than WebGPU on large battles

## Credits & Legal

Fan-made battle simulator. Not affiliated with, endorsed by, or reproducing any
asset from HBO's *House of the Dragon* or GRRM's works. Built with Babylon.js
(Apache-2.0), TypeScript, Vite, WebAudio.
