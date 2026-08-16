# GAME DESIGN

## Concept

**DANCE OF FLAMES: DRAGONRIDER** — third-person dragon combat action / arcade /
light roguelite. Alternate-history battle simulator set during a Targaryen civil
war: any rider may fly any dragon across four escalating battles.

### Core fantasy

Ride a massive dragon over a war-torn battlefield; burn armies and fortifications;
loot the field; grow stronger through hidden relics; and when the dragon falls,
finish the fight on foot with a sword.

## Loops

Primary (mission): fly → find enemies → breathe fire → kill → collect coins/heals →
destroy buildings → discover relics → complete objectives → victory.

Meta (campaign): victory → results (rank) → shop → upgrades → next mission →
progressively harder battlefields.

## Roster (data-driven, any rider × any dragon)

| Rider | Canon dragon | Archetype |
|---|---|---|
| Rhaenyra | Syrax | Balanced / agile |
| Daemon | Caraxes | High damage / aggressive |
| Aemond | Vhagar | Tank / heavy fire |
| Aegon II | Sunfyre | Balanced / recovery |
| Rhaenys | Meleys | Speed / veteran |
| Baela | Moondancer | Extreme agility / fragile |

Each rider has a distinct visual identity (gendered frame, unique hairstyle — long/braids/ponytail/topknot/buzz — hair color, skin tone, build, and signature face detail: Rhaenyra's circlet, Daemon's beard, Aemond's eyepatch) applied to both the mounted and ground figures, and the protagonist renders at 1.5× scale.

Dragons differ across 13 gameplay stats (HP, armor, fire damage/range/cone/capacity/
drain/recharge, accel, max/boost speed, turn rate, climb, dive, stagger resist,
hitbox). Canon pairs get a "BONDED" synergy bonus (e.g. Daemon+Caraxes: fire damage
+8%, boost +6%); cross-pairings trade the bonus for freedom.

## Missions

1. **Dragonstone Coast** (tutorial) — volcanic shore; teaches W/turn/aim/fire/boost via
   input-reactive prompts; burn 8 soldiers, raze the watchtower.
2. **Riverlands Raid** — villages & camps; introduces **ballistae** and commander
   kill; relic towers.
3. **Harrenhal Outskirts** — rain, fog, ruined keep; 4 ballistae, elites, relic keep;
   significantly harder.
4. **King's Landing Assault** — walls, gatehouses, 5 scorpions, commander, 90s final
   survive wave.
5. **The Blackstone Citadel** — large fortified castle assault. Outer curtain 220m
   square with 8 towers and battlemented walls, gatehouse with approach bridge and
   banners, inner ward (110m), 46m central keep with corner turrets, great hall,
   barracks/supply (destructible, relic-bearing), courtyards dressed with braziers,
   weapon racks, carts and banner rings; outside: village, military camp, siege
   towers and scorched siege lines. Six phases: silence 6 ballistae → shatter 4 wall
   towers → breach the gatehouse → clear 12 courtyard defenders → eliminate the
   castellan → survive a 75s counterattack. Ground continuation after dragon death
   uses the gate → courtyard → keep-gate route with wall collision.

Difficulty (Story/Normal/Hard) scales enemy damage, accuracy, count, ballista count,
heal drop rate and aggression.

## Systems

### Fire breath

Cone query (range 54–74m by dragon, half-angle ~0.28–0.44 rad) with distance falloff;
ignites soldiers (burning DoT → panic → collapse); ~×1.4 effective vs buildings.
Resource: ~5s sustained fire, 20%-lockout after full depletion, recharge 16–30/s.

### Super Charge

Gains from kills (+5), destruction (+12), relics (+30), fire (+2/s) and time
(+1.2/s). `R`: 170m piercing beam (600dps troops / 900dps structures instant tick).
Cooldown 11–16s by dragon.

### Dragon death → ground war

HP 0 → death spiral (2–4s) → crash FX → rider spawns at flat site with 2.5s
invulnerability → shoulder camera + ground HUD → objectives convert (kill X on foot /
survive / kill commander) so the mission always remains completable. Rider combat:
3-hit combo, heavy (2.1–2.4×, breaks shield blocks), block (50–70% reduction),
0.22s parry window (negates + staggers), dodge roll (0.42s i-frames), sprint, soft
lock-on, stamina economy.

### Enemies

Archer (volleys, now with ballistic lead — real pressure when loitering), Spearman
(low-altitude thrown spears + anti-rider), Swordsman, Shield soldier (blocks frontal
lights — heavy or flank), Elite knight (220HP mini-boss), Commander (320HP objective
target), Siege ballista (95-dmg bolts, glowing telegraph, learn to kill them first).
AI LOD: ≤24 full-AI / 4Hz mid-ring / 1Hz far. Dragons flying low & fast trigger
bravery-checked panic flees.

### Destruction & discovery

Buildings: house 300 / tower 800 / barracks 1200 / fort 2500 HP, states
INTACT→DAMAGED(burning)→COLLAPSED (mesh swap, dust, fire, shake). Relic buildings
(dragonfireCore +15% fire, obsidianScale +30% armor, bloodfireHeart lifesteal,
valyrianSaddle −15% damage taken, dragonheartEssence +35% heal, etc.) auto-collect
with a toast — no landing required.

### Economy

Soldier loot roll: coin 60% (1/2/5/10 denominations 70/20/9/1) / nothing 25% /
small heal 10% / large heal 4% / temp buff 1% (difficulty-scaled heal rate). Coins
magnet to the dragon/rider. Shop tiers 50/120/250/500 across 15 upgrades (7 dragon,
5 rider, 3 consumables). Everything persists via IndexedDB.

### Scoring

kills×30 + buildings×80 + coins×2 + relics×250 + survived 800 + damage-time bonuses
→ ranks S≥4000 / A≥2200 / B≥1000 / C.

## Art & audio direction

Stylized cinematic medieval fantasy: dark stone, fog, smoke, warm dragonfire,
muted landscapes, per-mission palettes (Dragonstone grey-blue, Riverlands green,
Harrenhal rain-dark, King's Landing sunset ember). All meshes procedural,
silhouette-first (dragon: body/neck/head/jaw/wings-fold/legs/tail/saddle/rider).
Audio 100% synthesized WebAudio: roars, wing beats, fire loop, arrows, collapse,
coins, parry stings, wind that scales with airspeed.
