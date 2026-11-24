# Task checklist: peer animation sync, no CJK text plus translations, no environment sound

Status legend: [ ] open, [x] done (evidence next to it), [~] partially done (reason next to it).

## Step 0
0.1 [x] Create this checklist before writing code, one line per requirement. Evidence: this file, written before the code changes (root cause section predates the fixes).
0.2 [x] Mirror it in the agent task list. Evidence: mirrored in the agent task list (s0 to d) and in LoopForge loop `pbd-sync-i18n-audio` (planSource = this file).
0.3 [x] Tick items only with evidence (file and line, test name or command output). Evidence: every ticked line below carries its evidence.
0.4 [x] At the end, re-read the prompt top to bottom against this list and do anything missed. Evidence: prompt re-read against this list at the end; additions are E.1 to E.3 and 2.29.
0.5 [x] Final reply carries this checklist with done / partially done / not done and reasons. Evidence: final reply carries this list.

## 1. Players can't see other players' animations
1.1 [x] Reproduce with two browser windows in the main plaza (WS backend). Evidence: root cause table below, rows "Hub ...": two Chromium windows, dev backend 8899.
1.2 [x] Reproduce with two browser windows in the room plaza (WS backend). Evidence: root cause table, rows "Room plaza (WS) ...".
1.3 [x] Reproduce in the room plaza over PeerJS. Evidence: root cause table, rows "PeerJS ...".
1.4 [x] Temporary debug logs at each hop (UI, transport, server, protocol, HubScreen/Plaza, World, MonRig) to find where the gesture is lost. Evidence: temporary `gdbg` trace, hops A to I, quoted in the root cause table.
1.5 [x] Report the root cause(s) before fixing. Evidence: root cause report below, written before any fix.
1.6 [x] Check `peerGesture()` speed > 0.25 drop; fix by queueing until the peer stops, with a short timeout. Evidence: `engine/world/gestureQueue.ts` `GestureQueue` (1.5 s timeout), used in `World.ts:140` and `peerAct` (`World.ts:785`); test `gestures.test.ts` "waits while the partner is still moving, then plays once it stops", "drops a gesture the partner never got still for".
1.7 [x] Check `rig.resting` / `rise` ordering. Evidence: `World.peerAct`: a held pose that ended calls `rig.rise()` before any queued gesture; a gesture is taken only when `still && !rig.resting`.
1.8 [x] Check `rig.gesture()` returning false when the model is not loaded yet. Evidence: `peerAct` keeps the wanted pose in `peerPoses` and retries every frame until `rig.gesture()` succeeds, so a model that loads late still lies down (QA: B saw `mewtwo#p0:sleep` once frames ran).
1.9 [x] Check clip lookup with the wrong key (`${id}#2` duplicates). Evidence: root cause table row "PeerJS, host to guest, both Eiscue (`eiscue#2` key)": played. No change needed.
1.10 [x] Check the `GESTURES` map in World.ts covers every `PLAZA_EMOTES` value. Evidence: root cause item 4: GESTURES covers every PLAZA_EMOTES value except `punch` (deliberate) and `rise` (handled as a pose end).
1.11 [x] Check the server rate limit dropping emotes silently, and client and server throttles in step. Evidence: client `EMOTE_GAP = 700` ms (`ui/screens/match/Plaza.tsx:13`) is slower than the server bucket `EMOTES_PER_SEC = 2`, `EMOTE_BURST = 4` (`backend/src/index.ts:29-30`), so a click the UI allows is never dropped.
1.12 [x] Check `hubEmote` is sent when the `hubAs` / protocol gate applies. Evidence: protocol v9 note (`shared/src/protocol.ts:31-33`): poses ride on existing messages, nothing new is sent by clients, so there is no gate to miss.
1.13 [x] Persistent poses (sit, nap) reach late joiners and reloads: pose in hub member state. Evidence: `HubMember.pose` (`shared/src/protocol.ts:74`, parsed at :207); backend test `tests/hub.mjs:72-80`; two-browser QA on 2026-11-22 against a local backend (port 8799, this tree) and the built frontend: A napped, B entered later and saw `mewtwo#p0:sleep` with `peerPoses [m9, nap]`.
1.14 [x] Same for the room plaza presence. Evidence: room seat pose sent on join/resume (`tests/plaza.mjs:37-73`), `PresenceRelay` replays it to a late plaza screen (`net/types.ts:77`), `World.plazaResend` resends the own pose (`World.ts:796`); two-browser QA on 2026-11-22 against a local backend (port 8799, this tree) and the built frontend: A napped in room 9C981E, B joined and saw `mewtwo:sleep`.
1.15 [x] Confirm remote partners' walk stride animates (`rig.stride(w.speed, w.walk)`). Evidence: root cause item 5: `rig.stride(w.speed, w.walk)` runs for every peer in `stepWalk`; receivers were observed walking in the walk tests.
1.16 [x] Backend test `tests/hub.mjs`: an emote from A reaches B. Evidence: `backend/tests/hub.mjs:62-68` (twirl relayed A to B); run on 2026-11-22: `hub exit=0`.
1.17 [x] Backend test `tests/hub.mjs`: pose state reaches a late joiner. Evidence: `backend/tests/hub.mjs:72-80` ("a late joiner sees the sitting partner"); `hub exit=0`.
1.18 [x] Backend test `tests/plaza.mjs`: an emote from A reaches B. Evidence: `backend/tests/plaza.mjs`; run on 2026-11-22: `plaza exit=0`.
1.19 [x] Backend test `tests/plaza.mjs`: pose state reaches a late joiner. Evidence: `backend/tests/plaza.mjs:37-42` ("the late joiner hears the pose") and :62-73 (resumed seat); `plaza exit=0`.
1.20 [x] Frontend unit test for the queued-gesture logic. Evidence: `frontend/tests/gestures.test.ts` (7 tests: queue and held poses); part of vitest 18 files / 123 tests passed.
1.21 [x] Remove the temporary debug logs. Evidence: `grep -rn "gdbg|GDBG" frontend/src backend/src shared/src` returns nothing; `frontend/src/gdbg.ts` is gone.

