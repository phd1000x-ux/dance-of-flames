# The Blackstone Citadel — AAA Finale: Design Spec (Slice 2 of 3)

Date: 2026-08-17
Status: Approved design for Slice 2; Slice 1 merged (080c685); Slice 3 planned
Predecessor spec: docs/superpowers/specs/2026-08-16-blackstone-finale-slice1-design.md

## 0. Scope and decisions

Slice 2 is the **siege vertical slice** (master prompt §82): make destroying the
fortress feel like siege warfare. Player-visible chain: ballista siege → tower
damage progression → tower collapse with battlefield consequences → gatehouse
breach hero moment → courtyard entry — the existing objective chain
(bs-ballistae → bs-breach → bs-gate → bs-courtyard) is UNCHANGED; all work is
feel, feedback, and consequence.

Decisions made with the human partner:
- Ambient battle (§9): **visual pair actors** — ~24-30 cheap animated combat
  pairs, no real faction/AI/damage. Matches master prompt §10 far-field design.
- Structure damage (§12-13): **visual damage states + collapse consequences**,
  no zone-based hit detection (§13's "do not overcomplicate" honored).
- Gatehouse breach (§16): **finishing-blow presentation** — staged visuals,
  BREACH READY hint at critical, enhanced collapse on the final fire hit. No new
  input mechanic.
- Slice-1 parked fix included: `finaleMusicOverride` reset (first task).

Out of scope (Slice 3): zone hits, dragon charge, spire crash/final assault
escalation, checkpoints, spatial audio, real allied faction, weather
progression.

## 1. Architecture

New files:
| File | Responsibility |
|---|---|
| `src/world/DamageStates.ts` | Pure: DamageState union + `damageStateFor(hpFrac)` thresholds + per-state visual parameter table (diffuse scale, ember emissive, particle rates). Unit-tested. |
| `src/world/AmbientBattle.ts` | Visual combat pairs: placement, procedural fight-loop animation, distance tiers, dragon look-up reaction, death/reset cycle. No collision/damage/AI. |

Modified files:
| File | Change |
|---|---|
| `src/world/BuildingSystem.ts` | Per-building damage-state application via existing unique materials (diffuse/emissive ramps, particle intensity keyed to state); collapse consequences: radial soldier knockdown+flee, **radial ballista destruction** (fixes floating-ballista gap), dust/shake scaling; gatehouse breach-ready hint + enhanced collapse. |
| `src/world/BuildingFactory.ts` | Tower variant params (height, crown style, banner) driven by placement. |
| `src/world/CastleBuilder.ts` | Scale bump (walls 16→20m, towers 30→38m, artillery towers 42m); 8 tower identities: 1-2 gate defense (banners), 3-4 artillery (wall ballistae mounted on them), 5-6 military (near barracks), 7 ruined (spawns in DAMAGED state), 8 = existing static spire. |
| `src/ai/EnemyManager.ts` | Ballista volley scheduler (~12s cadence: 2-3 alive ballistae sync-fire with per-shot aim jitter). Export a pure `planVolley` helper for tests. |
| `src/app/GameApp.ts` | `finaleMusicOverride = false` in `loadMission()` (slice-1 parked fix). |

The objective chain, mission data, finale orchestrator, and all other missions
are untouched. Non-blackstone missions get the damage-state visuals for free
(they share BuildingSystem) — acceptable and desirable (§12 is a global
improvement); tower identities/scale/ambient pairs are blackstone-only.

## 2. Damage states (§12)

`hpFrac = hp/maxHp`:
- INTACT > 0.85 — current visuals
- SCORCHED 0.6-0.85 — diffuse ×0.82, faint ember emissive
- DAMAGED 0.35-0.6 — diffuse ×0.68, ember ramp, fire particles attach (absorbs
  the old <55% threshold)
- CRITICAL 0.0-0.35 — diffuse ×0.55, strong ember, fire+smoke max, occasional
  spark burst
- COLLAPSING — the collapse moment (existing animation path, enhanced)
- DESTROYED — rubble (existing)

No crack geometry (§12: readable, not simulated). States drive only material
params + existing particle system rates — zero new meshes/textures.

## 3. Collapse consequences (§15)

On building collapse (existing `collapse()` path, extended):
- Soldiers within `w*1.2` radius: stagger (knockback + brief `flee`), light
  damage; never instant-kill elites/commander.
- **Ballistae within radius: destroyed** (uses existing damageBallista death
  path) — fixes ballistae floating after their tower dies; objective
  bs-ballistae counts them (existing onBallistaDeath wiring).
- Dust volume + shake scaled by building size (existing distance attenuation).
- Rubble remains walkable ground clutter (existing behavior).

## 4. Gatehouse breach (§16)

- Gatehouse (tag "gatehouse") entering CRITICAL emits `hud-hint` "BREACH THE
  GATE" once (existing hint system, existing SFX objective()).
- Final blow (hp→0) on a gatehouse: explosion scale ×1.8, dust ×2, shake 1.2,
  buildingCollapse + explosion SFX layering, rubble offset inward (falls into
  the courtyard). No slow-motion (§39 reserves it for the slice-3 finale).
- No new inputs; fire breath/super both qualify as the finishing attack.

## 5. Ballista siege feel (§11)

- Volley scheduler in EnemyManager: every ~12s (with ±3s jitter), select 2-3
  alive ballistae; align their cooldowns so shots leave within a 0.6s window;
  per-shot aim jitter ±3m so volleys never converge on one point.
- Existing telegraph (rail glow + ballistaTelegraph SFX) unchanged — volleys
  multiply it visibly.
- Pure planning logic (`planVolley(count, alive, rng)`) exported for unit tests.

## 6. Ambient battle pairs (§9/§10)

- 24-30 pairs placed at authored anchors: courtyard interior, gate approach,
  siege lines, barbican. Two low-poly humanoid figures per pair (capsule+
  box limbs, 2 shared faction materials), procedurally animated fight loop
  (offset sin phases: sway, lunge, weapon-arm arc).
- Distance tiers (from active camera): <120m full anim; <300m 10Hz update;
  beyond: frozen mid-pose, culled by the existing prop culling radius.
- Dragon reaction: player dragon below 40m altitude within 60m → pair pauses
  and looks up (pose lerp) until it passes.
- Death/reset cycle: per pair, every 20-40s (seeded), one figure falls; after
  6s the pair resets (a "reinforcement" — same figures, phase shift).
- Zero interaction with combat systems; never targeted, never damaged.

## 7. Tower identities and scale (§5-7)

- Outer wall 16→20m; grandTowers 30→38m (artillery variants 42m with wider
  crown platform); keep/spire unchanged (46m/58m — spire remains dominant).
- Identity mapping (blackstone layout): towers indexed by position — S corner
  pair (1-2) gate defense: banners + taller crowns; E/W mids (3-4) artillery:
  the 4 wall ballistae sit on these (existing positions re-anchored); N pair
  (5-6) military: adjacent to barracks, weapon-rack props at base; tower 7 (NE
  diagonal) ruined: spawns at 45% HP (DAMAGED state, pre-fire); identity 8 is
  the static spire (not destructible, slice-1 landmark).
- Objective bs-breach ("Shatter the wall towers", 4 of 8) unchanged — any 4.

## 8. Performance (§59, §68-76)

- Pairs: instancing or shared-mesh clones; ~50-60 figures total, 2 materials,
  tiered updates — cheaper than one enemy squad.
- Damage states: material param writes on state CHANGE only (not per frame).
- Volleys: reuse ballista entities/projectile pool.
- Enhanced collapse bursts reuse the pooled burst system (cap 6 — breaching
  two gatehouses can't exceed it).

## 9. Testing

Unit (`tests/siege.test.ts` new + suite stays green):
- `damageStateFor` boundary thresholds.
- `planVolley` selection/window/jitter properties (pure, seeded).
- Pair tier selection + look-up trigger conditions (pure functions).
- Death/reset cycle determinism per seed.

E2E (`e2e/siege.spec.ts` new; existing suites stay green):
1. Tower: fire until SCORCHED→DAMAGED→CRITICAL transitions observed (poll
   building state via test API) → collapse → ballistae within radius dead.
2. Gatehouse: damage to breach-ready (hint text asserted) → final blow →
   enhanced collapse markers (shake flag / rubble position inward).
3. Volley: ≥2 ballista bolts within a 0.6s sim window observed once.
4. Ambient: pair count > 0, tier assignment changes with camera distance.
5. §90/§91/finale specs: no regression (full suite gate).

Test API additions: `getBuildingStates()` (tag/state/hp list), `getAmbientPairs()`
(count + tier histogram), `triggerVolley()`.

## 10. Slice-1 parked fix (Task 0)

`finaleMusicOverride` is cleared in `loadMission()` and on any finale resolve
path (shortCircuit emits `finale-music: resolve`). One line + one emit; E2E:
start blackstone, force finale resolve, start dragonstone, assert adaptive
music state changes (menu→explore/combat within 2s poll of
`app.music.currentState`).
