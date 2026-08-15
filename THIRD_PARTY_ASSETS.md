# THIRD PARTY ASSETS

## Policy

This project ships **zero external art, audio, model, or texture files**.
Every visual and audible element is generated procedurally at runtime:

| Asset class | Source |
|---|---|
| Dragon meshes | Procedural primitive hierarchy (capsules, boxes, cylinders) composed in `src/world/DragonRig.ts` |
| Dragon scale/vein textures, normal maps, roughness maps | Procedural canvas generation (height fields → Sobel normals) in `src/world/DragonMaterials.ts` |
| Soldier / rider / ballista meshes | Procedural, `src/world/SoldierFactory.ts` (multi-material rider: leather/metal/cloth/hair/skin) |
| Buildings (intact + rubble states), castle mega-geometry | Procedural, `src/world/BuildingFactory.ts`, `src/world/CastleBuilder.ts` |
| Terrain | CPU value-noise heightfield, `src/world/Terrain.ts` |
| Battlefield props (tents, carts, banners, siege towers…) | Procedural instanced templates, `src/world/PropLibrary.ts` |
| Cloud / glow / smoke textures | Runtime `DynamicTexture` canvas generation |
| Fire / smoke / ember / rain particle systems | Babylon.js `ParticleSystem` + generated textures |
| UI styling | Hand-written CSS (parchment/dark-fantasy theme) |
| All sound effects & ambience (roar, wings, fire, wind, swords, castle) | Layered WebAudio synthesis, `src/audio/AudioManager.ts` |
| Original soundtrack (cello + violin adaptive score) | Procedural WebAudio composition, `src/audio/MusicComposer.ts` + `src/audio/MusicSystem.ts` |

### Original Project Assets (composed/synthesized for this project)

- **Soundtrack**: all cues (menu / exploration / combat low+high / castle assault / ground
  combat / dragon-fallen stinger / victory / defeat) are ORIGINAL compositions generated
  at runtime — bowed-string synthesis (detuned saw pairs, lowpass + body resonance,
  delayed vibrato) plus frame drum and low pad. No existing film/game themes were
  referenced. Motifs and progressions are defined as data in `MusicComposer.ts`.
- **SFX**: every effect is an internal layered synthesis graph (Original Project Asset).

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
