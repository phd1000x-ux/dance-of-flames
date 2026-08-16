# The Blackstone Citadel — AAA Finale: Design Spec (Slice 1 of 3)

Date: 2026-08-16
Status: Approved design for Slice 1; Slices 2–3 planned
Source prompt: "The Blackstone Citadel — AAA Finale Master Implementation Prompt" (95 sections)

## 0. Context and decomposition

The master prompt transforms the final mission ("The Blackstone Citadel") into a
cinematic siege finale. The full scope (~13 mission phases, war-dragon aerial boss,
chase, spire crash, checkpoints, layered audio, perf work) is too large for a single
implementation pass. Per the prompt's own vertical-slice mandate (§81–83) the work is
decomposed into three slices, each shipped as a fully playable, fully tested increment:

1. **Slice 1 — Boss vertical slice** (this spec): courtyard → castellan ground duel →
   40% HP transition → war-dragon reveal → mount/remount → short chase → one aerial
   attack pattern → resolution → existing 75 s final assault → VICTORY.
2. **Slice 2 — Siege vertical slice**: ballista siege feel, tower damage states,
   tower collapse gameplay consequences, gatehouse breach hero moment, fortress
   landmark scale, 8 distinct tower identities, battlefield density/ambient battle.
3. **Slice 3 — Integration and polish**: full aerial pattern library + combos, chase
   events, return-to-citadel, spire final crash, final assault escalation, war horn,
   phase-based checkpoints (rebuild + destruction-state reapply), spatial audio,
   war-dragon damage states, performance reservation.

### Decisions made with the human partner

- Vertical-slice order approved (boss first).
- Dismount/remount for the castellan duel is **mission-scripted** (no free-form
  dismount system; other missions unaffected).
- Checkpoints = **phase-level restore** via deterministic rebuild + re-applied
  destruction state (Slice 3).
- Slice 1 dragon-death policy: **survivor path first**. Dragon dead before/during the
  finale → current behavior (castellan killable normally, no war dragon, mission
  completable on foot). The §43 ballista ground-route convergence lands in Slice 3.
- Architecture: **Approach A — Finale Orchestrator** (small blackstone-scoped
  controllers; `MissionScene.phase` stays 4-valued).

### Repository analysis summary (what exists and is preserved)

Already present — do NOT rebuild:
- Distance-based AI tiering (`EnemyManager.reassignTiers`, 0.5 s, tiers 0/1/2).
- Dynamic FOV (66→82), camera roll 28%, hierarchical shake with distance falloff.
- Cello+violin adaptive score, 9 music states, bar-boundary transitions.
- Defeat popup + exact button set pinned by E2E (Scenario B).
- Dragon material scene-scoping (`WeakMap` cache + `assertMaterialsInScene`) and the
  visibility regression test.
- Full keyboard playability (`?keyboardOnly=1` proof mode).
- Minimap north-up conventions + unit/E2E regression tests.
- Projectile pooling (90 slots), PerformanceGovernor quality tiers, prop distance
  culling.
- Deterministic seeded world generation (rebuild+reapply checkpoint strategy viable).
- Wall-clock fallback pattern for staged sequences (dragon death sequence).

Core gaps (all new work):
- Extended finale phase machine (13 conceptual phases vs current 4 sim modes).
- War dragon (Vharax): rig variant, armor, boss flight AI, attack patterns.
- Castellan boss patterns + 40% transition lock.
- Player dismount/remount (one-way `dragon→dying→ground` today).
- Chase, aerial duel, resolution.
- Event-type objectives; boss HP bar; subtitle bar; new SFX/music states.

Structural constraints honored:
- Objective tracker is strictly sequential, head-only progress — maps 1:1 to the
  finale stage chain.
- E2E runs at 2–6 FPS (SwiftShader): every staged sequence needs a wall-clock bound;
  tests use sim-clock waits and a finale phase-skip test API.
- E2E pins: defeat buttons (Scenario B), groundAlternative completeness
  (`tests/scoring.test.ts`), castle completion paths (§90/§91).

## 1. Architecture

### 1.1 New files (`src/mission/blackstone/`)

