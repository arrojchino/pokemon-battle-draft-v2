# Performance

## Budget and strategy

Target: 60 fps on reasonably modern desktop GPUs, smooth on high-refresh displays, usable on phones. Everything time-based is delta-time driven and frame-rate independent (exponential damping and critically damped springs), so 120/144 Hz displays simply get smoother motion.

- One renderer, one animation loop, one canvas for the whole app (v1 ran three WebGL contexts and three loops).
- The loop stops when the tab is hidden; WebGL context loss is handled.
- No per-frame React renders, no per-frame allocations in the rig, no CPU geometry updates (v1 recomputed vertex normals on the CPU every frame).
- Environment animation is shader-driven: LED boards, crowd flashes, stars, light shafts, motes, the field pulse.
- Characters that are not on screen are hidden and skip all work.
- three.js loads as a lazy chunk; the UI paints first.
- Pokémon models download at runtime, once per species (partners are 3.4 to 15 MB, mostly animation data; battling species range from 60 KB to 11 MB), and every instance clones the cached download, so geometry and textures are shared. Until a model arrives, its artwork stands in (a card for partners, the projection for battling Pokémon). Effects are synthesized; only partner cries are fetched, once each.

## Quality tiers

| | low | medium | high |
|---|---|---|---|
| Max DPR | 1 | 1.5 | 2 |
| MSAA | off | 2× | 4× |
| Bloom | off | on | on |
| Planar floor reflection | off | off | on (1024²) |
| Shadows | off | 1024² | 2048² |
| Petals / towers | 180 / 120 | 520 / 220 | 900 / 340 |
| Light shafts | off | on | on |

`auto` (default) picks a starting tier from the device (software renderers and coarse pointers start lower), then an adaptive controller watches measured frame times: above ~19.5 ms average it lowers render scale in 10% steps down to 0.7, then drops a tier; with sustained headroom it raises scale, then the tier. Hysteresis and cooldowns prevent oscillation. Users can pin a tier in Settings or with `?quality=`.

## Measurements

Measured in headless Chromium on SwiftShader (software rendering), so wall-clock fps there is not representative of a GPU. Counts and CPU-side costs are:

| Scene | Tier | Draw calls | Triangles | Rig simulation per frame |
|---|---|---|---|---|
| Partner select, 3 characters, before mesh merge | high | 616 | 503k | |
| Partner select, 3 characters | high | 298 | 503k | 0.65 ms |
| Match, 2 characters + coin | high | 259 | 295k | 0.35 ms |
| Title, 1 character | high | 165 | 180k | 0.15 ms |
| Partner select, 3 characters | medium | 194 | 326k | 0.68 ms |
| Match, 2 characters + coin | medium | 167 | 187k | 0.27 ms |
| Title, 1 character | medium | 106 | 111k | 0.22 ms |

These numbers were measured with the earlier VRM partners. Partner Pokémon models are lighter (about 4k to 10k triangles each, a few materials), so character cost is lower now; re-measure with `?perf` on your target devices.

Triangle counts include the shadow pass and, on high, the planar reflection pass, which re-render the characters. Medium removes the reflection pass: about 35% fewer calls.

Resource hygiene (scripted checks):
- Cycling screens 6 times: geometries, textures and programs unchanged.
- Switching quality tiers 5 times: geometries and textures unchanged (a leak of bloom render targets was found and fixed: `EffectComposer.dispose()` does not dispose passes). Shader programs grow by a bounded set of variants, which three.js keeps while materials that used them exist.
- `World.dispose()` releases the WebGL context.

## Diagnostics

`?perf` (or Settings → Show performance diagnostics) shows fps, p50/p95 frame time, CPU frame time, tier, render scale, DPR, draw calls (whole frame, all passes), triangles, geometries, textures, programs and JS heap. `window.__WORLD__.stats()` returns the same data for scripted profiling.

## Known costs and next steps

