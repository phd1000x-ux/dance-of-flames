# ARCHITECTURE

## Stack

- **TypeScript (strict)** — zero type errors, `tsc --noEmit` is part of `npm run build`
- **Vite 6** — dev server & production bundler
- **Babylon.js 8** — 3D engine; `WebGPUEngine` when `navigator.gpu` is available, standard WebGL2 `Engine` otherwise (detected at boot in `src/engine/EngineFactory.ts`; behavior identical across renderers)
- **DOM UI** — menus/HUD are plain CSS/HTML; Babylon owns the render loop exclusively (no React)
- **IndexedDB** — save persistence with version field + migration path (memory fallback)

## Module map

```
src/
  main.ts                     boot, capability detection, __GAME test API
  app/GameApp.ts              top-level orchestrator: state machine, render loop,
                              mission lifecycle, benchmark autopilot, debug overlay
  core/
    GameState.ts              explicit enum state machine (BOOT…DEFEAT)
    EventBus.ts               typed pub/sub
    SeededRng.ts              mulberry32 deterministic RNG (loot/AI reproducibility)
    MathUtils.ts              clamp/lerp/damp/smoothstep
  engine/
    EngineFactory.ts          WebGPU→WebGL2 fallback + capability report
    PerformanceGovernor.ts    dynamic quality tiers (render scale, particles, shadows)
  data/                       pure data: dragons, riders, enemies, items(relics),
                              upgrades(shop), difficulty, missions
  player/
    PlayerState.ts            composed stats (base × rider bond × shop × relics × buffs),
                              resources, dragon/rider HP pools
    DragonController.ts       arcade flight model, states, dodge, stagger, death spiral
    RiderController.ts        ground movement, 3-hit combo, heavy, block/parry, dodge, lock-on
  camera/GameCameras.ts       DragonCamera (back-view, 28% roll, dynamic FOV) +
                              GroundCamera (shoulder, terrain clip prevention)
  combat/
    DamageCalculator.ts       armor mitigation, HP/damage/heal, FireEnergy resource
    FireSystem.ts             cone damage query + layered fire visuals + Super beam
    ProjectileSystem.ts       pooled arrows/bolts/spears with ballistic flight
  ai/EnemyManager.ts          soldiers + ballistae, LOD-tier AI scheduler
                              (tier A ≤24 full AI / B 4Hz / C 1Hz), panic/flee/burning,
                              melee telegraphs, ballistic aiming with velocity lead
  world/
    Terrain.ts                analytic height sampler + vertex-colored ground,
                              sky clouds, horizon silhouettes
    WorldBuilder.ts           mission environment + data-driven battlefield layout
    DragonRig.ts / SoldierFactory.ts / BuildingFactory.ts   procedural meshes
    BuildingSystem.ts         state-based destruction (INTACT→DAMAGED→BURNING→COLLAPSED)
    LootSystem.ts             pooled coins/flasks/buffs, magnetic attraction
    EffectsLibrary.ts         shared particle factories (budget-scaled)
  mission/
    Objectives.ts             sequential objective chain + ground conversion (pure logic)
    MissionScene.ts           per-mission runtime wiring everything together
    Scoring.ts                score + C/B/A/S rank
  progression/
    UpgradeSystem.ts          wallet + shop levels (pure logic)
    StatBlock.ts              multiplicative stat composition
  save/SaveSystem.ts          IndexedDB storage, versioned save, best-score merge
  audio/AudioManager.ts       100% synthesized WebAudio SFX + wind/fire loops
  input/InputManager.ts       bindings, pointer lock, mouse-look, test injection API
  ui/
    UIManager.ts              all DOM screens (menu, select, map, shop, pause, results, settings)
    HudController.ts          dual-mode HUD + canvas minimap + toasts + damage indicators
```

## Key design decisions

1. **Pure-logic core** — damage math, loot tables, objectives, upgrades, scoring and
   save are renderer-free modules with unit tests; Babylon types never leak into them.
2. **Data-driven content** — riders, dragons (13 stat fields each), enemies, missions,
   objectives, relics, shop items, difficulty are plain data modules; adding a rider or
   mission touches no gameplay code. Rider↔dragon pairing is data, not hardcoded — any
   rider can ride any dragon (canon pairs get a "BONDED" badge and synergy bonuses).
3. **AI LOD** — a distance-based scheduler re-tiers soldiers every 0.5s; only ≤24
   nearest run full per-frame AI, medium ring at 4Hz, far ring at 1Hz, keeping 50–60
   visible soldiers cheap.
4. **State-based destruction** — buildings swap intact→rubble meshes with dust/fire
   bursts and camera shake; no rigid-body debris.
5. **Test injection** — `InputManager` exposes `injectKeyDown/injectMouse/injectMouseMove`
   and `main.ts` exposes `window.__GAME` in `?test=1` mode, so Playwright drives the
   actual game loop (no mocks of gameplay logic).
6. **Frame budget discipline** — pooled projectiles/loot/particles, instanced trees/
   rocks, merged meshes per soldier/building, one fire light, shadow casters limited to
   player + nearby key meshes.

## Game state machine

`BOOT → MENU ⇄ CHARACTER_SELECT → MISSION_SELECT → LOADING → DRAGON_GAMEPLAY →
(DRAGON_DEATH → GROUND_GAMEPLAY)? → VICTORY|DEFEAT → SHOP → …  PAUSED overlays gameplay.`

Dragon death is a first-class transition: MissionScene runs the death spiral (2–4s),
spawns the rider at a flat crash-adjacent site, swaps cameras/HUD, and converts
incomplete objectives via `ObjectiveTracker.convertToGround()` so every mission is
completable both mounted and on foot.

## Extension points

- New dragon: append to `data/dragons.ts` (stats + colors) — select screen, stats
  bars, rig tinting and balance all pick it up automatically.
- New mission: append to `data/missions.ts` (environment, spawns, buildings, objectives
  with `groundAlternative` for each).
- Persistent relics: add a `persist` flag in `items.ts` and copy `PlayerState.relicIds`
  into `SaveData` on mission end (composition already isolates relic effects).
- Controller support: `InputManager` bindings map is a `Record<GameAction, string[]>`.
