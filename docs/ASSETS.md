# Assets and licenses

## Pokémon models (runtime)

Partner and battling Pokémon are 3D models from the community [Pokémon 3D API](https://github.com/Pokemon-3D-api/assets) (`models/opt/regular/<National Dex number>.glb`), fetched from GitHub when first needed and cached per species; nothing is bundled. The files are Draco-compressed glTF with WebP textures, so the Draco decoder ships in `frontend/public/assets/draco/` (copied from three.js `examples/jsm/libs/draco/gltf`, Apache-2.0). Sizes range from about 60 KB to 15 MB per species; Switch-era models are the heavy ones (partners are 3.4 to 15 MB) and bring 40 to 113 animation clips. The API credits the models as property of Nintendo, Creatures Inc. and GAME FREAK.

Every model was graded and its runtime fixes are listed in [ASSET_AUDIT.md](ASSET_AUDIT.md).

Ninety-two draft-pool species use their Pokémon HOME model instead (`FROM_HOME` in `engine/character/monModel.ts`), fetched at runtime from two public GitHub exports: [Pokemon-HOME-GLB-Models](https://github.com/Lilothestitch16/Pokemon-HOME-GLB-Models) (mesh and skeleton) and [Pokemon-HOME-Unity-Models](https://github.com/Lilothestitch16/Pokemon-HOME-Unity-Models) (textures, materials and animation clips). `engine/character/home.ts` assembles them and converts the Unity clips; `scripts/home-manifest.py` regenerates `homeManifest.ts`, which only lists paths and texture transforms. With both sources, every Pokémon in the pool battles as an animated 3D model.

## Partner roster

Fourteen partners live in `frontend/src/characters/roster.ts` (ids validated by the server through `shared/src/characters.ts`): Dex number, types, an accent colour readable on the dark interface, the official artwork as portrait, an original one-line quip and the reaction each game moment triggers. To add one: add the id to `shared/src/characters.ts` and an entry to `ROSTER` (check the model in the API first).

## Cries (runtime)

Partner cries come from the PokeAPI cries repository (`cries/pokemon/latest/<dex>.ogg`), fetched on first use and decoded with the Web Audio API.

## Draft pool sets

The first 38 sets are the original game's. The other 62 are the main set of each species in Pokémon Showdown's Gen 9 Battle Factory data (`data/random-battles/gen9/factory-sets.json` in the MIT-licensed `pokemon-showdown` package; the sets are curated by Smogon), and every set's tier comes from Showdown's formats data. Role names and quips are original.

## Plaza host (runtime)

- `frontend/public/npc/presenter.vrm`: VRoid Studio sample "β Ver AvatarSample_4" by pixiv Inc., CC0 (listed under "CC0 license models" at https://vroid.pixiv.help/hc/en-us/articles/4402614652569), recoloured and repacked by `frontend/src/engine/npc/tools/pack_presenter.py`. The cap and headset are modelled in code (`engine/npc/accessories.ts`). It loads in its own chunk the first time the main plaza opens.

## Generated, not downloaded

- The stadium: field, lines, stands, crowd, LED boards (canvas text), floodlights, sky, light shafts and motes are shaders and canvas textures generated at load (`engine/world/`).
- All sound effects: synthesized in `frontend/src/audio/sound.ts`.

## Pokémon artwork

Official artwork is loaded at runtime from the PokeAPI sprites repository (not bundled). Pokémon and its artwork are trademarks of their respective owners; this is a non-commercial fan project.

## Trainers (runtime)

Plaza trainer models, picked per player (`shared/src/trainers.ts`, `frontend/src/ui/TrainerPicker.tsx`). Each model loads, in its own request, the first time someone in the plaza uses it; `classic` reuses the plaza host file above. Licenses checked on the source pages on 2026-11-24.

| id | file | source | author | license | verified at |
| --- | --- | --- | --- | --- | --- |
| classic | `npc/presenter.vrm` | VRoid beta AvatarSample_4 ("Victoria Rubin"), recoloured (see Plaza host) | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/en-us/articles/360014900233 |
| shibu | `trainers/shibu.vrm` | VRoid beta AvatarSample_1 ("Sendagaya Shibu"; file AvatarSample_D.vrm) | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/en-us/articles/360012381793 |
| vivi | `trainers/vivi.vrm` | VRoid beta AvatarSample_2 ("Vivi"; file AvatarSample_E.vrm) | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/ja/articles/360014900273 |
| vita | `trainers/vita.vrm` | VRoid beta AvatarSample_3 ("Vita"; file AvatarSample_F.vrm) | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/ja/articles/360014900113 |
| hana | `trainers/hana.vrm` | VRoid HairSample_Female | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/en-us/articles/4402614652569 |
| kai | `trainers/kai.vrm` | VRoid HairSample_Male | pixiv Inc. (VRoid Project) | CC0 1.0 | https://vroid.pixiv.help/hc/en-us/articles/4402614652569 |
| kate | `trainers/kate.vrm` | 100Avatars R1 #038 "Kate" | Polygonal Mind | CC0 1.0 | https://github.com/ToxSam/open-source-avatars (`data/projects.json`: 100avatars-r1, license CC0; VRM meta licenseName CC0) |
| kyle | `trainers/kyle.vrm` | 100Avatars R1 #069 "Kyle" | Polygonal Mind | CC0 1.0 | same as kate |

- The VRoid page "Do VRoid Studio's sample models come with conditions of use?" (https://vroid.pixiv.help/hc/en-us/articles/4402614652569) lists HairSample_Male, HairSample_Female and beta AvatarSample_1 to _4 as CC0; each beta AvatarSample article states "The CC license for this model is CC0". AvatarSample_A, _B, _C and the VRoidPreset models are not CC0 and are not used. The beta sample files were taken from the OpenGameArt mirror "VRoid Studio CC0 models" (https://opengameart.org/content/vroid-studio-cc0-models); their VRM titles match the beta article names (AvatarSample_D = Sendagaya Shibu, E = Vivi, F = Vita, G = Victoria Rubin), and the article images are `vivi.jpg` / `vita.jpg`. The files' own VRM meta carries VRoid Hub terms that allow everything; the CC0 dedication on pixiv's pages is the license that applies.
- 100Avatars: VRM files from the arweave links in `data/avatars/100avatars-r1.json` of the Open Source Avatars registry (opensourceavatars.com); the project entry and each file's VRM meta (author Polygonal Mind) say CC0.
- No Nintendo, Game Freak or other ripped character models.

Optimization (`scripts/optimize-trainers.mjs`, `cd scripts && npm install && node optimize-trainers.mjs`; sources are downloaded to `TRAINER_SRC`, not committed): morph targets no trainer expression uses are dropped (VRoid 41 to 56 targets down to 5), textures are shrunk (face parts 512 px, the rest 1024 px VRoid / 512 px 100Avatars) with premultiplied filtering and opaque ones re-encoded as JPEG, and the binary is rebuilt with only referenced data. The script fails over budget.

| id | source KB | shipped KB | budget KB |
| --- | --- | --- | --- |
| shibu | 16456 | 4521 | 4700 |
| vivi | 17516 | 4302 | 4700 |
| vita | 13866 | 3771 | 4700 |
| hana | 17534 | 3260 | 4700 |
| kai | 18504 | 3658 | 4700 |
| kate | 1369 | 395 | 600 |
| kyle | 1756 | 451 | 600 |
| classic | (plaza host file) | 5530 | shared with the host |

Picker portraits: `frontend/public/trainers/<id>.png` (192 x 256, light grey outfit) and `<id>-mask.png` (outfit coverage, where a red and a blue outfit render differently) are rendered offline by `qa/trainer.html` (`__qa.portraits()`) and tinted in CSS. Regenerate them after changing a model or the tint mask.
