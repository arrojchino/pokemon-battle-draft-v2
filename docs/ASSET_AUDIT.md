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

Every one of the 38 species battles as an animated 3D model. Grades as measured by `qa/models.html` with the shipped plan:

| Grade | A | B | C | F |
| --- | ---: | ---: | ---: | ---: |
| Species | 5 | 33 | 0 | 0 |

B here mostly means the Pokémon HOME set: authored idle, physical attack, special attack (and roar for most), 512 px textures, no damage or faint clips (the stage flinches and topples those procedurally).

| Pokémon | Dex | Grade | Source | Triangles | Texture | Clips | Why this source |
| --- | ---: | :---: | --- | ---: | ---: | --- | --- |
| Gholdengo | 1000 | B | Pokémon HOME | 9,584 | 512 px | 3 | API file shows its coin board apart |
| Great Tusk | 984 | B | Pokémon 3D API | 9,982 | 1024 px | 84 | own clips |
| Iron Valiant | 1006 | B | Pokémon HOME | 18,564 | 512 px | 3 | API: static rig |
| Kingambit | 983 | A | Pokémon 3D API | 10,693 | 1024 px | 46 (battle set) | own battle set |
| Clodsire | 980 | B | Pokémon HOME | 7,072 | 512 px | 3 | API: static rig |
| Tinkaton | 959 | B | Pokémon HOME | 25,271 | 512 px | 3 | API: static rig |
| Dondozo | 977 | B | Pokémon HOME | 12,878 | 512 px | 3 | not in the API |
| Annihilape | 979 | A | Pokémon 3D API | 9,937 | 1024 px | 48 (battle set) | own battle set |
| Meowscarada | 908 | B | Pokémon HOME | 22,456 | 512 px | 3 | API: static rig |
| Skeledirge | 911 | A | Pokémon 3D API | 9,798 | 1024 px | 54 (battle set) | own battle set, two stray meshes dropped |
| Quaquaval | 914 | B | Pokémon HOME | 30,670 | 512 px | 3 | API body collapses |
| Garganacl | 934 | A | Pokémon 3D API | 5,700 | 1024 px | 47 (battle set) | own battle set |
| Baxcalibur | 998 | B | Pokémon HOME | 7,710 | 512 px | 3 | API: 1 clip |
| Dragapult | 887 | B | Pokémon HOME | 14,962 | 512 px | 4 | API: 4 clips |
| Corviknight | 823 | B | Pokémon HOME | 15,300 | 512 px | 4 | API: static rig |
| Rotom-Wash | 479 (form) | B | Pokémon HOME | 6,138 | 512 px | 4 | API has the base form only |
| Garchomp | 445 | B | Pokémon HOME | 6,522 | 512 px | 3 | API: static rig |
| Azumarill | 184 | B | Pokémon HOME | 4,436 | 512 px | 4 | API: static rig |
| Volcarona | 637 | B | Pokémon HOME | 4,772 | 512 px | 4 | API: static rig |
| Breloom | 286 | B | Pokémon HOME | 5,474 | 512 px | 4 | API: static rig |
| Gengar | 94 | B | Pokémon HOME | 5,238 | 512 px | 4 | API: static rig |
| Serperior | 497 | B | Pokémon HOME | 6,006 | 512 px | 3 | API bind pose is a straight pole |
| Grimmsnarl | 861 | B | Pokémon HOME | 16,698 | 512 px | 4 | not in the API |
| Hydreigon | 635 | B | Pokémon HOME | 6,198 | 512 px | 4 | API: static rig |
| Maushold | 925 | B | Pokémon HOME | 20,788 | 512 px | 3 | API: static rig |
| Ditto | 132 | B | Pokémon HOME | 3,604 | 512 px | 3 | API: static rig |
| Sneasler | 903 | B | Pokémon HOME | 5,686 | 512 px | 3 | API: 3 clips |
| Toxapex | 748 | B | Pokémon HOME | 11,756 | 512 px | 4 | API: static rig |
| Clefable | 36 | B | Pokémon HOME | 4,802 | 512 px | 4 | API: static rig |
| Scizor | 212 | B | Pokémon HOME | 5,562 | 512 px | 4 | API: 1 clip |
| Iron Hands | 992 | B | Pokémon HOME | 20,848 | 512 px | 3 | not in the API |
| Sinistcha | 1013 | B | Pokémon HOME | 17,576 | 512 px | 4 | not in the API |
| Mimikyu | 778 | B | Pokémon HOME | 6,786 | 512 px | 4 | API: static rig |
| Hatterene | 858 | B | Pokémon HOME | 16,964 | 512 px | 4 | API: static rig |
| Froslass | 478 | B | Pokémon HOME | 5,094 | 512 px | 4 | API: static rig |
| Pawmot | 923 | B | Pokémon HOME | 10,016 | 512 px | 3 | API: 1 clip |
| Kilowattrel | 941 | A | Pokémon 3D API | 7,476 | 1024 px | 59 (battle set) | own battle set |
| Sableye | 302 | B | Pokémon HOME | 4,242 | 512 px | 4 | API: static rig |