| File | Responsibility |
|---|---|
| `FinalePhases.ts` | `FinalePhase` enum + legal-transition table + guard helpers. Pure logic, unit-tested. |
| `BlackstoneFinale.ts` | Orchestrator: owns current `FinalePhase`, advances the scripted sequence, wall-clock bounds per stage, emits objective/music/HUD events. One responsibility: sequencing. |
| `CastellanBoss.ts` | Ground boss: puppets the claimed commander `Soldier`, attack patterns, 40% HP clamp + single-fire transition trigger, death short-circuit. |
| `WarDragon.ts` | Aerial boss: own light flight integrator (waypoint steering, banking), attack state machine, flame sweep damage in/out, fail-safes, rig + armor + fire VFX ownership. |

### 1.2 Modified files

| File | Change |
|---|---|
| `src/mission/MissionScene.ts` | Construct `BlackstoneFinale` for `blackstone`; `finale.update(dt)` hook in `update()`; new `scriptedDismount()` / `remountDragon()` methods (mode + camera + rider lifecycle, NO `convertToGround` on dismount). |
| `src/mission/Objectives.ts` | `ObjectiveDef.type` gains `"event"` with `event?: string`; `notifyEvent(eventId)` completes the current objective on match. |
| `src/data/missions.ts` | Blackstone objective chain rewritten (§2.2). |
| `src/player/PlayerState.ts` | Mode restoration entry (used only by `remountDragon`). |
| `src/app/GameApp.ts` | Reverse mirroring `GROUND_GAMEPLAY → DRAGON_GAMEPLAY` when `mission.phase` returns to `"dragon"`; music state events from finale. |
| `src/ai/EnemyManager.ts` | `claimCommander(): Soldier | null` + `puppeted` flag that skips generic AI for that soldier. |
| `src/world/DragonRig.ts` | Optional `bulk` proportion param (chest/neck girth, default 1); `buildWarArmor()` overlay (~8 meshes: head plate, 3 neck rings, chest plate, saddle+chains). |
| `src/world/DragonMaterials.ts` | Expose grime/scar intensity knobs; build "vharax" material set (own id → own cache entry, scene-scoped). |
| `src/data/wardragon.ts` (new) | VHARAX definition: DragonDefinition-compatible stats/visuals (scale 2.2, charred palette, torn membrane wingShape, bulk 1.25). |
| `src/world/CastleBuilder.ts` | Minimal spire: north tower taller + darker (reveal framing only; full 8 identities in Slice 2). |
| `src/ui/HudController.ts` | Boss HP bar (name + bar), cinematic subtitle bar, objective stinger animation class. |
| `src/audio/AudioManager.ts` | `deepRoar`, `inhale`, `wingBuffet`, `bossHit`. |
| `src/audio/MusicComposer.ts` | `chase` (fast violin ostinato) and `boss` states via existing config structure. |
| `src/main.ts` | Test API: `setCastellanHp`, `getFinale`, `warDragon` state getter, `forceLand`, `setFinalePhase` (skip). |

### 1.3 Phase model

Sim level (unchanged): `MissionScene.phase ∈ {dragon, dragonDying, ground, ended}`.
Finale level (new): `FinalePhase ∈ {INACTIVE, AWAIT_LANDING, DUEL_GROUND, TRANSITION,
REVEAL, MOUNT, REMOUNT, CHASE, DUEL_AIR, RESOLVED}`.

- One authoritative `FinalePhase` on `BlackstoneFinale`; systems react to transitions.
- Transitions are table-validated and idempotent (guard flags, `dragonDeathHandled`
  pattern). Illegal transitions throw in dev/test, are ignored in production.
- The finale drives sim-level mode via `scriptedDismount()` / `remountDragon()` only.

## 2. Gameplay flow (Slice 1)

### 2.1 Stage-by-stage

1. **AWAIT_LANDING** (after `bs-courtyard` completes): objective gate "land to face
   the castellan". Trigger: dragon altitude < 3 m, speed < 10, within courtyard
   radius. Then `scriptedDismount()`: rider spawns beside the parked dragon; dragon
   remains visible, parked (no dragon update in ground phase; projectiles target the
   rider in ground mode, so the parked dragon is naturally ignored).
2. **DUEL_GROUND**: `CastellanBoss` activates. Patterns:
   - Heavy combo: slash → slash → delayed heavy (extends existing `meleeWindup`
     telegraph: red emissive).
   - Shield breaker: unblockable heavy, orange emissive telegraph (guard-punisher).
   - Javelin throw: strong anticipation anim + audio.
   - Reinforcement command: once, at ~70% HP — 4 nearby courtyard defenders aggro.
   - **40% floor**: incoming damage clamps at `0.4 × maxHp`. The first player hit at
     the floor fires TRANSITION exactly once (`transitionTriggered` guard).
   - Dragon-dead path: no clamp, no reveal — castellan is killable (current
     behavior).
