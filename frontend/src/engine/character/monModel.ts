import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl, pokemonModel } from '../../assets.js';
import { ProceduralRig } from './procedural.js';
import { loadHome, layerOf, flameOf, flameMaterial, type Blink } from './home.js';

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

export type Plan = {
  folder?: string;
  /** model = Pokémon 3D API (default); home = the Pokémon HOME export (home.ts); art = official artwork. */
  use?: 'model' | 'home' | 'art';
  metal?: RegExp;
  /** Stray meshes to drop (effect geometry left in the file). */
  hide?: RegExp;
};
/**
 * Per-species decisions from the asset audit (docs/ASSET_AUDIT.md). `art` = no usable model, so the
 * Pokémon is shown as its official artwork instead.
 */
export const PLAN: Record<number, Plan> = {
  911: { hide: /^Object_21[02]$/ },   // Skeledirge: a stray effect strip props it up, its song bird lies loose on the floor
};
/** Species shown with their Pokémon HOME model (home.ts): authored idle, attack and roar clips, blinking eyes. */
const FROM_HOME = [
  861, 977, 992, 1013, // not in the Pokémon 3D API
  1000, 497, 914, // broken there: props shown apart (Gholdengo), a straight pole (Serperior), a collapsed body (Quaquaval)
  10009, // Rotom-Wash: the API only has the base form
  445, 94, 635, 823, 908, 959, 980, 858, 478, 184, 36, 1006, 286, 925, 637, 748, 778, 132, 302, // static or rigless there
  998, 887, 212, 903, 923, // one to four clips there
  // Expanded pool: HOME for one consistent look (authored idle, physical and special clips, blinking eyes).
  // Dragonite (149) and Greninja (658) keep their grade-A API models.
  472, 145, 146, 491, 646, 1021, 994, 1003, 815, 730, 812, 889, 905, 1025, 1017, 1023, 901, 1005, 485, 381, 647, 1014, 461, 1019, 227, 920, 988, 530, 248, 199, 376, 373, 534, 630, 966, 989, 638, 423, 282, 197, 130, 473, 663, 450, 462, 715, 395, 553, 936, 245, 639, 591, 579, 385, 609, 700, 392, 260, 123, 474,
];
for (const dex of FROM_HOME) PLAN[dex] = { ...PLAN[dex], use: 'home' };
/** National Dex numbers use the API unless planned otherwise; alternate forms (artwork ids above 1025) need a plan. */
export const hasModel = (dex: number) =>
  Number.isInteger(dex) && dex > 0 && (dex <= 1025 ? PLAN[dex]?.use !== 'art' : PLAN[dex]?.use === 'home');

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

