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
        fx -> stageBridge -> World.battle (holograms, bolts, bursts, camera kick, floor pulse) + partner emotes
        snapshot -> BattleArena (plates, HP, move grid, Tera, switches, preview, log, timer)
```

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
- `character/CharacterRig.ts`: procedural animator over VRM normalized bones. Layers: personality idle pose, breathing, weight shifts, micro-motion, blended gesture, look-at split between neck and head plus VRM eye look-at, expression smoothing, stochastic blinking with double blinks. Each bone slerps toward its target with its own stiffness (frame-rate independent), which gives follow-through and seamless transitions. Spring bones (hair, skirts, ribbons) come from the models' own VRM spring-bone data. No allocations per frame.
- `character/poses.ts`: pose and gesture library authored once in VRM 1.0 space; VRM 0.x models are mirrored by the rig. Gestures: greet (with speech mouth), nod, excited, surprised, thinking, victory, sad, bow, twirl.
- `character/loadVrm.ts`: streamed download with progress and byte cache, VRM parsing, `combineSkeletons`, and a VRM-safe skinned-mesh merge that halves draw calls.
- `world/*`: sky dome, instanced skyline (derivative-antialiased windows), reflective stage floor (planar `Reflector` on high tier), torii and lanterns, GPU-driven petals, light shafts, ground mist, sigil ring, toss coin. Every animated environment element is driven by a shader uniform; none update geometry on the CPU.
- `post/GradeShader.ts`: display-space grade after tone mapping: split toning, saturation, vignette, faint edge fringe, grain, fade.
- `quality.ts`: tiers and the adaptive controller (see PERFORMANCE.md).

## UI (`frontend/src/ui/`, `frontend/src/styles/`)

Screens: Title → Partner select → Room setup → Match. The match screen derives a view model from authoritative state (`match/model.ts`) and maps phase transitions onto stage layouts and partner reactions (toss winner celebrates, loser reacts, game and series winners get victory moves). Panels: waiting room with invite link, toss, toss result, draft board (two teams with role spread, type spread and Tera types), battle (team strips, Showdown handoff, result report), interval, series complete, history drawer with the full archive. Error boundaries isolate panel failures; settings (quality, motion, diagnostics) persist locally.

## Adding a game mode or screen

Game rules: extend `GameAction` and `reduce()` in `shared/src/room.ts`, add parsing in `protocol.ts`, bump `PROTOCOL_VERSION`, add tests. Both authorities pick it up automatically. Presentation: add a `Layout` variant and its `shotFor` case in `World.ts`, then a React screen that calls `world.setLayout`.
