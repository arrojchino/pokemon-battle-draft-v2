import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl, pokemonModel } from '../../assets.js';
import { ProceduralRig } from './procedural.js';

/**
 * Runtime 3D Pokémon from the community Pokémon 3D API: Draco-compressed GLB with WebP textures, fetched
 * from GitHub when first needed and never bundled. Each species downloads once; every use gets its own
 * clone (skeleton and materials included), so flashes and fades never leak between instances.
 *
 * The API mixes Switch-era models (full battle clip sets) with much older or partial ones, so every
 * instance goes through the same treatment: lit PBR materials (some arrive unlit), cut-out alpha instead
 * of blending, a shared fresnel rim, a size fit that respects wide and long bodies, and a procedural rig
 * (see procedural.ts) that brings static models to life. `qa/models.html` shows the result for any id.
 */

type Plan = { folder?: string; use?: 'model' | 'art'; metal?: RegExp };
/**
 * Per-species decisions from the asset audit (docs/ASSET_AUDIT.md). `art` = the model fails the quality
 * bar or does not exist, so the Pokémon is shown as its official artwork instead.
 */
const PLAN: Record<number, Plan> = {
  1000: { metal: /^body_(a|b)/ },     // Gholdengo is made of gold
  497: { use: 'art' },                // Serperior: bind pose is a straight vertical pole, no clips
  778: { use: 'art' },                // Mimikyu: 340 triangles
  637: { use: 'art' },                // Volcarona: 1.9k triangles, 128 px texture, no rig
  748: { use: 'art' },                // Toxapex: 1.5k triangles, no rig
  914: { use: 'art' },                // Quaquaval: clips stripped, rest pose collapses the body
  861: { use: 'art' }, 977: { use: 'art' }, 992: { use: 'art' }, 1013: { use: 'art' }, // not in the API
};
export const hasModel = (dex: number) => Number.isInteger(dex) && dex > 0 && dex <= 1025 && PLAN[dex]?.use !== 'art';

let loader: GLTFLoader | null = null;
function gltfLoader() {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('draco/'));
    loader = new GLTFLoader();
    loader.setCrossOrigin('anonymous');
    loader.setDRACOLoader(draco);
  }
  return loader;
}

type Source = { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
const sources = new Map<number, Promise<Source>>();

export type MonModel = {
  /** Holder with the model inside: feet on y = 0, centred on the origin, facing +z. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
  /** Footprint radius, for the contact shadow. */
  radius: number;
  /** This instance's own materials. */
  materials: THREE.Material[];
};

/**
 * Smooth vertex normals for a mesh exported without any. glTF then requires flat shading, which turns
 * a creature into faceted plastic. Face normals are accumulated per position (weighted by triangle area)
 * rather than per vertex, so the duplicated vertices along UV seams share one normal and leave no crease.
 */
function smoothNormals(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index;
  const n = pos.count;
  g.computeBoundingBox();
  const q = 1e5 / Math.max(g.boundingBox!.getSize(new THREE.Vector3()).length(), 1e-6);
  const weld = new Int32Array(n);
  const ids = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    weld[i] = id;
  }
  const acc = new Float32Array(ids.size * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), cb = new THREE.Vector3();
  const tris = (idx ? idx.count : n) / 3;
  for (let t = 0; t < tris; t++) {
    const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    cb.subVectors(c, b).cross(ab.subVectors(a, b)); // length = twice the triangle area
    for (const i of [i0, i1, i2]) { const o = weld[i] * 3; acc[o] += cb.x; acc[o + 1] += cb.y; acc[o + 2] += cb.z; }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = weld[i] * 3, x = acc[o], y = acc[o + 1], z = acc[o + 2], l = Math.hypot(x, y, z) || 1;
    out[3 * i] = x / l; out[3 * i + 1] = y / l; out[3 * i + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

/** Download a species once (later calls share the request); resolves when it is in memory. */
export function preloadMon(dex: number, onProgress?: (loaded: number, total: number) => void): Promise<Source> {
  let p = sources.get(dex);
  if (!p) {
    p = gltfLoader().loadAsync(pokemonModel(dex, PLAN[dex]?.folder), e => onProgress?.(e.loaded, e.total || e.loaded)).then(g => {
      // Once per download: every instance shares this geometry.
      g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.geometry.attributes.normal) smoothNormals(m.geometry); });
      return { scene: g.scene, clips: g.animations };
    });
    sources.set(dex, p);
    p.catch(() => sources.delete(dex));
  }
  return p;
}

