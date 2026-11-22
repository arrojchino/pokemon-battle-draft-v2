# Pokémon Battle Draft · Stadium League

A two-player Pokémon draft game played in a 3D night stadium. Pick a partner Pokémon, call the coin (the first caller is random, then the winner of the previous game calls), let the toss winner privately choose one of two dealt six-Pokémon teams, then battle **right in the app** (no account, no import) or on Pokémon Showdown, in a best-of-3 or best-of-5 series.

The series rules, the Showdown export format and server-authoritative multiplayer are unchanged from the original casino build. Everything you see and touch is new: a floodlit stadium rendered in three.js, partner Pokémon and battling Pokémon as animated 3D models, and a redesigned interface.

**The deal.** The pool holds 100 species with one competitive set each: the original game's 38 sets, unchanged, plus 62 Gen 9 Battle Factory sets from Pokémon Showdown's data (curated by Smogon). Every game draws 12 at random and splits them into two sixes of the same power. Each species is worth points by its Smogon singles tier (Uber 5, OU 4, UU 3, RU 2, NU 1.5, PU 1), and the two teams always land within one point of each other. Each team also gets a playable mix (at least two attackers or setup sweepers, no more than two hazard setters) and never three Pokémon sharing a type. The toss winner picks a play style, not the stronger team. Over 4,000 simulated deals the gap was 0 or 0.5 points 94% of the time and never above 1, and every species appeared between 0.86 and 1.25 times its fair share.

## Quick start

```bash
# terminal 1: authoritative WebSocket backend on ws://127.0.0.1:8787 (health: /health)
cd backend && npm install && npm run build && npm start

# terminal 2: frontend on http://127.0.0.1:5173/pokemon-battle-draft-v2/
cd frontend && npm install && VITE_BACKEND_URL=ws://127.0.0.1:8787 npm run dev
```

Windows: `scripts/start-backend.ps1` and `scripts/start-frontend.ps1` (or the `.sh` versions on macOS/Linux).

Open two browser windows. In the first, **Play online**, pick a partner and **Create room**, then copy the invite link. Open it in the second window, pick a partner and join. Refreshing either window resumes the same seat.

Without `VITE_BACKEND_URL` the frontend uses the public PeerJS relay and the room creator's browser is the authority. To point a deployed frontend at your own backend, open it with `?ws=wss://your-backend.example` once (remembered locally).

**First install after upgrading:** the frontend no longer uses `@pixiv/three-vrm` (removed) and the backend now depends on `pokemon-showdown` (the MIT battle simulator). Run `npm install` in both `frontend/` and `backend/` and commit the regenerated `package-lock.json` files. CI falls back to `npm install` until you do.

## Partners, stadium and sound

