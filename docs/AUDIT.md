# Audit of the original build (v1) and what changed

## What v1 was

About 1,200 lines: a React + Vite + three.js frontend, a Node `ws` backend and a PeerJS fallback. Three Three.js scenes (casino table backdrop, coin, a 2D dealer image animated on a deformed plane), a 38-set pool duplicated in frontend and backend, coin-call → deal → pick → report flow, best-of-3/5 series, Showdown import text, a `psim.us` iframe, five Vitest tests and a two-client WebSocket flow test.

## Kept

The 38 sets (byte-identical), team generation and its role-balance rules, `teamImport` format, coin and series rules, server authority with crypto randomness, room codes, resume tokens, origin check and TTL, best-of-3/5, round history and archive, Showdown handoff, PeerJS serverless mode, silence (no audio), reduced-motion support, GitHub Pages deployment.

## Bugs and risks found and fixed

| Area | v1 behavior | Now |
|---|---|---|
| Security | Every state broadcast included both players' resume tokens, so either client could resume as the other player. | Tokens never leave the authority; test asserts no token appears in any broadcast. |
| PeerJS host | Any peer that connected could act as player 2. | Only the bound guest connection can act; extra peers are told the room is full. |
| PeerJS host | Equal coin calls were accepted; the toss then had no winner and nobody could pick (soft lock). | Shared reducer rejects equal calls. |
| Rule drift | Backend and PeerJS host each had their own copy of the rules (they had already diverged). | One pure reducer in `shared/` used by both. |
| WebSocket client | Each create/join opened a new socket without closing the previous one. | One socket per session with reconnect and resume. |
| Startup | Both transports always started (PeerJS connected to the public relay even with a backend). | Exactly one transport; PeerJS loaded lazily. |
| Showdown | Default format `gen9ou` rejects Breloom's Spore (Sleep Moves Clause). | Default `gen9customgame`, with an OU legality warning. |
| Artwork | Rotom-Wash showed base Rotom (wrong dex id). | `artId` for alternate forms. |
| Rendering | Three WebGL contexts and loops; ResizeObservers never disconnected; per-frame CPU normal recomputation; coin advanced a fixed 0.016 s per frame; card tilt re-rendered React on every mouse move. | One context and loop, full disposal, shader-driven animation, delta-time everywhere, tilt via CSS variables. |
| Backend hardening | 64 KB payloads, no rate limits, no presence. | 4 KB payloads, message and room-creation rate limits, room cap, heartbeat presence, validated input. |

## Replaced

All casino presentation (scenes, dealer art, copy, styles) and the UI. See ARCHITECTURE.md for the new engine and UI, ASSETS.md for characters.

## Additions

Partner selection synced through the protocol (`avatar`), presence indicators, leave room, PokePaste team sheet, challenge command builder, team composition summary, species type badges, history drawer, settings, credits, diagnostics overlay, still-portrait fallback without WebGL, error boundaries, 15 new unit tests and a much broader backend flow test (token leak, validation, third client, illegal transitions, resume, full series, reset).
