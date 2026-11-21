# Architecture

## Overview

```
shared/src            pure game core (no deps): pool, rules, reducer, protocol
   ▲         ▲
backend/     frontend/src/net/peerTransport.ts      both authorities call shared `reduce()`
   ▲                    ▲
frontend/src/net  ──  Transport interface  ──  useSession() (useSyncExternalStore)
                                                     │
frontend/src/ui (React screens)  ── imperative calls ──►  frontend/src/engine/World (three.js)
```

React never re-renders per frame. The engine owns one canvas, one `WebGLRenderer` and one `setAnimationLoop`; React calls a handful of imperative methods (`setLayout`, `emote`, `hover`, `flipCoin`, `setQuality`) and listens to typed events.

## Game core (`shared/`)

- `pool.ts`: the original 38 sets, byte-identical, plus species `types` (from PokeAPI's `pokemon_types.csv`) and `artId` for alternate forms (Rotom-Wash previously showed base Rotom's artwork).
- `rules.ts`: `generateTeams`, `teamImport`, `coinWinner`, `winsNeeded`, unchanged behavior. The rare fallback path now uses an unbiased shuffle.
- `room.ts`: `reduce(room, seat, action, rng)` is the single authoritative rule set. It is pure (never mutates input) and takes injected randomness, so the backend (Node `crypto`) and the PeerJS host (`crypto.getRandomValues`) run identical rules. `publicView()` strips bearer tokens before broadcast.
- `protocol.ts`: `parseClientMessage()` validates every untrusted message (types, room code format, name sanitizing including control and bidi characters, avatar whitelist). `parseServerMessage()` normalizes v1 server state so the UI has one shape.

### Protocol v2 (backward compatible)

| | v1 | v2 |
|---|---|---|
| Player tokens in broadcasts | yes (any client could take over the other seat) | never |
| `hello` | `{type}` | `{type, protocol: 2}` |
| players[] | `{name, token}` | `{name, avatar, connected}` |
| New messages | | `avatar` (whitelisted partner id) |
| Errors | some silent | every rejected action gets a typed reason |

The original v1 `backend/tests/flow.mjs` passes unchanged against the v2 server, and v2 clients read v1 servers through `parseServerMessage`.

### Protocol v3: in-app battles

| Addition | Shape |
|---|---|
| Room fields | `mode: 'app' \| 'showdown'`, `battle: {id, status: 'preview' \| 'active', turn} \| null`, `RoundRecord.turns` |
| `create` | adds optional `mode` |
| Client `choose` | `{choice}`, must match `^(move [1-4]( terastallize)?\|switch [1-6]\|team [1-6]{1,6}\|default\|undo)$` before it reaches the simulator |
| Client `forfeit`, `mode` | forfeit the live battle; switch mode between games only |
| Server `battle` | `{id, lines, reset, deadline}`: protocol lines for this seat only; `reset` means replace the local log (join, resume, reconnect) |
| Server-only actions | `battleStatus`, `battleEnd` go through the same `reduce()` but `parseClientMessage` can never produce them, so a client cannot report an in-app result |

### Protocol v4: lobbies, one caller, private views

| Addition | Shape |
|---|---|
| `create` | adds `visibility: 'private' \| 'public'`; public rooms are listed until a rival sits down |
| Client `lobbies`, `quick` | list open public rooms (`{lobbies, now}`), or take the longest-waiting one (else open a public room) |
| Room `caller` | the seat that calls this coin: random for the first game of a series, then the winner of the previous game; a draw keeps the caller. Calling flips the coin at once |
| Per-seat views | `publicView(room, connected, protocol, viewer)`: during the pick only the toss winner receives `candidates`; during a game the rival's six arrive as `rival` (species and types, like Team Preview). Finished games are public in `history` |
| Battle format | `gen9purehackmons`, so the rival's HP reaches each player in percent only (asserted in `backend/tests/sleep.mjs`) |

### Battle flow

```
pick (mode app) -> reduce sets battle {id, preview}
backend syncBattle(): new BattleSession(p1 team, p2 team)  [pokemon-showdown BattleStream + getPlayerStreams]
  p1 stream --lines--> seat 0 socket          p2 stream --lines--> seat 1 socket
  omniscient stream: |teampreview| |turn| -> battleStatus ; |win| |tie| -> battleEnd -> recordWin / replay
client: WsTransport.onBattle -> BattleController (queue + per-line pacing) -> BattleModel (state, log, fx)
        fx -> stageBridge -> World.battle (BattleStage: holograms, move recipes, fx pools, lights, hit-stop)
                             World.battle.cam (BattleCamera beats -> CameraDirector springs, roll, FOV punch)
                             + partner emotes
        snapshot -> BattleArena (plates, HP, move grid, Tera, switches, preview, log, timer)
```

`engine/battle/moveFx.ts` maps every pool move to a recipe and an impact delay. The model uses the same delay to pace `|move|` lines, and the stage defers the hit reaction until the animation lands, so damage numbers, HP drain and the impact always coincide. `BattleCamera.ts` also holds the field geometry (`ARENA`) shared by the stage, the partners' slots and the shots.

The client never learns a result before the server records it: the end banner's Continue button waits for the room state, and series scoring always comes from `reduce()`.

## Backend (`backend/src/index.ts`, `backend/src/battle.ts`)