/** Download (once per species) and return a fresh instance about `height` tall. Rejects when the model is unavailable. */
export function loadMonModel(dex: number, height: number, onProgress?: (loaded: number, total: number) => void): Promise<MonModel> {
  return preloadMon(dex, onProgress).then(src => instance(src, height, PLAN[dex]?.metal));
}

/** Shared by every Pokémon material: a fresnel rim that lifts silhouettes off the night, tinted by the stage. */
export const MON_RIM = { color: { value: new THREE.Color('#a9c6ff') }, strength: { value: 0.3 } };

/**
 * How a texture's alpha channel is really used. Many models flag their bodies as blended while the
 * alpha channel holds something else, which renders them half see-through; others carry a clean cut-out
 * mask. Measured once per texture on a 64 px copy.
 */
const alphaKinds = new WeakMap<THREE.Texture, 'opaque' | 'cutout'>();
function alphaKind(tex: THREE.Texture): 'opaque' | 'cutout' {
  const known = alphaKinds.get(tex);
  if (known) return known;
  let kind: 'opaque' | 'cutout' = 'opaque';
  try {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(tex.image as CanvasImageSource, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let clear = 0, solid = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 26) clear++; else if (d[i] > 230) solid++; }
    const n = d.length / 4;
    if (clear / n > 0.03 && (clear + solid) / n > 0.85) kind = 'cutout';
  } catch { /* unreadable: treat as opaque */ }
  alphaKinds.set(tex, kind);
  return kind;
}

function upgradeMaterial(src: THREE.Material, metal: RegExp | undefined): THREE.MeshStandardMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = s.isMeshStandardMaterial ? (s.clone() as THREE.MeshStandardMaterial) : new THREE.MeshStandardMaterial({
    name: src.name, map: s.map ?? null, color: s.color?.clone() ?? new THREE.Color('#ffffff'), alphaMap: s.alphaMap ?? null,
    transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side, vertexColors: src.vertexColors,
  });
  // Several models arrive unlit or with arbitrary PBR values: settle on believable, slightly soft surfaces.
  const isMetal = !!metal && metal.test(src.name);
  m.metalness = isMetal ? 0.85 : Math.min(m.metalness ?? 0, 0.15);
  m.roughness = isMetal ? 0.32 : THREE.MathUtils.clamp(m.roughness ?? 0.7, 0.42, 0.85);
  // Bodies flagged as blended: opaque unless the alpha is a real cut-out mask (then alpha-tested, smooth
  // with MSAA through alpha to coverage). Genuine effects (flames, auras) keep blending.
  if ((m.transparent || m.alphaTest > 0) && m.opacity >= 0.99 && !/(fire|flame|effect|glow|aura|smoke|ghost)/i.test(src.name)) {
    const cut = m.map ? alphaKind(m.map) === 'cutout' : false;
    m.transparent = false; m.depthWrite = true;
    m.alphaTest = cut ? 0.5 : 0; m.alphaToCoverage = cut;
  }
  if (m.map) m.map.anisotropy = 8;
  // glTF asks for flat shading when a mesh has no normals; preloadMon has given every such mesh smooth ones.
  m.flatShading = false;
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = MON_RIM.color; shader.uniforms.uRimStrength = MON_RIM.strength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength;')
      .replace('#include <opaque_fragment>', 'outgoingLight += uRimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * uRimStrength;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'mon-rim';
  return m;
}

