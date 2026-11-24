import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { DEFAULT_TRAINER, type CharacterId, type CoinSide, type PlazaEmote, type PlazaPose, type Spot, type TrainerId } from '@shared';
import { trainerLook } from './trainerLook.js';
import { DEFAULT_CHARACTER, characterById, type Emote } from '../characters/roster.js';
import { CameraDirector, type Shot } from './CameraDirector.js';
import { FLOOR_Y, MonRig, type Gesture } from './character/MonRig.js';
import { MON_RIM, hasModel, loadMonModel } from './character/monModel.js';
import { monSize } from './character/size.js';
import { Emitter, type WorldEvents } from './events.js';
import { AdaptiveQuality, EFFECTS, TIERS, initialTier, stepTier, type EffectsLevel, type QualityPref, type QualityTier, type RenderScale } from './quality.js';
import { GradeShader } from './post/GradeShader.js';
import { MAX_SLOTS } from './world/Floor.js';
import { Plaza, PLAZA_SPAWN, RIVAL, isMoveKey, platform, withObstacles, type Bounds, type Walker } from './world/Plaza.js';
import { Follower } from './world/Follower.js';
import { GestureQueue } from './world/gestureQueue.js';
import { PlazaHost, hostFront, hostObstacle } from './world/PlazaHost.js';
import { WALL_R } from './world/dims.js';
import type { BattleStage } from './battle/BattleStage.js';
import { StadiumScene, KEY_POS } from './scenes/StadiumScene.js';
import { SceneTransitionManager, type EnvId } from './scenes/SceneTransitionManager.js';
import { disposeTree, envFromPanels } from './scenes/dispose.js';
import type { EnvShot, IntroEnvironment, TownEnvironment } from './scenes/types.js';
import type { Trainer } from './character/Trainer.js';
import { t as tr } from '../i18n/index.js';

export { disposeTree };
const BLOOM_STRENGTH = 0.55;
/** A trainer in the town square: walking pace (units per second), footprint radius and how tall it stands. */
const TRAINER_WALK = 1.25, TRAINER_R = 0.24, TRAINER_H = 0.98;
/** Partner Pokémon height on the platform (every model is normalised to it). */

export type DuoShot = 'room' | 'match' | 'draft' | 'battle';
export type Layout =
  /** The opening cinematic in its own scene; the partner appears at its reveal. */
  | { mode: 'intro'; partner: CharacterId }
  | { mode: 'title'; featured: CharacterId }
  | { mode: 'select'; focus: CharacterId | null }
  | { mode: 'duo'; mine: CharacterId | null; theirs: CharacterId | null; shot: DuoShot; coin: boolean }
  | { mode: 'victory'; winner: CharacterId; loser: CharacterId | null }
  /** In-app battle: the partners leave the field to the battling Pokémon. */
  | { mode: 'arena'; mine: CharacterId; theirs: CharacterId }
  /** The plaza: the waiting room as a place. This player walks their partner around; the rival's follows the network. */
  | { mode: 'plaza'; mine: CharacterId; theirs: CharacterId | null; seat: 0 | 1 }
  /**
   * The main plaza, a town square of its own: every trainer walks there with their partner following. This
   * player's trainer follows the keys from `spawn`; the others follow the network.
   */
  | { mode: 'hub'; mine: CharacterId; spawn: Spot; others: HubPeer[]; trainer?: TrainerId };
/** Someone else in the main plaza: their member id, their partner, and where their trainer stood when they came in. */
export type HubPeer = { id: string; partner: CharacterId; at: Spot; trainer?: TrainerId };
/** Which environment (scene) shows a layout: the intro, the town square (main plaza, partner showcase) or the stadium. */
export const envOf = (l: Layout): EnvId => (l.mode === 'intro' ? 'intro' : l.mode === 'hub' || l.mode === 'select' ? 'town' : 'stadium');
type WalkLayout = Extract<Layout, { mode: 'plaza' | 'hub' }>;
const walking = (l: Layout | null | undefined): l is WalkLayout => l?.mode === 'plaza' || l?.mode === 'hub';
/**
 * Plaza emotes as authored gestures. Older clients still send the original set: each maps to the nearest real
 * clip, and a spar maps to nothing (no fighting in a plaza).
 */
const GESTURES: Partial<Record<PlazaEmote, Gesture>> = {
  happy: 'happy', stretch: 'stretch', notice: 'notice', nap: 'nap', sit: 'sit',
  greet: 'notice', excited: 'happy', thumbs: 'happy', twirl: 'happy', bow: 'notice',
};
type Pair = { mine: CharacterId | null; theirs: CharacterId | null };
/** A screen point for overlays (CSS pixels, viewport); `on` is false when the partner is off screen. */
export type Anchor = { x: number; y: number; on: boolean; d?: number };
/** A battling Pokemon on screen (CSS px): centre x, head y, feet y, and whether a move animation is playing. */
export type MonAnchor = { x: number; top: number; bottom: number; on: boolean; attacking: boolean };

type Slot = { key: string; x: number; z: number; facing: number; focus: boolean };

/**
 * Display options the World honours (from Settings): quality preset, render scale, effects intensity,
 * calm = Reduce flashing (no crowd camera flashes or screen flashes), steady = the Steady camera style.
 */
export type WorldOptions = {
  quality: QualityPref; renderScale: RenderScale; effects: EffectsLevel; calm: boolean; steady: boolean;
  reducedMotion: boolean; preload: CharacterId[];
};

/**
 * The single owner of WebGL. One renderer, one post chain and one animation loop for the whole app; React
 * only calls imperative methods. Three environments, each with its own scene, lights and camera: the intro
 * (`scenes/intro`), the town square (`scenes/town`, the main plaza) and the stadium (`StadiumScene`). Exactly
 * one is drawn per frame; `SceneTransitionManager` changes between them in the dark, and only partner rigs and
 * trainers move from one scene to another. Rendering pauses when the tab is hidden and adapts resolution and
 * features to measured frame times.
 */
export class World {
  readonly events = new Emitter<WorldEvents>();
  readonly renderer: THREE.WebGLRenderer;
  /** The stadium: rooms, the draft, battles, victories, spectating. */
  readonly st: StadiumScene;
  readonly battle: BattleStage;
  private town: TownEnvironment | null = null;
  private townP: Promise<TownEnvironment | null> | null = null;
  private intro: IntroEnvironment | null = null;
  private introP: Promise<IntroEnvironment | null> | null = null;
  /** The environment on screen (its scene and camera are rendered once it is loaded). */
  private envId: EnvId = 'stadium';
  private envRTs = new Map<EnvId, THREE.WebGLRenderTarget>();
  private cut: SceneTransitionManager<Layout>;
  private renderPass!: RenderPass;
  /** The scene and camera of the environment on screen (the stadium while another one is still loading). */
  get scene(): THREE.Scene { return this.envObj(this.envId)?.scene ?? this.st.scene; }
  get camera(): THREE.PerspectiveCamera { return this.envObj(this.envId)?.camera ?? this.st.camera; }
  private envObj(id: EnvId) { return id === 'stadium' ? this.st : id === 'town' ? this.town : this.intro; }
  /** Trainers in the town square, by 'me' or member id ('loading' while the model comes in). */
  private trainers = new Map<string, Trainer | 'loading'>();
  private trainerMod: Promise<typeof import('./character/Trainer.js') | null> | null = null;
  /** Partners following their trainers in the town square, by 'me' or member id. */
  private followers = new Map<string, Follower>();
  /** Mouse-controlled follow camera in the town square: yaw and pitch around the trainer, zoom factor, a drag in progress. */
  private orbit = { yaw: 0, pitch: 0.42, zoom: 1, drag: null as null | { id: number; x: number; y: number; moved: boolean; button: number } };
  /** Where this player's trainer stood when the partner showcase opened (it comes back there). */
  private hubResume: Spot | null = null;
  /** Intro playback: seconds since it started (-1 before), the next beat, whether the partner is out. */
  private introClock = -1;
  private introBeat = 0;
  private introRevealed = false;
  private introWait = 0;
  private introShot: EnvShot = { pos: [0, 1, 5], target: [0, 1, 0], fov: 36 };
  private director: CameraDirector;
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade!: ShaderPass;
  private tier: QualityTier;
  private pref: QualityPref;
  private adaptive: AdaptiveQuality;
  private accent = new THREE.Color('#3ee6ff');
  private accentTarget = new THREE.Color('#3ee6ff');
  private rigs = new Map<string, MonRig>();
  private loading = new Map<string, Promise<MonRig | null>>();
  private lastCry = new Map<string, number>();
  private prepared = new Set<number>();
  private prewarmed = false;
  /** The plaza entry in progress (see `prepareHub`). */
  private hubEntry: Promise<void> | null = null;
  private hubPrefetched = false;
  private rimWhite = new THREE.Color('#dfe8ff');
  private hitboxes = new Map<string, THREE.Mesh>();
  /** The newest layout asked for (it may still be waiting for the dark: see `cut.pending`). */
  private get layout(): Layout | null { return this.cut?.current ?? null; }
  private get pendingLayout(): Layout | null { return this.cut?.pending ?? null; }
  /** What the stage is showing (intro, title, select, duo, victory, arena, plaza, hub), or null before the first layout. */
  get stage(): Layout['mode'] | null { return this.layout?.mode ?? null; }
  /** The environment on screen. */
  get environment(): EnvId { return this.envId; }
  private slots: Slot[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2(0, 0);
  private pointerIdle = 99;
  private hoverKey: string | null = null;
  private lookPoint = new THREE.Vector3();
  private gaze = new THREE.Vector3();
  private gazeValid = false;
  private gazePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.9);
  /** The walkable waiting room (layout 'plaza'). */
  private plaza = new Plaza();
  private plazaSeat: 0 | 1 = 0;
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
  private floorHit = new THREE.Vector3();
  private anchorV = new THREE.Vector3();
  private anchorFoot = new THREE.Vector3();
  /** A press on the stage is held: the plaza partner follows the pointer. */
  private steering = false;
  /** Someone else's partner fades while it blocks the view of this player's (by rig key). */
  private fades = new Map<string, number>();
  /** Main plaza: the rig each member's partner uses (member id to rig key). */
  private hubRigs = new Map<string, string>();
  /** Poses other partners hold (sit, nap) by peer id; applied once that partner is loaded and standing still. */
  private peerPoses = new Map<string, PlazaPose>();
  /** Gestures from other partners waiting for them to stop or finish loading (see GestureQueue). */
  private peerGestures = new GestureQueue<Gesture>(1.5);
  /**
   * The plaza host (main plaza only): whether this player's partner is close enough to talk, a walk up to her
   * that ends in a conversation, walking input held while a dialogue is open, and the pointer over her.
   */
  readonly plazaHost = new PlazaHost();
  private hostNear = false;
  private talkOnArrival = false;
  private inputLocked = false;
  private hostHover = false;
  private hubBounds: Bounds = platform;
  private clock = 0;
  private cpuMs = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private ro: ResizeObserver;
  private reducedMotion: boolean;
  private renderScale: RenderScale;
  private effects: EffectsLevel;
  private fx: (typeof EFFECTS)[EffectsLevel];
  private calm: boolean;
  private steady: boolean;
  private progressBytes = new Map<string, [number, number]>();
  private removeListeners: Array<() => void> = [];