## 2. Remove Japanese / Asian characters, add translation
2.1 [x] Remove `<span className="jp">` labels and the `jp` prop in `ui/primitives.tsx`. Evidence: `ui/primitives.tsx` ScreenHeader has no `jp` prop; no `className="jp"` left (`scripts/check-cjk.mjs` prints `CJK_CLEAN`).
2.2 [x] Remove CJK from Overlays, Title, Settings, PartnerSelect, Multiplayer, Watch, Hub, HostDialog, Pokedex, Dex*, Match screens, Scoreboard, Tips, Panels, BattlePanel, BattleArena, LobbyPanels, HistoryDrawer, `ui/pokemon.tsx`. Evidence: `node scripts/check-cjk.mjs` scans frontend/src, index.html and shared/src: `CJK_CLEAN`.
2.3 [x] Remove CJK canvas text in `engine/battle/BattleStage.ts`. Evidence: `engine/battle/BattleStage.ts`: kanji canvas text and comments replaced by a five-armed flame burst; `CJK_CLEAN`.
2.4 [x] Remove CJK in `showdown/handoff.ts`. Evidence: `showdown/handoff.ts` covered by the same scan: `CJK_CLEAN`.
2.5 [x] Remove CJK in `frontend/index.html`. Evidence: `frontend/index.html` covered by the same scan: `CJK_CLEAN`.
2.6 [x] Remove the `.jp` styles. Evidence: `.jp`, `.eyebrow .jp`, `.veil__jp`, `.menu__jp`, `.drawer__head .jp` removed from styles; `grep -rn "menu__jp|veil__jp|font-jp" frontend/src` empty.
2.7 [x] Remove the Zen Kaku font (`styles/fonts.css`, `styles/tokens.css`, woff, OFL license) if nothing else uses it. Evidence: deleted `assets/fonts/zen-kaku-jp-700.woff` and `OFL-ZenKakuGothicNew.txt`, its `@font-face`, `--font-jp`, the credits entry, and the Zen Kaku step in `tools/subset_fonts.sh`.
2.8 [x] Check the layout still looks right without the eyebrow labels. Evidence: checked in the built app (title, settings, draft pool, online screen screenshots, 2026-11-22). The draft pool card labels overlapped in Spanish; fixed with a max-content label column (`styles/match.css` `.pcard__meta`).
2.9 [x] CJK grep over `frontend/src frontend/index.html shared` returns nothing; rebuild `dist/`. Evidence: `CJK_CLEAN`; `npm run build` rebuilt `dist/` (vite: built in 2.55s).
2.10 [x] `src/i18n/` module: one dictionary per language, typed `t(key, params)`, `useT()` hook, no external translation APIs. Evidence: `frontend/src/i18n/core.ts` (typed `translate`, `fill`), `i18n/index.ts` (`t`, `useT`, `t.rich`), generated `en.ts` (MessageKey type) and `es.ts`; no network calls.
2.11 [x] English (default) and Spanish; adding a language is one new file. Evidence: `LANGS` in `i18n/core.ts`: English and Spanish; a language is one file plus one line there (README "Languages").
2.12 [x] Missing keys fall back to English. Evidence: `translate()` falls back to `en[key]`; test `i18n.test.ts` "translates and falls back to English for a missing key".
2.13 [x] A test fails if a language is missing keys. Evidence: `tests/i18n.test.ts` "every language has every English key" (`missingKeys`), plus placeholder and em dash/CJK checks.
2.14 [x] Every user-facing string in the dictionaries: screens. Evidence: every screen converted (Settings, Title, Partner, Multiplayer, Lobby, Match, Watch, Hub, Plaza, Battle arena and panels, Dex, Pokedex, Overlays); 751 keys in each language.
2.15 [x] Dialogs. Evidence: Modal, HostDialog, settings sheet, partner confirm (`app/App.tsx`).
2.16 [x] Mira's dialogue. Evidence: `ui/screens/HostDialog.tsx`: all of Mira's lines and options (`host.*`, 33 keys).
2.17 [x] Tips. Evidence: `ui/screens/match/Tips.tsx` (`tips.*`), loading tips in `ui/Overlays.tsx`, matchup hints in `battle/matchup.ts` (`mu.*`).
2.18 [x] Toasts. Evidence: toasts go through `t()` (for example `settings.restored`); toast container labels in `ui/primitives.tsx`.
2.19 [x] Server errors shown to the user. Evidence: `i18n/serverErrors.ts` maps every backend/peer message (`srv.*`, 49 keys) and is used by the error toast in `app/App.tsx`; test `tests/server-errors.test.ts`.
2.20 [x] aria-labels. Evidence: aria-labels converted in every file above (for example `common.close`, `plaza.gestures`).
2.21 [x] Titles (title attributes and document title). Evidence: `title=` attributes converted; `document.title` follows the language (QA: "Pokémon Battle Draft · Liga Estadio" after switching).
2.22 [x] Language picker in Settings. Evidence: Settings "Language" section (`ui/screens/SettingsScreen.tsx`, Segmented English / Español).
2.23 [x] Default language from `navigator.language`. Evidence: `app/settings.ts` `detectLang(navigator.languages)`; test `lang-settings.test.ts` "starts in the browser language and sets <html lang>".
2.24 [x] Persisted with the other settings. Evidence: `lang` saved in `pab-settings`; test "switches with no reload and persists the choice"; QA: localStorage showed `lang: es`.
2.25 [x] Updates `<html lang>`. Evidence: `i18n/index.ts` sets `document.documentElement.lang`; QA: `en` then `es`.
2.26 [x] Switching language changes the whole UI with no reload. Evidence: QA in the built app: clicking Español rewrote the open Settings sheet and the title menu while a `window.__marker` set before the click survived (no reload).
2.27 [x] Pokémon, move, ability and item names stay English; README note on localizing them later. Evidence: names come from data and are printed as is; README "Languages" explains localizing them later through PokéAPI `names[]`.
2.28 [x] Player chat and player names are not translated. Evidence: chat lines and player names render raw (`HubScreen`, `Plaza`, `MatchScreen` unchanged); only default placeholders like "Trainer" are translated.