function instance(src: Source, height: number, metal?: RegExp): MonModel {
  const model = cloneSkinned(src.scene);
  const materials: THREE.Material[] = [];
  const own = new Map<THREE.Material, THREE.Material>();
  // Some exports keep the game's lower levels of detail as extra meshes: drawing them too doubles the
  // cost and z-fights with the full model.
  const lods: THREE.Object3D[] = [];
  model.traverse(o => { if ((o as THREE.Mesh).isMesh && /_lod[1-9]$/i.test(o.name)) lods.push(o); });
  for (const o of lods) o.removeFromParent();
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    // Skinned bounds follow the bind pose, not the animation: never cull them away.
    m.frustumCulled = false;
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => {
      let c = own.get(mat);
      if (!c) { c = upgradeMaterial(mat, metal); own.set(mat, c); materials.push(c); }
      return c;
    });
    m.material = Array.isArray(m.material) ? list : list[0];
  });
  model.updateMatrixWorld(true);
  // Measure in the idle pose: some models (single-clip ones especially) have a bind pose far from how
  // they actually stand, which would throw the height and centre off.
  const pose = findClip(src.clips, ['battlewait01_loop', 'defaultwait01_loop']) ?? src.clips[0];
  if (pose) {
    const mx = new THREE.AnimationMixer(model);
    mx.clipAction(pose).play(); mx.update(0);
    model.updateMatrixWorld(true);
    mx.stopAllAction(); mx.uncacheRoot(model);
  }
  measureStrikes(model, src.clips);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // Fit the height; wide (wings) and long (tails, serpents) bodies may extend further before they shrink.
  const s = height / Math.max(size.y, size.x / 2, size.z / 2, 1e-4);
  model.scale.multiplyScalar(s);
  model.position.multiplyScalar(s).add(new THREE.Vector3(-c.x * s, -box.min.y * s, -c.z * s));
  const root = new THREE.Group();
  root.add(model);
  return { root, clips: src.clips, height: size.y * s, radius: Math.max(size.x, size.z) * s * 0.5, materials };
}

/**
 * When the strike happens inside each attack clip, as a fraction of its length: the moment the skeleton
 * moves fastest (the swing), measured once per clip by sampling it on the first instance. The battle
 * stage uses it to time each clip so the strike lands exactly when the move's effect hits.
 */
const strikes = new WeakMap<THREE.AnimationClip, number>();
export const strikeFraction = (clip: THREE.AnimationClip) => strikes.get(clip) ?? 0.4;
function measureStrikes(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const todo = clips.filter(c => /(attack0\d|rangeattack0\d|roar01|glad01)$/.test(c.name) && !strikes.has(c));
  if (!todo.length) return;
  const bones: THREE.Object3D[] = [];
  model.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o); });
  if (!bones.length) return;
  const mixer = new THREE.AnimationMixer(model);
  const prev = bones.map(() => new THREE.Vector3()), cur = new THREE.Vector3();
  for (const clip of todo) {
    const a = mixer.clipAction(clip); a.play();
    const N = 36; let best = 0.4, bestSpeed = -1;
    for (let i = 0; i <= N; i++) {
      mixer.setTime((i / N) * clip.duration);
      model.updateMatrixWorld(true);
      let speed = 0;
      bones.forEach((b, j) => { b.getWorldPosition(cur); if (i > 0) speed += cur.distanceTo(prev[j]); prev[j].copy(cur); });
      const f = i / N;
      if (i > 0 && f > 0.12 && f < 0.8 && speed > bestSpeed) { bestSpeed = speed; best = f; }
    }
    strikes.set(clip, best);
    a.stop(); mixer.uncacheAction(clip);
  }
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
}

/** First clip whose name ends with one of the Scarlet/Violet action names (defaultwait01_loop, glad01, attack01…). */
export function findClip(clips: THREE.AnimationClip[], names: readonly string[]): THREE.AnimationClip | null {
  for (const n of names) { const c = clips.find(x => x.name.endsWith(n)); if (c) return c; }
  return null;
}
const hasBattleSet = (clips: THREE.AnimationClip[]) => !!(findClip(clips, ['battlewait01_loop', 'defaultwait01_loop']) && findClip(clips, ['attack01', 'rangeattack01']) && findClip(clips, ['damage01']) && findClip(clips, ['down01_start', 'down01']));

export type ModelGrade = 'A' | 'B' | 'C' | 'F';
/**
 * What a downloaded model really contains, and the grade it earns:
 * A = game-quality (Switch-era rig): 1024 px textures, skinned, with a battle clip set (idle, attack, damage, faint);
 * B = skinned and animated, but lighter; C = static or low resolution; F = missing.
 */
export function auditModel(m: MonModel) {
  let tris = 0, maxTex = 0, bones = 0;
  const seen = new Set<THREE.Texture>();
  m.root.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (mesh.isSkinnedMesh) bones = Math.max(bones, mesh.skeleton.bones.length);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !seen.has(v)) {
        seen.add(v);
        const img = v.image as { width?: number; height?: number } | undefined;
        maxTex = Math.max(maxTex, img?.width ?? 0, img?.height ?? 0);
      }
    }
  });
  const battleSet = hasBattleSet(m.clips);
  const grade: ModelGrade = tris >= 3500 && maxTex >= 1024 && bones > 0 && battleSet ? 'A' : bones > 0 && m.clips.length > 0 && tris >= 3500 && maxTex >= 256 ? 'B' : 'C';
  return { tris: Math.round(tris), maxTex, bones, clips: m.clips.length, battleSet, materials: m.materials.length, grade };
}

