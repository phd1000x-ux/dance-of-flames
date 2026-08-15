# PERFORMANCE

## Method

`npm run benchmark` (headed Chrome, real GPU, scripted autopilot: continuous flight +
fire breath + boost bursts over the mission battlefield). Percentiles are computed
from raw frame-time samples in-page. Reference machine: MacBook M1, Chrome stable,
WebGPU backend, 1440×900 viewport.

## Results (reference machine)

| Scenario | Renderer | Avg FPS | p5 FPS | p1 FPS | Max frame | NPCs | Quality tier |
|---|---|---|---|---|---|---|---|
| Riverlands 30s stress | WebGPU | **74** | 70 | 69 | 480ms (one-time shader compile) | 36 | 0 |
| Harrenhal 20s stress (rain+fog) | WebGPU | **75** | 69 | 68 | 29ms | 57 | 0 |
| Dragonstone gameplay (manual) | WebGPU | 75–90 | — | — | — | 14 | 0 |

Targets from the brief (60 FPS typical, ≥35 FPS large combat) are met with the
quality governor never needing to leave tier 0 (full quality).

## Dynamic quality manager

`PerformanceGovernor` samples frame times each frame; every ≥4s (6s for upgrades) it
evaluates median + 5th-percentile frame time:

- downgrade when p5 > 40ms && median > 20ms, or median > 33ms
- upgrade when p5 < 22ms && median < 15ms

Tiers adjust hardware scaling (1.0 → 1.5), particle emit-rate multiplier (1.0 → 0.38)
and shadow enablement. Presets LOW/MEDIUM/HIGH pin tiers statically; AUTO (default)
starts at tier 1 and self-adjusts.

## Rendering budget & techniques

- Soldier = one merged mesh (torso+head+weapon) + cloned material; ballista ≈ 6 meshes
- Trees/rocks are instanced meshes with frozen world matrices
- Projectiles, loot pickups and particle bursts are pooled; nothing per-frame is
  allocated in steady state
- One dynamic fire light (flicker), shadow map 1024 with PCF, casters: player + near buildings
- Fog + horizon silhouettes replace distant geometry; mission bounds ~1.5km
- GlowLayer at minimal samples for fire/embers
- HUD updates at 30Hz; minimap canvas redrawn in the same tick

## Known performance characteristics

- First 1–2s of a mission includes WebGPU pipeline compilation (one long frame);
  subsequent frames are stable
- WebGL2 fallback is fully playable but heavier on draw calls; tier governor
  compensates automatically
- Headless Chrome runs on SwiftShader (software) and is NOT representative — always
  benchmark headed (`BENCH_HEADLESS=1` opt-in for CI smoke only)