## 3. Remove the environment sound
3.1 [x] Delete `audio/ambience.ts` (wind, fountain, crowd murmur, birds). Evidence: `frontend/src/audio/` has analysis, graph, mix, music, sound, synth: no `ambience.ts`.
3.2 [x] Remove its wiring in `audio/graph.ts`. Evidence: `grep -rn ambience frontend/src` finds only the migration comment in `audio/mix.ts:92`.
3.3 [x] Remove its wiring in `audio/sound.ts`. Evidence: same grep: nothing in `audio/sound.ts`.
3.4 [x] Remove from `audio/mix.ts`: `SCENE`, `ambience` category, `CATEGORY_TRIM`, `PROFILE` entries, `CRY_DUCK`, `MAX_VOICES`, `REVERB_SEND`. Evidence: test `audio.test.ts` "has no environment category anywhere in the mix".
3.5 [x] Remove the "Environment" slider in `ui/screens/SettingsScreen.tsx`. Evidence: `AUDIO_SLIDERS` in `SettingsScreen.tsx` lists music, cries, interface, effects only.
3.6 [x] Footsteps (`step`) move to another category and stay quiet (not gone, not louder). Evidence: `audio/mix.ts:39` `step: 'battle'`, `CUE_TRIM.step = 0.5` (:46); test asserts `CUE_CATEGORY.step` is battle and the trim is below 1.
3.7 [x] Settings migration: an old saved `ambienceVolume` is ignored without errors. Evidence: test `audio-settings.test.ts` "ignores the old environment volume in a save, and drops it on the next save".
3.8 [x] Update `tests/audio.test.ts`. Evidence: `frontend/tests/audio.test.ts` updated (no environment category, footstep category).
3.9 [x] Update `tests/audio-settings.test.ts`. Evidence: `frontend/tests/audio-settings.test.ts` updated (old `ambienceVolume`).
3.10 [x] Update README "Sound" section. Evidence: README "Partners, stadium and sound": "There is no environment bed: no wind, fountain, crowd murmur or birds."
3.11 [x] Update the Settings help text. Evidence: Settings mute hint: "Music, cries, interface and effects (battles and footsteps)".
3.12 [x] Mix check on title, plaza, battle and watch: nothing clips; music and effects defaults unchanged unless clearly too loud. Evidence: offline render through the full mix on the live build (`?audiotest`, `__sound.renderBeds(profile, 16)` / `renderCue`), 2026-11-22: beds menu -33.5, plaza -33.8, battle -32.8, watch -35.7 LUFS integrated, peaks -21.8 / -15.3 / -14.1 / -17.8 dBFS (nothing near clipping, beds on the -33 target); cues step -36.2 dBFS peak (quiet), hover -32.2, confirm -20.6, crit -22.3, faint -15.4. Music and effects defaults unchanged (0.3 / 0.45).

