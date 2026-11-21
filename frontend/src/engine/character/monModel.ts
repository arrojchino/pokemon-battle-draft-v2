import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl, pokemonModel } from '../../assets.js';

/**
 * Runtime 3D Pokémon from the community Pokémon 3D API: Draco-compressed GLB with WebP textures, fetched
 * from GitHub when first needed and never bundled. Each species downloads once; every use gets its own
 * clone (skeleton and materials included), so flashes and fades never leak between instances.
 */

/** National Dex numbers the API has no model for (checked against its asset tree). They keep the artwork card. */
const MISSING = new Set([861, 977, 992, 1013]);
export const hasModel = (dex: number) => Number.isInteger(dex) && dex > 0 && dex <= 1025 && !MISSING.has(dex);

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

/** Download (once per species) and return a fresh instance about `height` tall. Rejects when the model is unavailable. */
export function loadMonModel(dex: number, height: number, onProgress?: (loaded: number, total: number) => void): Promise<MonModel> {
  let p = sources.get(dex);
  if (!p) {
    p = gltfLoader().loadAsync(pokemonModel(dex), e => onProgress?.(e.loaded, e.total || e.loaded)).then(g => ({ scene: g.scene, clips: g.animations }));
    sources.set(dex, p);
    p.catch(() => sources.delete(dex));
  }
  return p.then(src => instance(src, height));
}

function instance(src: Source, height: number): MonModel {
  const model = cloneSkinned(src.scene);
  const materials: THREE.Material[] = [];
  const own = new Map<THREE.Material, THREE.Material>();
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    // Skinned bounds follow the bind pose, not the animation: never cull them away.
    m.frustumCulled = false;
    const list = (Array.isArray(m.material) ? m.material : [m.material]).map(mat => {
      let c = own.get(mat);
      if (!c) { c = mat.clone(); own.set(mat, c); materials.push(c); }
      return c;
    });
    m.material = Array.isArray(m.material) ? list : list[0];
  });
  model.updateMatrixWorld(true);
  // Measure in the idle pose: some models (single-clip ones especially) have a bind pose far from how
  // they actually stand, which would throw the height and centre off.
  const pose = findClip(src.clips, ['defaultwait01_loop', 'battlewait01_loop']) ?? src.clips[0];
  if (pose) {
    const mx = new THREE.AnimationMixer(model);
    mx.clipAction(pose).play(); mx.update(0);
    model.updateMatrixWorld(true);
    mx.stopAllAction(); mx.uncacheRoot(model);
  }
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // Fit the height, but keep very wide or very long bodies (wings, serpents) inside the frame too.
  const s = height / Math.max(size.y, size.x * 0.8, size.z * 0.65, 1e-4);
  model.scale.multiplyScalar(s);
  model.position.multiplyScalar(s).add(new THREE.Vector3(-c.x * s, -box.min.y * s, -c.z * s));
  const root = new THREE.Group();
  root.add(model);
  return { root, clips: src.clips, height: size.y * s, radius: Math.max(size.x, size.z) * s * 0.5, materials };
}

/** First clip whose name ends with one of the Scarlet/Violet action names (defaultwait01_loop, glad01, attack01…). */
export function findClip(clips: THREE.AnimationClip[], names: readonly string[]): THREE.AnimationClip | null {
  for (const n of names) { const c = clips.find(x => x.name.endsWith(n)); if (c) return c; }
  return null;
}

type MatState = { color: THREE.Color | null; emissive: THREE.Color | null; opacity: number; transparent: boolean };

/**
 * One Pokémon body on stage: its own animation mixer (idle loop plus one-shot actions when the model has
 * Scarlet/Violet-style clips) and material effects (hit flash, status tint, fade). Effects touch the
 * materials only while they change.
 */
export class MonBody {
  readonly root: THREE.Group;
  readonly height: number;
  readonly radius: number;
  /** True when the model brings its own idle and action clips. */
  readonly animated: boolean;
  private mixer: THREE.AnimationMixer | null = null;
  private idleKind: 'default' | 'battle';
  private idleAction: THREE.AnimationAction | null = null;
  private current: THREE.AnimationAction | null = null;
  private base = new Map<THREE.Material, MatState>();
  private flash = 0; private flashColor = new THREE.Color('#ffffff');
  private tint = 0; private tintColor = new THREE.Color('#000000');
  private opacity = 1;
  private dirty = false;

  constructor(private model: MonModel, idle: 'default' | 'battle' = 'default') {
    this.root = model.root; this.height = model.height; this.radius = model.radius; this.idleKind = idle;
    const sv = !!findClip(model.clips, ['defaultwait01_loop', 'battlewait01_loop']);
    // Scarlet/Violet-style models bring idle and action clips; older single-clip models loop their one
    // clip as the idle (their bind pose is often not a standing pose).
    this.animated = sv || model.clips.length > 0;
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

  setIdle(kind: 'default' | 'battle') {
    this.idleKind = kind;
    if (!this.mixer) return;
    const clip = findClip(this.model.clips, kind === 'battle' ? ['battlewait01_loop', 'defaultwait01_loop'] : ['defaultwait01_loop', 'battlewait01_loop']) ?? this.model.clips[0];
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    if (next === this.idleAction) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.idleAction && this.current === this.idleAction) this.idleAction.crossFadeTo(next, 0.3, false);
    this.idleAction = next; if (!this.current || this.current === this.idleAction) this.current = next;
  }

  /** Play a one-shot clip by action name; returns its duration in seconds, or 0 when the model has none of them. */
  act(names: readonly string[], opts: { speed?: number; hold?: boolean } = {}): number {
    if (!this.mixer) return 0;
    const clip = findClip(this.model.clips, names);
    if (!clip) return 0;
    const a = this.mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = opts.speed ?? 1;
    a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, 0.15, false);
    this.current = a;
    (a as THREE.AnimationAction & { hold?: boolean }).hold = !!opts.hold;
    return clip.duration / (opts.speed ?? 1);
  }
  /** Loop a clip (a faint pose, for instance) until the next action. */
  loop(names: readonly string[]): boolean {
    if (!this.mixer) return false;
    const clip = findClip(this.model.clips, names);
    if (!clip) return false;
    const a = this.mixer.clipAction(clip);
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, 0.2, false);
    this.current = a;
    return true;
  }
  private backToIdle() {
    const cur = this.current as (THREE.AnimationAction & { hold?: boolean }) | null;
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
    this.setIdle(this.idleKind);
  }

  /** Brief flash toward a colour (hits, heals); fades by itself. */
  hit(color: THREE.ColorRepresentation, amount = 1) { this.flashColor.set(color); this.flash = Math.max(this.flash, amount); this.dirty = true; }
  setTint(color: THREE.ColorRepresentation | null, amount = 0.35) { if (color) this.tintColor.set(color); this.tint = color ? amount : 0; this.dirty = true; }
  setOpacity(a: number) { if (Math.abs(a - this.opacity) < 1e-3) return; this.opacity = a; this.dirty = true; }

  update(dt: number) {
    this.mixer?.update(dt);
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
