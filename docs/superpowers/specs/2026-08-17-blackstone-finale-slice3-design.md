# The Blackstone Citadel — AAA Finale: Design Spec (Slice 3 of 3)

Date: 2026-08-17
Status: Approved design for Slice 3 (final); Slices 1-2 merged (080c685, ac4084c)
Predecessors: 2026-08-16-blackstone-finale-slice1-design.md, 2026-08-17-blackstone-finale-slice2-design.md

## 0. Scope and decisions

Slice 3 completes the finale (master prompt §27-43): aerial pattern library with HP
phases, return-to-citadel duel, Blackstone Spire final crash with one-time
slow-motion, war horn + escalated final assault, in-memory checkpoints, stereo
spatial audio, and deferred cosmetics.

Decisions with the human partner:
- Checkpoints: **in-memory snapshot** (deterministic rebuild + state reapply,
  same session only; rider-death RETRY uses it, fresh-start option preserved).
- Spatial audio: **stereo panning** (StereoPannerNode, listener = active camera
  yaw; no full 3D/HRTF).
- Aerial patterns: **3 patterns + phases** (sweep/charge/dive with phase-weighted
  selection, 2-3 authored combos, anti-repeat; not the full §29 seven).
- Spire crash + return duel: **full sequence** (§34-35, §38-39).
- §25 chase events, §43 ballista ground-route convergence, weather progression
  (§57), zone hits (§13): still out of scope — explicitly deferred beyond the
  AAA-finale program (documented as future work).

## 1. Phase flow extension

FinalePhase gains: RETURN, FINAL_STAGGER, FINAL_CRASH — inserted before RESOLVED:
DUEL_AIR (40% floor) → RETURN → FINAL_STAGGER → FINAL_CRASH → RESOLVED →
bs-final (75 s escalated) → VICTORY.

Transition triggers:
- DUEL_AIR → RETURN: war-dragon HP ≤ 25% (the existing 40% "floor" becomes the
  RETURN entry — DUEL_AIR combat continues through RETURN around the fortress;
  the boss steers between castle-top waypoints, damage still applies).
- RETURN → FINAL_STAGGER: player damage brings effective HP to the crash
  threshold (10% of max) near the spire zone (horizontal dist < 80 m of spire —
  if reached out of zone, boss circles until in-zone; wall-clock bound 25 s then
  forces in-zone).
- FINAL_STAGGER → FINAL_CRASH: next player hit (fire/beam — the finishing blow;
  HUD hint "FINISH THE CASTELLAN" once on entry).
- FINAL_CRASH → RESOLVED: crash sequence completion (~6 s).

## 2. FINAL_CRASH sequence (§38-39) — authored, control retained

1. Finishing hit accepted → slowmoT = 1.0 (0.4×, THE only slow-motion per §39).
2. Vharax loses control: roll oscillation ±0.5, speed decays 25→12, steered to
   the spire's upper third; fire light gutters out.
3. Wing contact at spire top: spire crown (top ~30% — a separate mesh from now
   on; see §6) detaches, tilts, falls along the spire with dust trail.
4. Body crashes through mid-spire: explosion ×2.2, dust ×2.5, shake 1.6, deep
   layered roar; Vharax rig disappears under debris (setEnabled false) — no
   ragdoll, no random physics.
5. 1.5 s of near-silence (music ducks) → vharax-resolved event → RESOLVED.
6. WAR HORN: new warHorn SFX (synthesized brass-ish stab + fifth) + music dips
   to low pad → existing bs-final objective becomes the escalated assault.

Player control/aiming stays live; camera gets a 2.5 s look-bias toward the
spire on impact (existing addShake/bias mechanisms only). Wall-clock bound
8 s for the whole sequence.

## 3. Aerial patterns (§28-30)

Patterns (WarDragon SM extended — TELEGRAPH/ATTACK/RECOVERY per pattern):
- Flame sweep (existing): unchanged.
- Charge: boss creates distance (target 65 m+ opposite side), aligns, roar +
   head-lower pose 1.2 s telegraph → 70 m/s run at the player's predicted
   position (existing lead math) → pass-by near-miss wingBuffet (if closest
   approach < 12 m: damage + tumble-stagger on the player dragon) → 2.5 s
   recovery (attack window).
- Dive: boss climbs 30 m above, hangs 0.8 s (strong vertical telegraph: shadow
   cue via a decal-less dark disc mesh under the player + inhale) → dives at
   55 m/s → pull-out climb 2.0 s recovery.
- Castellan javelin: during any RECOVERY, 30% chance one ballistic spear
   (existing ballisticDir + projectile pool); telegraph = metal glint SFX.

Phase weights (pure, unit-tested): `selectPattern(hpFrac, last, rng)`:
- >0.7: sweep 0.6 / charge 0.3 / dive 0.1
- 0.4-0.7: sweep 0.3 / charge 0.45 / dive 0.25
- 0.25-0.4: dive 0.5 / charge 0.35 / sweep 0.15
- <0.25 (RETURN): steering dominates; attacks limited to sweep while passing.
- Never the same pattern twice in a row (re-roll once, then allow).

