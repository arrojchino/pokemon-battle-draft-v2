# Assets and licenses

## Partner models

Each license below was read from the license metadata embedded in the VRM file itself and cross-checked with the publisher's page. Names, ages and personalities are original to this project; all partners are adults.

| Partner | Source model | Author | License (from VRM meta) | Source |
|---|---|---|---|---|
| Rei Amatsuka (25) | Vita (VRoid Studio sample) | VRoid Project / pixiv Inc. | `licenseName: CC0`, commercial use allowed | [VRoid help: sample model conditions](https://vroid.pixiv.help/hc/en-us/articles/4402614652569) |
| Kanade Shiomi (27) | VRM1_Constraint_Twist_Sample | pixiv Inc. | VRM Public License 1.0: `avatarPermission: everyone`, `commercialUsage: corporation`, `allowRedistribution: true`, `modification: allowModificationRedistribution`, `creditNotation: unnecessary` | [vrm-c/vrm-specification samples](https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample) |
| Mirei Kurogane (29) | Darkness Shibu (VRoid Studio sample) | VRoid Project / pixiv Inc. | `licenseName: CC0`, commercial use allowed | [VRoid help: sample model conditions](https://vroid.pixiv.help/hc/en-us/articles/4402614652569) |

Credit is shown in the in-game Credits dialog even where it is not required.

**Figure tuning.** `ROSTER[].figure.bust` scales each model's own secondary chest bones (`J_Sec_L/R_Bust1`) at load (clamped 0.8 to 1.5; spring-bone rest state is re-captured). Body and outfit are skinned to those bones, so clothing follows and nothing is exposed. Both licenses allow modification (CC0; VRM Public License 1.0 `modification: allowModificationRedistribution`). The select-screen portraits are pre-rendered and were not regenerated.

Candidates rejected and why: Sendagaya Shino and Sakurada Fumiriya (school uniforms read as students), Vivi (child proportions), Seed-san (youthful), AvatarSample A to C (non-CC0 conditions; usable but kept the set consistent).

## Model pipeline

`tools/optimize_vrm.py in.vrm out.vrm [--max 1024] [--quality 88]`

General glTF optimizers renumber nodes and textures and drop unknown extensions, which silently breaks VRM humanoid, expression and spring-bone references. This tool only rewrites image payloads and the BIN chunk: textures become WebP via the standard `EXT_texture_webp` extension (alpha kept, normal maps at higher quality), large textures are capped at 1024 px, and the embedded thumbnail drops to 256 px. Results: 45.6 MB → 14.0 MB for the three models.

At load time `loadVrm.ts` additionally removes unused vertices, combines skeletons and merges skinned meshes that share materials (draw items per character: Rei 90 → 28, Mirei 71 → 27, Kanade 20).

Not done here and worth doing with a full toolchain: KTX2/Basis texture compression (needs `toktx`/`basisu` plus a VRM-aware pass) and meshopt geometry compression.

## Adding a partner

1. Find a VRM with a license that allows your use; read its embedded meta (`extensions.VRM.meta` for 0.x, `extensions.VRMC_vrm.meta` for 1.0).
2. `python3 tools/optimize_vrm.py source.vrm frontend/public/assets/models/<id>.vrm`
3. Add `<id>` to `CHARACTER_IDS` in `shared/src/characters.ts` (the server whitelist) and an entry to `ROSTER` in `frontend/src/characters/roster.ts` (idle style, energy, tempo, emote mapping, accent colors, credit).
4. Render a portrait (any 640×800 framing of the character on stage) to `frontend/public/assets/portraits/<id>.webp`.
5. Add a slot position in `World.selectSlots` if the lineup grows beyond three.

Poses are authored in VRM 1.0 normalized-bone space; VRM 0.x models are mirrored automatically. Expressions are matched by name, case-insensitively, so custom clips such as VRoid's `Surprised` work.

## Other assets

- Fonts: Chakra Petch, Manrope, Zen Kaku Gothic New (SIL OFL 1.1, licenses in `frontend/src/assets/fonts/`). Subset to the glyphs used (the Japanese face is 23 KB instead of 2.3 MB). Regenerate with `tools/subset_fonts.sh` after adding Japanese UI text.
- Pokémon artwork: loaded at runtime from the PokeAPI sprites repository (as in v1), with a lettered placeholder if it fails.
- Everything else (sky, city, shrine, lanterns, petals, coin faces, sigils) is procedural code in `frontend/src/engine/world/`.
- Removed: the casino dealer atlas and portrait.