type Source = { scene: THREE.Object3D; clips: THREE.AnimationClip[]; blink?: Blink };
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
  /** Eye-texture blink (HOME models). */
  blink?: Blink;
  /** Ground speed of the walk loop at normal playback, units per second (from its root motion); null when unknown. */
  walkSpeed?: number | null;
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
  if (!p && PLAN[dex]?.use === 'home') {
    p = loadHome(dex, onProgress);
    sources.set(dex, p);
    p.catch(() => sources.delete(dex));
  }
  if (!p) {
    p = gltfLoader().loadAsync(pokemonModel(dex, PLAN[dex]?.folder), e => onProgress?.(e.loaded, e.total || e.loaded)).then(g => {
      // Once per download: every instance shares this geometry and these clips.
      // The game's lower levels of detail ship as extra meshes that z-fight with the full one, and a few
      // files carry stray effect geometry: drop both.
      const lods: THREE.Object3D[] = [];
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (/_lod[1-9]$/i.test(o.name) || PLAN[dex]?.hide?.test(o.name)) lods.push(o);
        else if (!m.geometry.attributes.normal) smoothNormals(m.geometry);
      });
      for (const o of lods) o.removeFromParent();
      // Bone tracks stored with step interpolation stutter at their key rate: rotations and positions
      // become linear (scale stays stepped, since some models use it to swap eyes and mouths).
      for (const clip of g.animations) for (const t of clip.tracks) {
        if (t.getInterpolation() === THREE.InterpolateDiscrete && /[.](quaternion|position)$/.test(t.name)) t.setInterpolation(THREE.InterpolateLinear);
      }
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

function upgradeMaterial(src: THREE.Material, metal: RegExp | undefined): THREE.Material {
  const flame = flameOf.get(src);
  if (flame) return flameMaterial(flame, src.name);
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
  if (/uniran/i.test(src.name) && m.map) {
    // HOME's gel and glass shader (Reuniclus' cell, Chandelure's lamp, Kyurem's ice): see-through for real.
    m.transparent = true; m.depthWrite = false; m.alphaTest = 0;
  } else if ((m.transparent || m.alphaTest > 0) && m.opacity >= 0.99 && !/(fire|flame|effect|glow|aura|smoke|ghost)/i.test(src.name)) {
    const cut = m.map ? alphaKind(m.map) === 'cutout' : false;
    m.transparent = false; m.depthWrite = true;
    m.alphaTest = cut ? 0.5 : 0; m.alphaToCoverage = cut;
  }
  if (m.map) m.map.anisotropy = 8;
  // glTF asks for flat shading when a mesh has no normals; preloadMon has given every such mesh smooth ones.
  m.flatShading = false;
  // A second texture layer (an eye's iris) shows wherever the main texture is transparent.
  const layer = layerOf.get(src);
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = MON_RIM.color; shader.uniforms.uRimStrength = MON_RIM.strength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength;')
      .replace('#include <opaque_fragment>', 'outgoingLight += uRimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * uRimStrength;\n#include <opaque_fragment>');
    if (layer && m.map) {
      shader.uniforms.uLayer = { value: layer }; shader.uniforms.uLayerM = { value: layer.matrix };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat3 uLayerM; varying vec2 vLayerUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayerUv = (uLayerM * vec3(uv, 1.0)).xy;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uLayer; varying vec2 vLayerUv;')
        .replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vMapUv);\nvec4 layerColor = texture2D(uLayer, vLayerUv);\nsampledDiffuseColor = vec4(mix(layerColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a), max(sampledDiffuseColor.a, layerColor.a));\ndiffuseColor *= sampledDiffuseColor;');
    }
  };
  m.customProgramCacheKey = () => (layer ? 'mon-rim-layer' : 'mon-rim');
  return m;
}

function instance(src: Source, height: number, metal?: RegExp): MonModel {
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
      if (!c) { c = upgradeMaterial(mat, metal); own.set(mat, c); materials.push(c); }
      return c;
    });
    m.material = Array.isArray(m.material) ? list : list[0];
    if (list.some(x => x.userData.flame)) m.castShadow = false;
  });
  model.updateMatrixWorld(true);
  // Measure in the idle pose: some models (single-clip ones especially) have a bind pose far from how
  // they actually stand, which would throw the height and centre off. The relaxed idle comes first: it is
  // how a Pokémon stands (Pokédex height), while some battle stances crouch low (Greninja is ~1.6x
  // taller standing, so fitting its crouch made the standing partner far too big).
  // Only what shows in that pose counts (HOME models hide their props until an attack brings them out).
  // Measure before the mixer stops: stopping restores the bind pose.
  const pose = findClip(src.clips, ['defaultwait01_loop', 'battlewait01_loop']) ?? src.clips[0];
  let box: THREE.Box3;
  if (pose) {
    const mx = new THREE.AnimationMixer(model);
    // A little into the loop: frame 0 can still show props the clip hides one frame later.
    mx.clipAction(pose).play(); mx.update(Math.min(0.5, pose.duration / 2));
    box = visibleBox(model);
    mx.stopAllAction(); mx.uncacheRoot(model);
  } else box = visibleBox(model);
  measureStrikes(model, src.clips);
  const pace = measureStride(model, src.clips);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // Fit the height; wide (wings) and long (tails, serpents) bodies may extend further before they shrink.
  const s = height / Math.max(size.y, size.x / 2, size.z / 2, 1e-4);
  model.scale.multiplyScalar(s);
  model.position.multiplyScalar(s).add(new THREE.Vector3(-c.x * s, -box.min.y * s, -c.z * s));
  const root = new THREE.Group();
  root.add(model);
  return { root, clips: src.clips, height: size.y * s, radius: Math.max(size.x, size.z) * s * 0.5, materials, blink: src.blink, walkSpeed: pace ? pace * s : null };
}