`battle.ts` owns one simulator session per in-app game: decision timers that play `default` on timeout, forfeits through `>forcelose`, replay on resume, and cleanup with the room. `index.ts` is identity and transport: room codes, seats, resume tokens, origin allow-list, per-socket message rate limit, per-address room-creation limit, room cap, 4 KB max payload, heartbeat-based presence and TTL expiry. All game transitions go through `reduce()`.

## Networking (`frontend/src/net/`)

`getTransport()` creates exactly one transport per page (v1 started both the WebSocket and PeerJS clients unconditionally).

- `WsTransport`: one socket for the session, exponential-backoff reconnect, automatic `resume` with the stored token, queued sends while connecting. (v1 opened a new socket on every create/join and never closed the old ones.)
- `PeerTransport`: PeerJS is loaded lazily. The host runs `reduce()`. Fixes over v1: only the bound guest connection may act as seat 1 (v1 accepted actions from any peer), equal coin calls are rejected (v1 soft-locked the room), guests resume with a token after refresh, and the host reclaims its peer id after a refresh so the room survives.

## Engine (`frontend/src/engine/`)

- `World.ts`: renderer, scene, lights, post chain, layouts, input picking, loop, resize, visibility pause, context-loss handling, disposal. `Layout` is declarative (`title`, `select`, `duo`, `victory`, `arena`); `setLayout` is idempotent. Screen changes use a short fade-to-black cut: characters are re-staged and the camera is cut while dark, then the camera pushes in on the new shot. Fades and the coin run on wall-clock time so slow frames never stall gameplay.
- `CameraDirector.ts`: critically damped springs (`smoothDamp`) for position, target and FOV, subtle handheld drift, pointer parallax. Reduced motion uses cuts.
- `character/monModel.ts`: Draco glTF loader for runtime Pokémon models, one download per species and a skinned clone (`SkeletonUtils.clone`) with its own materials per use, normalised to a height in its idle pose. Each download is repaired once (smooth normals for meshes exported without them, extra LOD meshes dropped) and each instance gets lit PBR materials with cut-out instead of blended alpha and a shared fresnel rim; `PLAN` holds the per-species audit decisions (docs/ASSET_AUDIT.md). `MonBody` owns one model on stage as a small state machine over the model's own clips: idle loops (relaxed, battle stance, asleep with start and end transitions), fidgets, cross-faded one-shot actions, a held faint pose, and attack clips time-scaled so their measured strike frame lands on the move's impact; plus hit flash, status tint and fade.
- `character/home.ts`: Pokémon HOME models: GLB mesh and skeleton, textures and Unity animation clips (YAML) from two public exports, fetched at runtime. Unity's left-handed curves are converted (x mirrored), resampled from their Hermite tangents at 30 fps and named like the Scarlet/Violet clips so the battle state machine needs no special case. Helper nodes carry data in their position: `CusAnimVis_*` toggles props (Gholdengo's coin board stays hidden in every clip the game plays), eye atlases blink by moving their texture a cell at a time. `homeManifest.ts` (generated by `scripts/home-manifest.py`) lists paths and texture transforms only.
- `character/procedural.ts`: procedural animation driven by bone names, for any rig: head look-at toward the opponent, and for rigs without clips arms lowered out of the T-pose, breathing, tail waves, ear and feeler sway, lean and jaw for attacks and hits, a drowsy droop when asleep.
- `character/MonRig.ts`: a partner on the field: placement springs, contact shadow, Poké Ball send-out flash, a gentle turn toward its look target, and reactions as an authored clip plus a light procedural motion that works for every model. Without a model it shows the artwork as a standing card.
- `world/*`: night sky (stars, moon), the stage floor (battle field shader: turf bands, antialiased field lines, accent strip, pulse wave, glow under each Pokémon, planar `Reflector` reflections on high tier), `Stadium.ts` (barrier wall with scrolling LED boards, a lathe-built bowl of stands with a shader crowd and phone flashes, instanced floodlight towers), floodlight shafts and drifting motes (`Atmosphere.ts`), and the coin. Animated elements are driven by shader uniforms; none update geometry on the CPU.
- `post/GradeShader.ts`: display-space grade after tone mapping: split toning, saturation, vignette, faint edge fringe, grain, fade, impact punch (radial blur) and screen flash.
- `../audio/sound.ts`: Web Audio synthesis into a compressor; effects through gentle saturation and a generated reverb. The World emits `sound` events (stage cues, coin) and `cry` events (partner reactions, National Dex number) that the app routes here; the UI adds hover and click sounds by delegation.
- `quality.ts`: tiers and the adaptive controller (see PERFORMANCE.md).

## UI (`frontend/src/ui/`, `frontend/src/styles/`)

Screens: Title → Partner select → Room setup → Match. The match screen derives a view model from authoritative state (`match/model.ts`) and maps phase transitions onto stage layouts and partner reactions (toss winner celebrates, loser reacts, game and series winners get victory moves). Panels: waiting room with invite link, toss, toss result, draft board (two teams with role spread, type spread and Tera types), battle (team strips, Showdown handoff, result report), interval, series complete, history drawer with the full archive. Error boundaries isolate panel failures; settings (quality, motion, diagnostics) persist locally.

## Adding a game mode or screen

Game rules: extend `GameAction` and `reduce()` in `shared/src/room.ts`, add parsing in `protocol.ts`, bump `PROTOCOL_VERSION`, add tests. Both authorities pick it up automatically. Presentation: add a `Layout` variant and its `shotFor` case in `World.ts`, then a React screen that calls `world.setLayout`.
