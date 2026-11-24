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
