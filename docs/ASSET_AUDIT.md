# Asset audit

Audit of every 3D Pokémon the game shows, run on 2026-11-21 against the community [Pokémon 3D API](https://github.com/Pokemon-3D-api/assets) (`models/opt/regular/<dex>.glb`). The numbers below come from `frontend/qa/models.html`, a contact sheet that loads each species through the game's own loader and `MonBody` and reports what the file really contains (`auditModel` in `frontend/src/engine/character/monModel.ts`).

## Grades

- **A**: game quality. Skinned, 1024 px textures, at least 3.5k triangles and a full battle clip set (idle, attack, damage, faint).
- **B**: skinned and animated, but lighter (smaller textures or a partial clip set).
- **C**: static rig, static mesh or low resolution.
- **F**: missing from the API.

## What every model goes through at runtime

The API mixes Switch-era models (40 to 113 authored clips) with much older or partial ones, so every instance gets the same treatment before it reaches the stage:

- **Lit PBR materials.** Unlit or arbitrary materials become `MeshStandardMaterial` with believable roughness and metalness (Gholdengo's gold body is the one metal). A shared fresnel rim lifts silhouettes off the night stadium.
- **Alpha.** Bodies flagged as blended render opaque unless the texture's alpha is a real cut-out mask (then alpha test with alpha to coverage). Before this, several bodies were half see-through.
- **Normals.** Meshes exported without normals (all ten of Greninja's, among others) get smooth normals welded by position, so UV seams leave no crease. glTF otherwise requires flat shading, which made them faceted.
- **Levels of detail and stray meshes.** Exports that carry the game's lower LODs (`_lod1`, `_lod2`) lose them: drawing them doubled the cost and z-fought with the full mesh. Skeledirge's file also carries a vertical effect strip and a loose song bird that propped it off the floor; `hide` in `PLAN` drops them.
- **Step-interpolated tracks.** Bone rotations and positions keyed with step interpolation (Pikachu, Pawmot) play linearly; they stuttered at their key rate. Scale tracks stay stepped, since some models swap eyes and mouths with them.
- **Size.** Height is fitted in the idle pose, not the bind pose (single-clip models stand far from their bind pose); wide and long bodies may extend further before they shrink.
- **Procedural layer** (`procedural.ts`). Every rig gets a head that tracks the opponent. Rigs without clips also get their arms lowered out of the T-pose, breathing, a travelling tail wave, lagging ear and feeler sway, and body lean and jaw for attacks and hits.
- **Battle state machine** (`MonBody`). Idle loops (relaxed, battle stance, asleep with its start and end transitions), fidgets from the model's idle variations, one-shot actions that cross-fade in and out, and a held faint pose. Attack clips are time-scaled so the frame where the skeleton moves fastest (the strike, measured once per clip) lands exactly when the move's effect hits.

## Partners

Partners are on screen the longest, so only models with a full battle clip set qualify. Thirteen are grade A; Lugia is B for its 512 px textures.

| Partner | Dex | Grade | Triangles | Texture | Bones | Clips | Download |
| --- | ---: | :---: | ---: | ---: | ---: | ---: | ---: |
| Greninja | 658 | A | 5,952 | 1024 px | 101 | 74 | 7.0 MB |
| Dragonite | 149 | A | 5,699 | 1024 px | 80 | 62 | 5.7 MB |
| Mewtwo | 150 | A | 9,691 | 1024 px | 88 | 71 | 7.6 MB |
| Lugia | 249 | B | 8,078 | 512 px | 121 | 84 | 15.0 MB |
| Feraligatr | 160 | A | 6,552 | 1024 px | 125 | 113 | 12.7 MB |
| Flygon | 330 | A | 6,608 | 1024 px | 126 | 62 | 6.4 MB |
| Fuecoco | 909 | A | 3,876 | 1024 px | 200 | 50 | 5.5 MB |
| Marill | 183 | A | 3,830 | 1024 px | 44 | 74 | 3.8 MB |
| Gimmighoul | 999 | A | 4,191 | 1024 px | 179 | 46 | 3.4 MB |
| Flutter Mane | 987 | A | 5,753 | 1024 px | 124 | 43 | 7.4 MB |
| Toxel | 848 | A | 4,116 | 1024 px | 89 | 43 | 3.8 MB |
| Kingambit | 983 | A | 10,693 | 1024 px | 169 | 46 | 4.6 MB |
| Thwackey | 811 | A | 6,420 | 1024 px | 242 | 48 | 6.8 MB |
| Eiscue | 875 | A | 10,020 | 1024 px | 112 | 74 | 5.8 MB |

## Draft pool (38 sets)

| Grade | A | B | C | F |
| --- | ---: | ---: | ---: | ---: |
| Species | 6 | 6 | 22 | 4 |

30 of the 38 species battle as 3D models; the other 8 keep the artwork projection (4 missing from the API, 3 broken files, and Rotom-Wash's form).

| Pokémon | Dex | Grade | Triangles | Texture | Bones | Clips | In battle |
| --- | ---: | :---: | ---: | ---: | ---: | ---: | --- |
| Gholdengo | 1000 | A | 5,368 | 1024 px | 240 | 71 | artwork (body, coin stack and board sit apart even in the bind pose: broken file) |
| Great Tusk | 984 | B | 9,982 | 1024 px | 244 | 84 | model, own clips plus the procedural layer |
| Iron Valiant | 1006 | C | 6,156 | 512 px | 0 | 0 | model, static mesh (no rig) |
| Kingambit | 983 | A | 10,693 | 1024 px | 169 | 46 | model with its own battle clips |
| Clodsire | 980 | C | 7,448 | 1024 px | 65 | 0 | model with the procedural layer |
| Tinkaton | 959 | C | 16,674 | 1024 px | 150 | 0 | model with the procedural layer |
| Dondozo | 977 | F | - | - | - | - | artwork (not in the API) |
| Annihilape | 979 | A | 9,937 | 1024 px | 213 | 48 | model with its own battle clips |
| Meowscarada | 908 | C | 6,392 | 1024 px | 170 | 0 | model with the procedural layer |
| Skeledirge | 911 | A | 9,798 | 1024 px | 201 | 54 | model with its own battle clips (two stray meshes dropped) |
| Quaquaval | 914 | C | 12,220 | 1024 px | 157 | 0 | artwork (clips stripped, the rest pose collapses the body) |
| Garganacl | 934 | A | 5,700 | 1024 px | 84 | 47 | model with its own battle clips |
| Baxcalibur | 998 | B | 7,194 | 256 px | 92 | 1 | model, own clips plus the procedural layer |
| Dragapult | 887 | B | 13,646 | 1024 px | 210 | 4 | model, own clips plus the procedural layer |
| Corviknight | 823 | C | 15,033 | 1024 px | 115 | 0 | model with the procedural layer |
| Rotom-Wash | 479 | C | 3,078 | 256 px | 9 | 0 | artwork (alternate form; the API has no model for it) |
| Garchomp | 445 | C | 6,433 | 512 px | 36 | 0 | model with the procedural layer |
| Azumarill | 184 | C | 4,226 | 512 px | 31 | 0 | model with the procedural layer |
| Volcarona | 637 | C | 1,892 | 128 px | 0 | 0 | model, static mesh (no rig) |
| Breloom | 286 | C | 11,774 | 32 px | 0 | 0 | model, static mesh (no rig) |
| Gengar | 94 | C | 4,308 | 256 px | 31 | 0 | model with the procedural layer |
| Serperior | 497 | C | 4,395 | 256 px | 40 | 0 | artwork (bind pose is a straight vertical pole, no clips) |
| Grimmsnarl | 861 | F | - | - | - | - | artwork (not in the API) |
| Hydreigon | 635 | C | 5,838 | 256 px | 71 | 0 | model with the procedural layer |
| Maushold | 925 | C | 60,286 | 1024 px | 0 | 0 | model, static mesh (no rig) |
| Ditto | 132 | C | 3,072 | 1024 px | 18 | 1 | model, own clips plus the procedural layer |
| Sneasler | 903 | B | 5,400 | 512 px | 102 | 3 | model, own clips plus the procedural layer |
| Toxapex | 748 | C | 1,506 | 1024 px | 0 | 0 | model, static mesh (no rig) |
| Clefable | 36 | C | 4,681 | 256 px | 42 | 0 | model with the procedural layer |
| Scizor | 212 | B | 5,494 | 256 px | 48 | 1 | model, own clips plus the procedural layer |
| Iron Hands | 992 | F | - | - | - | - | artwork (not in the API) |
| Sinistcha | 1013 | F | - | - | - | - | artwork (not in the API) |
| Mimikyu | 778 | C | 340 | 1024 px | 12 | 1 | model, own clip plus the procedural layer |
| Hatterene | 858 | C | 16,480 | 1024 px | 155 | 0 | model with the procedural layer |
| Froslass | 478 | C | 4,866 | 256 px | 46 | 0 | model with the procedural layer |
| Pawmot | 923 | B | 9,790 | 1024 px | 238 | 1 | model, own clips plus the procedural layer |
| Kilowattrel | 941 | A | 7,476 | 1024 px | 88 | 59 | model with its own battle clips |
| Sableye | 302 | C | 2,588 | 1024 px | 282 | 1 | model, own clips plus the procedural layer |

## Decisions

- **Artwork instead of a model** (`PLAN` in `monModel.ts`): Gholdengo, Serperior and Quaquaval are broken files (parts apart in the bind pose, a straight vertical pole, a collapsed body). Mimikyu, Volcarona and Toxapex are rough (few triangles or no rig) but recognisable, so they battle as models: a rough 3D Pokémon reads better than a missing one. Grimmsnarl, Dondozo, Iron Hands and Sinistcha are not in the API. Rotom-Wash uses an alternate-form artwork id, and the API has no model for that form. These ten species appear as the holographic artwork projection.
- **Static rigs stay as models.** Most C-grade pool species only exist in the API as static rigs. With materials fixed and the procedural layer on top they read as living Pokémon, and they keep their 3D silhouette from every camera angle, which a flat card cannot.
- **Garchomp's Legends Z-A model** (`models/opt/za/445.glb`) was tried and dropped; the regular model is used.

## Limits

- C-grade pool species move through the procedural layer, not authored clips. Iron Valiant, Breloom, Maushold, Volcarona and Toxapex have no rig at all, so they only move as a whole body (send-out, hop, rush, recoil, topple on faint). Raising them needs better sources; the API has nothing better for these species.
- Partner models are heavy downloads: 3.4 to 15 MB each, mostly animation data. Each player's partner is fetched on demand and cached for the session; the artwork card stands in until it arrives.
- Licensing: no model is bundled or redistributed by this repository. They are fetched at runtime from the Pokémon 3D API, which sources them from Sketchfab and credits them as property of Nintendo, Creatures Inc. and GAME FREAK. This is an unofficial, non-commercial fan project.

## Visual regression checklist

Run the dev server (`cd frontend && npx vite --port 5170 --strictPort --host 127.0.0.1`) and check:

1. `http://127.0.0.1:5170/pokemon-battle-draft-v2/qa/models.html?ids=658,149,150,249,160,330,909,183,999,987,848,983,811,875&cols=7&h=420`: every partner loads with a battle set (grade A or B) and smooth shading, no see-through bodies, feet on the floor. Without `ids` the sheet shows the draft pool; `act=attack01` loops an action on every model.
2. The title screen shows the partner with smooth shading and no console errors (`window.__WORLD__.stats()` reports fps, draw calls and triangles).
3. In the console, drive the stage without a live match: `__WORLD__.setLayout({mode:'arena', mine:'greninja', theirs:'kingambit'})`, then `__WORLD__.battle.switchIn(0, 445, 'Garchomp', '#5b6cff', false)` and `__WORLD__.battle.switchIn(1, 983, 'Kingambit', '#e04848', false)`: a Poké Ball arcs in, opens in a flash and each Pokémon grows in facing its opponent.
4. `__WORLD__.battle.move(0, 'Dragon Claw', 'Dragon', 'Physical', 1)`, then `__WORLD__.battle.hit(1, 0.45, true, 'super', '#7b5bff')`: the attacker strikes as the slash lands, the target flinches with its damage clip and a flash.
5. `__WORLD__.battle.move(1, 'Shadow Ball', 'Ghost', 'Special', 0)`: a ranged attack clip, then the projectile.
6. `__WORLD__.battle.faint(1)`: the collapse clip (or a topple for models without one), then a fade; nothing is left floating.
7. `__WORLD__.battle.status(0, 'slp')`: the sleep loop or a drowsy droop; `__WORLD__.battle.status(0, null)` wakes it.
8. Switch the same species back in (a revive): it returns at full opacity in a clean idle, with no leftover tint or held pose.
9. Draft Pool: the card grid scrolls with the wheel or touch anywhere over it. The UI layer ignores the pointer except on allow-listed elements, so every scrolling region needs the `scroller` class, or the 3D stage behind it takes the wheel.
10. Smoothness: during a scripted exchange `__WORLD__.stats().p95` stays near the display's frame interval; camera beats glide (only the battle intro and the biggest hits cut) and hits wobble smoothly instead of jittering. The browser harness drops input outside the real window, so test wheel scrolling inside `innerWidth` by `innerHeight`, not inside an emulated viewport.
