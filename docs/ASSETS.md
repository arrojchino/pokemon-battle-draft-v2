# Assets and licenses

## Battle bot

| Asset | Author | License | Source |
|---|---|---|---|
| `frontend/public/assets/models/bot.glb` (RobotExpressive) | Tomás Laulhé (Quaternius); morph targets and cleanup by Don McCurdy | CC0 1.0 | [three.js repository](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive), also published as "Animated LowPoly Robot" on [OpenGameArt](https://opengameart.org/content/animated-lowpoly-robot) |

The license was read from the model's own README in the three.js repository (`CC0 1.0`) and cross-checked with the OpenGameArt listing. The file is used unmodified; consider supporting the author's Patreon.

It ships 14 animation clips (Idle, Wave, Yes, No, ThumbsUp, Jump, Punch, Dance, Death and others) and three facial morph targets (Angry, Surprised, Sad), all used by `BotRig.ts`.

## Paint jobs

Eight paint jobs live in `frontend/src/characters/roster.ts`. The model's `Main` material is replaced per instance with a paint colour; joints (`Grey`) and the visor (`Black`) keep their roles. Rust, scuffs and dirt are generated in the shader (`addGrime` in `loadBot.ts`), so no textures are involved. To add a paint: add an id to `shared/src/characters.ts` and an entry to `ROSTER`. Names and quips are original to this project.

## Generated, not downloaded

- Portrait badges: small SVGs drawn in code (`badge()` in `roster.ts`).
- Panel grime, stains and grain: SVG `feTurbulence` data URIs in `styles/grime.css`.
- The alley: brick walls, graffiti (original doodles and words), neon signs and every surface are canvas textures or shaders generated at load (`engine/world/Alley.ts`).
- All sound effects and music: synthesized in `frontend/src/audio/sound.ts`.

## Pokémon artwork

Official artwork is loaded at runtime from the PokeAPI sprites repository (not bundled). Pokémon and its artwork are trademarks of their respective owners; this is a non-commercial fan project.
