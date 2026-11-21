import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { CharacterId, CoinSide } from '@shared';
import { BOT, DEFAULT_CHARACTER, characterById, type Emote } from '../characters/roster.js';
import { CameraDirector, type Shot } from './CameraDirector.js';
import { BotRig } from './character/BotRig.js';
import { loadBot } from './character/loadBot.js';
import { Emitter, type WorldEvents } from './events.js';
import { AdaptiveQuality, EFFECTS, TIERS, initialTier, stepTier, type EffectsLevel, type QualityPref, type QualityTier, type RenderScale } from './quality.js';
import { GradeShader } from './post/GradeShader.js';
import { createSky } from './world/Sky.js';
import { createSkyline } from './world/Skyline.js';
import { StageFloor, MAX_SLOTS } from './world/Floor.js';
import { Alley } from './world/Alley.js';
import { Rain } from './world/Rain.js';
import { Atmosphere } from './world/Atmosphere.js';
import { Coin } from './world/Coin.js';
import { BattleStage } from './battle/BattleStage.js';
import { ARENA, yawTo } from './battle/BattleCamera.js';

const HEMI_BASE = new THREE.Color('#4a4238');
const HEMI_FLASH = new THREE.Color('#b8c8ff');
const BLOOM_STRENGTH = 0.6;

export type DuoShot = 'room' | 'match' | 'draft' | 'battle';
export type Layout =
  | { mode: 'title'; featured: CharacterId }
  | { mode: 'select'; focus: CharacterId | null }
  | { mode: 'duo'; mine: CharacterId | null; theirs: CharacterId | null; shot: DuoShot; coin: boolean }
  | { mode: 'victory'; winner: CharacterId; loser: CharacterId | null }
  /** In-app battle: partners step back, holograms of the active Pokémon take the centre. */
  | { mode: 'arena'; mine: CharacterId; theirs: CharacterId };

type Slot = { key: string; x: number; z: number; facing: number; focus: boolean };