## Root cause report (written before any fix)

Setup: dev frontend (vite 5170) and a dev backend on 8899 built from this tree, two separate Chromium windows
placed side by side (Chrome marks an occluded window `hidden` and stops its frames, so both have to be on
screen), a temporary trace (`gdbg`, hops A to I) in UI, World, both transports, server and hub.

| Scenario | Trace on the receiver | Result |
|---|---|---|
| Hub, standing, Happy | `F hub recv m2 happy`, `H peerGesture ... speed 0`, `I peer play happy true` | seen |
| Hub, walk with W then Stretch 30 ms after release | `H peerGesture ... speed 0`, `I peer play stretch true` | seen |
| Room plaza (WS), Stand up / Happy / Nap | `F room recv 0 rise/happy/nap opp`, `I peer play ... true`, rig posture `sleep` | seen |
| Room plaza (WS), 8 Happy at 660 ms | server: 8 x `D emote pass`; receiver: 8 x `I peer play happy true` | seen |
| Room plaza (WS), click-to-walk then Happy mid-walk | sender halts, receiver speed 0.00 at play time | seen |
| PeerJS, host to guest, both Eiscue (`eiscue#2` key) | `H peerGesture rival happy eiscue#2`, `I peer play true` | seen |
| PeerJS, guest to host | `F room recv 1 happy/sit opp`, `I peer play true`, posture `rest` | seen |
| Hub: A sits, B reloads and walks back in | before reload B saw `rest`; after re-entry B sees `default` | LOST |
| Room plaza (WS): A sits, then B joins | B sees `default` | LOST |
| PeerJS: A sits, then B joins by invite | B sees `default` | LOST |

Root causes:
1. Confirmed, the main one: a gesture is a one-shot relay that nobody stores. Sit and Nap are persistent states,
   but a player who joins, reloads or reconnects after them never hears about them, so the partner stands there
   for them while it sits for everyone else (hub, room plaza over WS and over PeerJS).
2. Confirmed by reading, reachable but not reproduced on a LAN: `peerGesture()` silently drops a gesture when the
   partner is not ready on the receiver (rig not created or model still loading, `rig.gesture()` false) or still
   moving (`speed > 0.25`, possible when the final move report lags the emote). On the LAN the replayed speed was
   0.00 in all six walk-then-gesture trials, so this is hardening, not the reported symptom.
