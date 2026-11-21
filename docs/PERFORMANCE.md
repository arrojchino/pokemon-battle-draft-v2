# Performance

## Budget and strategy

Target: 60 fps on reasonably modern desktop GPUs, smooth on high-refresh displays, usable on phones. Everything time-based is delta-time driven and frame-rate independent (exponential damping and critically damped springs), so 120/144 Hz displays simply get smoother motion.

- One renderer, one animation loop, one canvas for the whole app (v1 ran three WebGL contexts and three loops).
- The loop stops when the tab is hidden; WebGL context loss is handled.
- No per-frame React renders, no per-frame allocations in the rig, no CPU geometry updates (v1 recomputed vertex normals on the CPU every frame).
- Environment animation is shader-driven: rain, ripples, flames, embers, steam, bulb sway, window flicker, smog, shafts.
- Characters that are not on screen are hidden and skip all work.
- three.js loads as a lazy chunk; the UI paints first.
- The partner model is one 464 KB glTF shared by every paint job (the three VRM partners it replaced were about 14 MB). Audio is synthesized, so it adds no downloads.

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

These numbers were measured with the earlier VRM partners. The bots are far lighter (3 materials, no spring bones, no textures), so character cost is now lower; re-measure with `?perf` on your target devices.

Triangle counts include the shadow pass and, on high, the planar reflection pass, which re-render the characters. Medium removes the reflection pass: about 35% fewer calls.

Resource hygiene (scripted checks):
- Cycling screens 6 times: geometries, textures and programs unchanged.
- Switching quality tiers 5 times: geometries and textures unchanged (a leak of bloom render targets was found and fixed: `EffectComposer.dispose()` does not dispose passes). Shader programs grow by a bounded set of variants, which three.js keeps while materials that used them exist.
- `World.dispose()` releases the WebGL context.

## Diagnostics

`?perf` (or Settings → Show performance diagnostics) shows fps, p50/p95 frame time, CPU frame time, tier, render scale, DPR, draw calls (whole frame, all passes), triangles, geometries, textures, programs and JS heap. `window.__WORLD__.stats()` returns the same data for scripted profiling.

## Known costs and next steps

- MToon outlines double the draw items of outlined materials; this is the price of the toon look.
- Real-GPU profiling (Chrome Performance panel with GPU, or `EXT_disjoint_timer_query_webgl2`) should be run on target hardware; this environment had no GPU.
- KTX2 textures and meshopt geometry would cut download size further (see ASSETS.md).
- In-app battle stage (`engine/battle/`): everything is allocated once when the arena is built and recycled. One CPU-simulated particle field (2,600 particles, one draw call) serves streams, sparks, swirls, lightning, coins and leaves; rings, slashes, beams, orbs and barriers are small fixed pools; rocks, meteors, shards, spikes and salt are instanced meshes (one draw call per kind, only while visible). Three point lights stay in the scene at zero intensity between flashes, because toggling their visibility would change the light count and force every lit material to recompile mid-battle. Pokémon art textures are cached per species (bounded by the 38-set pool) and disposed with the stage. Battle playback is paced by a timer queue, and each move line holds until its animation's hit lands, so a dropped frame never desyncs the log from the 3D effects.
- The back alley (sandbox measurement, match screen with two bots, SwiftShader): 192 draw calls / 52k triangles on high, 122 / 26k on medium, 68 / 16k on low. Rain is one instanced draw (2,600 / 1,600 / 600 streaks by tier); embers, steam and bulbs are one draw each. The two alley point lights and the lightning light exist from the start (lightning sits at zero intensity), so nothing recompiles when they flicker.
