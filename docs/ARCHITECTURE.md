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

- `pool.ts`: 100 sets, one per species. The original 38 come first, byte-identical; the other 62 are the main set of each species in Pokémon Showdown's Gen 9 Battle Factory data. Each set carries species `types`, its Smogon singles `tier` (Showdown formats data), optional `ivs` and `artId` for alternate forms (Rotom-Wash).
- `rules.ts`: `generateTeams` draws 12 distinct species, then searches the 462 ways to split them for two playable sixes (`playable`: role mix, at most two per type) within one tier point (`TIER_POINTS`, `teamPower`) and with the closest role spread, and picks one of the best at random. `teamImport`, `coinWinner` and `winsNeeded` are unchanged.
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

### Protocol v5: the plaza

| Addition | Shape |
|---|---|
| Action `chat` | `{text}`, cleaned by `cleanChat()` (control and bidi characters, at most 140 code points). The room keeps its last 40 lines as `chat: [{id, seat, text}]`, seen by both seats; the backend allows about one line a second (bursts of four) |
| Client `move`, `emote` | `{x, z, face}` (pulled back onto the platform by `cleanSpot()`) and `{emote}` from `PLAZA_EMOTES`. The authority relays them to the other seat as `{seat, ...}` and stores neither; the backend passes about 1.5 emotes a second |

`engine/world/Plaza.ts` is pure simulation: this player's walker (keys, click target, collision with the rival, a limited turn rate, eased starts and stops, pluggable walkable `bounds`), other partners replayed from their reported spots a fraction of a second behind (the delay follows each peer's report interval, so slow links still move evenly), and at most ten spots a second while something changes. Plazas are walk-only. `World` turns walkers into rigs (`MonRig.stride` plays the walk loop at the rate that matches ground speed), a follow camera, gaze, floor rings and a see-through rival when it blocks the view.

Walk loops: the SV clips carry root motion (the origin bone travels through the cycle and jumps back on loop). `measureStride` in `monModel.ts` removes that drift once per clip, so loops play seamlessly in place, and turns its length into `walkSpeed`, the pace a partner walks at. Clip changes go through `MonBody.blend`, which fades every weighted action from its current weight, so cutting a fade short never pops the pose.

Gestures (protocol v7): `PLAZA_EMOTES` adds `happy`, `stretch`, `notice`, `nap`, `sit` and `rise`, each one the model's own clip (`glad01`, `refresh01`, `notice01`, `sleep01_*`, `rest01_*`); the original emote names stay valid for older clients and map to the nearest clip. Gestures are done standing still: one stops a walk to a spot, and a peer's gesture plays after the same delay as its movement and is skipped while that partner is walking. Clients show the gesture buttons only to servers that announce protocol 7 or later (`GESTURES_SINCE`). `ui/screens/match/Plaza.tsx` draws name tags and chat bubbles at `World.anchor()` and relays presence between the World and the transport. Partners are fitted in their relaxed idle (standing height); some battle stances crouch lower.

### Protocol v6: the main plaza and spectators

| Addition | Shape |
|---|---|
| Client `hub` | `{on, name, avatar, at}`: enter the main plaza (again to rename or change partner) or leave it; at most `MAX_HUB` (20) members, and seated trainers stay out. The server answers `hub {you, members, chat}` and tells everyone else `hubJoin {member}` or `hubLeave {id}` |
| Client `hubMove`, `hubEmote`, `hubChat` | Relayed to every other member as `{id, ...}`: spots through `cleanSpot()`, lines through `cleanChat()` and numbered, the last 40 kept in memory (`backend/src/hub.ts`). Same rate limits as the room plaza |
| Client `watch {code}`, `unwatch` | Follow a room without a seat (the code is the key, as for joining): `watching {code}`, the room state as a spectator sees it (no candidates, no sets, `rival` null) and `battle` with the public stream (HP in percent, never a request). Rooms carry `watchers` |
| `lobbies` reply | Adds `live: [{code, names, avatars, bestOf, wins, turn, watchers}]`: public battles with at least one trainer still connected |

`ui/screens/HubScreen.tsx` sets the World's `hub` layout (this player's walker plus one easing walker per member, a wider follow camera) and draws tags and bubbles for everyone. `ui/screens/WatchScreen.tsx` follows the watched room like a player would, from seat 0, and reuses `BattleArena` with `spectating` (no choices or forfeit, a log that names both trainers). The PeerJS host ignores hub and watch messages: both need the dedicated server. Stadium proportions live in `engine/world/dims.ts` (`STADIUM` for platform, wall and stands; `FIELD` for the field, spots and battle camera).

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
- `../audio/`: `sound.ts` is the AudioManager. Every cue belongs to a category (music, ambience, cries, ui, battle; `mix.ts`), and each category has its own fader, ducking stage and per-profile level into a master bus with a limiter and a soft clipper (`graph.ts`), so piled-up sounds never clip. Profiles (`menu`, `plaza`, `battle`, `watch`) crossfade the generated music (`music.ts`) and ambience beds (`ambience.ts`) and set the cry policy; `app/useAudio.ts` follows the World's stage to pick one. Effects are synthesized (`synth.ts`). Cries are fetched once per species and treated (`analysis.ts`: BS.1770 loudness normalization, high shelf cut, length cap, soft clip). Levels are calibrated with offline renders through the full mix (`?audiotest` exposes `__sound.renderCue/renderCry/renderBeds`). The World emits `sound` and `cry` events that the app routes here; the UI adds hover and click sounds by delegation.
- `quality.ts`: tiers and the adaptive controller (see PERFORMANCE.md).

## UI (`frontend/src/ui/`, `frontend/src/styles/`)

Screens: Title → Partner select → Room setup → Match. The match screen derives a view model from authoritative state (`match/model.ts`) and maps phase transitions onto stage layouts and partner reactions (toss winner celebrates, loser reacts, game and series winners get victory moves). Panels: waiting room with invite link, toss, toss result, draft board (two teams with role spread, type spread and Tera types), battle (team strips, Showdown handoff, result report), interval, series complete, history drawer with the full archive. Error boundaries isolate panel failures; settings (quality, motion, diagnostics) persist locally.

## Adding a game mode or screen

Game rules: extend `GameAction` and `reduce()` in `shared/src/room.ts`, add parsing in `protocol.ts`, bump `PROTOCOL_VERSION`, add tests. Both authorities pick it up automatically. Presentation: add a `Layout` variant and its `shotFor` case in `World.ts`, then a React screen that calls `world.setLayout`.