  static supported(): boolean {
    try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
  }

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, opts: WorldOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x and falls back anyway
    this.renderer.info.autoReset = false; // count the whole frame (all passes), reset manually
    this.reducedMotion = opts.reducedMotion;
    this.pref = opts.quality;
    this.renderScale = opts.renderScale;
    this.effects = opts.effects; this.fx = EFFECTS[opts.effects];
    this.calm = opts.calm; this.steady = opts.steady;
    this.tier = opts.quality === 'auto' ? initialTier(this.renderer.getContext()) : opts.quality;
    this.adaptive = new AdaptiveQuality(() => this.shiftTier(-1), () => this.shiftTier(1), opts.quality === 'auto', opts.renderScale === 'auto');

    this.st = new StadiumScene({ reduced: () => this.reducedMotion, onCoinLand: () => { this.st.floor.pulse(); this.events.emit('sound', { cue: 'coinLand', pan: 0 }); } });
    this.battle = this.st.battle;
    this.director = new CameraDirector(this.st.camera);
    this.director.reducedMotion = this.reducedMotion;
    this.director.steady = this.steady;
    this.syncBattleCamera();
    this.battle.onImpact = color => this.st.floor.pulse(color);
    this.battle.onSound = (cue, pan, gain) => this.events.emit('sound', { cue, pan, gain });
    this.st.scene.add(this.plaza.marker);
    this.cut = new SceneTransitionManager<Layout>({
      mode: l => l.mode, env: envOf, instant: () => this.reducedMotion,
      apply: (l, modeChanged, envChanged) => this.onApply(l, modeChanged, envChanged),
      ready: id => this.envReady(id),
      travel: to => { this.events.emit('travel', { to }); if (to === 'town') void this.loadTown(); else if (to === 'intro') void this.loadIntro(); },
    });