type MatState = { color: THREE.Color | null; emissive: THREE.Color | null; opacity: number; transparent: boolean };
type Act = THREE.AnimationAction & { hold?: boolean };

/**
 * One Pokémon body on stage. Animation runs as a small state machine over the model's own clips: an
 * idle loop (battle stance or relaxed), occasional fidgets from the model's idle variations, one-shot
 * actions that cross-fade in and back out (attack, ranged attack, damage, roar, glad), held poses
 * (faint) and alternate idles (sleep). The procedural rig layers on top: look-at for every model, and
 * breathing, sway and body lean for models without clips. Material effects (hit flash, status tint,
 * fade) touch the materials only while they change.
 */
export class MonBody {
  readonly root: THREE.Group;
  readonly height: number;
  readonly radius: number;
  /** True when the model brings its own clips (it loops at least an idle). */
  readonly animated: boolean;
  /** True when the clips cover a full battle: idle, attack, damage and faint. */
  readonly battleSet: boolean;
  readonly proc: ProceduralRig;
  private mixer: THREE.AnimationMixer | null = null;
  private idleKind: 'default' | 'battle' | 'sleep';
  private idleAction: THREE.AnimationAction | null = null;
  private current: Act | null = null;
  private fidgetIn = 6 + Math.random() * 6;
  private base = new Map<THREE.Material, MatState>();
  private flash = 0; private flashColor = new THREE.Color('#ffffff');
  private tint = 0; private tintColor = new THREE.Color('#000000');
  private opacity = 1;
  private dirty = false;

  constructor(private model: MonModel, idle: 'default' | 'battle' = 'default') {
    this.root = model.root; this.height = model.height; this.radius = model.radius; this.idleKind = idle;
    this.battleSet = hasBattleSet(model.clips);
    // Older single-clip models loop their one clip as the idle (their bind pose is often not a stance).
    this.animated = model.clips.length > 0;
    this.proc = new ProceduralRig(model.root, { animated: this.animated });
    if (this.animated) {
      this.mixer = new THREE.AnimationMixer(model.root);
      this.mixer.addEventListener('finished', () => this.backToIdle());
      this.setIdle(idle);
    }
    for (const mat of model.materials) {
      const m = mat as THREE.MeshStandardMaterial;
      this.base.set(mat, { color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null, opacity: m.opacity, transparent: m.transparent });
    }
  }

  private idleClip(kind: 'default' | 'battle' | 'sleep') {
    const c = this.model.clips;
    if (kind === 'sleep') return findClip(c, ['sleep01_loop']);
    return findClip(c, kind === 'battle' ? ['battlewait01_loop', 'defaultwait01_loop'] : ['defaultwait01_loop', 'battlewait01_loop']) ?? c[0] ?? null;
  }

  /** Idle stance: relaxed, battle-ready, or asleep (models with a sleep loop; others droop procedurally). */
  setIdle(kind: 'default' | 'battle' | 'sleep') {
    const was = this.idleKind;
    this.idleKind = kind;
    this.proc.drowsy = kind === 'sleep';
    if (!this.mixer) return;
    const clip = this.idleClip(kind) ?? this.idleClip('battle');
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    if (next === this.idleAction) return;
    // Falling asleep and waking play their transition clips first when the model has them.
    const into = kind === 'sleep' ? findClip(this.model.clips, ['sleep01_start']) : was === 'sleep' ? findClip(this.model.clips, ['sleep01_end']) : null;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    const prevIdle = this.idleAction;
    this.idleAction = next;
    if (into && this.current === prevIdle) { this.act([into.name]); return; }
    next.play();
    if (prevIdle && this.current === prevIdle) prevIdle.crossFadeTo(next, 0.35, false);
    if (!this.current || this.current === prevIdle) this.current = next;
  }