/**
 * Display options the World honours (from Settings): quality preset, render scale, effects intensity,
 * calm = Reduce flashing (no lightning or screen flashes), steady = the Steady camera style.
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
  private skyline!: THREE.InstancedMesh;
  private rain!: Rain;
  private hemi!: THREE.HemisphereLight;
  private boltLight!: THREE.DirectionalLight;
  /** Lightning: seconds until the next strike, the flash level, and the scheduled flicker sequence. */
  private bolt = { next: 9, flash: 0, seq: [] as number[], t: 0 };
  private boltFlash = 0;
  private atmosphere!: Atmosphere;
  private alley: Alley;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private coin: Coin;
  readonly battle: BattleStage;
  private key: THREE.DirectionalLight;
  private rimA: THREE.DirectionalLight;
  private rimB: THREE.DirectionalLight;
  private accent = new THREE.Color('#3ee6ff');
  private accentTarget = new THREE.Color('#3ee6ff');
  private rigs = new Map<string, BotRig>();
  private loading = new Map<string, Promise<BotRig | null>>();
  private hitboxes = new Map<string, THREE.Mesh>();
  private layout: Layout | null = null;
  private slots: Slot[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2(0, 0);
  private pointerIdle = 99;
  private hoverKey: string | null = null;
  private lookPoint = new THREE.Vector3();
  private gaze = new THREE.Vector3();
  private gazeValid = false;
  private gazePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.9);
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

    this.scene.fog = new THREE.FogExp2('#05030b', 0.0085);
    this.sky = createSky();
    this.scene.add(this.sky);
    this.alley = new Alley();
    this.scene.add(this.alley.group);
    this.coin = new Coin(() => this.reducedMotion);
    this.coin.group.position.set(0, 1.08, 0.75);
    this.coin.onLand = () => { this.floor.pulse(); this.events.emit('sound', { cue: 'coinLand', pan: 0 }); };
    this.scene.add(this.coin.group);
    this.battle = new BattleStage(this.camera, () => this.reducedMotion);
    this.syncBattleCamera();
    this.battle.onImpact = color => this.floor.pulse(color);
    this.battle.onSound = (cue, pan, gain) => this.events.emit('sound', { cue, pan, gain });
    this.scene.add(this.battle.group);

    // Lighting: a sodium street-lamp key with shadows, neon rims (cyan and pink) for silhouettes; the
    // barrel fire and the pink sign are real point lights inside the alley.
    this.hemi = new THREE.HemisphereLight('#4a4238', '#0a0706', 0.32);
    this.scene.add(this.hemi);
    // Lightning: a cold light from high behind the walls, dark until a strike.
    this.boltLight = new THREE.DirectionalLight('#c8d6ff', 0); this.boltLight.position.set(-3, 14, -12);
    this.scene.add(this.boltLight);
    this.key = new THREE.DirectionalLight('#ffd2a0', 1.65);
    this.key.position.set(2.4, 6.5, 5.5); this.key.target.position.set(0, 1, 0);
    this.key.shadow.camera.left = -3.2; this.key.shadow.camera.right = 3.2; this.key.shadow.camera.top = 3.2; this.key.shadow.camera.bottom = -1.5;
    this.key.shadow.camera.near = 2; this.key.shadow.camera.far = 16; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.025;
    this.scene.add(this.key, this.key.target);
    this.rimA = new THREE.DirectionalLight('#3ee6ff', 2.2); this.rimA.position.set(-4, 3, -4);
    this.rimB = new THREE.DirectionalLight('#ff3d7a', 1.6); this.rimB.position.set(4, 2.5, -3.5);
    this.scene.add(this.rimA, this.rimB);

    this.buildTierDependent();
    this.buildEnvironmentMap();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.listen(window, 'pointermove', e => this.onPointer(e as PointerEvent));
    this.listen(canvas, 'click', () => this.onClick());
    this.listen(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.listen(canvas, 'webglcontextlost', e => { e.preventDefault(); this.stop(); this.events.emit('contextLost'); });
    this.listen(canvas, 'webglcontextrestored', () => { this.start(); this.events.emit('contextRestored'); });
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
    if (this.skyline) { this.scene.remove(this.skyline); this.skyline.geometry.dispose(); (this.skyline.material as THREE.Material).dispose(); this.skyline.dispose(); }
    this.skyline = createSkyline(q.buildings);
    this.scene.add(this.skyline);
    if (this.rain) { this.scene.remove(this.rain.mesh); this.rain.dispose(); }
    this.rain = new Rain(q.rain);
    this.rain.setSpeed(this.reducedMotion ? 0.35 : 1);
    this.scene.add(this.rain.mesh);
    this.floor.uniforms.uRain.value = this.reducedMotion ? 0.3 : 1;
    if (this.atmosphere) { this.scene.remove(this.atmosphere.group); disposeTree(this.atmosphere.group); }
    this.atmosphere = new Atmosphere(q.shafts);
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
   * Effects intensity and Reduce flashing: bloom strength, post-processing grit (grain, scratches and
   * colour fringe; grime and impact blur are scaled per frame), battle particles and light flashes, and
   * the alley's flickering signs (flicker counts as flashing).
   */
  private applyEffects() {
    const fx = this.fx, base = GradeShader.uniforms, g = this.grade.uniforms;
    if (this.bloom) { this.bloom.enabled = fx.bloom > 0; this.bloom.strength = BLOOM_STRENGTH * fx.bloom; }
    g.uGrain.value = base.uGrain.value * (this.reducedMotion ? 0.5 : 1) * fx.post;
    g.uFringe.value = base.uFringe.value * fx.post;
    this.battle.setEffects(fx.particles, fx.lights, this.calm);
    this.alley.reduced = this.reducedMotion || this.calm;
  }

  /**
   * Distant lightning every 12 to 30 seconds: two or three quick flickers that light the clouds, the
   * rain and the wet ground, then thunder a moment later (the delay sells the distance). Skipped with
   * reduced motion or Reduce flashing, since flashes are exactly what those settings are for.
   */
  private stepLightning(dt: number) {
    const b = this.bolt;
    b.next -= dt;
    if (b.next <= 0 && !this.reducedMotion && !this.calm) {
      b.next = 12 + Math.random() * 18; b.t = 0;
      const n = 2 + Math.floor(Math.random() * 2);
      b.seq = []; let at = 0;
      for (let i = 0; i < n; i++) { b.seq.push(at, 0.05 + Math.random() * 0.06); at += 0.09 + Math.random() * 0.14; }
      const dist = 0.6 + Math.random() * 1.6;
      window.setTimeout(() => this.events.emit('sound', { cue: 'thunder', pan: Math.random() * 1.2 - 0.6, gain: 1.4 - dist * 0.35 }), dist * 1000);
    }
    let f = 0;
    if (b.seq.length) {
      b.t += dt;
      for (let i = 0; i < b.seq.length; i += 2) { const s0 = b.seq[i], d = b.seq[i + 1]; if (b.t >= s0 && b.t < s0 + d) f = Math.max(f, 1 - i * 0.15); }
      if (b.t > b.seq[b.seq.length - 2] + 0.4) b.seq = [];
    }
    b.flash += (f - b.flash) * Math.min(1, dt * (f > b.flash ? 60 : 9));
    this.sky.material.uniforms.uFlash.value = b.flash;
    this.rain.setFlash(b.flash);
    this.alley.setFlash(b.flash);
    this.hemi.intensity = 0.32 + b.flash * 2.2;
    this.hemi.color.lerpColors(HEMI_BASE, HEMI_FLASH, Math.min(1, b.flash));
    this.boltLight.intensity = b.flash * 4.5;
    this.boltFlash = b.flash;
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
    this.rain.setSpeed(v ? 0.35 : 1); this.floor.uniforms.uRain.value = v ? 0.3 : 1;
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

  private buildEnvironmentMap() {
    // Reflections for metals (coin, platform rim) from a tiny neon-and-sky scene, prefiltered once.
    const envScene = new THREE.Scene();
    envScene.add(createSky());
    const panel = (c: string, x: number, y: number, z: number, s: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); envScene.add(m); };
    panel('#2fe6ff', 8, 4, -6, 5); panel('#ff2f8a', -6, 5, -9, 6); panel('#ffa040', -7, 3, -2, 4); panel('#ffd2a0', 3, 9, 6, 6);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.18;
    pmrem.dispose(); disposeTree(envScene);
  }

  // ---------------------------------------------------------------- characters
  private async preload(ids: CharacterId[]) {
    // One model serves every paint job, so only the paints actually on screen need instances.
    for (const id of ids.length ? ids : [DEFAULT_CHARACTER]) { await this.ensureRig(id); if (this.disposed) return; }
    this.events.emit('ready');
  }

  private reportProgress(key: string, loaded: number, total: number, label: string) {
    this.progressBytes.set(key, [loaded, total || loaded]);
    let l = 0, t = 0; for (const [a, b] of this.progressBytes.values()) { l += a; t += b; }
    this.events.emit('progress', { loaded: l, total: t, label });
  }

  /** Get (or lazily create) a rig. `#2` keys are second instances used when both players pick the same partner. */
  private ensureRig(key: string): Promise<BotRig | null> {
    const existing = this.rigs.get(key);
    if (existing) return Promise.resolve(existing);
    let p = this.loading.get(key);
    if (p) return p;
    const id = key.split('#')[0] as CharacterId;
    const c = characterById(id);
    if (!c) return Promise.resolve(null);
    p = loadBot(BOT.model, c.paint, (l, t) => this.reportProgress('bot', l, t, 'battle bot')).then(bot => {
      if (this.disposed) { disposeTree(bot.scene); return null; }
      const rig = new BotRig(bot, c);
      rig.reducedMotion = this.reducedMotion;
      rig.setVisible(false, true); rig.root.visible = false;
      this.scene.add(rig.root);
      // Invisible capsule-ish hitbox for hover/click picking (cheaper and steadier than skinned meshes).
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, rig.height * 0.95, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = rig.height * 0.48; hit.userData.key = key;
      rig.root.add(hit); this.hitboxes.set(key, hit);
      this.rigs.set(key, rig);
      this.events.emit('characterReady', { id });
      if (this.layout && !this.pendingLayout) this.applyLayout(this.layout, false);
      return rig;
    }).catch(err => {
      this.loading.delete(key);
      this.events.emit('error', { message: `Could not load ${c.name}: ${String((err as Error).message ?? err)}` });
      return null;
    });
    this.loading.set(key, p);
    return p;
  }

  isLoaded(id: CharacterId) { return this.rigs.has(id); }

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

  private shotFor(l: Layout): Shot {
    switch (l.mode) {
      case 'title': return { pos: [-0.15, 1.12, 3.5], target: [0.55, 0.86, 0], fov: 30, time: 1.4 };
      case 'select': {
        if (!l.focus) return { pos: [0, 1.1, 5.0], target: [0, 0.8, 0], fov: 31, time: 1.2 };
        const s = this.selectSlots(l.focus).find(x => x.focus)!;
        return { pos: [s.x - 0.8, 1.4, s.z + 4.3], target: [s.x - 0.6, 0.95, s.z], fov: 31, time: 1.0 };
      }
      case 'duo':
        if (l.shot === 'draft') return { pos: [0, 1.95, 6.6], target: [0, 1.45, 0], fov: 33, time: 1.3 };
        if (l.shot === 'battle') return { pos: [0, 1.5, 5.3], target: [0, 1.25, 0], fov: 33, time: 1.3 };
        return { pos: [0, 1.25, 4.7], target: [0, 1.05, 0], fov: 34, time: 1.3 };
      case 'victory': return { pos: [0.25, 1.0, 2.75], target: [0, 1.25, 0.25], fov: 33, time: 1.6 };
      case 'arena': return this.battle.cam.neutral();
    }
  }

  private selectSlots(focus: CharacterId | null): Slot[] {
    // The paint shop: just your bot, centre stage.
    return focus ? [{ key: focus, x: 0, z: 0.35, facing: 0, focus: true }] : [];
  }

  private applyLayout(l: Layout, modeChanged: boolean) {
    let slots: Slot[] = [];
    let accent: CharacterId | null = null;
    if (l.mode === 'title') { slots = [{ key: l.featured, x: 0.95, z: 0.15, facing: -0.32, focus: true }]; accent = l.featured; }
    if (l.mode === 'select') { slots = this.selectSlots(l.focus); accent = l.focus; }
    if (l.mode === 'duo') {
      if (l.mine) slots.push({ key: l.mine, x: -1.05, z: 0, facing: 0.42, focus: false });
      if (l.theirs) slots.push({ key: l.theirs === l.mine ? `${l.theirs}#2` : l.theirs, x: 1.05, z: 0, facing: -0.42, focus: false });
      accent = l.mine;
      this.coin.visibleTarget = l.coin ? 1 : 0;
    } else this.coin.visibleTarget = 0;
    if (l.mode === 'arena') {
      // Pokémon-style field: each partner behind their Pokémon, squared up to the other partner.
      const [a, b] = ARENA.trainer;
      slots.push({ key: l.mine, x: a.x, z: a.z, facing: yawTo(a, b), focus: false });
      slots.push({ key: l.theirs === l.mine ? `${l.theirs}#2` : l.theirs, x: b.x, z: b.z, facing: yawTo(b, a), focus: false });
      accent = l.mine;
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
      // New screen (or newly shown): teleport and reset spring bones. Within a screen: glide.
      rig.place(s.x, s.z, s.facing, !rig.isShown || modeChanged);
      rig.setVisible(true);
      rig.focused = s.focus;
    }
    this.slots = slots.filter(s => wanted.has(s.key));
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i];
      if (s) this.floor.setSlot(i, s.x, s.z, 0.55, s.focus ? 1 : 0.35); else this.floor.setSlot(i, 0, 0, 0, 0);
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
      if (l?.mode !== 'duo' && l?.mode !== 'arena') return;
      key = who === 'mine' ? l.mine : l.theirs === l.mine && l.theirs ? `${l.theirs}#2` : l.theirs;
    }
    const rig = key ? this.rigs.get(key) : undefined;
    if (!rig) return;
    rig.play(e);
    // Every reaction comes with a little robot gibberish, panned to where the bot stands.
    const cue = e === 'excited' || e === 'victory' || e === 'twirl' || e === 'thumbs' || e === 'greet' ? 'chirpHappy'
      : e === 'sad' || e === 'faceplant' ? 'chirpSad' : e === 'punch' || e === 'thinking' ? 'chirpAngry' : 'chirp';
    if (rig.root.visible) this.events.emit('sound', { cue, pan: Math.max(-1, Math.min(1, rig.root.position.x / 3)), gain: 0.8 });
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
  }
  private pickHover(overCanvas: boolean) {
    let key: string | null = null;
    if (overCanvas) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const boxes = [...this.hitboxes.entries()].filter(([k]) => this.rigs.get(k)?.root.visible).map(([, m]) => m);
      const hit = this.raycaster.intersectObjects(boxes, false)[0];
      key = (hit?.object.userData.key as string | undefined) ?? null;
    }
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.canvas.style.cursor = key && this.layout?.mode === 'select' ? 'pointer' : '';
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
    this.rimA.color.copy(this.accent);

    // Gaze: the pointer ray meets a plane just in front of the stage; idle pointers hand gaze back to the camera.
    this.pointerIdle += dt;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.gazeValid = this.raycaster.ray.intersectPlane(this.gazePlane, this.gaze) !== null;
    const toCamera = this.pointerIdle > 3.5;
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
      }
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
    const bf = this.boltFlash * 0.07, sf = arena ? this.battle.screenFlash.amt : 0;
    this.grade.uniforms.uFlashAmt.value = Math.max(sf, bf);
    const grime = (arena ? 1 : 0.55) * (this.reducedMotion ? 0.6 : 1) * this.fx.post;
    this.grade.uniforms.uGrime.value += (grime - this.grade.uniforms.uGrime.value) * Math.min(1, dt * 2);
    this.grade.uniforms.uFlashColor.value.copy(sf >= bf ? this.battle.screenFlash.color : HEMI_FLASH);
    this.director.update(dt);
    this.floor.update(t, dt);
    this.alley.update(t, dt);
    this.rain.update(t);
    this.stepLightning(dt);
    this.atmosphere.update(t, dt);
    this.coin.update(dt);
    this.sky.material.uniforms.uTime.value = t;
    (this.skyline.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
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
    this.floor.dispose(); this.rain.dispose(); this.alley.dispose(); this.battle.dispose();
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
