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

- `World.ts`: renderer, scene, lights, post chain, layouts, input picking, loop, resize, visibility pause, context-loss handling, disposal. `Layout` is declarative (`title`, `select`, `duo`, `victory`); `setLayout` is idempotent. Screen changes use a short fade-to-black cut: characters are re-staged and the camera is cut while dark, then the camera pushes in on the new shot. Fades and the coin run on wall-clock time so slow frames never stall gameplay.
- `CameraDirector.ts`: critically damped springs (`smoothDamp`) for position, target and FOV, subtle handheld drift, pointer parallax. Reduced motion uses cuts.
- `character/loadBot.ts`: streamed download with progress and byte cache, parses the bot once and hands out skinned clones (`SkeletonUtils.clone`) with their own paint material and a procedural grime layer injected with `onBeforeCompile`.
- `character/BotRig.ts`: AnimationMixer over the model's authored clips (idle loops; reactions play once and cross-fade back), facial morph targets (Angry, Surprised, Sad), head look-at layered on top of the clip, placement springs and a springy pop on appear. Emotes map onto clips in one table.
- `world/*`: smoggy sky dome with a procedural cloud deck and lightning, instanced skyline (derivative-antialiased windows), the stage floor (wet asphalt: puddles with planar `Reflector` reflections on high tier, procedural rain ripples, cracks, oil sheen, spray-painted ring), `Alley.ts` (asphalt yard, canvas-textured brick walls and graffiti, flickering neon with a real point light, burning barrel with flame shader, GPU embers and a flickering point light, steam puffs, bulb strings, antialiased chain-link fence, dumpster), GPU rain streaks (`Rain.ts`), sodium light shafts and ground smog. Animated elements are driven by shader uniforms; none update geometry on the CPU. `World.stepLightning` schedules strikes and drives the sky, rain, hemisphere and a dedicated light, plus a delayed thunder sound event.
- `post/GradeShader.ts`: display-space grade after tone mapping: split toning, saturation, vignette, faint edge fringe, grain, fade, impact punch (radial blur), screen flash and back-alley grime (sodium tint, film scratches, dust).
- `../audio/sound.ts`: Web Audio synthesis. sfx and music buses into a compressor; sfx through tape saturation and a generated reverb. The World emits `sound` events (stage cues, coin, bot chirps) that the app routes here; the UI adds hover and click sounds by delegation.
- `quality.ts`: tiers and the adaptive controller (see PERFORMANCE.md).

## UI (`frontend/src/ui/`, `frontend/src/styles/`)

Screens: Title → Partner select → Room setup → Match. The match screen derives a view model from authoritative state (`match/model.ts`) and maps phase transitions onto stage layouts and partner reactions (toss winner celebrates, loser reacts, game and series winners get victory moves). Panels: waiting room with invite link, toss, toss result, draft board (two teams with role spread, type spread and Tera types), battle (team strips, Showdown handoff, result report), interval, series complete, history drawer with the full archive. Error boundaries isolate panel failures; settings (quality, motion, diagnostics) persist locally.

## Adding a game mode or screen

Game rules: extend `GameAction` and `reduce()` in `shared/src/room.ts`, add parsing in `protocol.ts`, bump `PROTOCOL_VERSION`, add tests. Both authorities pick it up automatically. Presentation: add a `Layout` variant and its `shotFor` case in `World.ts`, then a React screen that calls `world.setLayout`.