3. **TRANSITION/REVEAL** (~10–12 s, each sub-stage wall-clock bounded):
   player hit → castellan block + sparks + player pushback → subtitle "You came here
   riding a dragon." → "Did you think you were the only one?" → deep roar + shadow
   sweep across courtyard + ≤12 nearby soldiers look up → Vharax rises behind the
   keep (dust burst, shake 1.0, camera bias ~2.5 s, player control retained).
4. **MOUNT** (~2.8 s): castellan root animated along authored path (run → keep
   stairs → leap arc → saddle).
5. **REMOUNT**: rider returns to parked dragon; `remountDragon()` restores
   `phase="dragon"`, `DRAGON_GAMEPLAY`, dragonCam; take-off (speed 20, nose up).
   Player control immediate.
6. **CHASE**: Vharax follows an authored waypoint loop (keep → spire → west wall →
   gate → outer cliff → open sky), one full loop in Slice 1. Rubber-banding: target
   separation 60–90 m; beyond → boss −10% speed; inside → +10%. Fail-safes: >250 m
   behind for >8 s → boss circles to wait; never despawns.
7. **DUEL_AIR**: boss SM `POSITION → SELECT → TELEGRAPH → ATTACK → RECOVERY`.
   Slice 1 pattern: **flame sweep** — telegraph 1.1 s (head-pullback pose, jawHeat
   mouth glow, inhale SFX) → 1.4 s sweeping flame cone (damage ticks vs player
   dragon capsule) → 2.2 s recovery window. Player damage-out: fire breath cone and
   super beam extended to test the Vharax capsule. HP floor 40% → RESOLVED.
8. **RESOLVED**: Vharax breaks off, flees (despawn past fog after 6 s). Existing
   `bs-final` 75 s survive → VICTORY (unchanged).

### 2.2 Objective chain (data-driven)

```
bs-ballistae → bs-breach → bs-gate → bs-courtyard          (unchanged, existing 4)
→ bs-castellan "Defeat the Castellan in single combat"     event: castellan-transition
                                                            groundAlt: kill commander
→ bs-pursue    "Pursue the Castellan"                       event: chase-complete
                                                            groundAlt: survive 30
→ bs-vharax    "Defeat Vharax, the War Dragon"              event: vharax-resolved
                                                            groundAlt: survive 30
→ bs-final     survive 75 s                                 (unchanged)
```

- `ObjectiveTracker.notifyEvent(eventId)` completes **every incomplete matching event
  objective in the chain** (not just the head): the castellan-death short-circuit must
  work regardless of where the chain pointer sits when he dies.
- **Death short-circuit**: if the castellan dies at any time (dragon-dead path,
  anomaly), `bs-castellan`/`bs-pursue`/`bs-vharax` complete immediately — the
  existing §90 E2E (killByType commander) passes unchanged and the mission can never
  dead-end.
- Dragon death mid-finale: existing `convertToGround()` runs; `bs-pursue`/`bs-vharax`
  are **event objectives WITHOUT groundAlternative** — the tracker's sanctioned
  splice-out path removes them (they are aerial-spectacle-only and meaningless on
  foot). The ground chain therefore remains exactly today's: courtyard-alt →
  castellan-alt (kill commander) → final-alt (survive 60) — preserving §91 E2E
  timing. The every-objective-has-groundAlternative unit-test invariant is refined
  to: every objective has a groundAlternative OR is an event objective.

### 2.3 Dragon-death matrix (Slice 1)

| When | Result |
|---|---|
| Before courtyard objective | Current behavior; finale never activates (objectives short-circuit on commander kill). |
| During DUEL_GROUND | Castellan unclamped, killable; events short-circuit; ground finale → final assault. |
| During CHASE/DUEL_AIR | Vharax flees; events complete via flee; convertToGround swaps; survive on foot. |
| Rider dies | Existing DEFEAT (unchanged, Scenario B pinned). |

## 3. War dragon — Vharax

- Definition (`src/data/wardragon.ts`): scale 2.2 (~1.5× perceived vs largest player
  dragon 1.45), charred black/red palette, `wingShape { span 1.15, chord 1.1,
  fingers 4, membraneNotch 0.5, sweepAngle 0.35 }`, `bulk 1.25`.
