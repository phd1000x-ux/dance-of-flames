# Game Quality Audit — Completion Report (2026-10-24)

Executes and closes `2026-10-24-game-quality-audit.md`. All constraints honored:
no commits/pushes (work sits uncommitted on `main` — committing is the user's
call), free/original assets only, 100% synthesized audio, keyboard-complete.

## Verification evidence

| Check | Result |
|---|---|
| `npm run typecheck` | clean (tsc --noEmit) |
| `npm run test` (vitest) | **220/220 pass**, 24 files, 2.31s |
| `npm run test:e2e` (Playwright, chromium, workers=1) | **32/32 pass**, 10.4m |
| headed benchmark (`node scripts/run-benchmark.mjs`, riverlands 30s) | EXIT=0, WebGPU |

Benchmark (headed, WebGPU, quality tier 0, 36 NPCs, hardware scaling 1):
average **120 fps** (vsync-capped), p5 111, p1 108, avg frame 8.33ms,
max frame **11.5ms**.

Prior-session comparison run (20s): 109 avg fps, max frame **1356.8ms** —
the startup stall is gone and average fps improved to the vsync cap.

The previously failing E2E (`quality.spec.ts` "music toggle persists,
settings agrees, and M toggles during gameplay") is green in this run.

Combat/flight repair contracts and their RED→GREEN evidence are documented in
`.superpowers/brainstorm/5041-1792844479/gameplay-repairs.md` (ground
projectiles → `RiderController.takeHit`, shieldbreaker attack kind,
`CastellanDuel.syncHp`, WarDragon 3D fire cone, ground-lock rebinding,
`SolidCollision` flight sweeps vs. architecture, EventBus duplicate-damage
accounting fix).

## Verified changes by area

- **Audio**: persistent `musicEnabled` setting (default on), MUSIC ON/OFF
  toggle in menu and gameplay (`M` key), settings screen agreement, IndexedDB
  persistence across reload; orchestration/transitions improved. Covered by
  `tests/musicSystem.test.ts`, `tests/audioLifecycle.test.ts`, `tests/music.test.ts`,
  and `e2e/quality.spec.ts:42`.
- **Characters**: opt-in CC BY 4.0 prototype (`?characters=1`, 17MB GLBs) with
  scene-owned reusable presentation, procedural fallback preserved, preview
  framing and selection-lifecycle covered by `tests/character-assets.test.ts`,
  `tests/dragon-camera.test.ts`, and the selection-preview/drag E2E tests.
- **Environment**: terrain, trees/rocks, buildings/castle, props improved with
  bounded procedural detail; `tests/scenery.test.ts` (6) green.
- **Combat/scenarios**: the repairs listed above; covered by
  `tests/combat-regressions.test.ts`, `tests/flight-collision.test.ts`, and the
  gameplay/regression/siege/blackstone-finale/finale3 E2E suites (aerial duel,
  ground attack, siege, dragon-death → ground continuation all pass).
- **UI**: stale-selection and drag-interception fixes verified by
  `quality.spec.ts` tests 1–2; continue/Escape flow verified by test 4.

## Source licenses & original audio

- Exactly two third-party models, both CC BY 4.0: `public/character-prototype/dragon.glb`
  (Animated Dragon Three Motion Loops, LasquetiSpice) and `knight.glb`
  (Strong Knight, DJMaesen), via Ai2's Objaverse distribution, retrieved
  2026-10-24; full attribution, download URLs and SHA256 hashes in
  `THIRD_PARTY_ASSETS.md` + `public/character-prototype/sources.json`.
- All SFX and the full soundtrack (menu/exploration/combat/castle/ground/
  stinger/victory/defeat cues) are original runtime WebAudio synthesis — no
  recordings, no HBO/GRRM assets. Noncommercial fan project (PolyForm
  Noncommercial, see `LICENSE`).

## Remaining limitations

- Knight running/attack motions are code-authored skeletal poses, not
  downloaded motion capture (documented in `THIRD_PARTY_ASSETS.md`).
- The character prototype stays opt-in; the default game is fully procedural.
- Benchmark numbers are one headed run on this machine — evidence, not a
  hardware performance claim (headless/SwiftShader numbers were never used).
- All work is uncommitted on `main` per the plan's no-commit constraint;
  review the diff and commit when ready.

## Local preview

- Game: http://localhost:5173 (dev server, HTTP 200 verified)
- Character prototype: http://localhost:5173/?characters=1
- Test mode: `?test=1` · keyboard-only check: `?keyboardOnly=1`