- Real-GPU profiling (Chrome Performance panel with GPU, or `EXT_disjoint_timer_query_webgl2`) should be run on target hardware; this environment had no GPU.
- KTX2 textures and meshopt geometry would cut download size further (see ASSETS.md).
- In-app battle stage (`engine/battle/`): everything is allocated once when the arena is built and recycled. One CPU-simulated particle field (2,600 particles, one draw call) serves streams, sparks, swirls, lightning, coins and leaves; rings, slashes, beams, orbs and barriers are small fixed pools; rocks, meteors, shards, spikes and salt are instanced meshes (one draw call per kind, only while visible). Three point lights stay in the scene at zero intensity between flashes, because toggling their visibility would change the light count and force every lit material to recompile mid-battle. Pokémon art textures are cached per species (bounded by the 38-set pool) and disposed with the stage. Battle playback is paced by a timer queue, and each move line holds until its animation's hit lands, so a dropped frame never desyncs the log from the 3D effects.
- The stadium (Chromium, high tier, title screen with one partner): 57 draw calls / 51k triangles at 56 fps in the sandbox. The stands are one lathe mesh, the four floodlight towers two instanced draws, the LED boards one cylinder.

## Smoothness fixes (this round)

- Adaptive quality no longer bounces between tiers: once a tier proves too slow it is not retried for the session, and tiers never change during a battle (only the render resolution does). Each tier change rebuilds the post chain and recompiles shaders, which showed up as a hitch every few seconds on machines near the 60 fps line.
- The battle stage compiles every effect's shaders when the arena opens (pooled meshes are hidden, and the renderer only compiles what is visible), Team Preview downloads and compiles all twelve Pokémon models, and partners compile before they are shown.
- Hit recoil is a smooth damped sway instead of a random per-frame jitter, hit-stop is limited to crits and super-effective hits, and camera beats glide into each other instead of cutting twice per move.

## Entering the main plaza

Measured on a GeForce GT 1030 (Chrome, ANGLE D3D11), high tier, static build, frame times from `requestAnimationFrame`:

| | Before | After |
|---|---|---|
| First entry, longest frame | 2,133 ms (one long task of 2,103 ms when the host first drew) | 100 ms, behind the entry veil |
| First entry, frames over 33 ms after the veil lifts | n/a (no veil) | 0 |
| Second entry | | veil up 250 ms, longest frame 16.8 ms |
| Slow network (0.7 MB/s, cold cache): veil times out at 4.0 s, the host arrives 7 s later and fades in | | longest frame 50.1 ms, no long tasks |
| 7 entries and exits | | geometries 131, textures 71, programs 67, unchanged; tier stays high |

What it was: every precompile in the app (partners, battling Pokémon, battle effects) called `compileAsync` with no render target bound, which builds the on-screen variant of each program (sRGB output, tone mapping on). The scene is drawn into the post chain's linear target, so the real program still compiled on the first visible frame. `World.compile` binds the composer's target first; all precompiles go through it. On top of that, the host's first frame built her blend-shape and skinning textures and uploaded her buffers and textures.

How it works now:
- `PlazaHost.prepare` runs one step per frame: download and parse, build (rig, cap, headset), upload textures two per frame (`initTexture`), compile the opaque and the transparent (fade) variants against the real lights, then one off-screen draw per mesh with a flat material (buffers, skinning and blend-shape textures; the worst mesh costs 22 ms). Her shadow casters switch on behind the veil, or three per frame if she arrives on an uncovered plaza, where she fades in over 0.7 s.
- The title screen prefetches her with `requestIdleCallback` when the server has a plaza (`World.prefetchHub`), except on the low tier or with Save-Data on.
- `World.prepareHub` (behind the veil in `HubScreen`) waits for the host, the partners of the trainers already there and two drawn frames, capped at 4 s, and reports `hubProgress` for the veil.
- `AdaptiveQuality.mute` ignores frame times for the entry window, so a one-off spike never lowers the resolution or the tier.
