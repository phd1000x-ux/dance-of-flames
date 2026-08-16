# AGENTS.md

TypeScript + Babylon.js 8 browser game (WebGPU with WebGL2 fallback). No framework owns the render loop — Babylon does; DOM/CSS handles all UI.

## Commands

```bash
npm run dev            # vite dev server, port 5173 (strictPort)
npm run typecheck      # tsc --noEmit — run before any commit; build runs it too
npm run test           # vitest unit tests (tests/ only — e2e/ is excluded in vite.config.ts)
npm run test:e2e       # Playwright (e2e/); auto-starts the dev server, workers=1, no retries
npm run build          # typecheck + vite build
npm run benchmark      # headed Chrome via Playwright; needs dev server running
```

Run one unit test file: `npx vitest run tests/input.test.ts`
Run one E2E test: `npx playwright test e2e/gameplay.spec.ts -g "E2E 5"`

## Architecture invariants (learned from real bugs — do not regress)

- **Materials/textures are scene-scoped.** `DragonMaterials` caches by `WeakMap<Scene, ...>`. Never share materials across the menu showcase scene and mission scenes — disposing one scene releases GPU textures and the other scene's dragon renders invisible. `DragonRig.dispose()` releases only meshes (`dispose(false, false)`); the cache owns materials. `assertMaterialsInScene()` guards this — it throws on violation.
- **Fixed-timestep sim inside the render loop** (`GameApp.frame()`): frame time accumulates and runs `mission.update(1/60)` substeps (max 5, or 8 in testMode). Don't call `mission.update(dt)` from render frames directly.
- **Input edges are consume-on-read.** `InputState.pressed()` deletes the edge on first read; `endFrame(simRanThisFrame)` only clears when substeps ran. Zero-substep frames must not clear edges (keypresses would vanish). Both halves are required — each alone reintroduces a lost-input bug class.
- **Coordinates**: world `+Z` = south, `-Z` = north (minimap up), `+X` = east. Player forward = `(sin yaw, 0, cos yaw)`. All minimap math lives in `src/ui/MinimapMath.ts` — single source of truth; the map is north-up, only the player arrow rotates.
- **Dragon death is idempotent** (`dragonDeathHandled` guard in `MissionScene`). Any path that zeroes dragon HP is caught by the per-frame check in `update()`. Death → DRAGON FALLEN overlay → ground combat; only rider death produces DEFEAT.

## Testing quirks

- E2E runs against `?test=1` mode: exposes `window.__GAME` (test API: `api.startMission`, `api.damageDragon`, `api.killByType`, etc.) and `window.__APP` (the GameApp). `?test=1` also enables synthetic input injection (`input.injectKeyDown/injectMouse`).
- Headless Chrome uses SwiftShader (software GL, 2–6 FPS). **Never use wall-clock waits** for gameplay assertions — use `simWait()` (waits on `mission.time`, defined in `e2e/keyboard.spec.ts`) or `waitForFunction` polling game state. Timing-based tests were the main source of flakiness; the pattern is mandatory.
- Benchmarks must run **headed** (`node scripts/run-benchmark.mjs`, launches its own browser). Headless numbers are meaningless.
- Keyboard-only E2E tests (`e2e/keyboard.spec.ts`) must never call `page.mouse`. Tab keypresses go through `window.dispatchEvent` (CDP Tab retargets focus). `?keyboardOnly=1` disables mouse gameplay input entirely for manual verification.

## Adding content (data-driven — no gameplay code changes)

- New dragon: append to `src/data/dragons.ts` (stats + colors + `wingShape`). Select screen, stats bars, procedural rig, and materials pick it up automatically.
- New rider: append to `src/data/riders.ts` (includes `look`: gender/hairStyle/hairColor/skin/build/face — drives both mounted and ground figures).
- New mission: append to `src/data/missions.ts` (environment, spawns, buildings, objectives — every objective needs a `groundAlternative` so it stays completable after dragon death).

## Other gotchas

- Keyboard is the complete primary control scheme (see `src/input/InputState.ts` `DEFAULT_BINDINGS`); mouse bindings are optional alternatives on the same actions. The in-game MANUAL (`src/data/manual.ts`) renders from these bindings — a unit test keeps them in sync. Change bindings in both places or the test fails.
- Settings schema lives in `src/save/SaveSystem.ts` (`GameSettings`); new fields need defaults in `defaultSettings()` — old saves load via spread-merge, no version bump needed for additive changes.
- Audio is 100% synthesized WebAudio (`AudioManager` SFX + `MusicComposer`/`MusicSystem` original score). No audio assets exist; `THIRD_PARTY_ASSETS.md` documents this — keep it that way.
- Babylon imports must come from `@babylonjs/core` subpath (`import { X } from "@babylonjs/core"`); there is no `BABYLON` global at runtime.
- Untracked `*.png` QA screenshots at repo root are artifacts of browser verification — don't commit them intentionally (they occasionally get committed; harmless but avoid adding more).
