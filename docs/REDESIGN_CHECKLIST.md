# World redesign checklist

Source: the user's `message.txt` ("Partner Selection Fix & Complete Game World Redesign"). Every requirement, numbered.
Status is ticked only with evidence (file:line, test name, command output). `open` means not done yet.

## 1. Partner selection

1.1 Find the real underlying bugs (state/init, first visit, random deal, switching, confirm/save, persistence, multiplayer sync, room create/join, visibility for both, model loading/fallback). Status: done in code.
  Root causes found and fixed:
  - A layout queued behind a running fade was applied after a newer one, so the stage showed the previous partner. Fixed by `engine/scenes/SceneTransitionManager.ts` (requests coalesce, newest wins). Test: `tests/scene-transitions.test.ts`.
  - First visit had no defined "dealt partner" moment. `settings.ts` now deals and saves a random partner once (`firstVisit`). Test: `tests/partner-lifecycle.test.ts`.
  - A second tab could write a stale partner back. Settings now follow the `storage` event. Test: `tests/partner-lifecycle.test.ts` ("two tabs").
1.2 Every selectable Pokémon is selectable reliably. Status: open (browser QA over the full roster).
1.3 Selected Pokémon always matches the displayed model. Status: open (two-browser QA).
1.4 Switching updates the preview at once (artwork + progress stand in while the model downloads). Code: `ui/screens/PartnerSelect.tsx` (`shop__loading`). Status: open (browser QA).
1.5 Confirm persists. Test: `partner-lifecycle.test.ts`. Status: unit-tested; browser QA open.
1.6 Reload restores the partner. Test: `partner-lifecycle.test.ts`. Status: unit-tested; browser QA open.
1.7 Joining a room does not overwrite the selection. Status: open (QA with invite link).
1.8 Both players see each other's correct partners. Status: open (two-browser QA).
1.9 No stale state, races, duplicate init, async model issues. Status: covered by 1.1; QA open.
1.10 Loading failures never leave the selection unusable. Status: open (QA with a blocked model request).
1.11 Lifecycle tests. Status: done (`partner-lifecycle.test.ts`, 6 tests; `scene-transitions.test.ts`, 7 tests).
1.12 Works across two independent browser sessions. Status: open.

## 2. Entry experience

2.1 Cinematic intro after load (not a menu, arena or partner select). Code: `ui/screens/IntroScreen.tsx`, `engine/scenes/intro/*` (worker), `World.stepIntro`. Status: open (worker finishing, QA).
2.2 Night environment, camera move, particles, partner's dramatic appearance, camera reveal, typography, original branding. Status: open (worker).
2.3 Short and skippable (Esc, Enter, Space, Skip button). Code: `IntroScreen.tsx`. Status: open (QA).
2.4 Transition into the main plaza afterwards. Status: open (QA).

## 3. Separate 3D plaza

3.1 Separate environment, not the stadium. Code: own `THREE.Scene` and camera in `engine/scenes/town/*` (worker); `World.envOf` routes `hub`/`select` to it. Status: open (worker).
3.2 Look: night town square, Japanese-inspired architecture with a modern Center, paths, landscaping, trees, lanterns, flowers, central fountain/landmark, themed shops, a gathering area, sky, lighting, shadows, atmosphere. Status: open (worker).
3.3 Own partner and other trainers with theirs. Code: `World.syncTrainers`, `World.stepTown`. Status: open (QA).
3.4 WASD movement relative to the camera. Code: `Plaza.keyYaw`. Status: open (QA).
3.5 Mouse camera (drag to orbit, wheel to zoom), following naturally, kept in front of buildings. Code: `World.orbitShot`, `onDown/onUp/onWheel`. Status: open (QA).
3.6 Smooth movement and turning. Code: reuses `Walker`. Status: open (QA).
3.7 Collision with buildings and objects. Code: `TownEnvironment.bounds` + host obstacle. Status: open (worker + QA).
3.8 Other players synchronized in real time. Code: hub protocol v10 (`HUB_R`, `cleanHubSpot`). Status: open (two-browser QA).
3.9 Names and subtle identification. Code: `PlazaScreen` tags on trainers (`World.anchor`). Status: open (QA).
3.10 Partners follow their trainers. Code: `engine/world/Follower.ts`. Test: `tests/follower.test.ts`. Status: unit-tested; QA open.
3.11 Idle and movement animations (trainer and partner). Code: `character/Trainer.ts` (worker), `MonRig.stride`. Status: open.
3.12 Emotes and social interactions. Code: `GestureBar` in the Social panel; gestures queue until the partner settles. Status: open (QA).
3.13 Chat when the server supports it. Code: `PlazaScreen` `SocialPanel`. Status: open (QA).
3.14 Several players at once. Status: open (QA).
3.15 Performance budget. Status: open (worker numbers + FPS check).

