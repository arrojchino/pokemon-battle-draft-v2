import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { CharacterId, CoinSide } from '@shared';
import { ROSTER, characterById, type Emote } from '../characters/roster.js';
import { CameraDirector, type Shot } from './CameraDirector.js';
import { CharacterRig } from './character/CharacterRig.js';
import { loadVrm } from './character/loadVrm.js';
import { Emitter, type WorldEvents } from './events.js';
import { AdaptiveQuality, TIERS, initialTier, stepTier, type QualityPref, type QualityTier } from './quality.js';
import { GradeShader } from './post/GradeShader.js';
import { createSky } from './world/Sky.js';
import { createSkyline } from './world/Skyline.js';
import { StageFloor, MAX_SLOTS } from './world/Floor.js';
import { Shrine } from './world/Shrine.js';
import { Petals } from './world/Petals.js';
import { Atmosphere } from './world/Atmosphere.js';
import { Coin } from './world/Coin.js';
import { rand } from './math.js';

export type DuoShot = 'room' | 'match' | 'draft' | 'battle';
export type Layout =
  | { mode: 'title'; featured: CharacterId }
  | { mode: 'select'; focus: CharacterId | null }
  | { mode: 'duo'; mine: CharacterId | null; theirs: CharacterId | null; shot: DuoShot; coin: boolean }
  | { mode: 'victory'; winner: CharacterId; loser: CharacterId | null };

type Slot = { key: string; x: number; z: number; facing: number; focus: boolean };

