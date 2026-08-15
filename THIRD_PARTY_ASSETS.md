# THIRD PARTY ASSETS

## Policy

This project ships **zero external art, audio, model, or texture files**.
Every visual and audible element is generated procedurally at runtime:

| Asset class | Source |
|---|---|
| Dragon meshes | Procedural primitive hierarchy (capsules, boxes, cylinders) composed in `src/world/DragonRig.ts` |
| Soldier / rider / ballista meshes | Procedural, `src/world/SoldierFactory.ts` |
| Buildings (intact + rubble states) | Procedural, `src/world/BuildingFactory.ts` |
| Terrain | CPU value-noise heightfield, `src/world/Terrain.ts` |
| Cloud / glow / smoke textures | Runtime `DynamicTexture` canvas generation |
| Fire / smoke / ember / rain particle systems | Babylon.js `ParticleSystem` + generated textures |
| UI styling | Hand-written CSS (parchment/dark-fantasy theme) |
| All sound effects & ambience | Synthesized WebAudio graphs (filtered noise bursts, FM pings, loop layers), `src/audio/AudioManager.ts` |

No HBO video, screenshots, soundtrack recordings, voice recordings, face scans,
logos, ripped game models, or copyrighted UI graphics are used. Characters and
dragons are stylized fantasy interpretations used as inspiration only.

## Libraries (installed via npm, not bundled assets)

| Library | License | Use |
|---|---|---|
| [@babylonjs/core](https://www.babylonjs.com/) 8.x | Apache License 2.0 | 3D engine (WebGPU/WebGL2, scene graph, particles, shadows) |
| vite 6.x | MIT | Dev server & bundler |
| typescript 5.x | Apache 2.0 | Language |
| vitest 2.x | MIT | Unit tests |
| @playwright/test 1.x | Apache 2.0 | E2E browser tests |

All licenses permit redistribution in this project's built form.