Combos (authored): sweep→reposition→charge; charge-miss→dive (on player dodge);
no more than one combo per 20 s.

## 4. Final assault escalation (§40-41)

Pure `assaultProfile(elapsed, duration)` → { spawnIntervalMult, eliteBoost,
musicPeak } — 4 bands (75-45 / 45-20 / 20-5 / 5-0): interval ×1.0 / ×0.7 / ×0.5 /
×0.4, elite +0/+2/+2/+4, music intensity target 0.7/0.85/1.0/1.0. EnemyManager
gains a reinforcement spawner active only during bs-final (blackstone only,
respects the 24-soldier tier-0 cap; spawns at courtyard/gate anchors, swordsmen
+ band elites). Existing survive-objective completion untouched (no mass
deletion at zero). warHorn motif (short) at each band transition.

## 5. Checkpoints (§78-79)

- Capture points (blackstone only): courtyard objective completed (pre-duel),
  DUEL_GROUND entry, CHASE entry, DUEL_AIR entry, FINAL_CRASH completed.
- Snapshot (plain object, in-memory on GameApp): finalePhase, castellan
  {hp, transitioned}, vharax {hp, state} (if exists), destroyed buildings
  [{id}], dead ballista indices, objective progresses (per-item progress +
  completed flags), player {dragonHp, riderHp, mode, pos, yaw},
  consumed charges (heal/fireBoost/armorWard), mission time.
- Restore: rider-death DEFEAT → RETRY offers checkpoint resume (default) —
  full rebuild via loadMission(optionalSnapshot): after deterministic rebuild,
  reapply building HP (existing hpFraction path via damageBuilding to the exact
  stored HP), re-kill ballistae, set tracker progresses, skipTo(finalePhase)
  with mandatory side effects, restore player state/pos. "RESTART FROM
  BEGINNING" remains as the secondary option (existing flow).
- Non-blackstone missions and abandon-to-menu: unchanged behavior.
- Snapshot invalidation: any new mission load clears it.

## 6. Spire split + cosmetics

- CastleBuilder spire becomes two meshes: base (70%) static as today; crown
  (30%) a separately-named mesh, initially merged-look (same material) but a
  distinct node so FINAL_CRASH can detach/tilt/fall it. AABB unchanged.
- SCORCHED smoke: BuildingSystem.attachSmoke split from attachFire (smoke-only
  attach when smokeRate > 0 and fireRate === 0).
- staggered wiring: tier-0 soldier AI skipped 0.8 s while staggered > 0 (field
  decremented in update loop) — knockdown reads on rank-and-file.
- Military tower weapon racks: PropLibrary.weaponRack ×2 at each N-corner
  tower base (castleCourtyard-adjacent placement in CastleBuilder).
- War-dragon damage state (§36, visual only): HP < 25% → roll trim bias +
  intermittent jaw ember flicker + flapRate ×0.85 (no control-degradation).

## 7. Spatial audio (stereo panning)

- Events.ts sfx payload gains optional `pos?: {x,z}`; emitters updated at the
  seven call sites listed in §0 decisions (ballista fire/telegraph, arrows,
  roars, inhale, explosions, collapses, warHorn).
- AudioManager: `panFor(pos, listenerYaw, listenerPos)` (pure, unit-tested —
  relative bearing → StereoPanner.pan −1..1 with distance rolloff −6 dB/40 m
  beyond 30 m); tone()/noise() gain chains route through a panner when the sfx
  call carries a pan value.
- GameApp supplies listener (active camera position/yaw at emit time — the bus
  carry is a plain number computed by the emitter helper
  `panFromWorld(pos): number` exposed via MissionScene).

## 8. Testing

Unit (`tests/finale3.test.ts`): selectPattern weights/anti-repeat/phase edges;
assaultProfile bands; snapshot round-trip completeness (pure parts);
panFor math; crash-trigger zone condition.
E2E (`e2e/finale3.spec.ts`):
1. Full finale: DUEL_AIR → damage to RETURN → steer near spire → FINAL_STAGGER
   hint → finishing hit → FINAL_CRASH (spire crown detached — mesh check;
   slowmo asserted once via slowmoT poll; vharax-resolved) → warHorn sfx flag →
   assault spawn-interval changes across bands (poll reinforcement spawner
   stats) → VICTORY.
2. Checkpoint: DUEL_AIR entry → rider killed via forced dragon death + rider
   damage → DEFEAT → RETRY → assert restored state (buildings still collapsed,
   finale phase DUEL_AIR, vharax HP ≈ snapshot) → complete to VICTORY.
3. Full regression: all suites green.
Test API: getFinale extended (phase incl. new ids, crash state), assaultPhase(),
checkpoint ops, warHorn spy (sfx emit counter).

## 9. Out of scope (post-program future work)

§25 chase events; §43 ballista ground-route convergence for dragon-death
during aerial phases (current: events complete via flee; ground route remains
slice-1 behavior); weather progression §57; zone-based structure hits §13;
dragon charge input mechanic (§16 alt); victory-presentation rework §42
beyond what the crash sequence provides.
