# Game Quality Audit and Repair Implementation Plan

> **For agentic workers:** Use scoped parallel workers for independent audio, environment and character work; root integrates UI and runs end-to-end checks. User explicitly requested implementation and repair across these surfaces.

**Goal:** Repair verified gameplay/UI defects and substantially improve music and all major visual asset categories using only free or original content.

**Architecture:** Preserve Babylon's render loop, fixed timestep, consume-on-read inputs, scene-scoped materials and idempotent death. Reuse the approved free dragon/knight for higher-quality character presentation, keep procedural fallback and scene ownership. Improve existing procedural world geometry/materials with bounded draw calls rather than introduce unverified paid assets.

**Tech Stack:** TypeScript, Babylon 8.56.2, Vite, WebAudio, Vitest, Playwright.

**Spec:** User request in this session: music on/off + major music improvement; start/settings/in-game screens; background/enemies/enemy dragons/trees/castles/houses; aerial duel/ground attack/siege scenarios; correct operation. Prior constraints: free assets only, keyboard-complete, synthesized audio, no commit/push request.

## Global Constraints

- Existing uncommitted character work belongs to this session and must remain intact.
- No commits, pushes, paid assets, audio recordings or external transmissions.
- Audio remains original synthesized WebAudio, with persistent explicit music enable/disable.
- Run typecheck/build and meaningful unit/E2E regressions; use simulation state for gameplay waits.
- Browser screenshots and benchmarks are separate evidence; never call headless FPS hardware performance.
- Diagnose before repairing; record unresolved limitations rather than claim universal perfection.

## Review Focus

- Re-entering selection must show exactly the selected rider/dragon; material lifetimes survive swaps/restarts.
- Turning music off silences scheduled voices; turning on works after unlock and settings reload.
- Imported animation must not move gameplay roots, break fire origin, or put camera inside the silhouette.
- Enemy dragon attacks/death, siege progression and post-dragon-death objectives remain completable.
- More detailed geometry must respect instancing, bounded materials and draw-call budgets.

## Tasks

- [x] Audio: audit MusicSystem/Composer lifecycle, add persistent `musicEnabled` default true, improve original instruments, orchestration and transitions; audio worker owns src/audio and SaveSystem only; root owns UI wiring.
- [x] Characters: refactor approved imported assets into scene-owned reusable presentation; menu and mission/enemy dragon support, fallback/lifecycle and preview framing; character worker owns MenuShowcase and imported visual modules, coordinates root hooks.
- [x] Environment: inspect and improve terrain, trees/rocks, buildings/castle and decorative props, bounded procedural detail; environment worker owns these world modules only.
- [x] UI integration: fix stale selection and drag interception; explicit music toggle in settings and gameplay/pause; responsive start/settings/HUD behavior; root owns GameApp, UIManager, styles, main.
- [x] Combat/scenarios: run baseline unit/E2E, replay aerial/ground/siege contracts, fix demonstrated root causes in responsible modules; root coordinates ownership before shared edits.
- [x] Verification: review every worker diff, run integrated build/unit/E2E, browser menu/settings/mission swaps/music state and duel/siege/death flows on WebGPU/WebGL2; headed benchmark representative missions.
- [x] Report: document source licenses, original audio, verified changes and remaining limitations with evidence and local preview URL.
