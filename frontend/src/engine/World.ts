import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { CharacterId, CoinSide, PlazaEmote, Spot } from '@shared';
import { DEFAULT_CHARACTER, characterById, type Emote } from '../characters/roster.js';
import { CameraDirector, type Shot } from './CameraDirector.js';
import { FLOOR_Y, MonRig, type Gesture } from './character/MonRig.js';
import { MON_RIM, hasModel, loadMonModel } from './character/monModel.js';
import { monSize } from './character/size.js';
import { Emitter, type WorldEvents } from './events.js';
import { AdaptiveQuality, EFFECTS, TIERS, initialTier, stepTier, type EffectsLevel, type QualityPref, type QualityTier, type RenderScale } from './quality.js';
import { GradeShader } from './post/GradeShader.js';
import { createSky } from './world/Sky.js';
import { StageFloor, MAX_SLOTS } from './world/Floor.js';
import { Stadium } from './world/Stadium.js';
import { Atmosphere } from './world/Atmosphere.js';
import { Coin } from './world/Coin.js';
import { Plaza, PLAZA_SPAWN, RIVAL, isMoveKey, platform, withObstacles, type Walker } from './world/Plaza.js';
import { HOST_FRONT, HOST_OBSTACLE, HOST_SPOT, PlazaHost } from './world/PlazaHost.js';
import { FIELD, WALL_R } from './world/dims.js';
import { BattleStage } from './battle/BattleStage.js';

const FOG_COLOR = new THREE.Color('#060a18');
const FOG_DENSITY = 0.0105;
const BLOOM_STRENGTH = 0.55;
/** The floodlight key: high in front of the field (in the plazas it follows this player's partner). */
const KEY_POS = new THREE.Vector3(2.4, 7.5, 5.5);
/** Partner Pokémon height on the platform (every model is normalised to it). */

export type DuoShot = 'room' | 'match' | 'draft' | 'battle';
export type Layout =
  | { mode: 'title'; featured: CharacterId }
  | { mode: 'select'; focus: CharacterId | null }
  | { mode: 'duo'; mine: CharacterId | null; theirs: CharacterId | null; shot: DuoShot; coin: boolean }
  | { mode: 'victory'; winner: CharacterId; loser: CharacterId | null }
  /** In-app battle: the partners leave the field to the battling Pokémon. */
  | { mode: 'arena'; mine: CharacterId; theirs: CharacterId }
  /** The plaza: the waiting room as a place. This player walks their partner around; the rival's follows the network. */
  | { mode: 'plaza'; mine: CharacterId; theirs: CharacterId | null; seat: 0 | 1 }
  /** The main plaza: everyone in it walks their partner. This player's follows the keys from `spawn`; the others the network. */
  | { mode: 'hub'; mine: CharacterId; spawn: Spot; others: HubPeer[] };
/** Someone else in the main plaza: their member id, their partner, and where it stood when they came in. */
export type HubPeer = { id: string; partner: CharacterId; at: Spot };
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
 * The single owner of WebGL. One renderer, one scene, one animation loop for the whole app; React only
 * calls imperative methods. Rendering pauses when the tab is hidden and adapts resolution and features
 * to measured frame times.
 */