## Decisions

- **Two sources.** The Pokémon 3D API keeps the six species where it has Scarlet/Violet clip sets (five full battle sets, plus Great Tusk's 84 clips). Everything else uses its Pokémon HOME model (`FROM_HOME` in `monModel.ts`): the four species the API lacks, the three it ships broken, Rotom-Wash (the API only has the base form) and every species it only has as a static rig or with one to four clips. A HOME model with an authored idle and two attacks beats a static rig with procedural motion.
- **The broken API files were not broken in the same way at the source.** Gholdengo's "parts apart" is its coin board and coins, a prop that HOME's idle and attack clips keep hidden through `CusAnimVis_*` visibility nodes; the game applies those tracks, so Gholdengo stands without the stray board. Serperior and Quaquaval are complete in HOME.
- **Fitting happens in the idle pose for real.** Stopping an animation mixer restores the bind pose, which the old fit measured by mistake; the box is now taken while the idle is applied, over visible meshes only. Serperior (a straight pole in its bind pose) and the HOME props stopped shrinking their Pokémon.
- **Garchomp's Legends Z-A model** (`models/opt/za/445.glb`) was tried and dropped; HOME's is used.

## Limits

- HOME textures are 512 px (often half-width and mirrored), below the API's 1024 px battle sets; the clips and blinking eyes are worth more on stage than the extra resolution.
- HOME clips cover idle, physical attack, special attack and roar only. Damage and faint stay procedural (flinch, topple) for those 32 species.
- Downloads: a HOME species is 0.3 to 1.3 MB of GLB, a few small PNGs and three or four gzipped clip files; the API battle sets are 2.4 to 11 MB. Team Preview fetches and compiles all twelve Pokémon of a match.
- Licensing: no model, texture or clip is bundled or redistributed by this repository. They are fetched at runtime from the Pokémon 3D API and from public Pokémon HOME exports on GitHub (`Lilothestitch16/Pokemon-HOME-GLB-Models`, `Lilothestitch16/Pokemon-HOME-Unity-Models`); `homeManifest.ts` holds paths and texture transforms only. The assets are property of Nintendo, Creatures Inc. and GAME FREAK. This is an unofficial, non-commercial fan project.

## Visual regression checklist

Run the dev server (`cd frontend && npx vite --port 5170 --strictPort --host 127.0.0.1`) and check:

1. `http://127.0.0.1:5170/pokemon-battle-draft-v2/qa/models.html?ids=658,149,150,249,160,330,909,183,999,987,848,983,811,875&cols=7&h=420` (`&use=home` or `&use=model` forces a source for comparison): every partner loads with a battle set (grade A or B) and smooth shading, no see-through bodies, feet on the floor. Without `ids` the sheet shows the draft pool; `act=attack01` loops an action on every model.
2. The title screen shows the partner with smooth shading and no console errors (`window.__WORLD__.stats()` reports fps, draw calls and triangles).
3. In the console, drive the stage without a live match: `__WORLD__.setLayout({mode:'arena', mine:'greninja', theirs:'kingambit'})`, then `__WORLD__.battle.switchIn(0, 445, 'Garchomp', '#5b6cff', false)` and `__WORLD__.battle.switchIn(1, 983, 'Kingambit', '#e04848', false)`: a Poké Ball arcs in, opens in a flash and each Pokémon grows in facing its opponent.
4. `__WORLD__.battle.move(0, 'Dragon Claw', 'Dragon', 'Physical', 1)`, then `__WORLD__.battle.hit(1, 0.45, true, 'super', '#7b5bff')`: the attacker strikes as the slash lands, the target flinches with its damage clip and a flash.
5. `__WORLD__.battle.move(1, 'Shadow Ball', 'Ghost', 'Special', 0)`: a ranged attack clip, then the projectile.
6. `__WORLD__.battle.faint(1)`: the collapse clip (or a topple for models without one), then a fade; nothing is left floating.
7. `__WORLD__.battle.status(0, 'slp')`: the sleep loop or a drowsy droop; `__WORLD__.battle.status(0, null)` wakes it.
8. Switch the same species back in (a revive): it returns at full opacity in a clean idle, with no leftover tint or held pose.
9. Draft Pool: the card grid scrolls with the wheel or touch anywhere over it. The UI layer ignores the pointer except on allow-listed elements, so every scrolling region needs the `scroller` class, or the 3D stage behind it takes the wheel.
10. Smoothness: during a scripted exchange `__WORLD__.stats().p95` stays near the display's frame interval; camera beats glide (only the battle intro and the biggest hits cut) and hits wobble smoothly instead of jittering. The browser harness drops input outside the real window, so test wheel scrolling inside `innerWidth` by `innerHeight`, not inside an emulated viewport.
