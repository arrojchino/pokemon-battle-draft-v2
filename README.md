# Pokémon Battle Draft · Back Alley League

A two-player Pokémon draft game presented as a grimy back-alley battle show. Paint your scrappy battle bot, call the coin (the first caller is random, then the winner of the previous game calls), let the toss winner privately choose one of two dealt six-Pokémon teams, then battle **right in the app** (no account, no import) or on Pokémon Showdown, in a best-of-3 or best-of-5 series.

The game rules, the 38-set pool, the Showdown export format and server-authoritative multiplayer are unchanged from the original casino build. Everything you see and touch is new: a rain-soaked back-alley arena rendered in three.js, a comic battle bot each player repaints, and a redesigned interface.

## Quick start

```bash
# terminal 1: authoritative WebSocket backend on ws://127.0.0.1:8787 (health: /health)
cd backend && npm install && npm run build && npm start

# terminal 2: frontend on http://127.0.0.1:5173/pokemon-battle-draft-v2/
cd frontend && npm install && VITE_BACKEND_URL=ws://127.0.0.1:8787 npm run dev
```

Windows: `scripts/start-backend.ps1` and `scripts/start-frontend.ps1` (or the `.sh` versions on macOS/Linux).

Open two browser windows. In the first, **Play online**, pick a paint job and **Create room**, then copy the invite link. Open it in the second window, pick a paint job and join. Refreshing either window resumes the same seat.

Without `VITE_BACKEND_URL` the frontend uses the public PeerJS relay and the room creator's browser is the authority. To point a deployed frontend at your own backend, open it with `?ws=wss://your-backend.example` once (remembered locally).

**First install after upgrading:** the frontend no longer uses `@pixiv/three-vrm` (removed) and the backend now depends on `pokemon-showdown` (the MIT battle simulator). Run `npm install` in both `frontend/` and `backend/` and commit the regenerated `package-lock.json` files. CI falls back to `npm install` until you do.

## Bots, paint and sound

- **Partners are battle bots.** Everyone gets the same comic robot (RobotExpressive by Tomás Laulhé / Quaternius, CC0, 464 KB) and picks one of eight paint jobs in the **Paint shop**: Rust Bucket, Toxic Waste, Caution Tape, Hot Rod, Bruiser, Coolant Leak, Oil Slick and Bone Dry. Paint is applied at runtime with procedural grime (rust creeping up from the feet, scuffs), so it costs no extra downloads. Your opponent sees your paint.
- Bots react with the model's own animation clips and facial morphs: wave, thumbs up, jump, dance on wins, angry shadow punches when their Pokémon attacks, and a full faceplant when they lose a series. Each reaction comes with robot gibberish.
- **Grimy look:** steel-plate panels with stains, scratches and grain (all generated, no images), hazard tape on the dock and on a low turn timer, segmented HP gauges, and a classic message box in the command dock that colours critical hits, super-effective hits, misses and K.O.s. The 3D grade adds sodium tint, film scratches and dust, heavier in the arena.
- **The alley:** the stage sits in a rain-soaked back alley. GPU rain streaks slanting in the wind; wet asphalt with puddles that mirror the scene (planar reflection on high quality), rain ripples, cracks and oil sheen; a spray-painted hazard ring; brick walls with graffiti; flickering neon ("BOT PIT", a dying "OPEN 24/7", "NO REFUNDS") that really lights the bots; a burning barrel with embers and a flickering firelight; a steam vent; strings of bare bulbs with a couple of dying ones; a chain-link fence, a dumpster, a smoggy sky with drifting clouds lit orange by the city, and distant lightning every 12 to 30 seconds followed by thunder. Reduced motion steadies the neon and the fire and turns lightning off.
- **Sound:** everything is synthesized live with the Web Audio API (`frontend/src/audio/sound.ts`), so there are no audio files to download or license. 57 cues cover UI ticks and clunks, the coin, the draft, every move archetype (punches, slashes, flames, water, zaps, beams, orbs, quakes, meteors, coins, heals, shields), hits, crits, faints, Tera, stamps, win and lose stings, and bot chirps panned to where they stand, and thunder. Two generated music beds: a rainy alley drone with sparse plucks for menus and a crunchy half-time groove for battles. Volume, music and mute live in Settings. Audio starts on your first click or key press (browser autoplay rules).

## In-app battles

When the room uses a backend (`VITE_BACKEND_URL` or `?ws=`), **Battle here** is the default in room setup and can be switched from the room menu between games.