3. Confirmed by reading: client throttle (650 ms between clicks) and server bucket (1.5 a second, burst 3) are out
   of step by design, and the automatic `rise` sent when walking off a rest is not throttled at all. Sustained
   clicking slowly drains the bucket and the server then drops emotes with no feedback. Not hit in the 8-click test.
4. Ruled out: `GESTURES` covers every `PLAZA_EMOTES` value except `punch` (deliberate, no sparring) and `rise`
   (handled before the map); the `hubAs` / `v6` gate was open (`hubAs true, open true, proto 8`) on every send;
   the `${id}#2` key resolves (`eiscue#2`); `rise` ordering applied correctly (posture back to `default`).
5. Walk animation of remote partners: `rig.stride(w.speed, w.walk)` runs for every peer in `stepWalk`
   (World.ts), observed moving on the receiver during the walk tests.

## Done when
D.1 [x] `npm test` and `npm run build` pass in frontend. Evidence: frontend `tsc --noEmit` clean, vitest 18 files / 123 tests passed, `npm run build` built in 2.55s (2026-11-22).
D.2 [x] `npm test` and `npm run build` pass in backend. Evidence: backend `tsc --noEmit` TSC_OK, build to devdist BUILD_OK, all 8 suites exit 0 (flow, lobby, plaza, hub, sleep, revive, battle, feed).
D.3 [x] Two-window manual test: every gesture visible on the other screen in the hub. Evidence: two-browser QA on 2026-11-22 against a local backend (port 8799, this tree) and the built frontend: hub, A Wake up / Happy / Stretch arrived on B as `rise`, `act:glad01`, `act:refresh01`; B Nap arrived on A as `lugia#p0:sleep`. Mewtwo and Lugia have no Sit clip, so Sit was covered by `tests/hub.mjs` and the earlier table.
D.4 [x] Same in the room plaza. Evidence: live site, PeerJS room, 2026-11-22: A Wake up / Happy / Stretch arrived on B as `rise`, `sleep01_end`, `glad01`, `refresh01`; B (Spanish UI) Siesta arrived on A as `lugia:sleep`. WS room plaza covered by `tests/plaza.mjs` and the late-joiner run in 1.14.
D.5 [x] Including a player who joins after someone sat down. Evidence: hub (WS) and room plaza (WS) late joiners in local QA (1.13, 1.14), and PeerJS on the live site: A napped in room 467aa628, B joined by invite and saw `mewtwo:sleep`, `peerPoses [rival, nap]`.
D.6 [x] CJK grep returns nothing. Evidence: `node scripts/check-cjk.mjs` prints `CJK_CLEAN`; it is also a LoopForge evidence command (`cjk_scan`).
D.7 [x] Language switch in Settings changes the whole UI with no reload. Evidence: see 2.26.
D.8 [x] No ambience plays anywhere; footsteps still play. Evidence: no ambience module or category remains (3.1 to 3.4); footsteps kept on the effects bus (3.6).
D.9 [x] This file fully filled in with evidence; final checklist in the reply. Evidence: this file.

## Extras from the prompt
E.1 [x] `CLAUDE.md` at the repo root with the multi-part request rules. Evidence: `CLAUDE.md` at the repo root holds the multi-part request rules.
E.2 [x] No em dashes in code, comments, UI copy or docs touched by this task. Evidence: `grep -rln U+2014` over frontend/src, frontend/tests, shared/src, backend/src, README.md and docs returns nothing; the two "no value" glyphs became en dashes; `i18n.test.ts` rejects em dashes in every message.
E.3 [x] Publish the result live (standing deploy workflow) and verify the live bundle. Evidence: `pbd_deploy.py prepare --tree --keep-prod` PREPARED (frontend tests 123, backend suites OK on the side port), `publish` commit dd9958dfb5, run 45022238703 success, `LIVE MATCHES BUILD ['index-Dxmuhy3r.js', ...]`; the live bundle has 0 CJK characters, contains the Spanish dictionary and no `ambience`. Production backend: it had stopped together with the tunnel; restarted under the supervisor on the new build, `/health` reports `"protocol":9`, origin check holds (`ws_probe`: Pages OPEN, foreign origin CLOSED 1008), `tests/flow.mjs` through the new tunnel prints `FLOW_OK ... protocol: 9`.

# Task: plaza visibility, trainer grounding and models, Ditto transform, move effects, redesign QA

Brief saved at `C:/Users/Garza/pbd-wip/brief-2-plaza-trainers-ditto-fx.md`. Items are ticked only with evidence.