export class World {
  readonly events = new Emitter<WorldEvents>();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 900);
  private director: CameraDirector;
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private grade!: ShaderPass;
  private tier: QualityTier;
  private pref: QualityPref;
  private adaptive: AdaptiveQuality;
  private floor!: StageFloor;
  private hemi!: THREE.HemisphereLight;
  private atmosphere!: Atmosphere;
  private stadium: Stadium;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private coin: Coin;
  readonly battle: BattleStage;
  private key: THREE.DirectionalLight;
  private rimA: THREE.DirectionalLight;
  private rimB: THREE.DirectionalLight;
  private accent = new THREE.Color('#3ee6ff');
  private accentTarget = new THREE.Color('#3ee6ff');
  private rigs = new Map<string, MonRig>();
  private loading = new Map<string, Promise<MonRig | null>>();
  private lastCry = new Map<string, number>();
  private prepared = new Set<number>();
  private prewarmed = false;
  private rimWhite = new THREE.Color('#dfe8ff');
  private hitboxes = new Map<string, THREE.Mesh>();
  private layout: Layout | null = null;
  /** What the stage is showing (title, select, duo, victory, arena, plaza, hub), or null before the first layout. */
  get stage(): Layout['mode'] | null { return this.layout?.mode ?? null; }
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
  /** A press on the stage is held: the plaza partner follows the pointer. */
  private steering = false;
  /** Someone else's partner fades while it blocks the view of this player's (by rig key). */
  private fades = new Map<string, number>();
  /** Main plaza: the rig each member's partner uses (member id to rig key). */
  private hubRigs = new Map<string, string>();
  /**
   * The plaza host (main plaza only): whether this player's partner is close enough to talk, a walk up to her
   * that ends in a conversation, walking input held while a dialogue is open, and the pointer over her.
   */
  readonly plazaHost = new PlazaHost();
  private hostNear = false;
  private talkOnArrival = false;
  private inputLocked = false;
  private hostHover = false;
  private hubBounds = withObstacles(platform, [HOST_OBSTACLE]);
  private pendingLayout: Layout | null = null;
  private fade = 0;
  private fadeDir: -1 | 0 | 1 = 0;
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
  private envRT: THREE.WebGLRenderTarget | null = null;
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
    this.director = new CameraDirector(this.camera);
    this.director.reducedMotion = this.reducedMotion;
    this.director.steady = this.steady;

    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.sky = createSky();
    this.scene.add(this.sky);
    this.stadium = new Stadium({ fogColor: FOG_COLOR, fogDensity: FOG_DENSITY });
    this.scene.add(this.stadium.group);
    this.coin = new Coin(() => this.reducedMotion);
    this.coin.group.position.set(0, 1.08, 0.75);
    this.coin.onLand = () => { this.floor.pulse(); this.events.emit('sound', { cue: 'coinLand', pan: 0 }); };
    this.scene.add(this.coin.group);
    this.battle = new BattleStage(this.camera, () => this.reducedMotion);
    this.syncBattleCamera();
    this.battle.onImpact = color => this.floor.pulse(color);
    this.battle.onSound = (cue, pan, gain) => this.events.emit('sound', { cue, pan, gain });
    this.scene.add(this.battle.group);

    // Lighting: the floodlights as one cool key with shadows from high in front, a sky fill, and two rims
    // (the partner's accent and a stadium blue) that cut the Pokémon out of the night.
    this.hemi = new THREE.HemisphereLight('#a9bcff', '#0b0e1a', 0.75);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#f1f5ff', 2.4);
    this.key.position.copy(KEY_POS); this.key.target.position.set(0, 1, 0);
    const sc = this.key.shadow.camera;
    sc.left = -3.2 * FIELD; sc.right = 3.2 * FIELD; sc.top = 3.2 * FIELD; sc.bottom = -1.5 * FIELD;
    this.key.shadow.camera.near = 2; this.key.shadow.camera.far = 16; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.025;
    this.scene.add(this.key, this.key.target);
    this.rimA = new THREE.DirectionalLight('#3ee6ff', 1.8); this.rimA.position.set(-4, 3, -4);
    this.rimB = new THREE.DirectionalLight('#6f8cff', 1.4); this.rimB.position.set(4, 2.5, -3.5);
    this.scene.add(this.rimA, this.rimB);
    this.scene.add(this.plaza.marker);
    this.scene.add(this.plazaHost.group);

    this.buildTierDependent();
    this.buildEnvironmentMap();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.listen(window, 'pointermove', e => this.onPointer(e as PointerEvent));
    this.listen(canvas, 'click', () => this.onClick());
    this.listen(canvas, 'pointerdown', e => this.onDown(e as PointerEvent));
    this.listen(window, 'pointerup', () => { this.steering = false; });
    this.listen(window, 'pointercancel', () => { this.steering = false; });
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
    // Floor (planar reflection is the most expensive feature, high tier only).
    this.floor?.dispose(); if (this.floor) this.scene.remove(this.floor.group);
    this.floor = new StageFloor(q.reflections, 1024);
    this.floor.uniforms.uAccent.value.copy(this.accent);
    this.scene.add(this.floor.group);
    if (this.atmosphere) { this.scene.remove(this.atmosphere.group); disposeTree(this.atmosphere.group); }
    this.atmosphere = new Atmosphere(q.shafts, this.stadium.lamps);
    this.atmosphere.reduced = this.reducedMotion;
    this.atmosphere.setAccent(this.accent);
    this.scene.add(this.atmosphere.group);

    this.renderer.shadowMap.enabled = q.shadows;
    this.key.castShadow = q.shadows;
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
    this.key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => (x.needsUpdate = true)); });

    // Post chain: render → (bloom) → tone map + sRGB → display-space grade.
    // EffectComposer.dispose() frees only its own targets; passes (bloom mips, materials) must be freed too.
    if (this.composer) { for (const pass of this.composer.passes) pass.dispose(); this.composer.dispose(); }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
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
    this.stadium.reduced = this.reducedMotion || this.calm;
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
    this.atmosphere.reduced = v;
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
    this.envRT?.dispose(); this.envRT = null;
    this.buildEnvironmentMap();
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
    this.resize();
  }

  private buildEnvironmentMap() {
    // Reflections for the Pokémon, the coin and the platform rim: the night sky plus four floodlight
    // panels high around the field and a stadium-blue glow behind it, prefiltered once.
    const envScene = new THREE.Scene();
    envScene.add(createSky());
    const panel = (c: string, x: number, y: number, z: number, s: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.45), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(5), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); envScene.add(m); };
    for (const l of this.stadium.lamps) panel('#eef3ff', l.x * 0.45, l.y * 0.5, l.z * 0.45, 4);
    panel('#3a5cff', 0, 2, -9, 6);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose(); disposeTree(envScene);
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
    const compiled = model.then(m => (m ? this.renderer.compileAsync(m.root, this.camera, this.scene).then(() => m, () => m) : m));
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
      if (this.layout && !this.pendingLayout) this.applyLayout(this.layout, false);
      return rig;
    });
    this.loading.set(key, p);
    return p;
  }

  isLoaded(id: CharacterId) { return this.rigs.has(id); }

  /**
   * Get battling Pokémon ready before they are sent out: download each model and compile its shaders
   * against this scene now, so a switch-in never waits on the network or stalls a frame compiling.
   */
  prepareMons(dexes: number[]) {
    for (const dex of dexes) {
      if (this.prepared.has(dex) || !hasModel(dex)) continue;
      this.prepared.add(dex);
      void loadMonModel(dex, monSize(dex)).then(m => this.renderer.compileAsync(m.root, this.camera, this.scene).finally(() => { for (const mat of m.materials) mat.dispose(); })).catch(() => this.prepared.delete(dex));
    }
  }

  // ---------------------------------------------------------------- layout & camera
  setLayout(layout: Layout) {
    const changed = JSON.stringify(layout) !== JSON.stringify(this.layout);
    if (!changed) return;
    const modeChanged = layout.mode !== this.layout?.mode;
    const first = this.layout === null;
    this.layout = layout;
    // Screen changes get a cinematic cut: dip to black, re-stage while dark, push in on the new shot.
    if (modeChanged && !first && !this.reducedMotion) { this.pendingLayout = layout; this.fadeDir = 1; return; }
    this.applyLayout(layout, modeChanged);
    if (first) this.director.cut(this.shotFor(layout));
  }

  private stepFade(dt: number) {
    if (this.fadeDir === 0) return;
    this.fade = THREE.MathUtils.clamp(this.fade + this.fadeDir * dt / (this.fadeDir > 0 ? 0.2 : 0.55), 0, 1);
    if (this.fade >= 1 && this.pendingLayout) {
      const l = this.pendingLayout; this.pendingLayout = null;
      this.applyLayout(l, true);
      const shot = this.shotFor(l);
      // The cinematic camera pushes in on the new shot; the steady one simply lands on it.
      this.director.cut(this.steady ? shot : { ...shot, pos: [shot.pos[0], shot.pos[1] + 0.12, shot.pos[2] + 0.7] });
      this.director.go(shot);
      this.fadeDir = -1;
    } else if (this.fade <= 0 && this.fadeDir < 0) this.fadeDir = 0;
    this.grade.uniforms.uFade.value = this.fade * this.fade * (3 - 2 * this.fade);
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
      case 'title': return this.around(0.95, 0.15, [-1.4, 1.3, 4.25], [-0.35, 0.78, -0.15], this.framing(l.featured), 30, 1.4);
      case 'select': {
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
      let dx = HOST_SPOT.x - w.x, dz = HOST_SPOT.z - w.z;
      const d = Math.max(0.01, Math.hypot(dx, dz)); dx /= d; dz /= d;
      const mx = (w.x + HOST_SPOT.x) / 2, mz = (w.z + HOST_SPOT.z) / 2, back = 0.9 + d * 0.3, out = 2.3 + d * 0.6;
      return { pos: [mx + dz * out - dx * back, FLOOR_Y + 1.45, mz - dx * out - dz * back], target: [mx, FLOOR_Y + 0.32, mz], fov: 38, time: 0.9 };
    }
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

  private selectSlots(focus: CharacterId | null): Slot[] {
    // Partner select: just the chosen Pokémon, centre stage.
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
    if (l.mode === 'title') { slots = [{ key: l.featured, x: 0.95, z: 0.15, facing: -0.32, focus: true }]; accent = l.featured; }
    if (l.mode === 'select') { slots = this.selectSlots(l.focus); accent = l.focus; }
    if (walking(l)) {
      const p = this.plaza;
      if (l.mode === 'plaza' && (modeChanged || this.plazaSeat !== l.seat)) { this.plazaSeat = l.seat; p.enter(PLAZA_SPAWN[l.seat]); p.peer(RIVAL, PLAZA_SPAWN[1 - l.seat]); }
      if (l.mode === 'hub') {
        if (modeChanged) { p.enter(l.spawn); this.hubRigs.clear(); }
        // Whoever left is forgotten; newcomers appear where they stood when they came in.
        const here = new Set(l.others.map(o => o.id));
        for (const id of [...p.peers.keys()]) if (!here.has(id)) { p.drop(id); this.hubRigs.delete(id); }
        for (const o of l.others) p.peer(o.id, o.at);
      }
      slots.push({ key: l.mine, x: p.me.x, z: p.me.z, facing: p.me.face, focus: false });
      for (const [id, key] of this.peerKeys(l)) { const w = p.peer(id); slots.push({ key, x: w.x, z: w.z, facing: w.face, focus: false }); }
      accent = l.mine;
    } else {
      for (const rig of this.rigs.values()) { rig.stride(0, 1); rig.setFade(1); }
      this.fades.clear();
      this.plaza.keys.clear(); this.steering = false; this.plaza.marker.visible = false;
      this.key.position.copy(KEY_POS); this.key.target.position.set(0, 1, 0);
    }
    this.canvas.style.touchAction = walking(l) ? 'none' : '';
    if (l.mode === 'duo') {
      if (l.mine) slots.push({ key: l.mine, x: -1.05, z: 0, facing: 0.42, focus: false });
      if (l.theirs) slots.push({ key: l.theirs === l.mine ? `${l.theirs}#2` : l.theirs, x: 1.05, z: 0, facing: -0.42, focus: false });
      accent = l.mine;
      this.coin.visibleTarget = l.coin ? 1 : 0;
    } else this.coin.visibleTarget = 0;
    this.adaptive.hold = l.mode === 'arena';
    if (l.mode === 'arena') {
      // The partners leave the field to the battling Pokémon.
      accent = l.mine;
      if (!this.prewarmed) { this.prewarmed = true; void this.battle.prewarm(this.renderer, this.scene).catch(() => { this.prewarmed = false; }); }
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
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      if (s) this.floor.setSlot(i, s.x, s.z, 0.55 * this.framing(s.key), s.focus ? 1 : 0.35); else this.floor.setSlot(i, 0, 0, 0, 0);
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
  /** Every partner on the field, this player's first, as [rig key, walker]. */
  private walkers(l: WalkLayout): [string, Walker][] {
    return [[l.mine, this.plaza.me], ...this.peerKeys(l).map(([id, key]) => [key, this.plaza.peer(id)] as [string, Walker])];
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
    p.halt(); rig.stride(0, 1);
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
    const l = this.layout;
    if (!walking(l)) return;
    if (m.type === 'move') { this.plaza.hear(id, m); return; }
    // A gesture plays in step with the walk, which is drawn a fraction of a second behind the reports.
    const g = m.emote === 'rise' ? 'rise' : GESTURES[m.emote];
    if (g) window.setTimeout(() => this.peerGesture(id, g), this.plaza.delayOf(id) * 1000);
  }
  private peerGesture(id: string, g: Gesture | 'rise') {
    const l = this.layout;
    if (!walking(l)) return;
    const key = this.peerKeys(l).find(([pid]) => pid === id)?.[1];
    const rig = key ? this.rigs.get(key) : undefined;
    if (!key || !rig) return;
    if (g === 'rise') { rig.rise(); return; }
    // Gestures are for standing still: one that arrives while that partner walks (an older client) is skipped.
    if (rig.resting || (this.plaza.peers.get(id)?.w.speed ?? 0) > 0.25) return;
    this.gestureKey(key, g);
  }
  /** Send this player's spot again on the next frame (someone just arrived or reconnected). */
  plazaResend() { this.plaza.resend(); }
  /**
   * Just above a partner's head on screen, in a plaza or a match: where name tags and chat bubbles go.
   * `who` is 'mine', 'theirs' (a room's rival) or a main-plaza member id.
   */
  anchor(who: string, out: Anchor): Anchor {
    out.on = false;
    const l = this.layout;
    if (!l || this.fade > 0.3) return out;
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
    if (l.mode === 'hub') key = who === 'mine' ? l.mine : this.hubRigs.get(who);
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
    const p = this.plaza;
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
    if (l.mode === 'hub') {
      const h = this.plazaHost.update(dt, p.me, mine?.height ?? 0.7);
      if (h.greeted) this.events.emit('sound', { cue: 'npcGreet', pan: 0, gain: 0.8 });
      if (h.near !== this.hostNear) { this.hostNear = h.near; this.events.emit('hostNear', { near: h.near }); }
      if (h.near && this.talkOnArrival && p.me.speed < 0.05) { this.talkOnArrival = false; this.events.emit('hostTalk'); }
    }
    // A glow under this player's partner and the three nearest others.
    this.floor.setSlot(0, p.me.x, p.me.z, 0.55 * this.framing(l.mine), 1);
    const dist = (w: Walker) => Math.hypot(w.x - p.me.x, w.z - p.me.z);
    const near = peers.map(([id, key]) => ({ key, w: p.peer(id) })).sort((a, b) => dist(a.w) - dist(b.w));
    for (let i = 1; i < MAX_SLOTS; i++) {
      const n = near[i - 1];
      if (n) this.floor.setSlot(i, n.w.x, n.w.z, 0.55 * this.framing(n.key), 0.35); else this.floor.setSlot(i, 0, 0, 0, 0);
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
      if (rig.resting && w.speed > 0.15) rig.rise();
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
    this.key.position.set(KEY_POS.x + p.me.x, KEY_POS.y, KEY_POS.z + p.me.z);
    this.key.target.position.set(p.me.x, 1, p.me.z);
    this.director.go(this.plazaShot());
  }
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
    this.coin.visibleTarget = 1;
    return this.coin.flip(result, performance.now() / 1000);
  }
  showCoinFace(result: CoinSide | null) { this.coin.showFace(result); }
  pulse() { this.floor.pulse(); }

  // ---------------------------------------------------------------- input
  private onPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.director.pointer.copy(this.ndc);
    this.pointerIdle = 0;
    this.pickHover(e.target === this.canvas);
    if (this.steering) this.steerTo(false);
  }
  private onDown(e: PointerEvent) {
    if (!walking(this.layout) || e.button !== 0 || this.inputLocked) return;
    this.onPointer(e);
    this.steering = true;
    this.steerTo(true);
  }
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
        else { this.talkOnArrival = true; this.plaza.walkTo(HOST_FRONT.x, HOST_FRONT.z); }
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
    this.stepFade(Math.min(frameMs / 1000, 0.25));
    this.accent.lerp(this.accentTarget, 1 - Math.exp(-3 * dt));
    this.floor.uniforms.uAccent.value.copy(this.accent);
    this.atmosphere.setAccent(this.accent);
    this.stadium.setAccent(this.accent);
    this.rimA.color.copy(this.accent);
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
    const arena = this.layout?.mode === 'arena';
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
    this.floor.update(t, dt);
    this.stadium.update(t);
    this.atmosphere.update(t, dt);
    this.coin.update(dt);
    this.sky.material.uniforms.uTime.value = t;
    this.grade.uniforms.uTime.value = t;

    this.renderer.info.reset();
    this.composer.render(dt);
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
    this.camera.aspect = w / h;
    // Portrait screens: widen the lens so both partners stay in frame.
    this.camera.filmGauge = 35;
    this.camera.zoom = w / h < 1 ? Math.max(0.55, w / h * 1.15) : 1;
    this.camera.updateProjectionMatrix();
    this.coin.setPixelScale(h * dpr / 900);
    this.atmosphere?.setPixelScale(h * dpr / 900);
    this.battle?.setPixelScale(h * dpr / 900);
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
    this.floor.dispose(); this.stadium.dispose(); this.battle.dispose();
    disposeTree(this.scene);
    this.envRT?.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.events.clear();
  }
}

/** Dispose every geometry, material and texture under a root. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const k in u) { const val = u[k]?.value; if (val instanceof THREE.Texture) val.dispose(); }
      mat.dispose();
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