- The server runs each game with the official simulator package `pokemon-showdown` (MIT, the same engine Showdown uses), format `[Gen 9] Pure Hackmons`: Team Preview and no bans or clauses, like Custom Game, but the rival's HP is reported in percent (Custom Game is a debug format that reports exact HP to both players, which would reveal the hidden set). The drafted sets go in unchanged.
- Each player receives only their own side's stream, so the opponent's moves, items and exact HP are never sent to your browser. Choices are validated twice (wire regex, then the simulator).
- The server decides the winner and records it; manual result reporting is disabled for these games. Forfeit is available, and a tie replays the game.
- Decision timer: 150 s per turn, 90 s for Team Preview (`BATTLE_DECISION_SECONDS`, `BATTLE_PREVIEW_SECONDS`). When it runs out the simulator plays the default choice, so an idle player cannot stall the room.
- Refreshing or reconnecting mid-battle replays the log and restores the exact position.
- **Showdown-style hints.** Every move button shows its effectiveness against the opposing Pokémon (x4, x2, ½, ¼, ✕) and a STAB tag. Hover (or press and hold on touch) for a card with power (and STAB power), accuracy, PP, priority, the description and why it lands the way it does: type chart, Terastallized typing, Levitate, Air Balloon, Volt Absorb, Good as Gold, Magic Bounce, Purifying Salt, Mold Breaker, powder and status immunities. Hovering a Pokémon (your bench, either active plate, or the team preview) shows its ability, item, moves with their matchups, a weakness and resistance chart, and how hard the opposing active's types hit it. Both teams are public after the draft, so this is fair information. The type chart and move data are generated from Pokémon Showdown's own data (`backend/scripts/gen-moves.mjs`); the simulator stays the authority.
- **Staging:** a Pokémon-style diagonal field. Your partner stands behind your Pokémon near the lens, the opponent's across the field, and the two partners face each other. Pokémon appear as holographic projections from floor emitters; your side is mirrored so both face each other.
- **Every move is animated.** All 101 moves in the pool have a hand-picked recipe (`frontend/src/engine/battle/moveFx.ts`): physical rushes with afterimages (slashes, punch shockwaves, bites, flurries, spins), flamethrower and hydro streams, lightning, beams, shadow balls and seeds, psychic pulses, tornadoes, leaf storms, falling meteors, coins and salt, Earthquake with erupting spikes, shields, screens, buffs, heals and hazards. Effects light the scene with real point lights.
- **Cinematic camera:** over-the-shoulder windups, low hero angles for the opponent, side-on tracking for rushes, impact close-ups with a dutch angle, wide shots for field moves, orbits for Tera and self moves, slow push-ins on faints, and a breathing establishing shot between turns. Heavy hits add hit-stop, a zoom punch, radial blur and a screen flash. Reduced motion keeps a steady camera and skips punches.
- The partners react: they cheer big hits and Terastallization, wince when their side takes damage, and celebrate or slump at the end.
- The PeerJS fallback (no backend) cannot run the simulator, so those rooms keep the Showdown flow.

`?fast` speeds up battle playback (useful for testing).

## Tests

```bash
cd frontend && npm test          # Vitest: pool, dealing, export format, room reducer, protocol validation, switching rules (51 tests)
cd frontend && npm run build     # strict tsc + Vite production build
cd backend && npm run build && BATTLE_DECISION_SECONDS=3 npm start &  npm test   # flow + in-app battle tests with two real clients
```

URL switches for checking things by hand: `?perf` (diagnostics overlay), `?quality=low|medium|high`, `?nowebgl` (forces the still-portrait fallback).

## Repository layout

| Path | What it is |
|---|---|
| `shared/` | Isomorphic game core used by both the backend and the PeerJS host: pool data, dealing rules, the pure room reducer and the versioned wire protocol with validation. |
| `backend/` | Node + `ws` room server: identity, seats, tokens, rate limits, presence, expiry, and `battle.ts` (one simulator session per in-app game). Rules come from `shared/`. |
| `frontend/src/battle/` | Protocol parser (`model.ts`), playback queue (`controller.ts`) and the bridge from battle events to the 3D stage and partner reactions. |
| `frontend/src/engine/` | three.js engine: one renderer and one loop, environment, battle bot rig (`character/BotRig.ts`), camera director, post-processing, adaptive quality. |
| `frontend/src/net/` | One `Transport` interface with two implementations (WebSocket backend, PeerJS host). |
| `frontend/src/ui/` | React screens: title, partner select, room setup, match (toss, draft, battle, history). |
| `frontend/public/assets/` | The battle bot model (`models/bot.glb`). Portraits are generated SVG badges. |
| `frontend/src/audio/` | Synthesized sound effects and music. |
| `tools/` | `subset_fonts.sh`. |
| `docs/` | Architecture, assets and licenses, performance, and the audit of the original build. |

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
- [docs/ASSETS.md](docs/ASSETS.md): the bot model and its license, paint jobs, generated textures and audio.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): quality tiers, adaptive resolution, measurements, profiling switches.
- [docs/AUDIT.md](docs/AUDIT.md): what the original build did, what was kept, fixed and replaced.

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project; Pokémon artwork is loaded at runtime from the PokeAPI sprites repository.