## P0. Process
P0.1 [x] Read CLAUDE.md, docs/ARCHITECTURE.md, docs/PERFORMANCE.md, docs/REDESIGN_CHECKLIST.md. Evidence: read at the start of the redesign and this task (CLAUDE.md rules applied: checklist first, no em dashes).
P0.2 [x] This numbered checklist exists before code. Evidence: this section. Evidence: this section, written before any code of this task.
P0.3 [ ] No em dashes anywhere touched by this task.
P0.4 [ ] Browser items verified in a real browser with independent contexts (Playwright or equivalent), not only unit tests.
P0.5 [ ] Final reply re-reads the brief against this list and ends with the full checklist and status.

## P1. Finish the redesign's open items (no rebuild)
P1.1 [ ] Go through every open item of docs/REDESIGN_CHECKLIST.md, verify in a real browser, fix failures, record evidence there.
P1.2 [x] Partner selection: reproduce the reported failure first (the brief's description field was left as a template, so the case is found by testing). Evidence: the brief left the description as a template, so every case was exercised in a real browser (REDESIGN_CHECKLIST "Browser QA evidence"). Failures found: the select panel clipped the 7th tile column and the confirm button at every size; on narrow landscape windows the partner stood behind the panel; floating partners were cut at the top; Create Battle opened the wrong tab.
P1.3 [x] Partner selection: root cause found and fixed. Evidence: causes: `.shop__grid` used `repeat(7, 1fr)` (tracks cannot shrink below content) and `.shop__actions` nowrap buttons, so the panel content was 563px in a 438px panel; the showcase shot centred the partner where the panel sits; `MultiplayerScreen` ignored `mode`. Fixes in styles/screens.css, World.shotFor (select), MultiplayerScreen.tsx. After: panel scrollWidth 438/438 at 1280x720, 900x600, 1920x1080; partner right of the panel; Flutter Mane fully in frame.
P1.4 [ ] Partner selection: a Playwright test for the exact case.
P1.5 [ ] Partner selection: REDESIGN items 1.2 to 1.12 covered.
P1.6 [~] Flow: skippable cinematic intro, then town plaza with people, then the top-left dropdown menu; plaza never the arena. Screenshot of each step. Evidence: flow verified in the smoke test (intro in its own scene, then the town, menu top-left) with screenshots in the session; screenshots to artifacts/ still to export.
P1.7 [ ] Acceptance tests 8.1 to 8.18 run and recorded.

## P2. Plaza: other people sometimes invisible
P2.1 [x] Reproduce with 2 to 4 contexts: join, leave, rejoin, reload, back from the stadium. Evidence: 3 independent browser sessions (pzA2/pzB2/pzC2) on a v10 dev backend (8799) and the production build: join in order, B reload, C to the stadium and back, a server restart with all three inside. Every case: each context lists the other two in `others`, `peers` here=true, trainers in the town scene, name tags at opacity 1 (diag output in the session log).
P2.2 [x] Root cause found before fixing (written below). Evidence: root cause: the client chose its server as `?ws=` > remembered `pc-backend` > none, and with none, or a remembered quick-tunnel host that no longer exists (cloudflared changes hostname on every restart), the plaza fell back to "your own plaza" silently, so other trainers never appeared. Reproduced on the live site in a clean profile: plain link and a stale stored host both showed "Your plaza". Second cause: `World.syncTrainers` kept a failed `Trainer` import as null for the whole session and left failed loads marked loading forever, so after one network hiccup no trainer appeared again.
P2.3 [x] Check: production backend still on v9 (radius 9 clamp). Evidence: production was on v9 until it was restarted on the v10 build (health shows protocol 10 locally and through the tunnel). A v9 server clamps town spots to radius 9 (members still visible, placed wrong); now reported to players (P2.4).
P2.4 [x] Client shows a clear message on protocol mismatch instead of failing silently. Evidence: `frontend/src/net/plazaLink.ts` (states shared/outdated/connecting/unreachable/tooOld/solo), plaza status in `ui/screens/PlazaScreen.tsx` with "Use the current server"; i18n keys plaza.unreachable, plaza.outdated, plaza.tooOld (en+es). Browser: a dead `?ws=` shows "Can't reach the battle server" and the button switches to the advertised server, reaching "2 trainers here".
P2.5 [x] Restart procedure documented. Evidence: skill pbd-version-deploy Steps 3 (supervisor restart) and the Verify protocol note; `pbd_deploy.py prepare` now writes `frontend/public/backend.json` with the live tunnel (`advertise_backend`), so a restart that changes the tunnel host is picked up by the next deploy.
P2.6 [ ] Check: BonePool (POOL_CAP 32) releases slots on Trainer.dispose(); new trainers keep showing after 32 joins and rejoins.
P2.7 [ ] Check: World.syncTrainers 'loading' placeholder.
P2.8 [x] Check: trainerMod import failing to null forever. Evidence: World.syncTrainers: a failed import resets `trainerMod` and failed loads drop their loading mark and retry every 4 s (`retryTrainers`). Browser: with `*Trainer-*.js` blocked the list is empty; after unblocking the trainer is in the scene within 10 s without reload.
P2.9 [x] Check: a load finishing while in another environment. Evidence: code read: a load that finishes outside the town only joins the town scene when `envId === "town"`; `moveInto("town")` adds it later. Stadium round trip in the browser kept every trainer.
P2.10 [x] Check: a member who leaves and rejoins with the same id while still 'loading'. Evidence: member ids are per connection (server assigns a new `m<n>`; backend test asserts "a rejoin is a new member"); for "me", a load that finishes after a leave and re-entry finds a newer entry and disposes itself.
P2.11 [x] Check: stepTown setHere and anchor() hiding peers whose partner rig is not shown yet. Evidence: setHere uses the partner rig OR the trainer; anchor() for the hub rides the trainer walker, not the partner rig. Browser: tags at opacity 1 for every peer right after joining.
P2.12 [x] Check: hub join ordering (others before world or town ready), hubResume and hubRigs.clear() on re-entry. Evidence: browser: C joined after A and B and saw both; A saw B and C arrive live; C back from the stadium saw both; after a server restart all three reappeared without reload.
P2.13 [ ] Check: frustum culling of skinned trainer meshes whose bones live in the shared texture.
P2.14 [x] Regression tests: frontend unit for the causes found. Evidence: `frontend/tests/plaza-link.test.ts` (5 tests: solo only without backend, unreachable after 6 s instead of solo, outdated flagged, tooOld, shared while reconnecting).
P2.15 [x] Regression tests: backend tests/hub.mjs for the causes found. Evidence: `backend/tests/hub.mjs` block "Leave, drop and rejoin": town-edge spot (11,3) unclamped, terminated socket announces hubLeave, rejoin announced as a new member, late joiner sees it with no ghost, hub off/on on the same socket. HUB_OK against the v10 dev backend.

## P3. Trainers sink through the ground
P3.1 [ ] Inspect Trainer.ts (foot IK ground spots, hipsY, crouch/bob/dip, smin, model.position.y).
P3.2 [ ] Inspect scenes/town: is the ground flat (paths, steps, fountain base, slopes).
P3.3 [ ] Town ground height query (heightfield or raycast against a simplified walk mesh), cached, no per-frame allocations.
P3.4 [ ] Used for the trainer root.
P3.5 [ ] Used for both foot targets.
P3.6 [ ] Used for partner followers.
P3.7 [ ] Feet never below the surface and never floating: walk, turn in place, stop, gestures, every trainer scale.
P3.8 [ ] QA view in qa/trainer.html walking a trainer over every ground type with foot contact shown.

## P4. More trainer models, player choice
P4.1 [ ] Generalize the bake to any VRM 0.x/1.0 humanoid: per-model asset, missing bones/hair/skirt/expressions handled.
P4.2 [ ] Shared bone pool per model.
P4.3 [ ] Each model loaded lazily, only when someone in the plaza uses it.
P4.4 [ ] Only clearly licensed models; each license verified and recorded in docs/ASSETS.md.
P4.5 [ ] Older CC0 VRoid samples checked against the VRoid help page on sample model conditions.
P4.6 [ ] Open Source Avatars / 100Avatars (CC0) checked.
P4.7 [ ] No AvatarSample_A/B/C or newer presets unless their conditions fit; no ripped Nintendo/Game Freak models.
P4.8 [ ] 6 to 10 models fitting the look, mix of styles and body types.
P4.9 [ ] Offline optimization script in scripts/ (texture size, meshopt/Draco, unused morphs stripped).
P4.10 [ ] Per-model size budget documented and met.
P4.11 [ ] Trainer picker in My Profile: 3D preview carousel with the colour tint.
P4.12 [ ] Choice persisted in settings; random default on first visit.
P4.13 [ ] Sync: trainer model id in hub member state, protocol bumped.
P4.14 [ ] Server validates against an allowlist.
P4.15 [ ] Late joiners see it.
P4.16 [ ] Unknown id falls back to the default.
P4.17 [ ] Backend tests updated.

## P5. Ditto transform
P5.1 [ ] `transform` battle fx through controller.ts, stageBridge.ts, BattleStage.ts (also Imposter on switch-in).
P5.2 [ ] Morph effect: melts into a purple blob, reshapes.
P5.3 [ ] Swaps to the target species model, preloaded with World.prepareMons as soon as the target is known.
P5.4 [ ] Subtle Ditto tell (purple rim or shimmer).
P5.5 [ ] HUD shows "Ditto (Transformed)".
P5.6 [ ] Reverts on switch out.
P5.7 [ ] Reverts on faint.
P5.8 [ ] Correct on log replay / reconnect (resync).
P5.9 [ ] Works for players and spectators (Watch screen and the plaza diorama).
P5.10 [ ] Test with a fixture log that includes Imposter.

## P6. Move effects
P6.1 [ ] qa/moves.html: pick any move, play between two Pokemon of any sizes, replay, slow motion, export a keyframe contact sheet.
P6.2 [ ] "Before" contact sheets for every move.
P6.3 [ ] Each type has its own visual language (Fire, Water, Electric, Grass, Ice, Psychic, Ghost, Dragon, Dark, Fairy, Steel, Rock/Ground, Fighting, Poison, Bug, Flying, Normal as described).
P6.4 [ ] Every move has anticipation, release, impact, linger.
P6.5 [ ] Techniques: procedural-noise ShaderMaterials (no new textures), ribbon trails, fading ground decals, soft particles, reuse radial blur and flash.
P6.6 [ ] Each recipe true to how the move looks in the games.
P6.7 [ ] Rules kept: scale with the Pokemon, pooled and prewarmed, no light-count change, reduced motion and reduced flashing respected.
P6.8 [ ] Within the PERFORMANCE.md budget; draw calls per move documented.
P6.9 [ ] Batch 1: the 30 most common moves in shared/src/pool.ts, committed with before/after sheets in artifacts/.
P6.10 [ ] Batch 2 and later: the rest, committed with before/after sheets.
P6.11 [ ] Every move has an "after" contact sheet.

## P7. Never blank while a model loads
P7.1 [ ] Audit every load path and list it here (syncTrainers, partner rigs, battling Pokemon, PlazaHost/Presenter, intro).
P7.2 [ ] Real browser with Slow 3G and cache disabled: record which ones go blank.
P7.3 [ ] Trainer placeholder: soft glowing silhouette in the player's tint, name tag visible, spinning Poke Ball "Loading..." badge; can walk while loading.
P7.4 [ ] Partner and battling Pokemon: keep stand-ins, add a progress ring with real loader progress and the name.
P7.5 [ ] Materialize effect when ready (flash or dissolve), never a pop.
P7.6 [ ] Failure: after timeout or error keep the stand-in with "Couldn't load" and retry on click; error logged once; game playable.
P7.7 [ ] Corner indicator "Loading N models... P%" while anything visible downloads; full-screen veil only for scene entries.
P7.8 [ ] Placeholders share one geometry and material per kind, compiled before shown.
P7.9 [ ] Reduced motion respected (no spin, simple fade).
P7.10 [ ] All text through i18n (English and Spanish).
P7.11 [ ] Unit test for the placeholder state machine (loading to ready, failed to retry).
P7.12 [ ] Throttled-network browser run with no blank frames, screenshots in artifacts/.

## Done when
PD.1 [ ] npm test and npm run build pass, frontend and backend; backend tests pass on the new protocol.
PD.2 [ ] 3 contexts in the plaza always see each other (including leave, rejoin, reload, stadium round trip).
PD.3 [ ] Trainers never clip through the ground.
PD.4 [ ] Each context picks a different trainer model and the others see it.
PD.5 [ ] Ditto transforms on screen and reverts correctly.
PD.6 [ ] Every move has an after contact sheet; nothing exceeds the performance budget.
PD.7 [ ] REDESIGN_CHECKLIST.md and TASK_CHECKLIST.md updated with evidence for every item.