/** Bounds of the meshes that are actually drawn (visible all the way up, with at least one visible material). */
function visibleBox(root: THREE.Object3D) {
  const box = new THREE.Box3(), part = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    if (!(Array.isArray(m.material) ? m.material : [m.material]).some(x => x.visible)) return;
    box.union(part.setFromObject(m, true));
  });
  return box.isEmpty() ? box.setFromObject(root, true) : box;
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

/**
 * Ground speed of each walk and run loop at normal playback (units per second, at the model's own scale), from
 * its root motion. These loops carry the origin bone forward through the cycle and jump it back when they loop,
 * so a partner walking on the spot slid ahead and snapped back every cycle. The drift comes out of the clip (it
 * loops seamlessly in place) and its length becomes the pace at which the feet keep their grip. Once per clip:
 * clips are shared by every instance of a species.
 */
const paces = new WeakMap<THREE.AnimationClip, number>();
function measureStride(model: THREE.Object3D, clips: THREE.AnimationClip[]): number | null {
  model.updateMatrixWorld(true);
  const scale = new THREE.Vector3();
  for (const clip of clips) {
    if (!/(walk01_loop|run01_loop)$/.test(clip.name) || paces.has(clip)) continue;
    let best: { track: THREE.KeyframeTrack; dx: number; dz: number } | null = null;
    for (const track of clip.tracks) {
      if (!track.name.endsWith('.position') || track.values.length < 6) continue;
      const v = track.values, n = v.length / 3;
      const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
      if (!best || Math.hypot(dx, dz) > Math.hypot(best.dx, best.dz)) best = { track, dx, dz };
    }
    if (!best || Math.hypot(best.dx, best.dz) < 1e-4) { paces.set(clip, 0); continue; }
    // The drift is in the bone's parent space, which may be scaled.
    const bone = model.getObjectByName(best.track.name.slice(0, best.track.name.lastIndexOf('.')));
    if (bone?.parent) bone.parent.getWorldScale(scale); else scale.set(1, 1, 1);
    paces.set(clip, Math.hypot(best.dx * scale.x, best.dz * scale.z) / Math.max(1e-3, clip.duration));
    const { times, values } = best.track, t0 = times[0], span = Math.max(1e-6, times[times.length - 1] - t0);
    for (let i = 0; i < times.length; i++) {
      const k = (times[i] - t0) / span;
      values[i * 3] -= best.dx * k; values[i * 3 + 2] -= best.dz * k;
    }
  }
  const walk = findClip(clips, ['walk01_loop', 'run01_loop']);
  return walk ? paces.get(walk) || null : null;
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

type MatState = { color: THREE.Color | null; emissive: THREE.Color | null; opacity: number; transparent: boolean; depthWrite: boolean };
type Act = THREE.AnimationAction & { hold?: boolean };
/** Idle stance: relaxed, battle-ready, asleep, or resting (sitting). */
export type Posture = 'default' | 'battle' | 'sleep' | 'rest';
/**
 * Fade an action's weight from `from` to `to` over `d` seconds. three's fadeIn and fadeOut always start from 0
 * and 1, so cutting one blend short with another (stopping, then walking again at once) made the pose jump.
 */
function fadeWeight(a: THREE.AnimationAction, from: number, to: number, d: number) {
  a.weight = 1;
  (a as unknown as { _scheduleFading(d: number, from: number, to: number): void })._scheduleFading(Math.max(1e-3, d), from, to);
}

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
  /** Ground speed of the walk loop at normal playback (units per second), or null when unknown. */
  readonly walkSpeed: number | null;
  /** Actions that may still carry weight, so each new blend fades every one of them from where it is. */
  private live = new Set<Act>();
  private mixer: THREE.AnimationMixer | null = null;
  private idleKind: Posture;
  private idleAction: THREE.AnimationAction | null = null;
  private current: Act | null = null;
  private fidgetIn = 6 + Math.random() * 6;
  private base = new Map<THREE.Material, MatState>();
  private flash = 0; private flashColor = new THREE.Color('#ffffff');
  private tint = 0; private tintColor = new THREE.Color('#000000');
  private opacity = 1;
  private dirty = false;
  /** HOME eye blink: each eye's texture (this instance's own copy) and its UV offset at rest. */
  private eyes: { tex: THREE.Texture; x: number; y: number }[] = [];
  private blinkIn = 1 + Math.random() * 3;
  private blinkAt = -1;
  private eyeFrame = -1;

  constructor(private model: MonModel, idle: 'default' | 'battle' = 'default') {
    this.root = model.root; this.height = model.height; this.radius = model.radius; this.idleKind = idle;
    this.walkSpeed = model.walkSpeed ?? null;
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
      this.base.set(mat, { color: m.color ? m.color.clone() : null, emissive: m.emissive ? m.emissive.clone() : null, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
      if (m.map && model.blink?.eyes.includes(m.name.slice(m.name.indexOf('-') + 1))) {
        m.map = m.map.clone();
        this.eyes.push({ tex: m.map, x: m.map.offset.x, y: m.map.offset.y });
      }
    }
  }

  /** Blink now and then (open, half, shut, half, open); eyes stay shut while asleep. */
  private updateEyes(dt: number) {
    const b = this.model.blink!;
    let k = 0; // 0 open, 1 half, 2 shut
    if (this.proc.drowsy) k = 2;
    else if (this.blinkAt >= 0) {
      this.blinkAt += dt;
      const f = Math.floor(this.blinkAt * 30);
      k = f === 0 || f === 3 ? 1 : f < 3 ? 2 : 0;
      if (f > 3) { this.blinkAt = -1; this.blinkIn = 1.8 + Math.random() * 4.5; }
    } else if ((this.blinkIn -= dt) <= 0) this.blinkAt = 0;
    if (k === this.eyeFrame) return;
    this.eyeFrame = k;
    const [du, dv] = k === 0 ? [0, 0] : k === 1 ? b.half : b.shut;
    // Unity UV moves; the GLB's UVs are flipped vertically, so v moves the other way.
    for (const e of this.eyes) e.tex.offset.set(e.x + du, e.y - dv);
  }

  private idleClip(kind: Posture) {
    const c = this.model.clips;
    if (kind === 'sleep') return findClip(c, ['sleep01_loop']);
    if (kind === 'rest') return findClip(c, ['rest01_loop']);
    return findClip(c, kind === 'battle' ? ['battlewait01_loop', 'defaultwait01_loop'] : ['defaultwait01_loop', 'battlewait01_loop']) ?? c[0] ?? null;
  }

  /**
   * Idle stance: relaxed, battle-ready, asleep or resting (models with a sleep loop; others droop procedurally;
   * resting needs the model's own sitting loop). Returns false when the model cannot take that stance.
   */
  setIdle(kind: Posture): boolean {
    const was = this.idleKind;
    if (kind === 'rest' && !this.idleClip('rest')) return false;
    this.idleKind = kind;
    this.proc.drowsy = kind === 'sleep';
    if (!this.mixer) return true;
    const clip = this.idleClip(kind) ?? this.idleClip('battle');
    if (!clip) return false;
    const next = this.mixer.clipAction(clip) as Act;
    if (next === this.idleAction) return true;
    // Lying down, sitting down and getting up play their own transition clips first when the model has them.
    const c = this.model.clips;
    const into = kind === 'sleep' ? findClip(c, ['sleep01_start']) : kind === 'rest' ? findClip(c, ['rest01_start'])
      : was === 'sleep' ? findClip(c, ['sleep01_end']) : was === 'rest' ? findClip(c, ['rest01_end']) : null;
    next.setLoop(THREE.LoopRepeat, Infinity);
    const prevIdle = this.idleAction;
    this.idleAction = next;
    if (into && this.current === prevIdle) { this.act([into.name], { fade: 0.25 }); return true; }
    if (!this.current || this.current === prevIdle) this.blend(next, 0.35, true);
    return true;
  }
  /** The stance the idle is in. */
  get posture(): Posture { return this.idleKind; }
  /** Length of the first of these clips the model has, in seconds (0 when none). */
  clipLength(names: readonly string[]) { return findClip(this.model.clips, names)?.duration ?? 0; }

  /** Play a one-shot clip by action name; returns its duration in seconds, or 0 when the model has none of them. */
  act(names: readonly string[], opts: { speed?: number; hold?: boolean; fade?: number } = {}): number {
    if (!this.mixer) return 0;
    const clip = findClip(this.model.clips, names);
    if (!clip) return 0;
    const a = this.mixer.clipAction(clip) as Act;
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = opts.speed ?? 1;
    this.blend(a, opts.fade ?? 0.15, true);
    a.hold = !!opts.hold;
    return clip.duration / (opts.speed ?? 1);
  }
  private gait: THREE.AnimationAction | null = null;
  private gaits: Record<'walk' | 'run', THREE.AnimationClip | null> | null = null;
  /**
   * Locomotion: loop the walk or run at a playback rate, or settle back into the idle (null). Starting to
   * move cuts a one-shot short (a fidget, an emote); stopping lets one finish first. Returns false when the
   * model has no such clip.
   */
  gaitTo(kind: 'walk' | 'run' | null, rate = 1): boolean {
    if (!this.mixer) return false;
    const c = this.model.clips;
    this.gaits ??= { walk: findClip(c, ['walk01_loop', 'run01_loop']) ?? null, run: findClip(c, ['run01_loop', 'walk01_loop']) ?? null };
    const clip = kind ? this.gaits[kind] : null;
    if (kind && !clip) return false;
    const next = clip ? this.mixer.clipAction(clip) : null;
    if (next) next.timeScale = rate;
    if (next === this.gait) return true;
    const prev = this.gait;
    this.gait = next;
    const to = (next ?? this.idleAction) as Act | null;
    if (!to || (!next && this.current !== prev)) return true;
    to.setLoop(THREE.LoopRepeat, Infinity);
    to.timeScale = next ? rate : 1;
    // Walking again while the walk is still fading out picks it up where it is: no restart, no pop.
    this.blend(to, next ? 0.25 : 0.35, false);
    to.hold = false;
    return true;
  }
  /** Loop a clip until the next action. */
  loop(names: readonly string[]): boolean {
    if (!this.mixer) return false;
    const clip = findClip(this.model.clips, names);
    if (!clip) return false;
    const a = this.mixer.clipAction(clip) as Act;
    a.setLoop(THREE.LoopRepeat, Infinity);
    this.blend(a, 0.25, true);
    a.hold = true;
    return true;
  }
  has(names: readonly string[]) { return !!findClip(this.model.clips, names); }
  /**
   * Make `to` the playing action: every other action that still carries weight fades out from where it is while
   * `to` fades in from where it is, so the weights always add up and nothing pops. `fresh` starts it from its
   * first frame (one-shots); otherwise an action that is still fading out is picked back up where it is.
   */
  private blend(to: Act, d: number, fresh: boolean) {
    const w0 = to.isRunning() ? to.getEffectiveWeight() : 0;
    if (fresh || w0 < 0.01) to.reset();
    to.enabled = true; to.play();
    fadeWeight(to, w0, 1, d);
    for (const a of this.live) {
      if (a === to) continue;
      if (!a.enabled || !a.isScheduled()) { this.live.delete(a); continue; }
      fadeWeight(a, a.getEffectiveWeight(), 0, d);
    }
    this.live.add(to);
    this.current = to;
  }
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
    // While walking, a finished one-shot hands back to the walk instead of the idle.
    const base = (this.gait ?? this.idleAction) as Act | null;
    if (!base || !cur || cur === base || cur.hold) return;
    this.blend(base, 0.3, false);
  }

  /** Back to a clean idle: no held pose, tint, flash or fade (a revived Pokémon coming back, for instance). */
  reset() {
    this.flash = 0; this.tint = 0; this.opacity = 1; this.dirty = true;
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.current = null; this.idleAction = null; this.gait = null; this.live.clear();
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
    if (this.eyes.length) this.updateEyes(dt);
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
      m.depthWrite = !fade && b.depthWrite;
    }
  }

  dispose() {
    // Geometry and textures stay: they belong to the cached download that every instance shares.
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    for (const mat of this.model.materials) mat.dispose();
  }
}
