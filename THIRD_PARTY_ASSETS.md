# THIRD PARTY ASSETS

## Policy

The default game uses procedural visuals and synthesized audio. The opt-in
`?characters=1` character prototype additionally ships the two free CC BY 4.0
models listed below. All audio remains generated at runtime.

## Free character prototype assets

| Local file | Work and creator | Original source | License |
|---|---|---|---|
| `public/character-prototype/dragon.glb` | Animated Dragon Three Motion Loops, LasquetiSpice | https://sketchfab.com/3d-models/animated-dragon-three-motion-loops-eca98cf6cd084c1596cecf716e110c29 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/character-prototype/knight.glb` | Strong Knight, DJMaesen | https://sketchfab.com/3d-models/strong-knight-9d912e0fedb44b619fbd2a083bbf174f | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/character-prototype/axe.glb` | Viking battle axe, xeofox | https://sketchfab.com/3d-models/viking-battle-axe-b7123192adbf40f68043c57dd8ddcd15 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Retrieved 2026-10-24 (axe 2026-10-25) from [Ai2's public Objaverse distribution](https://huggingface.co/datasets/allenai/objaverse).
The GLBs embed matching title, author, source and CC-BY-4.0 metadata.
`public/character-prototype/sources.json` records exact download URLs and SHA256 hashes.
The original binary files are preserved. Runtime adaptations: normalized size and
orientation, removal of unused UV streams for WebGPU compatibility, material
lighting adjustments, and added skeletal poses for mounting/movement/combat.
The original clips are `Flying` (dragon) and `idle1` (knight); knight walking, running,
guard and axe attacks are code-authored procedural animation (`src/world/KnightAnimator.ts`), not downloaded motion capture.
`public/character-prototype/knight-anims.json` holds animation data derived from
[Mixamo](https://www.mixamo.com) (Adobe) motions — idle, walk, run, slashes, power
slash, block, dive roll, impact, death — retargeted onto the Strong Knight skeleton by
`scripts/retarget-mixamo.mjs` (`npm run retarget <dir-of-glb>`). Mixamo animations
may be used royalty-free inside games; the raw Mixamo FBX downloads are NOT
redistributed (kept in git-ignored `assets-src/mixamo/`). The code-authored poses in
`src/world/KnightAnimator.ts` remain as the fallback if the clip file fails to load.
The prototype displays attribution and source links in its on-screen panel.
These model files retain CC BY 4.0 and are not relicensed under the code license.

## Procedural assets

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
logos, ripped game models, or copyrighted UI graphics are used. Rider and dragon
**names** (e.g. Daemon Targaryen, Caraxes) are drawn from *House of the Dragon*
canon as text data only. Procedural assets and the CC-licensed prototype models
are not reproductions of HBO/GRRM assets. This is a
noncommercial fan project, distributed under the PolyForm Noncommercial License
(see `LICENSE`).

## Libraries (installed via npm, not bundled assets)

| Library | License | Use |
|---|---|---|
| [@babylonjs/core](https://www.babylonjs.com/) 8.x | Apache License 2.0 | 3D engine (WebGPU/WebGL2, scene graph, particles, shadows) |
| @babylonjs/loaders 8.56.2 | Apache License 2.0 | glTF/GLB import for the opt-in character prototype |
| vite 6.x | MIT | Dev server & bundler |
| typescript 5.x | Apache 2.0 | Language |
| vitest 2.x | MIT | Unit tests |
| @playwright/test 1.x | Apache 2.0 | E2E browser tests |

All licenses permit redistribution in this project's built form.