- Rig: `DragonRig` reused wholesale; `bulk` multiplies chest/neck cross-sections;
  `buildWarArmor()` adds ~25% coverage (head plate, neck rings ×3, chest plate,
  saddle + chains) with a scene-scoped dark-metal material owned by `WarDragon`.
- Materials: `"vharax"` id → own `DragonMaterialSet` via existing procedural
  machinery with grime 1.6 + scar lines on. No cross-scene sharing (cache owns).
- Damage state: existing HP specular tint only in Slice 1 (full §36 visuals in
  Slice 3).
- Flight: waypoint steering (turn-rate limited, banked), altitude from waypoint Y,
  own flapPhase driving `rig.animate()`. Head nodes are public — telegraph poses
  rotate `headPivot` directly.
- Fail-safes (§32): terrain clamp (castle-zone min altitude +8 m), combat volume
  400 m radius, stuck detection (non-telegraph speed < 5 for 3 s → nudge to next
  waypoint), always enabled/never culled, world matrices not frozen.

## 4. Audio / HUD

- SFX: `deepRoar` (pitched-down layered roar), `inhale` (telegraph), `wingBuffet`,
  `bossHit` (scale sparks impact). All synthesized, voice-capped, bus-routed.
- Music: `chase` (fast violin ostinato, ~132 bpm), `boss` (aggressive string
  interplay) states added to `MusicComposer` config; finale emits state events
  (reveal → boss, remount/chase → chase, resolved → existing combat/ground logic).
- HUD: boss HP bar ("VHARAX — WAR DRAGON OF BLACKSTONE") top-center, shown while
  Vharax is engaged, hidden at resolve; cinematic subtitle bar (2 lines); objective
  stinger animation on `PURSUE THE CASTELLAN` transitions. HUD-only, no input
  blocking, no new bindings.

## 5. Performance (Slice 1 scope)

- Vharax ≈ one more rig (~30 meshes) + ~8 armor meshes; acceptable.
- Reveal dust/explosions use the existing pooled burst system; boss fire = 1 fire
  stream + 1 point light, active only during ATTACK.
- No per-frame allocations in hot loops (reused `Vector3` temporaries).
- No new LOD/culling interactions; Vharax meshes always enabled.

## 6. Testing

### 6.1 Unit (`tests/finale.test.ts`, plus extensions)

- Finale phase transition legality; illegal transitions rejected.
- Idempotency: duplicate trigger calls cannot double-advance (multi-hit at 40%).
- Castellan 40% clamp math; single transition under burst damage.
- War-dragon SM timing: telegraph → attack → recovery; recovery window exists.
- Rubber-band response as a pure function of distance.
- `notifyEvent` objective completion; commander-death short-circuit chain.

### 6.2 E2E (`e2e/blackstone-finale.spec.ts`)

1. Clear objectives 1–4 via existing APIs (`killBallistae`, `collapseBuildingsWithTag`,
   `killByType`) → landing gate → `forceLand` → GROUND_GAMEPLAY + duel active.
2. `setCastellanHp(0.45)` + one hit → transition fires once; subtitles appear;
   remount restores DRAGON_GAMEPLAY.
3. Chase: waypoint progress advances; rubber-band keeps separation band.
4. Duel: flame sweep telegraph → damage window → recovery; player fire accumulates
   damage; 40% floor → RESOLVED → final assault → VICTORY.
5. Dragon-death fallback: early `damageDragon(99999)` → commander killable → VICTORY
   (ground path).

All waits on sim clock or bounded wall-clock. `setFinalePhase` skip API keeps the
cinematics out of unrelated tests.

### 6.3 Existing tests

- §90/§91 pass unchanged via the death short-circuit.
- `objectives.test.ts`, `scoring.test.ts` extended for the event type; the
  every-objective-has-groundAlternative invariant still holds.

## 7. Explicitly out of scope (Slice 1)

Chase events (§25), aerial patterns beyond flame sweep + combos (§29–30), return to
citadel / spire crash / slow-mo finisher (§34–39), war horn + final assault
escalation (§40–41), checkpoints (§78–79), ballista ground boss route (§43), spatial
audio (§61), 8 tower identities + 6-stage damage states (§7, §12), battlefield
ambient battle actors (§9), victory presentation rework (§42).