## 4. Top-left dropdown navigation

4.1 Small trigger top-left, closed by default; panel drops from top-left with open/close animation. Code: `ui/NavMenu.tsx`, `styles/world.css` (`.nav`). Status: open (QA).
4.2 Dark translucent, Pokémon accents, typography, icons, hierarchy, hover/selection feedback. Code: `world.css`. Status: open (screenshot).
4.3 Items: World (Plaza, Find Players, Social), Battle (Quick Match, Create Battle, Join with Code, Public Lobbies, Watch Battles), Player (My Partner, My Profile, Settings). Code: `NavMenu.tsx` `GROUPS`. Status: done in code; QA open.
4.4 Does not obstruct the 3D environment. Status: open (QA).

## 5. Stadium as its own destination

5.1 Create or join travels from the plaza to the stadium. Code: `SceneTransitionManager` travel; `TravelCard`. Status: open (QA).
5.2 Stadium has its own environment, lighting, camera, audio, presentation, positioning, UI. Code: `engine/scenes/StadiumScene.ts`; audio by environment in `app/useAudio.ts`. Status: open (QA).
5.3 Existing stadium functionality preserved. Status: open (battle QA).
5.4 Cinematic transition (matchmaking, both players transition, stadium intro, trainers and Pokémon introduced, battle begins). Status: open (QA).
5.5 Plaza and stadium never share scene, camera, lighting, objects or UI. Code: separate `Scene`/`PerspectiveCamera` per environment, `RenderPass` switched in `World.moveInto`. Status: open (QA).

## 6. Architecture

6.1 Separation: IntroScene, PlazaScene, BattleScene, PartnerSelection UI, GlobalNavigation UI, MultiplayerPresence, SceneTransitionManager. Status: done in code (`scenes/intro`, `scenes/town`, `scenes/StadiumScene.ts`, `PartnerSelect.tsx`, `NavMenu.tsx`, transports + `Plaza.ts`, `SceneTransitionManager.ts`).
6.2 One renderer, one loop, no accumulated listeners, cameras and environments disposed, models cached, multiplayer state survives transitions, audio follows the environment, overlays do not steal 3D input. Status: open (leak check across transitions).
6.3 No unnecessary rewrite. Status: done (World refactored in place; Walker, PlazaHost, protocol, transports reused).

## 7. Visual quality

7.1 Polished, no placeholder geometry, smooth camera and animation, consistent UI. Status: open (screenshots).
7.2 Partners feel alive (existing clips + procedural). Status: open.

## 8. Acceptance tests

8.1 First-time load. 8.2 Intro plays. 8.3 Enter plaza. 8.4 Partner select works. 8.5 Change and confirm partner. 8.6 Partner follows. 8.7 Open/close navigation. 8.8 Walk around. 8.9 Two sessions see each other and partners. 8.10 Create battle. 8.11 Another player joins. 8.12 Both travel to the stadium. 8.13 Battle works. 8.14 Return to plaza. 8.15 Refresh keeps identity and partner. Status: all open.
8.16 Existing tests pass. Evidence: vitest 23 files, 148 tests passed. Backend tests: open (rerun after v10).
8.17 Regression tests added. Evidence: `partner-lifecycle`, `scene-transitions`, `follower`, `plaza.test.ts` updated for v10.
8.18 Production build. Status: open.

## 9. Rules

9.1 Read CLAUDE.md and architecture docs. Done. 9.2 Reuse sound systems. Done (see 6.3). 9.3 No fake multiplayer. Done (presence through the real hub protocol; solo plaza says so). 9.4 Arena not used as plaza. Done (separate scene). 9.5 No static mockups. 9.6 No silent removals: `TitleScreen` and `HubScreen` are replaced by `IntroScreen` + `PlazaScreen` + `NavMenu`; every action they had is reachable from the menu or the host. 9.7 No TODOs. Status: check before closing.

## Deployment note

Protocol v10 widens the main-plaza radius. The production backend on 8787 runs v9 and clamps hub spots to radius 9 until it is restarted with the new build; restarting it needs the user's permission.