    this.buildTierDependent();
    this.st.buildEnvironmentMap(this.renderer);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.listen(window, 'pointermove', e => this.onPointer(e as PointerEvent));
    this.listen(canvas, 'click', () => this.onClick());
    this.listen(canvas, 'pointerdown', e => this.onDown(e as PointerEvent));
    this.listen(window, 'pointerup', e => this.onUp(e as PointerEvent));
    this.listen(window, 'pointercancel', () => { this.steering = false; this.orbit.drag = null; });
    this.listen(canvas, 'wheel', e => this.onWheel(e as WheelEvent));
    this.listen(canvas, 'contextmenu', e => { if (this.layout?.mode === 'hub') e.preventDefault(); });
    this.listen(window, 'keydown', e => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', e => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => { this.plaza.keys.clear(); this.steering = false; });
    this.listen(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.listen(canvas, 'webglcontextlost', e => { e.preventDefault(); this.stop(); this.events.emit('contextLost'); });
    this.listen(canvas, 'webglcontextrestored', () => { this.restoreGpu(); this.start(); this.events.emit('contextRestored'); });
    this.director.cut(this.shotFor({ mode: 'title', featured: opts.preload[0] ?? DEFAULT_CHARACTER }));
    this.start();
    void this.preload(opts.preload);
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void) {
    t.addEventListener(type, fn);
    this.removeListeners.push(() => t.removeEventListener(type, fn));
  }

  // ---------------------------------------------------------------- quality
  private buildTierDependent() {
    const q = TIERS[this.tier];
    // The stadium's floor (planar reflection is the most expensive feature, high tier only), shafts and shadows;
    // the other environments rebuild their own tier-dependent parts.
    this.st.buildTierDependent(q, this.accent, this.reducedMotion);
    this.town?.setQuality(this.tier);
    this.intro?.setQuality(this.tier);
    this.renderer.shadowMap.enabled = q.shadows;
    for (const sc of [this.st.scene, this.town?.scene, this.intro?.scene]) {
      sc?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => (x.needsUpdate = true)); });
    }

    // Post chain: render → (bloom) → tone map + sRGB → display-space grade.
    // EffectComposer.dispose() frees only its own targets; passes (bloom mips, materials) must be freed too.
    if (this.composer) { for (const pass of this.composer.passes) pass.dispose(); this.composer.dispose(); }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, 0.5, 1.15) : null;
    if (this.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.applyEffects();
    this.resize();
    this.events.emit('quality', { tier: this.tier, scale: this.pixelScale() });
  }

  /**
   * Effects intensity and Reduce flashing: bloom strength, post-processing (grain and colour fringe;
   * impact blur is scaled per frame), battle particles and light flashes, and the crowd's camera
   * flashes and scrolling boards (flashes count as flashing).
   */
  private applyEffects() {
    const fx = this.fx, base = GradeShader.uniforms, g = this.grade.uniforms;
    if (this.bloom) { this.bloom.enabled = fx.bloom > 0; this.bloom.strength = BLOOM_STRENGTH * fx.bloom; }
    g.uGrain.value = base.uGrain.value * (this.reducedMotion ? 0.5 : 1) * fx.post;
    g.uFringe.value = base.uFringe.value * fx.post;
    this.battle.setEffects(fx.particles, fx.lights, this.calm);
    this.st.stadium.reduced = this.reducedMotion || this.calm;
  }

  private shiftTier(dir: -1 | 1): boolean {
    const next = stepTier(this.tier, dir);
    if (!next) return false;
    this.tier = next; this.buildTierDependent(); return true;
  }

  setQuality(pref: QualityPref) {
    this.pref = pref;
    this.adaptive.tiers = pref === 'auto';
    const t = pref === 'auto' ? initialTier(this.renderer.getContext()) : pref;
    this.adaptive.scale = 1;
    if (t !== this.tier) { this.tier = t; this.buildTierDependent(); } else this.resize();
  }
  /** Fixed share of the tier's resolution, or 'auto' to let the adaptive controller trade resolution for frame time. */
  setRenderScale(s: RenderScale) {
    this.renderScale = s;
    this.adaptive.resolution = s === 'auto';
    this.adaptive.scale = 1;
    this.resize();
    this.events.emit('quality', { tier: this.tier, scale: this.pixelScale() });
  }
  setEffects(level: EffectsLevel, calm: boolean) {
    this.effects = level; this.fx = EFFECTS[level]; this.calm = calm;
    this.applyEffects();
  }
  setCameraStyle(style: 'cinematic' | 'steady') {
    this.steady = style === 'steady'; this.director.steady = this.steady;
    this.syncBattleCamera();
  }
  setReducedMotion(v: boolean) {
    this.reducedMotion = v; this.director.reducedMotion = v;
    this.st.atmosphere.reduced = v;
    for (const r of this.rigs.values()) r.reducedMotion = v;
    this.syncBattleCamera();
    this.applyEffects();
  }
  /** Battle cinematography (cuts, sweeps, breathing) only runs with full motion and the cinematic camera. */
  private syncBattleCamera() {
    this.battle.cam.enabled = !this.reducedMotion && !this.steady;
    if (!this.battle.cam.enabled) this.battle.cam.reset();
  }
  /** Multiplier on the tier's pixel ratio: the fixed render scale, or the adaptive one. */
  private pixelScale() { return this.renderScale === 'auto' ? this.adaptive.scale : this.renderScale; }

  /**
   * After a lost WebGL context comes back, three re-uploads everything it still has CPU data for (geometry,
   * image textures, programs), but a render target's pixels lived only on the GPU. The prefiltered environment
   * map is rendered once at start-up, so it came back empty: every Pokémon (all lit by it) went near black and
   * vanished into the night stadium while the game kept running. Re-render it, and drop the shadow map so it is
   * recreated at the right size. Context losses happen on Alt+Tab, minimising, GPU resets and memory pressure.
   */
  private restoreGpu() {
    this.st.buildEnvironmentMap(this.renderer);
    for (const id of ['town', 'intro'] as const) { const env = this.envObj(id) as TownEnvironment | IntroEnvironment | null; if (env) this.buildEnvMap(id, env); }
    for (const key of [this.st.key, this.town?.key]) if (key?.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
    this.resize();
  }

  // ---------------------------------------------------------------- environments
  /** Reflections for an environment from its light panels, prefiltered once (again after a lost context). */
  private buildEnvMap(id: EnvId, env: TownEnvironment | IntroEnvironment) {
    this.envRTs.get(id)?.dispose();
    const rt = envFromPanels(this.renderer, env.envPanels);
    this.envRTs.set(id, rt);
    env.scene.environment = rt.texture;
    env.scene.environmentIntensity = 0.5;
  }
  private envReady(id: EnvId) { return id === 'stadium' || (id === 'town' ? !!this.town : !!this.intro); }
  /** Compile a whole environment's shaders into the post chain's target before it is first seen. */
  private compileEnv(scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    const done = this.renderer.compileAsync(scene, camera, scene);
    this.renderer.setRenderTarget(prev);
    return done.catch(() => undefined);
  }
  /** Load and build the town square once (its own chunk). Resolves to null when it cannot be built. */
  loadTown(): Promise<TownEnvironment | null> {
    return (this.townP ??= import('./scenes/town/Town.js').then(async m => {
      if (this.disposed) return null;
      const env = m.createTown({ tier: this.tier });
      this.buildEnvMap('town', env);
      env.scene.add(this.plazaHost.group);
      this.plazaHost.setSpot(env.spots.host);
      this.hubBounds = withObstacles((x, z, r) => env.bounds(x, z, r), [hostObstacle(env.spots.host)]);
      this.fitCamera(env.camera);
      await this.compileEnv(env.scene, env.camera);
      if (this.disposed) { env.dispose(); return null; }
      this.town = env;
      this.onEnvLoaded('town');
      return env;
    }).catch(e => { console.error('[town]', e); this.events.emit('error', { message: String(e) }); return null; }));
  }
  /** Load and build the intro once. */
  loadIntro(): Promise<IntroEnvironment | null> {
    return (this.introP ??= import('./scenes/intro/Intro.js').then(async m => {
      if (this.disposed) return null;
      const env = m.createIntro({ tier: this.tier });
      this.buildEnvMap('intro', env);
      this.fitCamera(env.camera);
      await this.compileEnv(env.scene, env.camera);
      if (this.disposed) { env.dispose(); return null; }
      this.intro = env;
      this.onEnvLoaded('intro');
      return env;
    }).catch(e => { console.error('[intro]', e); this.events.emit('error', { message: String(e) }); return null; }));
  }
  /** An environment finished loading: if it is the one wanted on screen, move everyone into it and re-stage. */
  private onEnvLoaded(id: EnvId) {
    this.events.emit('envReady', { env: id });
    if (this.envId !== id || !this.layout || this.pendingLayout) return;
    this.moveInto(id);
    this.applyLayout(this.layout, true);
    this.director.cut(this.shotFor(this.layout));
  }
  /** Re-parent what moves between scenes (partner rigs, trainers, the walk marker) into environment `id`. */
  private moveInto(id: EnvId) {
    const env = this.envObj(id);
    if (!env) return;
    for (const rig of this.rigs.values()) env.scene.add(rig.root);
    for (const tr of this.trainers.values()) if (tr !== 'loading') { if (id === 'town') env.scene.add(tr.root); else tr.root.removeFromParent(); }
    env.scene.add(this.plaza.marker);
    this.renderPass.scene = env.scene;
    this.renderPass.camera = env.camera;
    this.director.attach(env.camera);
    this.fitCamera(env.camera);
  }
  /** The scene changes (in the dark): start loading the new environment if needed and move into it. */
  private switchEnv(id: EnvId) {
    const was = this.envId;
    this.envId = id;
    if (id === 'town') void this.loadTown();
    if (id === 'intro') void this.loadIntro();
    if (was === 'town' && id !== 'town') { this.hubResume = null; for (const tr of this.trainers.values()) if (tr !== 'loading') tr.root.removeFromParent(); }
    // Rigs keep living (cached models); only their parent scene changes.
    if (this.envReady(id)) this.moveInto(id);
    // The intro plays once: free it when the game moves on.
    if (was === 'intro' && id !== 'intro' && this.intro) {
      const env = this.intro; this.intro = null; this.introP = null;
      env.dispose(); this.envRTs.get('intro')?.dispose(); this.envRTs.delete('intro');
    }
  }

  // ---------------------------------------------------------------- characters
  private async preload(ids: CharacterId[]) {
    for (const id of ids.length ? ids : [DEFAULT_CHARACTER]) { await this.ensureRig(id); if (this.disposed) return; }
    this.events.emit('ready');
  }

  private reportProgress(key: string, loaded: number, total: number, label: string) {
    this.progressBytes.set(key, [loaded, total || loaded]);
    let l = 0, t = 0; for (const [a, b] of this.progressBytes.values()) { l += a; t += b; }
    this.events.emit('progress', { loaded: l, total: t, label });
  }

  /** Get (or lazily create) a rig. `#2` keys are second instances used when both players pick the same partner. */
  private ensureRig(key: string): Promise<MonRig | null> {
    const existing = this.rigs.get(key);
    if (existing) return Promise.resolve(existing);
    let p = this.loading.get(key);
    if (p) return p;
    const id = key.split('#')[0] as CharacterId;
    const c = characterById(id);
    if (!c) return Promise.resolve(null);
    // The 3D model when the Pokémon 3D API has one; otherwise (or offline) the official artwork card.
    const model = hasModel(c.dex) ? loadMonModel(c.dex, monSize(c.dex), (l, t) => this.reportProgress(key, l, t, c.name)).catch(() => null) : Promise.resolve(null);
    // Compile the model's shaders before it is shown, so its first frame on stage does not hitch.
    const compiled = model.then(m => (m ? this.compile(m.root).then(() => m, () => m) : m));
    p = compiled.then(m => {
      if (this.disposed) return null;
      const rig = new MonRig(m, c);
      rig.reducedMotion = this.reducedMotion;
      rig.setVisible(false, true); rig.root.visible = false;
      this.scene.add(rig.root);
      // Invisible capsule-ish hitbox for hover/click picking (cheaper and steadier than skinned meshes).
      const hr = 0.45 * Math.max(0.5, rig.height / 1.1);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, rig.height * 0.95, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = rig.height * 0.48; hit.userData.key = key;
      rig.root.add(hit); this.hitboxes.set(key, hit);
      this.rigs.set(key, rig);
      this.events.emit('characterReady', { id });
      if (this.layout && !this.pendingLayout && this.envReady(this.envId)) this.applyLayout(this.layout, false);
      return rig;
    });
    this.loading.set(key, p);
    return p;
  }

  isLoaded(id: CharacterId) { return this.rigs.has(id); }

  /**
   * Compile `obj`'s shaders exactly as the frame will draw it: against this scene's lights, into the post
   * chain's linear target. Compiling with no target set builds the on-screen variant (sRGB output, tone
   * mapping on), which the scene never uses, so the real program still compiled on the first visible frame.
   */
  compile(obj: THREE.Object3D, camera: THREE.Camera = this.camera): Promise<unknown> {
    return this.compileIn(obj, this.scene, camera);
  }
  /** As `compile`, against another environment's scene (its lights decide the shader variant). */
  compileIn(obj: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    const done = this.renderer.compileAsync(obj, camera, scene);
    this.renderer.setRenderTarget(prev);
    return done;
  }

  /**
   * Get battling Pokémon ready before they are sent out: download each model and compile its shaders
   * against this scene now, so a switch-in never waits on the network or stalls a frame compiling.
   */
  prepareMons(dexes: number[]) {
    for (const dex of dexes) {
      if (this.prepared.has(dex) || !hasModel(dex)) continue;
      this.prepared.add(dex);
      void loadMonModel(dex, monSize(dex)).then(m => this.compile(m.root).finally(() => { for (const mat of m.materials) mat.dispose(); })).catch(() => this.prepared.delete(dex));
    }
  }

  /**
   * Download and compile the plaza host while the player idles on the title screen, so the plaza usually
   * opens with nothing left to do. Skipped on the low tier and when the browser asks to save data.
   */
  prefetchHub() {
    if (this.hubPrefetched || this.tier === 'low') return;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return;
    this.hubPrefetched = true;
    const idle = (cb: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));
    idle(() => { if (!this.disposed) void this.loadTown().then(env => this.plazaHost.prepare(this.renderer, o => (env ? this.compileIn(o, env.scene, env.camera) : this.compile(o)))).catch(() => { this.hubPrefetched = false; }); });
  }

  /**
   * Everything the main plaza shows, ready before it is uncovered: the host downloaded, built, uploaded and
   * compiled, and the partners of the trainers already there loaded and compiled (`ensureRig`). Reports
   * `hubProgress`; resolves when all of that is done and the plaza has been drawn twice behind the veil, or
   * after `timeoutMs`, so the plaza never waits forever (whatever is late fades in when it arrives).
   * Adaptive quality ignores the frames of the entry, so its one-off cost never lowers the tier.
   */
  prepareHub(partners: readonly CharacterId[], timeoutMs = 4000): Promise<void> {
    const t0 = performance.now();
    this.adaptive.mute(timeoutMs / 1000 + 2);
    let host = this.plazaHost.loaded ? 1 : 0, mons = 0;
    const want = [...new Set(partners)].filter(id => !this.rigs.has(id));
    const report = () => {
      const progress = Math.min(1, host * 0.7 + (want.length ? mons / want.length : 1) * 0.3);
      const label = tr(host < 1 ? 'world.callingMira' : mons < want.length ? 'world.greetingTrainers' : 'world.openingStands');
      this.events.emit('hubProgress', { progress, label });
    };
    report();
    const townP = this.loadTown();
    const hostP = townP.then(env => this.plazaHost.prepare(this.renderer, o => (env ? this.compileIn(o, env.scene, env.camera) : this.compile(o)), f => { host = f; report(); })).catch(() => { host = 1; report(); });
    const monsP = Promise.all(want.map(id => this.ensureRig(id).finally(() => { mons++; report(); })));
    // The plaza must be applied (the screen cut ends in the dark) and drawn with everything in it.
    const applied = () => new Promise<void>(res => {
      const check = () => (this.disposed || (!this.pendingLayout && this.layout?.mode === 'hub') ? res() : requestAnimationFrame(check));
      check();
    });
    const drawn = () => new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
    const done = Promise.all([hostP, monsP, applied()]).then(drawn);
    const timeout = new Promise<void>(res => window.setTimeout(res, timeoutMs));
    const entry = Promise.race([done, timeout]).then(() => {
      if (this.hubEntry === entry) this.hubEntry = null;
      this.lastHubEntry = { ms: Math.round(performance.now() - t0), complete: host >= 1 && mons >= want.length, timings: { ...this.plazaHost.timings } };
    });
    this.hubEntry = entry;
    return entry;
  }
  /** How the last plaza entry went (for profiling). */
  lastHubEntry: { ms: number; complete: boolean; timings: object } | null = null;
  /** The entry veil has lifted: from here on, anything that arrives late fades in. */
  hubShown() { this.plazaHost.expose(); }

  // ---------------------------------------------------------------- layout & camera
  /**
   * Show a layout. Screen changes get a cinematic cut (dip to black, re-stage while dark, push in on the new
   * shot); a change of environment is a slower travel that waits in the dark until the new place is ready.
   * Requests made during a cut replace the one waiting for the dark (SceneTransitionManager).
   */
  setLayout(layout: Layout) {
    if (JSON.stringify(layout) === JSON.stringify(this.layout)) return;
    this.cut.request(layout);
  }

  /** The transition manager applies a layout (at once, or in the dark of a cut or travel). */
  private lastMode: Layout['mode'] | null = null;
  private onApply(l: Layout, modeChanged: boolean, envChanged: boolean) {
    // Leaving the town square for the partner showcase: remember where the trainer stood.
    if (l.mode === 'select' && this.lastMode === 'hub') this.hubResume = this.plaza.spot();
    this.lastMode = l.mode;
    if (envChanged) this.switchEnv(envOf(l));
    if (l.mode === 'intro' && modeChanged) { this.introClock = -1; this.introBeat = 0; this.introRevealed = false; this.introWait = 0; }
    if (!this.envReady(envOf(l))) return; // re-staged by onEnvLoaded once it arrives
    this.applyLayout(l, modeChanged);
    if (!modeChanged) return;
    const shot = this.shotFor(l);
    if (this.reducedMotion || this.steady) this.director.cut(shot);
    else if (envChanged) {
      // Arriving somewhere new: start on an establishing view and glide into the first shot.
      this.director.cut(this.arrivalShot(l, shot));
      this.director.go({ ...shot, time: l.mode === 'hub' ? 2.2 : 2.6 });
      return;
    } else this.director.cut({ ...shot, pos: [shot.pos[0], shot.pos[1] + 0.12, shot.pos[2] + 0.7] });
    this.director.go(shot);
  }
  /** The first view of an environment after a travel: high and wide, so the place is revealed before the action. */
  private arrivalShot(l: Layout, shot: Shot): Shot {
    if (l.mode === 'intro') return shot;
    if (envOf(l) === 'town') {
      const t = shot.target;
      return { pos: [t[0] + 1.5, t[1] + 4.2, t[2] + 7.5], target: [t[0], t[1] + 0.6, t[2] - 2], fov: shot.fov + 6, time: shot.time };
    }
    // The stadium: from high over the stands, sweeping down onto the field.
    return { pos: [-9, 8.5, 17], target: [0, 1.2, 0], fov: 44, time: shot.time };
  }

  /**
   * Framing for a partner: shots were composed around a 1.1-unit partner. Partners now stand at their
   * relative size, so the lens moves with them, partway: a small one is still shown smaller than a big one.
   */
  private framing(key: string | null | undefined) {
    if (!key) return 1;
    const id = key.split('#')[0] as CharacterId;
    const h = this.rigs.get(key)?.height ?? monSize(characterById(id)?.dex ?? 0);
    return THREE.MathUtils.clamp(Math.sqrt(h / 1.1), 0.55, 1.15);
  }
  /** A shot around point (x, z): camera and target offsets scaled by f. */
  private around(x: number, z: number, pos: [number, number, number], target: [number, number, number], f: number, fov: number, time: number): Shot {
    return { pos: [x + pos[0] * f, pos[1] * f, z + pos[2] * f], target: [x + target[0] * f, target[1] * f, z + target[2] * f], fov, time };
  }

  private shotFor(l: Layout): Shot {
    switch (l.mode) {
      case 'intro': {
        const env = this.intro;
        if (!env) return { pos: [0, 1.2, 6], target: [0, 1, 0], fov: 36, time: 0 };
        env.shotAt(Math.max(0, this.introClock), this.introShot);
        return { pos: [...this.introShot.pos], target: [...this.introShot.target], fov: this.introShot.fov, time: 0 };
      }
      case 'title': return this.around(0.95, 0.15, [-1.4, 1.3, 4.25], [-0.35, 0.78, -0.15], this.framing(l.featured), 30, 1.4);
      case 'select': {
        const town = this.town;
        if (town) {
          // The showcase stage in the town: the town's framing for a 1-unit partner, scaled to this one.
          // 12% headroom: floating partners (Flutter Mane) rise above their nominal height.
          const sp = town.spots.showcase, c = town.spots.showcaseCam, f = (this.framing(l.focus) / 0.95) * 1.12;
          const sc = (v: number[], base: number[]): [number, number, number] => [base[0] + (v[0] - base[0]) * f, FLOOR_Y + (v[1] - FLOOR_Y) * f, base[2] + (v[2] - base[2]) * f];
          const base = [sp.x, FLOOR_Y, sp.z];
          const portrait = this.camera.aspect < 0.85 ? 1.25 : 1;
          const pos = sc(c.pos, base), target = sc(c.target, base);
          if (portrait > 1) { pos[0] = base[0] + (pos[0] - base[0]) * portrait; pos[2] = base[2] + (pos[2] - base[2]) * portrait; target[1] -= 0.25 * f; }
          else {
            // Landscape: frame the partner in the free area right of the select panel (it covers about 440px + margin).
            const panel = Math.min(0.62, (440 + 80) / Math.max(1, this.host.clientWidth));
            const shift = Math.max(0, panel - 0.2); // NDC x of the partner: close to the centre of the free area (which is at NDC = panel)
            if (shift > 0) {
              const dx = target[0] - pos[0], dz = target[2] - pos[2], d = Math.hypot(dx, dz) || 1;
              const dist = Math.hypot(dx, target[1] - pos[1], dz);
              const halfW = dist * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) * Math.max(1, this.camera.aspect);
              const k = halfW * shift; // move the camera left along its right vector, so the partner moves right on screen
              const rx = -dz / d, rz = dx / d;
              pos[0] -= rx * k; pos[2] -= rz * k; target[0] -= rx * k; target[2] -= rz * k;
            }
          }
          return { pos, target, fov: c.fov, time: 1.0 };
        }
        if (!l.focus) return { pos: [0, 1.1, 5.0], target: [0, 0.8, 0], fov: 31, time: 1.2 };
        const s = this.selectSlots(l.focus).find(x => x.focus)!;
        // An upright phone has the panel over the lower half: pull back and aim low so the partner stands above it.
        if (this.camera.aspect < 0.85) return this.around(s.x, s.z, [-0.6, 1.9, 6.4], [-0.45, 0.05, 0], this.framing(l.focus), 31, 1.0);
        return this.around(s.x, s.z, [-0.8, 1.4, 4.3], [-0.6, 0.95, 0], this.framing(l.focus), 31, 1.0);
      }
      case 'duo': {
        // Both partners stay in frame: the taller one sets the framing.
        const f = Math.max(0.78, this.framing(l.mine), this.framing(l.theirs));
        if (l.shot === 'draft') return this.around(0, 0, [0, 1.95, 6.6], [0, 1.45, 0], f, 33, 1.3);
        if (l.shot === 'battle') return this.around(0, 0, [0, 1.5, 5.3], [0, 1.25, 0], f, 33, 1.3);
        return this.around(0, 0, [0, 1.25, 4.7], [0, 1.05, 0], f, 34, 1.3);
      }
      case 'victory': return this.around(0, 0.35, [0.25, 1.0, 2.4], [0, 1.25, -0.1], this.framing(l.winner), 33, 1.6);
      case 'arena': return this.battle.cam.neutral();
      case 'plaza': case 'hub': return this.plazaShot();
    }
  }

  private theirsKey(l: Pair) { return l.theirs ? (l.theirs === l.mine ? `${l.theirs}#2` : l.theirs) : null; }
  /** Plaza follow camera: behind and above this player's partner, kept inside the stadium wall. It looks at
   * the floor just in front of the partner, so the partner sits in the upper half, clear of the dock. */
  private plazaShot(): Shot {
    const w = this.plaza.me;
    const l = this.layout;
    const h = (walking(l) ? this.rigs.get(l.mine)?.height : undefined) ?? 0.7;
    if (l?.mode === 'hub' && this.inputLocked) {
      // Talking to the host: a two-shot from the side, both of them above the dialogue box.
      const hs = this.plazaHost.spot;
      let dx = hs.x - w.x, dz = hs.z - w.z;
      const d = Math.max(0.01, Math.hypot(dx, dz)); dx /= d; dz /= d;
      const mx = (w.x + hs.x) / 2, mz = (w.z + hs.z) / 2, back = 0.9 + d * 0.3, out = 2.3 + d * 0.6;
      return { pos: [mx + dz * out - dx * back, FLOOR_Y + 1.45, mz - dx * out - dz * back], target: [mx, FLOOR_Y + 0.45, mz], fov: 38, time: 0.9 };
    }
    if (l?.mode === 'hub' && this.town) return this.orbitShot();
    const f = THREE.MathUtils.clamp(Math.sqrt(h / 0.7), 0.85, 1.4);
    // The main plaza pulls back and up and looks further ahead: the other trainers are the point of it.
    const wide = l?.mode === 'hub' ? 1.55 : 1;
    let cx = w.x * 0.8, cz = w.z + 3.6 * f * wide;
    const r = Math.hypot(cx, cz), max = WALL_R - 1;
    if (r > max) { cx *= max / r; cz *= max / r; }
    // Framed so the partner's middle sits a little above the screen's middle, from the smallest to Lugia;
    // higher on a phone held upright, where the dock covers the lower half.
    const near = (this.camera.aspect < 0.85 ? 0.85 : 0.5) * f - (wide - 1) * 2.2;
    return { pos: [cx, (2.0 * f + 0.3) * wide, cz], target: [w.x, FLOOR_Y + h * 0.35, w.z + near], fov: 40, time: 0.45 };
  }

  /**
   * The town square's follow camera, under the mouse: behind and above the trainer at the orbit's yaw and pitch,
   * zoomed with the wheel, pulled in front of any building or wall between it and the trainer.
   */
  private orbitShot(): Shot {
    const w = this.plaza.me, o = this.orbit, town = this.town!;
    const tx = w.x, ty = FLOOR_Y + TRAINER_H * 0.78, tz = w.z;
    const portrait = this.camera.aspect < 0.85 ? 1.35 : 1;
    let dist = 4.1 * o.zoom * portrait;
    const cp = Math.cos(o.pitch), dx = Math.sin(o.yaw) * cp, dz = Math.cos(o.yaw) * cp, dy = Math.sin(o.pitch);
    // March from the trainer toward the camera: stop before the first point inside a building or past the edge.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const d = (dist * i) / steps, x = tx + dx * d, z = tz + dz * d;
      const at = town.bounds(x, z, 0.12);
      if (Math.abs(at.x - x) + Math.abs(at.z - z) > 0.04 && ty + dy * d < 4.5) { dist = Math.max(1.1, (dist * (i - 1)) / steps); break; }
    }
    const pos: [number, number, number] = [tx + dx * dist, Math.max(FLOOR_Y + 0.35, ty + dy * dist), tz + dz * dist];
    // Look a little ahead of the trainer so the partner behind it and the way forward share the frame.
    return { pos, target: [tx - dx * 0.6, ty - 0.12, tz - dz * 0.6], fov: 44, time: o.drag?.moved ? 0.08 : 0.32 };
  }

  private selectSlots(focus: CharacterId | null): Slot[] {
    // Partner select: just the chosen Pokémon, on the town's showcase stage (centre stage in the stadium).
    const sp = this.town?.spots.showcase;
    if (sp) return focus ? [{ key: focus, x: sp.x, z: sp.z, facing: sp.face, focus: true }] : [];
    return focus ? [{ key: focus, x: 0, z: 0.35, facing: 0, focus: true }] : [];
  }

  private applyLayout(l: Layout, modeChanged: boolean) {
    let slots: Slot[] = [];
    const hub = l.mode === 'hub';
    this.plazaHost.setActive(hub, this.reducedMotion);
    this.plaza.bounds = hub ? this.hubBounds : platform;
    if (!hub) {
      this.talkOnArrival = false; this.inputLocked = false;
      if (this.hostNear) { this.hostNear = false; this.events.emit('hostNear', { near: false }); }
    }
    let accent: CharacterId | null = null;
    if (l.mode === 'intro') {
      void this.ensureRig(l.partner);
      const sp = this.intro?.partnerSpot;
      if (sp && this.introRevealed) slots = [{ key: l.partner, x: sp.x, z: sp.z, facing: sp.face, focus: true }];
      accent = l.partner;
    }
    if (l.mode === 'title') { slots = [{ key: l.featured, x: 0.95, z: 0.15, facing: -0.32, focus: true }]; accent = l.featured; }
    if (l.mode === 'select') { slots = this.selectSlots(l.focus); accent = l.focus; }
    if (walking(l)) {
      const p = this.plaza;
      if (l.mode === 'plaza' && (modeChanged || this.plazaSeat !== l.seat)) { this.plazaSeat = l.seat; p.enter(PLAZA_SPAWN[l.seat]); p.peer(RIVAL, PLAZA_SPAWN[1 - l.seat]); }
      if (l.mode === 'hub') {
        // Back from the partner showcase: the trainer is where it was, not at the entrance.
        if (modeChanged) { p.enter(this.hubResume ?? l.spawn); this.hubResume = null; this.hubRigs.clear(); this.followers.clear(); }
        // Whoever left is forgotten; newcomers appear where they stood when they came in.
        const here = new Set(l.others.map(o => o.id));
        for (const id of [...p.peers.keys()]) if (!here.has(id)) { p.drop(id); this.hubRigs.delete(id); }
        for (const o of l.others) p.peer(o.id, o.at);
      }
      if (l.mode === 'hub') {
        // In the town the walkers are the trainers; partners stand where their followers are.
        for (const [k, w] of this.walkers(l)) slots.push({ key: k, x: w.x, z: w.z, facing: w.face, focus: false });
        this.syncTrainers(l);
      } else {
        slots.push({ key: l.mine, x: p.me.x, z: p.me.z, facing: p.me.face, focus: false });
        for (const [id, key] of this.peerKeys(l)) { const w = p.peer(id); slots.push({ key, x: w.x, z: w.z, facing: w.face, focus: false }); }
      }
      accent = l.mine;
    } else {
      for (const rig of this.rigs.values()) { rig.stride(0, 1); rig.setFade(1); }
      this.fades.clear();
      this.plaza.keys.clear(); this.steering = false; this.plaza.marker.visible = false; this.orbit.drag = null;
      this.st.key.position.copy(KEY_POS); this.st.key.target.position.set(0, 1, 0);
    }
    if (l.mode !== 'hub') this.syncTrainers(null);
    this.canvas.style.touchAction = walking(l) ? 'none' : '';
    if (l.mode === 'duo') {
      if (l.mine) slots.push({ key: l.mine, x: -1.05, z: 0, facing: 0.42, focus: false });
      if (l.theirs) slots.push({ key: l.theirs === l.mine ? `${l.theirs}#2` : l.theirs, x: 1.05, z: 0, facing: -0.42, focus: false });
      accent = l.mine;
      this.st.coin.visibleTarget = l.coin ? 1 : 0;
    } else this.st.coin.visibleTarget = 0;
    this.adaptive.hold = l.mode === 'arena';
    if (l.mode === 'arena') {
      // The partners leave the field to the battling Pokémon.
      accent = l.mine;
      if (!this.prewarmed) { this.prewarmed = true; void this.battle.prewarm(o => this.compile(o)).catch(() => { this.prewarmed = false; }); }
      if (modeChanged && !this.reducedMotion) this.battle.cam.intro();
    } else this.battle.clear();
    if (l.mode === 'victory') {
      slots.push({ key: l.winner, x: 0, z: 0.35, facing: 0, focus: true });
      if (l.loser) slots.push({ key: l.loser === l.winner ? `${l.loser}#2` : l.loser, x: 1.7, z: -0.8, facing: -0.5, focus: false });
      accent = l.winner;
    }
    const wanted = new Set(slots.map(s => s.key));
    for (const s of slots) void this.ensureRig(s.key);
    for (const [key, rig] of this.rigs) {
      const s = slots.find(x => x.key === key);
      if (!s) { rig.setVisible(false); rig.focused = false; continue; }
      // New screen (or newly shown): teleport. Within a screen: glide.
      rig.place(s.x, s.z, s.facing, !rig.isShown || modeChanged);
      rig.setVisible(true);
      rig.focused = s.focus;
    }
    this.slots = slots.filter(s => wanted.has(s.key));
    // The stadium floor glows under the partners on it; the other environments have their own ground.
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = envOf(l) === 'stadium' ? this.slots[i] : undefined;
      if (s) this.st.floor.setSlot(i, s.x, s.z, 0.55 * this.framing(s.key), s.focus ? 1 : 0.35); else this.st.floor.setSlot(i, 0, 0, 0, 0);
    }
    if (accent) this.accentTarget.set(characterById(accent)!.accent);
    const shot = this.shotFor(l);
    this.director.go(shot);
  }

  /** Trigger an emote on a slot: 'mine' / 'theirs' in duo mode, or a character id. */
  emote(who: 'mine' | 'theirs' | CharacterId, e: Emote) {
    const l = this.layout;
    let key: string | null = who;
    if (who === 'mine' || who === 'theirs') {
      if (l?.mode === 'hub') key = who === 'mine' ? l.mine : null;
      else if (l?.mode === 'duo' || l?.mode === 'arena' || l?.mode === 'plaza') key = who === 'mine' ? l.mine : this.theirsKey(l);
      else return;
    }
    this.emoteKey(key, e);
  }
  /** Play an emote on a rig; big reactions come with the Pokémon's cry. */
  private emoteKey(key: string | null, e: Emote) {
    const rig = key ? this.rigs.get(key) : undefined;
    if (!rig) return;
    rig.play(e);
    // Big reactions come with the Pokémon's own cry (lower for sad ones), at most once every few seconds each.
    if (!rig.root.visible || e === 'nod' || e === 'bow' || e === 'thinking' || e === 'idle') return;
    const now = performance.now();
    if (now - (this.lastCry.get(key!) ?? -1e9) < 3500) return;
    this.lastCry.set(key!, now);
    const sad = e === 'sad' || e === 'faceplant';
    this.events.emit('cry', { dex: rig.character.dex, pan: Math.max(-1, Math.min(1, rig.root.position.x / 3)), gain: sad ? 0.45 : 0.65, rate: sad ? 0.88 : 1 });
  }

  // ---------------------------------------------------------------- plazas
  /** Everyone else on the field in a walkable layout, as [peer id, rig key]. */
  private peerKeys(l: WalkLayout): [string, string][] {
    if (l.mode === 'plaza') { const tk = this.theirsKey(l); return tk ? [[RIVAL, tk]] : []; }
    return l.others.map(o => [o.id, this.hubKey(o)]);
  }
  /** Every partner on the field, this player's first, as [rig key, walker] (in the town: their followers). */
  private walkers(l: WalkLayout): [string, Walker][] {
    if (l.mode === 'hub') return [[l.mine, this.follower('me').w], ...this.peerKeys(l).map(([id, key]) => [key, this.follower(id).w] as [string, Walker])];
    return [[l.mine, this.plaza.me], ...this.peerKeys(l).map(([id, key]) => [key, this.plaza.peer(id)] as [string, Walker])];
  }
  /** The partner following a trainer ('me' or a member id), created on first use. */
  private follower(id: string): Follower {
    let f = this.followers.get(id);
    if (!f) { f = new Follower(); f.side = id === 'me' ? 1 : (id.charCodeAt(id.length - 1) % 2 ? -1 : 1); this.followers.set(id, f); }
    return f;
  }
  /**
   * Trainers for this player and everyone in the town square (null: none, outside the town). Models load in the
   * background, each one shared; whoever left loses theirs.
   */
  private syncTrainers(l: Extract<Layout, { mode: 'hub' }> | null) {
    const want = new Map<string, CharacterId>();
    const model = new Map<string, TrainerId>();
    if (l) {
      want.set('me', l.mine); model.set('me', l.trainer ?? DEFAULT_TRAINER);
      for (const o of l.others) { want.set(o.id, o.partner); model.set(o.id, o.trainer ?? DEFAULT_TRAINER); }
    }
    for (const [id, tr] of this.trainers) {
      // A trainer cannot switch model in place: someone who picked another model gets a new trainer.
      const stale = want.has(id) && this.trainerModels.get(id) !== model.get(id);
      if (want.has(id) && !stale) continue;
      if (tr !== 'loading') { tr.root.removeFromParent(); tr.dispose(); }
      this.trainers.delete(id); this.trainerModels.delete(id);
      if (!stale) this.followers.delete(id);
    }
    if (!l) return;
    // A failed import is not remembered: the next sync tries again (it used to stay null for the whole session,
    // and then no trainer ever appeared again).
    const mod = this.trainerMod ??= import('./character/Trainer.js').catch(e => { console.warn('[trainer]', e); this.trainerMod = null; return null; });
    for (const [id, partner] of want) {
      if (this.trainers.has(id)) continue;
      this.trainers.set(id, 'loading');
      const which = model.get(id) ?? DEFAULT_TRAINER;
      this.trainerModels.set(id, which);
      const c = characterById(partner);
      void mod.then(async m => {
        if (!m) throw new Error('trainer module unavailable');
        if (this.disposed) return;
        const look = trainerLook(id, c?.accent ?? '#3ee6ff');
        const tr = await m.Trainer.load(look, { reducedMotion: this.reducedMotion, model: which });
        if (this.disposed || this.trainers.get(id) !== 'loading' || this.trainerModels.get(id) !== which) { tr.dispose(); return; }
        // The trainer stands on the town's ground: its root and both feet follow the ground height under them.
        tr.root.position.y = FLOOR_Y;
        const town = this.town;
        if (town?.heightAt) tr.setGround((x, z) => town.heightAt!(x, z));
        this.trainers.set(id, tr);
        if (this.envId === 'town' && this.town) this.town.scene.add(tr.root);
      }).catch(e => {
        console.warn('[trainer]', e);
        // Drop the 'loading' mark so the next sync (a layout change, someone arriving) retries this trainer.
        if (this.trainers.get(id) === 'loading') { this.trainers.delete(id); this.trainerRetry ??= window.setTimeout(() => this.retryTrainers(), 4000); }
      });
    }
  }
  private trainerRetry: number | null = null;
  /** The model each trainer was loaded with (a change of model reloads it). */
  private trainerModels = new Map<string, TrainerId>();
  /** Retry trainers whose load failed (once every few seconds while in the town square). */
  private retryTrainers() {
    this.trainerRetry = null;
    const l = this.layout;
    if (!this.disposed && l?.mode === 'hub' && !this.pendingLayout) this.syncTrainers(l);
  }
  /** The rig for a main-plaza member: an instance of their partner nobody else is using (reused as people come and go). */
  private hubKey(o: HubPeer): string {
    const cur = this.hubRigs.get(o.id);
    if (cur && cur.split('#')[0] === o.partner) return cur;
    const used = new Set(this.hubRigs.values());
    let key = '';
    for (let i = 0; ; i++) { key = `${o.partner}#p${i}`; if (!used.has(key)) break; }
    this.hubRigs.set(o.id, key);
    return key;
  }
  /**
   * This player's partner plays a gesture: its own authored clip ('plazaEmote' tells the app to relay it). Nap and
   * Sit toggle; nothing else plays while it is lying down or sitting.
   */
  plazaEmote(e: PlazaEmote) {
    const l = this.layout;
    if (!walking(l)) return;
    const rig = this.rigs.get(l.mine), g = GESTURES[e];
    if (!rig || !g) return;
    if (rig.resting) {
      if (g === 'nap' || g === 'sit') { this.plaza.hold = rig.rise(); this.events.emit('plazaEmote', { emote: 'rise' }); }
      return;
    }
    // Gestures are done standing still: one stops a walk to a spot, and none plays while the keys walk.
    const p = this.plaza;
    if (p.keys.size) return;
    p.halt();
    if (l.mode === 'hub' && this.town) {
      // The partner may still be catching up with its trainer: it plays the gesture once it stands still.
      const f = this.follower('me');
      if (f.w.speed > 0.05) { this.peerGestures.push('me', g, performance.now() / 1000); return; }
    }
    rig.stride(0, 1);
    if (this.gestureKey(l.mine, g)) this.events.emit('plazaEmote', { emote: e });
  }
  /** Play a gesture on a rig; a happy one comes with the Pokémon's cry (at most once every few seconds each). */
  private gestureKey(key: string, g: Gesture): boolean {
    const rig = this.rigs.get(key);
    if (!rig?.gesture(g)) return false;
    if (g !== 'happy' || !rig.root.visible) return true;
    const now = performance.now();
    if (now - (this.lastCry.get(key) ?? -1e9) < 3500) return true;
    this.lastCry.set(key, now);
    this.events.emit('cry', { dex: rig.character.dex, pan: Math.max(-1, Math.min(1, rig.root.position.x / 3)), gain: 0.6, rate: 1 });
    return true;
  }
  /** The gestures this player's partner can play in the plaza (its model's own clips). */
  gestures(): Gesture[] {
    const l = this.layout;
    const rig = walking(l) ? this.rigs.get(l.mine) : undefined;
    return rig ? (['happy', 'stretch', 'sit', 'nap'] as const).filter(g => rig.canGesture(g)) : [];
  }
  /** 'sit' or 'nap' while this player's partner sits or sleeps after a gesture, else null. */
  resting(): 'sit' | 'nap' | null {
    const l = this.layout;
    const p = walking(l) ? this.rigs.get(l.mine)?.posture : null;
    return p === 'rest' ? 'sit' : p === 'sleep' ? 'nap' : null;
  }
  /** A dialogue with the plaza host opened or closed: walking waits while it is open and she gestures to the options. */
  hostDialog(open: boolean) {
    this.inputLocked = open;
    if (open) { this.plaza.keys.clear(); this.plaza.halt(); this.talkOnArrival = false; this.plazaHost.gesture('present'); }
    else this.plazaHost.talk(false);
  }
  /** The host talks (mouth and hand beats) while her line types. */
  hostTalk(on: boolean) { this.plazaHost.talk(on); }
  hostGesture(kind: 'present' | 'nod' | 'point') { this.plazaHost.gesture(kind); }
  /**
   * Presence from someone else: where their partner stands now, or a gesture it played. `id` is a main-plaza
   * member id (a room's rival needs none).
   */
  plazaPresence(m: ({ type: 'move' } & Spot) | { type: 'emote'; emote: PlazaEmote }, id = RIVAL) {
    if (m.type === 'move') { if (walking(this.layout)) this.plaza.hear(id, m); return; }
    // A gesture plays in step with the walk, which is drawn a fraction of a second behind the reports. Held poses
    // are kept even before the plaza is up (they arrive with the room), and applied when that partner is ready.
    const e = m.emote, delay = this.plaza.delayOf(id) * 1000;
    if (e === 'sit' || e === 'nap' || e === 'rise') { window.setTimeout(() => this.plazaPose(id, e === 'rise' ? null : e), delay); return; }
    const g = GESTURES[e];
    if (g && walking(this.layout)) window.setTimeout(() => this.peerGestures.push(id, g, performance.now() / 1000), delay);
  }
  /** Someone else's partner holds a pose (sit, nap) or none: it plays as soon as that partner is loaded and still. */
  plazaPose(id: string, pose: PlazaPose | null) {
    if (pose) this.peerPoses.set(id, pose); else this.peerPoses.delete(id);
  }
  /** Forget someone's pose and pending gesture: they left, or their partner is coming back standing. */
  plazaForget(id = RIVAL) { this.peerPoses.delete(id); this.peerGestures.drop(id); }
  /**
   * Another partner's gestures, every frame: a held pose it should be in, a queued gesture once it stands still,
   * and getting up when its trainer walks off (an older client that never sent `rise`) or the pose ended.
   */
  private peerAct(id: string, key: string, rig: MonRig, w: Walker) {
    let want = this.peerPoses.get(id) ?? null;
    if (want && w.speed > 0.15) { this.peerPoses.delete(id); want = null; }
    const has = rig.posture === 'rest' ? 'sit' : rig.posture === 'sleep' ? 'nap' : null;
    if (has && !want) { rig.rise(); return; }
    const still = w.speed < 0.05 && rig.posture !== null;
    if (want && want !== has) { if (still) rig.gesture(want); return; }
    const g = this.peerGestures.take(id, performance.now() / 1000, still && !rig.resting);
    if (g) this.gestureKey(key, g);
  }
  /** Walk this player's trainer up to someone in the town square (Find Players). */
  plazaApproach(id: string) { if (walking(this.layout)) { this.talkOnArrival = false; this.plaza.approach(id); } }
  /** Send this player's spot again on the next frame (someone just arrived or reconnected), and its held pose. */
  plazaResend() {
    this.plaza.resend();
    const pose = this.resting();
    if (pose) this.events.emit('plazaEmote', { emote: pose });
  }
  /**
   * Just above a partner's head on screen, in a plaza or a match: where name tags and chat bubbles go.
   * `who` is 'mine', 'theirs' (a room's rival) or a main-plaza member id.
   */
  /** Where a battling Pokemon is on screen, for the health bars that sit next to it (stage side 0 is the local player). */
  monAnchor(side: 0 | 1, out: MonAnchor): MonAnchor {
    out.on = false; out.attacking = this.battle.attacking;
    const l = this.layout;
    if (!l || l.mode !== 'arena' || this.envId !== 'stadium' || this.cut.fade > 0.3) return out;
    if (!this.battle.monBounds(side, this.anchorV, this.anchorFoot)) return out;
    const head = this.anchorV.project(this.camera), foot = this.anchorFoot.project(this.camera);
    if (head.z > 1 || foot.z > 1 || Math.abs(head.x) > 1.4) return out;
    const r = this.canvas.getBoundingClientRect();
    out.x = r.left + (head.x * 0.5 + 0.5) * r.width;
    out.top = r.top + (0.5 - head.y * 0.5) * r.height;
    out.bottom = r.top + (0.5 - foot.y * 0.5) * r.height;
    out.on = true;
    return out;
  }

  anchor(who: string, out: Anchor): Anchor {
    out.on = false;
    const l = this.layout;
    if (!l || this.cut.fade > 0.3) return out;
    if (who === 'host') {
      if (l.mode !== 'hub' || !this.plazaHost.ready) return out;
      const hv = this.plazaHost.head(this.anchorV);
      out.d = this.camera.position.distanceTo(hv);
      hv.project(this.camera);
      if (hv.z > 1 || Math.abs(hv.x) > 1.2 || hv.y < -1.1 || hv.y > 1.1) return out;
      const r = this.canvas.getBoundingClientRect();
      out.x = r.left + (hv.x * 0.5 + 0.5) * r.width; out.y = r.top + (0.5 - hv.y * 0.5) * r.height; out.on = true;
      return out;
    }
    let key: string | null | undefined = null;
    if (l.mode === 'hub') {
      // Name tags and bubbles ride the trainers in the town square.
      const w = who === 'mine' ? this.plaza.me : this.plaza.peers.get(who)?.w;
      if (!w || (who !== 'mine' && !this.plaza.peers.get(who)?.here && !this.trainers.has(who))) return out;
      out.d = this.camera.position.distanceTo(this.anchorV.set(w.x, FLOOR_Y + TRAINER_H, w.z));
      const v = this.anchorV.set(w.x, FLOOR_Y + TRAINER_H + 0.16, w.z).project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.3 || v.y < -1.1 || v.y > 2) return out;
      const r = this.canvas.getBoundingClientRect();
      out.x = r.left + (v.x * 0.5 + 0.5) * r.width; out.y = r.top + (0.5 - v.y * 0.5) * r.height; out.on = true;
      return out;
    }
    else if (l.mode === 'plaza' || l.mode === 'duo') key = who === 'mine' ? l.mine : who === 'theirs' ? this.theirsKey(l) : null;
    const rig = key ? this.rigs.get(key) : undefined;
    if (!rig?.root.visible || !rig.isShown) return out;
    out.d = this.camera.position.distanceTo(rig.root.position);
    const v = this.anchorV.set(rig.root.position.x, FLOOR_Y + rig.height * 1.06 + 0.12, rig.root.position.z).project(this.camera);
    // Heads just above the top edge still count (a big partner close to the camera): the UI clamps the tag into view.
    if (v.z > 1 || Math.abs(v.x) > 1.3 || v.y < -1.1 || v.y > 2) return out;
    const r = this.canvas.getBoundingClientRect();
    out.x = r.left + (v.x * 0.5 + 0.5) * r.width; out.y = r.top + (0.5 - v.y * 0.5) * r.height; out.on = true;
    return out;
  }
  private stepWalk(l: WalkLayout, dt: number) {
    if (l.mode === 'hub' && this.town) { this.stepTown(l, dt, this.town); return; }
    const p = this.plaza;
    p.keyYaw = 0;
    const mine = this.rigs.get(l.mine);
    p.me.size(mine?.height ?? 0.7, mine?.walkSpeed);
    const peers = this.peerKeys(l);
    for (const [id, key] of peers) { const rig = this.rigs.get(key); p.peer(id).size(rig?.height ?? 0.7, rig?.walkSpeed); p.setHere(id, !!rig?.isShown); }
    // Walking off from a nap or a rest: the partner gets up with its own clip first (the walk waits for it).
    if (mine?.resting && p.wantsToMove && p.hold <= 0) { p.hold = mine.rise(); this.events.emit('plazaEmote', { emote: 'rise' }); }
    const out = p.update(dt);
    if (out) this.events.emit('plazaMove', out);
    if (p.arrived) {
      const w = p.peers.get(p.arrived)?.w;
      p.arrived = null;
      if (w) { p.me.faceTo(w.x, w.z); this.plazaEmote('happy'); }
    }
    if (mine) { mine.place(p.me.x, p.me.z, p.me.face, true); mine.stride(p.me.speed, p.me.walk); }
    // A glow under this player's partner and the three nearest others.
    this.st.floor.setSlot(0, p.me.x, p.me.z, 0.55 * this.framing(l.mine), 1);
    const dist = (w: Walker) => Math.hypot(w.x - p.me.x, w.z - p.me.z);
    const near = peers.map(([id, key]) => ({ key, w: p.peer(id) })).sort((a, b) => dist(a.w) - dist(b.w));
    for (let i = 1; i < MAX_SLOTS; i++) {
      const n = near[i - 1];
      if (n) this.st.floor.setSlot(i, n.w.x, n.w.z, 0.55 * this.framing(n.key), 0.35); else this.st.floor.setSlot(i, 0, 0, 0, 0);
    }
    // Everyone else's partner goes where the network put it, and turns see-through while it stands
    // between the camera and this player's.
    const c = this.camera.position;
    const px = p.me.x - c.x, pz = p.me.z - c.z, pl = Math.max(1e-3, Math.hypot(px, pz));
    for (const [id, key] of peers) {
      const rig = this.rigs.get(key);
      if (!rig) continue;
      const w = p.peer(id);
      rig.place(w.x, w.z, w.face, true);
      this.peerAct(id, key, rig, w);
      rig.stride(w.speed, w.walk);
      const rx = w.x - c.x, rz = w.z - c.z;
      const along = (rx * px + rz * pz) / pl, off = Math.abs(rx * pz - rz * px) / pl;
      const blocks = !!mine && along > 0.3 && along < pl && off < w.radius + p.me.radius + rig.height * 0.35;
      let f = this.fades.get(key) ?? 1;
      f += ((blocks ? 0.28 : 1) - f) * (1 - Math.exp(-8 * dt));
      this.fades.set(key, f);
      rig.setFade(f > 0.995 ? 1 : f);
    }
    p.marker.material.color.copy(this.accent);
    // The key light's shadows follow this player's partner around the plaza.
    this.st.key.position.set(KEY_POS.x + p.me.x, KEY_POS.y, KEY_POS.z + p.me.z);
    this.st.key.target.position.set(p.me.x, 1, p.me.z);
    this.director.go(this.plazaShot());
  }

  /**
   * One frame in the town square. The keys (relative to the orbit camera) and clicks walk this player's trainer;
   * everyone else's trainer replays the network. Each partner follows its trainer with the same `Follower` on every
   * screen; held poses and gestures play on the partners once they stand still.
   */
  private stepTown(l: Extract<Layout, { mode: 'hub' }>, dt: number, town: TownEnvironment) {
    const p = this.plaza;
    p.keyYaw = this.orbit.yaw;
    const sizeTrainer = (w: Walker) => { w.walk = w.run = TRAINER_WALK; w.radius = TRAINER_R; w.turn = 9; };
    sizeTrainer(p.me);
    // The walk waits for the trainer's body to come round (a 180 is stepped, not spun on planted feet).
    const meTr = this.trainerOf('me');
    p.me.gate = meTr ? () => meTr.walkReady : null;
    const peers = this.peerKeys(l);
    for (const [id, key] of peers) { sizeTrainer(p.peer(id)); p.setHere(id, !!this.rigs.get(key)?.isShown || this.trainers.get(id) instanceof Object); }
    const mine = this.rigs.get(l.mine);
    // Walking off while the partner naps or sits: it gets up with its own clip and catches up.
    if (mine?.resting && p.wantsToMove) { mine.rise(); this.events.emit('plazaEmote', { emote: 'rise' }); }
    const out = p.update(dt);
    if (out) this.events.emit('plazaMove', out);
    if (p.arrived) {
      const w = p.peers.get(p.arrived)?.w;
      p.arrived = null;
      if (w) { p.me.faceTo(w.x, w.z); this.trainerOf('me')?.wave(); this.plazaEmote('happy'); }
    }
    const lead = (w: Walker) => ({ x: w.x, z: w.z, face: w.face, speed: w.speed, radius: w.radius });
    // This player's trainer and partner.
    const fm = this.follower('me');
    fm.w.size(mine?.height ?? 0.7, mine?.walkSpeed);
    fm.update(dt, lead(p.me), this.hubBounds, !!mine?.resting);
    if (mine) { mine.place(fm.w.x, fm.w.z, fm.w.face, true); mine.root.position.y = town.heightAt?.(fm.w.x, fm.w.z) ?? FLOOR_Y; mine.stride(fm.w.speed, fm.w.walk); }
    const me = this.trainerOf('me');
    if (me) { me.place(p.me.x, p.me.z, p.me.face); me.move(p.me.speed); }
    // A gesture asked for while the partner was still settling plays once it stands still.
    if (mine) { const g = this.peerGestures.take('me', performance.now() / 1000, fm.w.speed < 0.05 && !mine.resting); if (g && this.gestureKey(l.mine, g)) this.events.emit('plazaEmote', { emote: g }); }
    // The host at the Center's door.
    const h = this.plazaHost.update(dt, p.me, TRAINER_H);
    if (h.greeted) this.events.emit('sound', { cue: 'npcGreet', pan: 0, gain: 0.8 });
    if (h.near !== this.hostNear) { this.hostNear = h.near; this.events.emit('hostNear', { near: h.near }); }
    if (h.near && this.talkOnArrival && p.me.speed < 0.05) { this.talkOnArrival = false; this.events.emit('hostTalk'); }
    // Everyone else: trainer where the network put it, partner following it; both turn see-through while they
    // stand between the camera and this player's trainer.
    const c = this.camera.position;
    const px = p.me.x - c.x, pz = p.me.z - c.z, pl = Math.max(1e-3, Math.hypot(px, pz));
    const blockFade = (key: string, x: number, z: number, r: number, h: number) => {
      const rx = x - c.x, rz = z - c.z;
      const along = (rx * px + rz * pz) / pl, off = Math.abs(rx * pz - rz * px) / pl;
      const blocks = along > 0.3 && along < pl - 0.2 && off < r + p.me.radius + h * 0.3;
      let f = this.fades.get(key) ?? 1;
      f += ((blocks ? 0.28 : 1) - f) * (1 - Math.exp(-8 * dt));
      this.fades.set(key, f);
      return f > 0.995 ? 1 : f;
    };
    for (const [id, key] of peers) {
      const w = p.peer(id), rig = this.rigs.get(key), f = this.follower(id);
      f.w.size(rig?.height ?? 0.7, rig?.walkSpeed);
      f.update(dt, lead(w), this.hubBounds, !!rig?.resting);
      const tr = this.trainerOf(id);
      if (tr) { tr.place(w.x, w.z, w.face); tr.move(w.speed); tr.setFade(blockFade(`t:${id}`, w.x, w.z, w.radius, TRAINER_H)); }
      if (!rig) continue;
      rig.place(f.w.x, f.w.z, f.w.face, true);
      rig.root.position.y = town.heightAt?.(f.w.x, f.w.z) ?? FLOOR_Y;
      this.peerAct(id, key, rig, f.w);
      rig.stride(f.w.speed, f.w.walk);
      rig.setFade(blockFade(key, f.w.x, f.w.z, f.w.radius, rig.height));
    }
    for (const tr of this.trainers.values()) if (tr !== 'loading') tr.update(dt);
    p.marker.material.color.copy(this.accent);
    // The moon's shadows follow this player around the square.
    const key = town.key, off = this.keyOffset ??= key.position.clone().sub(key.target.position);
    key.target.position.set(p.me.x, FLOOR_Y, p.me.z); key.position.copy(key.target.position).add(off);
    this.director.go(this.plazaShot());
  }
  private keyOffset: THREE.Vector3 | null = null;
  private trainerOf(id: string): Trainer | null { const t = this.trainers.get(id); return t && t !== 'loading' ? t : null; }
  /** Plaza gaze: ahead while walking, at the nearest partner when close, otherwise the default (camera or pointer). */
  private walkGaze(all: [string, Walker][], key: string, rig: MonRig) {
    const w = all.find(([k]) => k === key)?.[1];
    if (!w) return;
    if (w.speed > 0.2) { this.lookPoint.set(w.x + Math.sin(w.face) * 3, FLOOR_Y + rig.height * 0.8, w.z + Math.cos(w.face) * 3); return; }
    let best: MonRig | null = null, at: Walker | null = null, bestGap = 1.6;
    for (const [k, o] of all) {
      if (o === w) continue;
      const r = this.rigs.get(k);
      if (!r?.root.visible) continue;
      const g = Math.hypot(o.x - w.x, o.z - w.z) - o.radius - w.radius;
      if (g < bestGap) { bestGap = g; best = r; at = o; }
    }
    if (best && at) this.lookPoint.set(at.x, FLOOR_Y + best.height * 0.75, at.z);
  }

  hover(id: CharacterId | null) {
    for (const [key, rig] of this.rigs) rig.hovered = key === id;
  }

  flipCoin(result: CoinSide): Promise<void> {
    this.events.emit('sound', { cue: 'coinFlip', pan: 0 });
    this.st.coin.visibleTarget = 1;
    return this.st.coin.flip(result, performance.now() / 1000);
  }
  showCoinFace(result: CoinSide | null) { this.st.coin.showFace(result); }
  pulse() { if (this.envId === 'stadium') this.st.floor.pulse(); }

  // ---------------------------------------------------------------- input
  private onPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.director.pointer.copy(this.ndc);
    this.pointerIdle = 0;
    const d = this.orbit.drag;
    if (d && d.id === e.pointerId) {
      // Town square: dragging turns the camera around the trainer (left drag on the ground, or right drag).
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
      if (d.moved) {
        this.orbit.yaw = wrapAngle(this.orbit.yaw - dx * 0.0065);
        this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.0042, 0.08, 1.15);
        d.x = e.clientX; d.y = e.clientY;
      }
      return;
    }
    this.pickHover(e.target === this.canvas);
    if (this.steering) this.steerTo(false);
  }
  private onDown(e: PointerEvent) {
    if (!walking(this.layout) || this.inputLocked) return;
    if (this.layout?.mode === 'hub' && this.town) {
      // A press may become a camera drag; a click without moving walks there (see onUp).
      if (e.button !== 0 && e.button !== 2) return;
      this.onPointer(e);
      this.orbit.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    this.onPointer(e);
    this.steering = true;
    this.steerTo(true);
  }
  private onUp(e: PointerEvent) {
    this.steering = false;
    const d = this.orbit.drag;
    if (!d || d.id !== e.pointerId) return;
    this.orbit.drag = null;
    if (!d.moved && d.button === 0 && walking(this.layout) && !this.inputLocked) { this.onPointer(e); this.steerTo(true); this.steering = false; }
  }
  /** Town square: the wheel zooms the follow camera in and out. */
  private onWheel(e: WheelEvent) {
    if (this.layout?.mode !== 'hub' || !this.town) return;
    e.preventDefault();
    this.orbit.zoom = THREE.MathUtils.clamp(this.orbit.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 1.9);
  }
  /** Turn the town camera to look the way this player's trainer faces (after entering, or on request). */
  resetCamera() { this.orbit.yaw = wrapAngle(this.plaza.me.face + Math.PI); this.orbit.pitch = 0.42; this.orbit.zoom = 1; }
  /** Plazas: walk to the floor point under the pointer, or up to someone's partner when it was pressed. */
  private steerTo(press: boolean) {
    const l = this.layout;
    if (!walking(l)) return;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (press) {
      // The host: talk now when close, otherwise walk up to her and talk on arrival.
      if (l.mode === 'hub' && this.plazaHost.hit(this.raycaster)) {
        this.steering = false;
        if (this.hostNear) this.events.emit('hostTalk');
        else { const f = hostFront(this.plazaHost.spot); this.talkOnArrival = true; this.plaza.walkTo(f.x, f.z); }
        return;
      }
      const peers = this.peerKeys(l).filter(([, k]) => this.rigs.get(k)?.root.visible && this.hitboxes.has(k));
      const hit = this.raycaster.intersectObjects(peers.map(([, k]) => this.hitboxes.get(k)!), false)[0];
      const id = hit ? peers.find(([, k]) => this.hitboxes.get(k) === hit.object)?.[0] : undefined;
      if (id) { this.steering = false; this.plaza.approach(id); return; }
    }
    if (this.raycaster.ray.intersectPlane(this.floorPlane, this.floorHit)) { this.talkOnArrival = false; this.plaza.walkTo(this.floorHit.x, this.floorHit.z); }
  }
  /** Plaza: WASD or the arrow keys walk (plazas are for walking: there is no run). Keys typed into a field never move the partner. */
  private onKey(e: KeyboardEvent, down: boolean) {
    if (!walking(this.layout)) return;
    const t = e.target as Element | null;
    const typing = e.ctrlKey || e.metaKey || e.altKey || !!t?.closest?.('input, textarea, select, [contenteditable="true"]');
    // E talks to the host when standing near her.
    if (down && e.code === 'KeyE' && !e.repeat && !typing && !this.inputLocked && this.hostNear) { this.events.emit('hostTalk'); return; }
    if (!isMoveKey(e.code)) return;
    if (!down) { this.plaza.keys.delete(e.code); return; }
    if (typing || this.inputLocked) return;
    this.plaza.keys.add(e.code);
    this.talkOnArrival = false;
    if (e.code.startsWith('Arrow')) e.preventDefault();
  }
  private pickHover(overCanvas: boolean) {
    let key: string | null = null;
    if (overCanvas) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const boxes = [...this.hitboxes.entries()].filter(([k]) => this.rigs.get(k)?.root.visible).map(([, m]) => m);
      const hit = this.raycaster.intersectObjects(boxes, false)[0];
      key = (hit?.object.userData.key as string | undefined) ?? null;
    }
    const overHost = overCanvas && !key && this.layout?.mode === 'hub' && this.plazaHost.hit(this.raycaster);
    if (overHost !== this.hostHover) { this.hostHover = overHost; if (!key) this.canvas.style.cursor = overHost ? 'pointer' : ''; }
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      const l = this.layout;
      this.canvas.style.cursor = key && (l?.mode === 'select' || (walking(l) && key !== l.mine)) ? 'pointer' : '';
      this.events.emit('characterHover', { id: (key?.split('#')[0] as CharacterId) ?? null });
    }
  }
  private onClick() { if (this.hoverKey) this.events.emit('characterClick', { id: this.hoverKey.split('#')[0] as CharacterId }); }

  // ---------------------------------------------------------------- loop
  start() {
    if (this.running || this.disposed || document.hidden) return;
    this.running = true; this.last = performance.now();
    this.renderer.setAnimationLoop((now: number) => this.frame(now));
  }
  stop() { this.running = false; this.renderer.setAnimationLoop(null); }

  private frame(now: number) {
    const frameMs = now - this.last; this.last = now;
    const dt = Math.min(frameMs / 1000, 1 / 20);
    this.clock += dt;
    const t = this.clock;

    // Transitions run on wall-clock time (capped), so slow frames never stretch a fade or the coin.
    this.grade.uniforms.uFade.value = this.cut.step(Math.min(frameMs / 1000, 0.25));
    this.accent.lerp(this.accentTarget, 1 - Math.exp(-3 * dt));
    this.st.setAccent(this.accent);
    if (this.envId === 'intro') this.stepIntro(dt);
    // Pokémon rim light: the stadium's cool white, warmed by the partner's colour.
    MON_RIM.color.value.copy(this.rimWhite).lerp(this.accent, 0.35);

    // Gaze: the pointer ray meets a plane just in front of the stage; idle pointers hand gaze back to the camera.
    this.pointerIdle += dt;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.gazeValid = this.raycaster.ray.intersectPlane(this.gazePlane, this.gaze) !== null;
    const toCamera = this.pointerIdle > 3.5;
    const lay = this.layout;
    const walk = walking(lay) && !this.pendingLayout ? lay : null;
    if (walk) this.stepWalk(walk, dt);
    const walkers = walk ? this.walkers(walk) : null;
    for (const [key, rig] of this.rigs) {
      if (!rig.root.visible) continue;
      if (toCamera || !this.gazeValid) this.lookPoint.copy(this.camera.position);
      else this.lookPoint.copy(this.gaze);
      if (this.layout?.mode === 'arena') {
        // Partners stare each other down across the field.
        for (const [k, r] of this.rigs) if (k !== key && r.root.visible) { this.lookPoint.set(r.root.position.x, 1.45, r.root.position.z); break; }
      } else if (this.layout?.mode === 'duo' && this.pointerIdle > 1.5) {
        // Partners glance at each other now and then during a match.
        if (Math.sin(t * 0.21 + key.length) > 0.55) {
          for (const [k, r] of this.rigs) if (k !== key && r.root.visible) { this.lookPoint.set(r.root.position.x, 1.45, r.root.position.z); break; }
        }
      } else if (walkers) this.walkGaze(walkers, key, rig);
      rig.lookAt(this.lookPoint);
      rig.update(dt);
    }
    const arena = this.layout?.mode === 'arena' && this.envId === 'stadium';
    if (arena) {
      this.battle.update(dt);
      // The battle camera steers the director once the cut into the arena has finished.
      const c = this.battle.cam.update(dt);
      if (!this.pendingLayout && !this.reducedMotion) { if (c.cut) this.director.cut(c.shot); else this.director.go(c.shot); }
      if (this.battle.shake > 0) { this.director.kick(this.battle.shake); this.battle.shake = 0; }
      if (this.battle.fovPunch > 0) { this.director.punch(this.battle.fovPunch); this.battle.fovPunch = 0; }
    }
    // Impact blur is a camera jolt (off with reduced motion or the steady camera) and post-processing (scaled by effects).
    this.grade.uniforms.uPunch.value = arena && !this.reducedMotion && !this.steady ? this.battle.screenPunch * this.fx.post : 0;
    this.grade.uniforms.uFlashAmt.value = arena ? this.battle.screenFlash.amt : 0;
    this.grade.uniforms.uFlashColor.value.copy(this.battle.screenFlash.color);
    this.director.update(dt);
    // Only the environment on screen is simulated and drawn.
    const env = this.envObj(this.envId);
    if (env) env.update(t, dt);
    this.grade.uniforms.uTime.value = t;

    this.renderer.info.reset();
    if (env) this.composer.render(dt);
    else { this.renderer.setRenderTarget(null); this.renderer.setClearColor(0x000000, 1); this.renderer.clear(); }
    // CPU cost of this frame (simulation + draw submission), smoothed. GPU time is not observable here.
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - now) * 0.1;
    if (this.adaptive.push(frameMs, dt)) { this.resize(); this.events.emit('quality', { tier: this.tier, scale: this.pixelScale() }); }
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const q = TIERS[this.tier];
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * this.pixelScale();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(dpr);
    this.composer?.setSize(w, h);
    for (const cam of [this.st.camera, this.town?.camera, this.intro?.camera]) if (cam) this.fitCamera(cam);
    this.st.coin.setPixelScale(h * dpr / 900);
    this.st.atmosphere?.setPixelScale(h * dpr / 900);
    this.battle?.setPixelScale(h * dpr / 900);
  }
  /** Aspect and lens of an environment camera for the canvas size (portrait screens widen the lens). */
  private fitCamera(cam: THREE.PerspectiveCamera) {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    cam.aspect = w / h;
    cam.filmGauge = 35;
    cam.zoom = w / h < 1 ? Math.max(0.55, w / h * 1.15) : 1;
    cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- intro
  /**
   * The intro plays once its scene is built and the partner is loaded (or after 8 s with whatever is ready):
   * the camera follows the intro's track, the partner is sent out at the reveal beat with a burst and its cry,
   * and `introEnd` tells the app to move on (it may also skip at any time).
   */
  private stepIntro(dt: number) {
    const l = this.layout, env = this.intro;
    if (l?.mode !== 'intro' || !env || this.pendingLayout) return;
    const rig = this.rigs.get(l.partner);
    if (this.introClock < 0) {
      this.introWait += dt;
      if (!rig && this.introWait < 8) return;
      this.introClock = 0; this.introBeat = 0;
      if (rig) env.setPartnerHeight(rig.height);
      this.events.emit('introBeat', { kind: 'start' });
      this.events.emit('sound', { cue: 'introSwell', pan: 0, gain: 0.8 });
    } else this.introClock += dt;
    env.shotAt(Math.min(this.introClock, env.duration), this.introShot);
    this.director.cut({ pos: this.introShot.pos, target: this.introShot.target, fov: this.introShot.fov, time: 0 });
    while (this.introBeat < env.beats.length && env.beats[this.introBeat].t <= this.introClock) {
      const b = env.beats[this.introBeat++];
      if (b.kind === 'reveal') {
        this.introRevealed = true;
        this.applyLayout(l, false);
        env.burst();
        this.events.emit('sound', { cue: 'switchIn', pan: 0, gain: 0.9 });
        if (rig) { rig.play('excited'); this.events.emit('cry', { dex: rig.character.dex, pan: 0, gain: 0.7, rate: 1 }); }
      }
      this.events.emit('introBeat', { kind: b.kind });
      if (b.kind === 'end') this.events.emit('introEnd');
    }
  }

  /** Live numbers for the diagnostics overlay and the settings readout. */
  stats() {
    const info = this.renderer.info;
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      ...this.adaptive.stats(), cpuMs: this.cpuMs, tier: this.tier, pref: this.pref, scale: this.pixelScale(),
      dpr: this.renderer.getPixelRatio(), width: buffer.x, height: buffer.y, effects: this.effects,
      calls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
      characters: [...this.rigs.values()].filter(r => r.root.visible).length,
    };
  }

  dispose() {
    this.disposed = true; this.stop();
    this.ro.disconnect();
    this.removeListeners.forEach(f => f());
    for (const r of this.rigs.values()) r.dispose();
    this.rigs.clear();
    for (const tr of this.trainers.values()) if (tr !== 'loading') tr.dispose();
    this.trainers.clear();
    this.st.dispose(); this.town?.dispose(); this.intro?.dispose();
    for (const rt of this.envRTs.values()) rt.dispose();
    this.envRTs.clear();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.events.clear();
  }
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A trainer's look: outfit and accent from their partner's colour, a stable variation from their id, so the same
 * person looks the same on every screen.
 */