- **Partner Pokémon.** A first visit deals a random partner and opens on the **Partner** screen, where you keep it, pick another or press **Surprise me**: Greninja, Dragonite, Mewtwo, Lugia, Feraligatr, Flygon, Fuecoco, Marill, Gimmighoul, Flutter Mane, Toxel, Kingambit, Thwackey or Eiscue. It stands beside the title menu, in lobbies and on the field between games, and your opponent sees it. Each one is a 3D model from the community [Pokémon 3D API](https://github.com/Pokemon-3D-api/assets) (Draco-compressed glTF, downloaded once and cached), sized from its Pokédex height (compressed, so Lugia still fits the stadium), sent out with a Poké Ball flash. Partners were chosen by audit: every one is a Switch-era rig with its own idle, attack, damage and faint clips ([docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md)). When a model cannot load, the official artwork stands in as a card.
- Partners react to the match with their own animation clips where the model has them (Scarlet/Violet-style models bring idle, notice, glad, attack, damage and faint clips) plus a light procedural layer that works for every model: greet, hop, spin on wins, slump on losses. Big reactions play the Pokémon's own cry (PokeAPI cries, fetched on first use), lower for sad ones, at most once every few seconds.
- **The stadium:** a floodlit night stadium. The battle field has mown turf and classic white lines (boundary, centre line, centre circle with a Poké Ball button, trainer boxes) inside a polished rim with an accent light strip; LED boards along the barrier wall scroll the game's name in your partner's colour; a bowl of stands with a crowd and the odd phone flash; four floodlight towers with faint light shafts; a starry sky with a moon. Planar reflections on the high tier. Reduced motion and Reduce flashing stop the crowd flashes and the scrolling boards.
- **Sound:** sound effects are synthesized live with the Web Audio API (`frontend/src/audio/sound.ts`), so there are no effect files to download or license: UI ticks, the coin, the draft, every move archetype (punches, slashes, flames, water, zaps, beams, orbs, quakes, meteors, coins, heals, shields), hits, crits, faints, Tera, stamps, and win and lose stings. Partner cries are the one recorded sound: each species is loudness-normalized once, its harshest highs cut and its length capped, and cries are spaced out (rare in menus, occasional in the plaza, normal in battle). Two original pieces are composed in code: a warm plaza theme (sparser in the menus, fuller in the plaza) and an energetic battle theme, each with an ambience bed (wind, a fountain, a distant crowd, birds), crossfaded as you move between screens. Settings has a master volume plus music, environment, cries, interface and battle volumes, and mute. Audio starts on your first click or key press (browser autoplay rules).

## The plaza (waiting room)

While a room waits for a rival, and again before each coin call, the stadium floor is a place to walk. Your partner goes where the keys send it (WASD or arrows) or where you click or tap the floor. It turns before it sets off and walks at the pace of its own walk clip, so its feet keep their grip, and the camera follows it. Gestures (Happy, Stretch, Sit, Nap) play the model's own animations; each partner offers the ones its model has. Your rival's partner walks the same field in real time.

- **Chat:** room chat beside the dock (Enter to type). Lines also pop up as speech bubbles over the speaker's partner, and the room keeps the last 40, so a rival who joins or reloads sees them. A mute button hides the rival's lines on your screen.
- **Interact:** Wave, Cheer, Spin, Bow, Nice and Spar play on both screens. Click your rival's partner to walk over and greet it; a Spar within reach makes it flinch. A rival standing between your partner and the camera turns see-through.
- **Limits:** the authority cleans every line (control and bidi characters, 140 characters), the server allows about one line and one emote a second, and positions go only to the other seat, never stored. Both transports support it: the backend relays presence, a PeerJS host sends it straight to its guest.

## The main plaza and watching battles

**Plaza** on the title menu opens the main plaza, shared by every trainer in the menus (up to 20 at a time). It works the same way as the room plaza, on a bigger stadium: the platform is 1.6 times wider, the field 1.25 times, and walking speed follows your partner's height.

- **Chat and gestures for everyone there:** lines pop up over the speaker's partner and the last 40 stay for newcomers; gestures play on every screen, in step with the walk; name tags fade with distance so a crowd stays readable.
- **Mira, the plaza host:** stands at the far edge of the field. Walk up to her (or click her) and press **E** to talk: she finds you a battle, creates one, takes you to watch a live battle, joins a room by code, or tells you what's on right now, from the server's own lists. Walking waits while you talk; Escape leaves.
- **Battles panel:** live battles in public rooms and open lobbies. **Quick match** and **Create** start your own.
- **Watch:** follows a battle from the first trainer's side, with the same stage, camera and log as the players. HP arrives in percent, sets stay hidden, and spectators can't choose anything. **Stop watching** goes back to the plaza. Players see how many people are watching their room. The lobby browser in **Play online** lists live battles too.
- The main plaza and watching need the battle server; the PeerJS fallback has neither.

## In-app battles

When the room uses a backend (`VITE_BACKEND_URL` or `?ws=`), **Battle here** is the default in room setup and can be switched from the room menu between games.

- The server runs each game with the official simulator package `pokemon-showdown` (MIT, the same engine Showdown uses), format `[Gen 9] Pure Hackmons`: Team Preview and no bans or clauses, like Custom Game, but the rival's HP is reported in percent (Custom Game is a debug format that reports exact HP to both players, which would reveal the hidden set). The drafted sets go in unchanged.
- Each player receives only their own side's stream, so the opponent's moves, items and exact HP are never sent to your browser. Choices are validated twice (wire regex, then the simulator).
- The server decides the winner and records it; manual result reporting is disabled for these games. Forfeit is available, and a tie replays the game.
- Decision timer: 150 s per turn, 90 s for Team Preview (`BATTLE_DECISION_SECONDS`, `BATTLE_PREVIEW_SECONDS`). When it runs out the simulator plays the default choice, so an idle player cannot stall the room.
- Refreshing or reconnecting mid-battle replays the log and restores the exact position.
- **Showdown-style hints.** Every move button shows its effectiveness against the opposing Pokémon (x4, x2, ½, ¼, ✕) and a STAB tag. Hover (or press and hold on touch) for a card with power (and STAB power), accuracy, PP, priority, the description and why it lands the way it does: type chart, Terastallized typing, Levitate, Air Balloon, Volt Absorb, Good as Gold, Magic Bounce, Purifying Salt, Mold Breaker, powder and status immunities. Hovering a Pokémon (your bench, either active plate, or the team preview) shows its ability, item, moves with their matchups, a weakness and resistance chart, and how hard the opposing active's types hit it. Both teams are public after the draft, so this is fair information. The type chart and move data are generated from Pokémon Showdown's own data (`backend/scripts/gen-moves.mjs`); the simulator stays the authority.
- **Staging:** a Pokémon-style diagonal field with real field lines. Your Pokémon stands near the lens, seen from behind at three-quarters as in the games, the opponent's across the field, and both face each other. All 100 Pokémon in the pool battle as animated 3D models, downloaded at runtime and cached per species. Eight come from the Pokémon 3D API with their Scarlet/Violet clip sets (idle, attack, ranged attack, and damage and faint for most of them); the other 92 use their Pokémon HOME model, with its own battle idle, physical and special attack clips, a roar for most, and blinking eyes. Until a model has downloaded, the Pokémon appears as a holographic projection of its official artwork.
- **Every move is animated.** All 170 moves in the pool have a hand-picked recipe (`frontend/src/engine/battle/moveFx.ts`): physical rushes with afterimages (slashes, punch shockwaves, bites, flurries, spins), flamethrower and hydro streams, lightning, beams, shadow balls and seeds, psychic pulses, tornadoes, leaf storms, falling meteors, coins and salt, Earthquake with erupting spikes, shields, screens, buffs, heals and hazards. Recipes follow how each move looks in the games: Thunderbolt's forked bolts, Surf's breaking wave, rock spikes for Stone Edge, circling swords for Swords Dance, rings for Calm Mind. Every effect scales with the Pokémon that uses or takes it, so a Mimikyu's Swords Dance is small and a Ting-Lu's Stone Edge is big. Effects light the scene with real point lights.
- **Cinematic camera:** over-the-shoulder windups, low hero angles for the opponent, side-on tracking for rushes, impact close-ups with a dutch angle, wide shots for field moves, orbits for Tera and self moves, slow push-ins on faints, and a breathing establishing shot between turns. Heavy hits add hit-stop, a zoom punch, radial blur and a screen flash. Reduced motion keeps a steady camera and skips punches.
- During a battle the partners leave the field to the battling Pokémon; between games they stand on it and react (cheer, wince, celebrate, slump), crying when they do.
- The PeerJS fallback (no backend) cannot run the simulator, so those rooms keep the Showdown flow.

`?fast` speeds up battle playback (useful for testing).

## Tests

```bash
cd frontend && npm test          # Vitest: pool, dealing, export format, room reducer, protocol validation, switching rules, plaza (67 tests)
cd frontend && npm run build     # strict tsc + Vite production build
cd backend && npm run build && BATTLE_DECISION_SECONDS=3 npm start &  npm test   # two real clients: flow, lobbies, room plaza, main plaza and spectators, in-app battles
```

URL switches for checking things by hand: `?perf` (diagnostics overlay), `?quality=low|medium|high`, `?nowebgl` (forces the still-portrait fallback).

## Repository layout

| Path | What it is |
|---|---|
| `shared/` | Isomorphic game core used by both the backend and the PeerJS host: pool data, dealing rules, the pure room reducer and the versioned wire protocol with validation. |
| `backend/` | Node + `ws` room server: identity, seats, tokens, rate limits, presence, expiry, and `battle.ts` (one simulator session per in-app game). Rules come from `shared/`. |
| `frontend/src/battle/` | Protocol parser (`model.ts`), playback queue (`controller.ts`) and the bridge from battle events to the 3D stage and partner reactions. |
| `frontend/src/engine/` | three.js engine: one renderer and one loop, the stadium, Pokémon model loading and rigs (`character/monModel.ts`, `character/MonRig.ts`), camera director, post-processing, adaptive quality. |
| `frontend/src/net/` | One `Transport` interface with two implementations (WebSocket backend, PeerJS host). |
| `frontend/src/ui/` | React screens: title, partner select, room setup, match (toss, draft, battle, history). |
| `frontend/public/assets/` | The Draco decoder (`draco/`) for the runtime Pokémon models. Models, artwork and cries are fetched at runtime and never bundled. |
| `frontend/qa/` | `models.html`, a dev-server-only contact sheet that loads and grades any species through the game's own loader ([docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md)). Not part of the build. |
| `frontend/src/audio/` | AudioManager: synthesized effects, generated music and ambience, treated partner cries, category volumes. |
| `tools/` | `subset_fonts.sh`. |
| `docs/` | Architecture, assets and licenses, the 3D asset audit, performance, and the audit of the original build. |

## Showdown integration (the "On Showdown" mode): what is and is not possible

`play.pokemonshowdown.com` is a cross-origin site. A web page cannot inject a team into it, choose a format or start a battle inside an iframe, and Showdown has no URL parameter that imports a team. This app does not pretend otherwise. It provides the most reliable handoff the browser allows:

1. **Copy my team** puts valid Showdown import text on the clipboard (format unchanged from v1).
2. **Format guidance.** The default is `[Gen 9] Custom Game`, which has no tier bans or clauses beyond Team Preview, so every dealt team is legal. The original build suggested `gen9ou`, but OU's Sleep Moves Clause rejects the pool's Breloom (Spore); the app now warns when OU would reject a dealt team. (Verified against Showdown's `config/formats.ts`.)
3. **Challenge command:** enter your rival's Showdown name to get a ready `/challenge name, format` line.
4. **Open team sheet (PokePaste)** publishes an open team sheet on pokepast.es through a normal form POST in a new tab (verified against PokePaste's open-source `/create` handler).
5. **Direct Team Builder link.** Showdown prints `IN FRAME / Please visit Showdown directly` when framed, so there is no embedded client; the app opens `play.pokemonshowdown.com/teambuilder` in a real new tab.

In this mode battle results are reported in the app by either player (two-step confirm), as before. Self-hosting a modified Showdown client to get true one-click battles is possible but would make that client subject to AGPL-3.0 source obligations; it is out of scope here.

## Deployment

- **Frontend:** push to `main`. `.github/workflows/deploy.yml` runs the unit tests, the production build, the backend build and the two-client flow test, then deploys `frontend/dist` to GitHub Pages at `/pokemon-battle-draft-v2/`.
- **Backend:** deploy from the repository root (it imports `../shared`): build with `cd backend && npm ci && npm run build`, start with `npm start`. Environment: `PORT`, `ALLOWED_ORIGIN` (comma-separated), `ROOM_TTL_MINUTES`, `MAX_ROOMS`, `BATTLE_DECISION_SECONDS`, `BATTLE_PREVIEW_SECONDS`. Each live battle costs roughly a few MB of memory on the server. GitHub Pages is HTTPS, so the backend must be served over `wss://`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, character rig, networking and protocol, state flow.
- [docs/ASSETS.md](docs/ASSETS.md): runtime Pokémon models, artwork and cries, the partner roster, generated scenery and audio.
- [docs/ASSET_AUDIT.md](docs/ASSET_AUDIT.md): grade of every 3D Pokémon (partners and draft pool), the runtime fixes each model gets, and the visual regression checklist.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): quality tiers, adaptive resolution, measurements, profiling switches.
- [docs/AUDIT.md](docs/AUDIT.md): what the original build did, what was kept, fixed and replaced.

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial, non-commercial fan project; Pokémon models (Pokémon 3D API and public Pokémon HOME exports), artwork and cries (PokeAPI) are loaded at runtime and not bundled.
