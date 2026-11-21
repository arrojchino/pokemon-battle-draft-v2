# Assets and licenses

## Pokémon models (runtime)

Partner and battling Pokémon are 3D models from the community [Pokémon 3D API](https://github.com/Pokemon-3D-api/assets) (`models/opt/regular/<National Dex number>.glb`), fetched from GitHub when first needed and cached per species; nothing is bundled. The files are Draco-compressed glTF with WebP textures, so the Draco decoder ships in `frontend/public/assets/draco/` (copied from three.js `examples/jsm/libs/draco/gltf`, Apache-2.0). Sizes range from about 60 KB to 15 MB per species; Switch-era models are the heavy ones (partners are 3.4 to 15 MB) and bring 40 to 113 animation clips. The API credits the models as property of Nintendo, Creatures Inc. and GAME FREAK.

Every model was graded and its runtime fixes are listed in [ASSET_AUDIT.md](ASSET_AUDIT.md).

Thirty-two draft-pool species use their Pokémon HOME model instead (`FROM_HOME` in `engine/character/monModel.ts`), fetched at runtime from two public GitHub exports: [Pokemon-HOME-GLB-Models](https://github.com/Lilothestitch16/Pokemon-HOME-GLB-Models) (mesh and skeleton) and [Pokemon-HOME-Unity-Models](https://github.com/Lilothestitch16/Pokemon-HOME-Unity-Models) (textures, materials and animation clips). `engine/character/home.ts` assembles them and converts the Unity clips; `scripts/home-manifest.py` regenerates `homeManifest.ts`, which only lists paths and texture transforms. With both sources, every Pokémon in the pool battles as an animated 3D model.

## Partner roster

Fourteen partners live in `frontend/src/characters/roster.ts` (ids validated by the server through `shared/src/characters.ts`): Dex number, types, an accent colour readable on the dark interface, the official artwork as portrait, an original one-line quip and the reaction each game moment triggers. To add one: add the id to `shared/src/characters.ts` and an entry to `ROSTER` (check the model in the API first).

## Cries (runtime)

Partner cries come from the PokeAPI cries repository (`cries/pokemon/latest/<dex>.ogg`), fetched on first use and decoded with the Web Audio API.

## Generated, not downloaded

- The stadium: field, lines, stands, crowd, LED boards (canvas text), floodlights, sky, light shafts and motes are shaders and canvas textures generated at load (`engine/world/`).
- All sound effects: synthesized in `frontend/src/audio/sound.ts`.

## Pokémon artwork

Official artwork is loaded at runtime from the PokeAPI sprites repository (not bundled). Pokémon and its artwork are trademarks of their respective owners; this is a non-commercial fan project.
