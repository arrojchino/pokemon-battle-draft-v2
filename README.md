# Pokémon Battle Draft · Yozakura League

A two-player Pokémon draft game presented as an anime battle experience. Pick one of three fully 3D partners, call the coin, let the toss winner choose one of two dealt six-Pokémon teams, then battle **right in the app** (no account, no import) or on Pokémon Showdown, in a best-of-3 or best-of-5 series.

The game rules, the 38-set pool, the Showdown export format and server-authoritative multiplayer are unchanged from the original casino build. Everything you see and touch is new: a night-time rooftop shrine rendered in three.js, three rigged VRM characters with procedural animation, and a redesigned interface.

## Quick start

```bash
# terminal 1: authoritative WebSocket backend on ws://127.0.0.1:8787 (health: /health)
cd backend && npm install && npm run build && npm start

# terminal 2: frontend on http://127.0.0.1:5173/pokemon-battle-draft-v2/
cd frontend && npm install && VITE_BACKEND_URL=ws://127.0.0.1:8787 npm run dev
```

Windows: `scripts/start-backend.ps1` and `scripts/start-frontend.ps1` (or the `.sh` versions on macOS/Linux).

Open two browser windows. In the first, **Play online**, choose a partner and **Create room**, then copy the invite link. Open it in the second window, choose a partner and join. Refreshing either window resumes the same seat.

Without `VITE_BACKEND_URL` the frontend uses the public PeerJS relay and the room creator's browser is the authority. To point a deployed frontend at your own backend, open it with `?ws=wss://your-backend.example` once (remembered locally).

**First install after upgrading:** the frontend depends on `@pixiv/three-vrm` and the backend now depends on `pokemon-showdown` (the MIT battle simulator). Run `npm install` in both `frontend/` and `backend/` and commit the regenerated `package-lock.json` files. CI falls back to `npm install` until you do.

## In-app battles

When the room uses a backend (`VITE_BACKEND_URL` or `?ws=`), **Battle here** is the default in room setup and can be switched from the room menu between games.

- The server runs each game with the official simulator package `pokemon-showdown` (MIT, the same engine Showdown uses), format `[Gen 9] Custom Game` with Team Preview. The drafted sets go in unchanged.
- Each player receives only their own side's stream, so the opponent's moves, items and exact HP are never sent to your browser. Choices are validated twice (wire regex, then the simulator).
- The server decides the winner and records it; manual result reporting is disabled for these games. Forfeit is available, and a tie replays the game.
- Decision timer: 150 s per turn, 90 s for Team Preview (`BATTLE_DECISION_SECONDS`, `BATTLE_PREVIEW_SECONDS`). When it runs out the simulator plays the default choice, so an idle player cannot stall the room.
- Refreshing or reconnecting mid-battle replays the log and restores the exact position.
- The partners react on stage: they cheer big hits and Terastallization, wince when their side takes damage, and celebrate or slump at the end. Pokémon appear as holographic cards projected from the arena floor, with type-colored projectiles, impact bursts, camera kicks and a Tera crystal effect.
- The PeerJS fallback (no backend) cannot run the simulator, so those rooms keep the Showdown flow.

`?fast` speeds up battle playback (useful for testing).

## Tests

```bash
cd frontend && npm test          # Vitest: pool, dealing, export format, room reducer, protocol validation (33 tests)
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
| `frontend/src/engine/` | three.js engine: one renderer and one loop, environment, VRM character rig, camera director, post-processing, adaptive quality. |
| `frontend/src/net/` | One `Transport` interface with two implementations (WebSocket backend, PeerJS host). |
| `frontend/src/ui/` | React screens: title, partner select, room setup, match (toss, draft, battle, history). |
| `frontend/public/assets/` | Optimized VRM models and pre-rendered partner portraits. |
| `tools/` | `optimize_vrm.py` (VRM-safe texture compression), `subset_fonts.sh`. |
| `docs/` | Architecture, assets and licenses, performance, and the audit of the original build. |

## Showdown integration (the "On Showdown" mode): what is and is not possible

`play.pokemonshowdown.com` is a cross-origin site. A web page cannot inject a team into it, choose a format or start a battle inside an iframe, and Showdown has no URL parameter that imports a team. This app does not pretend otherwise. It provides the most reliable handoff the browser allows:

1. **Copy my team** puts valid Showdown import text on the clipboard (format unchanged from v1).
2. **Format guidance.** The default is `[Gen 9] Custom Game`, which has no tier bans or clauses beyond Team Preview, so every dealt team is legal. The original build suggested `gen9ou`, but OU's Sleep Moves Clause rejects the pool's Breloom (Spore); the app now warns when OU would reject a dealt team. (Verified against Showdown's `config/formats.ts`.)
3. **Challenge command:** enter your rival's Showdown name to get a ready `/challenge name, format` line.
4. **Open team sheet (PokePaste)** publishes an open team sheet on pokepast.es through a normal form POST in a new tab (verified against PokePaste's open-source `/create` handler).
5. **Direct Team Builder link.** Showdown prints `IN FRAME / Please visit Showdown directly` when framed, so the dead iframe was removed; the app opens `play.pokemonshowdown.com/teambuilder` in a real new tab.

In this mode battle results are reported in the app by either player (two-step confirm), as before. Self-hosting a modified Showdown client to get true one-click battles is possible but would make that client subject to AGPL-3.0 source obligations; it is out of scope here.

## Deployment

- **Frontend:** push to `main`. `.github/workflows/deploy.yml` runs the unit tests, the production build, the backend build and the two-client flow test, then deploys `frontend/dist` to GitHub Pages at `/pokemon-battle-draft-v2/` (`https://arrojchino.github.io/pokemon-battle-draft-v2/`).
- **Backend:** deploy from the repository root (it imports `../shared`): build with `cd backend && npm ci && npm run build`, start with `npm start`. Environment: `PORT`, `ALLOWED_ORIGIN` (comma-separated), `ROOM_TTL_MINUTES`, `MAX_ROOMS`, `BATTLE_DECISION_SECONDS`, `BATTLE_PREVIEW_SECONDS`. Each live battle costs roughly a few MB of memory on the server. GitHub Pages is HTTPS, so the backend must be served over `wss://`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, character rig, networking and protocol, state flow.
- [docs/ASSETS.md](docs/ASSETS.md): character models and their verified licenses, the VRM pipeline, adding a partner.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): quality tiers, adaptive resolution, measurements, profiling switches.
- [docs/AUDIT.md](docs/AUDIT.md): what the original build did, what was kept, fixed and replaced.

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK inc. This is an unofficial fan project; Pokémon artwork is loaded at runtime from the PokeAPI sprites repository.