  /** Play a one-shot clip by action name; returns its duration in seconds, or 0 when the model has none of them. */
  act(names: readonly string[], opts: { speed?: number; hold?: boolean; fade?: number } = {}): number {
    if (!this.mixer) return 0;
    const clip = findClip(this.model.clips, names);
    if (!clip) return 0;
    const a = this.mixer.clipAction(clip) as Act;
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = opts.speed ?? 1;
    a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, opts.fade ?? 0.15, false);
    this.current = a;
    a.hold = !!opts.hold;
    return clip.duration / (opts.speed ?? 1);
  }
  /** Loop a clip until the next action. */
  loop(names: readonly string[]): boolean {
    if (!this.mixer) return false;
    const clip = findClip(this.model.clips, names);
    if (!clip) return false;
    const a = this.mixer.clipAction(clip) as Act;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, 0.25, false);
    this.current = a; a.hold = true;
    return true;
  }
  has(names: readonly string[]) { return !!findClip(this.model.clips, names); }
  /**
   * Play an attack-type clip so its strike lands `inSeconds` from now (speed clamped to stay natural).
   * Returns false when the model has none of the clips.
   */
  strike(names: readonly string[], inSeconds: number): boolean {
    const clip = findClip(this.model.clips, names);
    if (!clip || !this.mixer) return false;
    const speed = THREE.MathUtils.clamp((strikeFraction(clip) * clip.duration) / Math.max(0.15, inSeconds), 0.75, 2.4);
    this.act([clip.name], { speed, fade: 0.12 });
    return true;
  }
  private backToIdle() {
    const cur = this.current;
    if (!this.idleAction || !cur || cur === this.idleAction || cur.hold) return;
    this.idleAction.reset().play();
    cur.crossFadeTo(this.idleAction, 0.3, false);
    this.current = this.idleAction;
  }

  /** Back to a clean idle: no held pose, tint, flash or fade (a revived Pokémon coming back, for instance). */
  reset() {
    this.flash = 0; this.tint = 0; this.opacity = 1; this.dirty = true;
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.current = null; this.idleAction = null;
    const kind = this.idleKind === 'sleep' ? 'battle' : this.idleKind;
    this.idleKind = kind; this.proc.drowsy = false;
    this.setIdle(kind);
  }

  lookAt(world: THREE.Vector3 | null) { this.proc.lookAt(world); }
  /** Body motion that works for every model (procedural lean and jaw), on top of any clip. */
  pulse(kind: 'attack' | 'hit' | 'cheer' | 'roar', at?: number) { this.proc.pulse(kind, at); }

  /** Brief flash toward a colour (hits, heals); fades by itself. */
  hit(color: THREE.ColorRepresentation, amount = 1) { this.flashColor.set(color); this.flash = Math.max(this.flash, amount); this.dirty = true; }
  setTint(color: THREE.ColorRepresentation | null, amount = 0.35) { if (color) this.tintColor.set(color); this.tint = color ? amount : 0; this.dirty = true; }
  setOpacity(a: number) { if (Math.abs(a - this.opacity) < 1e-3) return; this.opacity = a; this.dirty = true; }

  update(dt: number) {
    this.proc.undo();
    if (this.mixer) {
      // Fidgets: now and then, a relaxed idle plays one of the model's own idle variations.
      if (this.idleKind === 'default' && this.current === this.idleAction) {
        this.fidgetIn -= dt;
        if (this.fidgetIn <= 0) { this.fidgetIn = 8 + Math.random() * 9; this.act(Math.random() < 0.5 ? ['defaultidle01', 'defaultidle02'] : ['defaultidle02', 'defaultidle01'], { fade: 0.3 }); }
      }
      this.mixer.update(dt);
    }
    this.proc.update(dt);
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 3.2); this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = this.flash > 0;
    for (const [mat, b] of this.base) {
      const m = mat as THREE.MeshStandardMaterial;
      if (m.emissive && b.emissive) {
        m.emissive.copy(b.emissive).lerp(this.tintColor, this.tint).lerp(this.flashColor, this.flash * 0.85);
      } else if (m.color && b.color) {
        m.color.copy(b.color).lerp(this.tintColor, this.tint * 0.6).lerp(this.flashColor, this.flash * 0.6);
      }
      const fade = this.opacity < 0.999;
      if (m.transparent !== (fade || b.transparent)) { m.transparent = fade || b.transparent; m.needsUpdate = true; }
      m.opacity = b.opacity * this.opacity;
      m.depthWrite = !fade;
    }
  }

  dispose() {
    // Geometry and textures stay: they belong to the cached download that every instance shares.
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    for (const mat of this.model.materials) mat.dispose();
  }
}