export type WorldOptions = { quality: QualityPref; reducedMotion: boolean; preload: CharacterId[] };

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
  private petals!: Petals;
  private atmosphere!: Atmosphere;
  private shrine: Shrine;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private coin: Coin;
  private key: THREE.DirectionalLight;
  private rimA: THREE.DirectionalLight;
  private rimB: THREE.DirectionalLight;
  private accent = new THREE.Color('#3ee6ff');
  private accentTarget = new THREE.Color('#3ee6ff');
  private rigs = new Map<string, CharacterRig>();
  private loading = new Map<string, Promise<CharacterRig | null>>();
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
  private envRT: THREE.WebGLRenderTarget | null = null;
  private progressBytes = new Map<string, [number, number]>();
  private removeListeners: Array<() => void> = [];

  static supported(): boolean {
    try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
  }

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, opts: WorldOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x and falls back anyway
    this.renderer.info.autoReset = false; // count the whole frame (all passes), reset manually
    this.reducedMotion = opts.reducedMotion;
    this.pref = opts.quality;
    this.tier = opts.quality === 'auto' ? initialTier(this.renderer.getContext()) : opts.quality;
    this.adaptive = new AdaptiveQuality(() => this.shiftTier(-1), () => this.shiftTier(1), opts.quality === 'auto');
    this.director = new CameraDirector(this.camera);
    this.director.reducedMotion = this.reducedMotion;

    this.scene.fog = new THREE.FogExp2('#0d0819', 0.0068);
    this.sky = createSky();
    this.scene.add(this.sky);
    this.shrine = new Shrine();
    this.scene.add(this.shrine.group);
    this.coin = new Coin(() => this.reducedMotion);
    this.coin.group.position.set(0, 1.08, 0.75);
    this.coin.onLand = () => this.floor.pulse();
    this.scene.add(this.coin.group);

    // Lighting: cool moon key with shadows, two accent rims for the anime silhouette, warm lantern bounce.
    this.scene.add(new THREE.HemisphereLight('#5a5fa8', '#140a16', 0.5));
    this.key = new THREE.DirectionalLight('#e4e9ff', 2.1);
    this.key.position.set(2.4, 6.5, 5.5); this.key.target.position.set(0, 1, 0);
    this.key.shadow.camera.left = -3.2; this.key.shadow.camera.right = 3.2; this.key.shadow.camera.top = 3.2; this.key.shadow.camera.bottom = -1.5;
    this.key.shadow.camera.near = 2; this.key.shadow.camera.far = 16; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.025;
    this.scene.add(this.key, this.key.target);
    this.rimA = new THREE.DirectionalLight('#3ee6ff', 1.6); this.rimA.position.set(-4, 3, -4);
    this.rimB = new THREE.DirectionalLight('#ff4f9a', 1.3); this.rimB.position.set(4, 2.5, -3.5);
    this.scene.add(this.rimA, this.rimB);
    const warm = new THREE.PointLight('#ff9b55', 6, 14, 1.6); warm.position.set(0, 4.2, -6.4);
    this.scene.add(warm);

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
    this.director.cut(this.shotFor({ mode: 'title', featured: opts.preload[0] ?? 'rei' }));
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
    if (this.petals) { this.scene.remove(this.petals.mesh); this.petals.dispose(); }
    this.petals = new Petals(q.petals);
    this.petals.setSpeed(this.reducedMotion ? 0.25 : 1);
    this.scene.add(this.petals.mesh);
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
    this.bloom = q.bloom ? new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.15) : null;
    if (this.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uGrain.value = this.reducedMotion ? 0.012 : 0.025;
    this.composer.addPass(this.grade);
    this.resize();
    this.events.emit('quality', { tier: this.tier, scale: this.adaptive.scale });
  }

  private shiftTier(dir: -1 | 1): boolean {
    const next = stepTier(this.tier, dir);
    if (!next) return false;
    this.tier = next; this.buildTierDependent(); return true;
  }

  setQuality(pref: QualityPref) {
    this.pref = pref;
    this.adaptive.enabled = pref === 'auto';
    const t = pref === 'auto' ? initialTier(this.renderer.getContext()) : pref;
    this.adaptive.scale = 1;
    if (t !== this.tier) { this.tier = t; this.buildTierDependent(); } else this.resize();
  }
  setReducedMotion(v: boolean) {
    this.reducedMotion = v; this.director.reducedMotion = v;
    this.petals.setSpeed(v ? 0.25 : 1);
    this.grade.uniforms.uGrain.value = v ? 0.012 : 0.025;
    for (const r of this.rigs.values()) r.reducedMotion = v;
  }

  private buildEnvironmentMap() {
    // Reflections for metals (coin, platform rim) from a tiny neon-and-sky scene, prefiltered once.
    const envScene = new THREE.Scene();
    envScene.add(createSky());
    const panel = (c: string, x: number, y: number, z: number, s: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(4), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 1, 0); envScene.add(m); };
    panel('#3ee6ff', -8, 4, -6, 6); panel('#ff4f9a', 8, 3, -6, 6); panel('#ffb36b', 0, 6, -9, 8); panel('#dfe6ff', 3, 9, 6, 6);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose(); disposeTree(envScene);
  }

  // ---------------------------------------------------------------- characters
  private async preload(ids: CharacterId[]) {
    const order = [...ids, ...ROSTER.map(c => c.id).filter(id => !ids.includes(id))];
    for (const id of order) { await this.ensureRig(id); if (this.disposed) return; }
    this.events.emit('ready');
  }

  private reportProgress(key: string, loaded: number, total: number, label: string) {
    this.progressBytes.set(key, [loaded, total || loaded]);
    let l = 0, t = 0; for (const [a, b] of this.progressBytes.values()) { l += a; t += b; }
    this.events.emit('progress', { loaded: l, total: t, label });
  }

  /** Get (or lazily create) a rig. `#2` keys are second instances used when both players pick the same partner. */
  private ensureRig(key: string): Promise<CharacterRig | null> {
    const existing = this.rigs.get(key);
    if (existing) return Promise.resolve(existing);
    let p = this.loading.get(key);
    if (p) return p;
    const id = key.split('#')[0] as CharacterId;
    const c = characterById(id);
    if (!c) return Promise.resolve(null);
    p = loadVrm(c.model, (l, t) => this.reportProgress(key, l, t, c.name)).then(vrm => {
      if (this.disposed) { disposeTree(vrm.scene); return null; }
      const rig = new CharacterRig(vrm, c, rand(key.length + this.rigs.size * 7.1) * 10);
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
      this.director.cut({ ...shot, pos: [shot.pos[0], shot.pos[1] + 0.12, shot.pos[2] + 0.7] });
      this.director.go(shot);
      this.fadeDir = -1;
    } else if (this.fade <= 0 && this.fadeDir < 0) this.fadeDir = 0;
    this.grade.uniforms.uFade.value = this.fade * this.fade * (3 - 2 * this.fade);
  }

  private shotFor(l: Layout): Shot {
    switch (l.mode) {
      case 'title': return { pos: [-0.15, 1.38, 3.7], target: [0.55, 1.18, 0], fov: 30, time: 1.4 };
      case 'select': {
        if (!l.focus) return { pos: [0, 1.32, 6.0], target: [0, 1.0, 0], fov: 31, time: 1.2 };
        const s = this.selectSlots(l.focus).find(x => x.focus)!;
        return { pos: [s.x - 0.75, 1.42, s.z + 3.15], target: [s.x - 0.3, 1.14, s.z], fov: 29, time: 1.0 };
      }
      case 'duo':
        if (l.shot === 'draft') return { pos: [0, 1.95, 6.6], target: [0, 1.45, 0], fov: 33, time: 1.3 };
        if (l.shot === 'battle') return { pos: [0, 1.5, 5.3], target: [0, 1.25, 0], fov: 33, time: 1.3 };
        return { pos: [0, 1.25, 4.7], target: [0, 1.05, 0], fov: 34, time: 1.3 };
      case 'victory': return { pos: [0.25, 1.0, 2.75], target: [0, 1.25, 0.25], fov: 33, time: 1.6 };
    }
  }

  private selectSlots(focus: CharacterId | null): Slot[] {
    const xs = [-1.55, 0, 1.55];
    return ROSTER.map((c, i) => ({ key: c.id, x: xs[i], z: (c.id === focus ? 0.55 : i === 1 ? 0 : -0.3), facing: c.id === focus ? -0.12 : -xs[i] * 0.1, focus: c.id === focus }));
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
      if (l?.mode !== 'duo') return;
      key = who === 'mine' ? l.mine : l.theirs === l.mine && l.theirs ? `${l.theirs}#2` : l.theirs;
    }
    if (key) this.rigs.get(key)?.play(e);
  }

  hover(id: CharacterId | null) {
    for (const [key, rig] of this.rigs) rig.hovered = key === id;
  }

  flipCoin(result: CoinSide): Promise<void> {
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
      if (this.layout?.mode === 'duo' && this.pointerIdle > 1.5) {
        // Partners glance at each other now and then during a match.
        if (Math.sin(t * 0.21 + key.length) > 0.55) {
          for (const [k, r] of this.rigs) if (k !== key && r.root.visible) { this.lookPoint.set(r.root.position.x, 1.45, r.root.position.z); break; }
        }
      }
      rig.lookAt(this.lookPoint);
      rig.update(dt);
    }
    this.director.update(dt);
    this.floor.update(t, dt);
    this.shrine.update(t);
    this.petals.update(t);
    this.atmosphere.update(t, dt);
    this.coin.update(dt);
    this.sky.material.uniforms.uTime.value = t;
    (this.skyline.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    this.grade.uniforms.uTime.value = t;

    this.renderer.info.reset();
    this.composer.render(dt);
    // CPU cost of this frame (simulation + draw submission), smoothed. GPU time is not observable here.
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - now) * 0.1;
    if (this.adaptive.push(frameMs, dt)) { this.resize(); this.events.emit('quality', { tier: this.tier, scale: this.adaptive.scale }); }
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const q = TIERS[this.tier];
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * this.adaptive.scale;
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
  }

  /** Live numbers for the diagnostics overlay. */
  stats() {
    const info = this.renderer.info;
    return {
      ...this.adaptive.stats(), cpuMs: this.cpuMs, tier: this.tier, pref: this.pref, scale: this.adaptive.scale,
      dpr: this.renderer.getPixelRatio(), calls: info.render.calls, triangles: info.render.triangles,
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
    this.floor.dispose(); this.petals.dispose();
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
