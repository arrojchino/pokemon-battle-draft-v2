import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOME, type HomeEntry, type HomeFlame, type HomeMat } from './homeManifest.js';

/**
 * Pokémon HOME models, for species the Pokémon 3D API lacks, ships broken, or only has as a static rig.
 * Mesh and skeleton come from a public GLB export of HOME; textures and animation clips (Unity YAML)
 * from a public Unity export of the same app. Both are fetched from GitHub when first needed and never
 * bundled: homeManifest.ts (built by scripts/home-manifest.py) records only file paths, texture
 * transforms and which clips exist.
 *
 * Unity is left-handed: positions mirror on x and rotations become (x, -y, -z, w), the conversion the GLB
 * export applied to the rest pose. Unity's Hermite curves are resampled at 30 fps. The GLB flipped its UVs
 * vertically, so Unity texture transforms are flipped the same way.
 */

const GLB_ROOT = 'https://raw.githubusercontent.com/Lilothestitch16/Pokemon-HOME-GLB-Models/main/';
const UNITY_ROOT = 'https://raw.githubusercontent.com/Lilothestitch16/Pokemon-HOME-Unity-Models/main/';
const url = (root: string, path: string) => root + path.split('/').map(encodeURIComponent).join('/');

export const hasHome = (dex: number) => !!HOME[dex];

/**
 * Eye blink. HOME eyes are texture atlases (2 columns x 4 rows of 0.25: open, half shut, shut, ...); a blink
 * moves the eye texture by whole cells. `eyes` lists the eye materials, `cells` the Unity-space UV moves.
 */
export type Blink = { eyes: string[]; half: [number, number]; shut: [number, number] };
export type HomeSource = { scene: THREE.Object3D; clips: THREE.AnimationClip[]; blink?: Blink };
/** Layer-1 texture of a material (an eye's iris, a decal): drawn where the main texture is transparent. */
export const layerOf = new WeakMap<THREE.Material, THREE.Texture>();

/** A flame shell (Moltres' wings and crest, Infernape's head): mask, flicker noise, upward scroll. */
export type Flame = { mask: THREE.Texture; noise: THREE.Texture; core: boolean; scroll: number };
export const flameOf = new WeakMap<THREE.Material, Flame>();
const FLAME_TIME = { value: 0 };

/**
 * Additive, flickering fire for a flame shell, one per model instance (tints and fades stay per instance).
 * The mask gives the silhouette, streaky noise scrolling upward gives the flicker, and the hottest parts
 * run from orange to pale yellow.
 */
export function flameMaterial(f: Flame, name: string): THREE.Material {
  // Additive colour that leaves destination alpha alone, so dim flame never darkens a transparent canvas.
  // Cores are strips of scrolling noise: their long edges fade so no rectangle shows.
  const m = new THREE.MeshBasicMaterial({
    name, map: f.mask, color: f.core ? '#ffa640' : '#ff5a14', transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, side: THREE.DoubleSide, toneMapped: false,
  });
  m.userData.flame = true;
  m.onBeforeCompile = s => {
    s.uniforms.uTime = FLAME_TIME; s.uniforms.uNoise = { value: f.noise };
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform sampler2D uNoise;')
      .replace('#include <map_fragment>', `
        float base = texture2D(map, vMapUv + vec2(0.0, uTime * ${f.scroll.toFixed(2)})).r;
        float flick = texture2D(uNoise, vMapUv * 0.6 + vec2(0.17, uTime * 0.85)).r;
        float heat = base * (0.35 + 0.95 * flick);
        ${f.core ? 'heat *= smoothstep(0.0, 0.3, vMapUv.y) * smoothstep(1.0, 0.65, vMapUv.y);' : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.92, 0.66), smoothstep(0.5, 1.1, heat)) * heat * ${f.core ? '1.1' : '1.5'};
        diffuseColor.a = 1.0;`);
  };
  m.customProgramCacheKey = () => `home-flame-${f.core ? 'c' : 'm'}-${f.scroll.toFixed(2)}`;
  m.onBeforeRender = () => { FLAME_TIME.value = performance.now() / 1000; };
  return m;
}

// ---------------------------------------------------------------------------------------------------
// Unity AnimationClip (YAML) reader

type Key = { t: number; v: number[]; i: number[]; o: number[] };
type Curve = { kind: 'r' | 'e' | 'p' | 's'; node: string; keys: Key[] };
const SECTION: Record<string, Curve['kind']> = { m_RotationCurves: 'r', m_EulerCurves: 'e', m_PositionCurves: 'p', m_ScaleCurves: 's' };
const NUM = /[xyzw]: (-?(?:Infinity|\d*\.?\d+(?:[eE][-+]?\d+)?))/g; // Unity writes 1.5E-07
const vec = (s: string) => Array.from(s.matchAll(NUM), m => parseFloat(m[1]));

export function parseUnityAnim(text: string): { curves: Curve[]; stop: number } {
  const curves: Curve[] = [];
  let kind: Curve['kind'] | null = null, keys: Key[] = [], key: Key | null = null, stop = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('  m_')) { kind = SECTION[line.slice(2, line.indexOf(':'))] ?? null; continue; }
    if (line.startsWith('    m_StopTime: ')) { stop = parseFloat(line.slice(16)); continue; }
    if (!kind) continue;
    const s = line.trimStart();
    if (s.startsWith('time: ')) { key = { t: parseFloat(s.slice(6)), v: [], i: [], o: [] }; keys.push(key); }
    else if (!key) continue;
    else if (s.startsWith('value: ')) key.v = vec(s);
    else if (s.startsWith('inSlope: ')) key.i = vec(s);
    else if (s.startsWith('outSlope: ')) key.o = vec(s);
    else if (s.startsWith('path: ')) {
      const path = s.slice(6).trim();
      if (keys.length) curves.push({ kind, node: path.slice(path.lastIndexOf('/') + 1), keys });
      keys = []; key = null;
    }
  }
  return { curves, stop };
}

/** Unity's curve evaluation: cubic Hermite between keys, stepped where a tangent is infinite. */
function sampleKeys(keys: Key[], t: number, seg: { i: number }, out: number[]) {
  const n = keys.length, dims = keys[0].v.length;
  if (n === 1 || t <= keys[0].t || t >= keys[n - 1].t) {
    const k = n === 1 || t <= keys[0].t ? keys[0] : keys[n - 1];
    for (let c = 0; c < dims; c++) out[c] = k.v[c];
    return;
  }
  let i = keys[seg.i].t > t ? 0 : seg.i;
  while (i < n - 2 && keys[i + 1].t <= t) i++;
  seg.i = i;
  const a = keys[i], b = keys[i + 1], dt = b.t - a.t;
  const s = dt > 1e-6 ? (t - a.t) / dt : 1, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 0; c < dims; c++) {
    const m0 = a.o[c] ?? 0, m1 = b.i[c] ?? 0;
    out[c] = Number.isFinite(m0) && Number.isFinite(m1) ? h00 * a.v[c] + h10 * dt * m0 + h01 * b.v[c] + h11 * dt * m1 : a.v[c];
  }
}

const FPS = 30;
const D2R = Math.PI / 180;
function sampleTimes(curves: Curve[], stop: number) {
  const dur = stop > 0 ? stop : Math.max(1 / FPS, ...curves.map(c => c.keys[c.keys.length - 1].t));
  const n = Math.max(2, Math.round(dur * FPS) + 1);
  const times = new Float32Array(n);
  for (let k = 0; k < n; k++) times[k] = (k / (n - 1)) * dur;
  return { dur, times };
}

/**
 * Bone clip in glTF space. Only nodes the model has are kept; quaternion curves win over Euler ones.
 * Helper nodes carry data in their position: CusAnimVis_* meshes are shown while x is non-zero (props such as
 * Gholdengo's coin board stay hidden in the battle clips), CusAnimMat_* drive material values (unused here).
 */
export function unityClip(name: string, text: string, nodes: Set<string>): THREE.AnimationClip {
  const { curves, stop } = parseUnityAnim(text);
  const { dur, times } = sampleTimes(curves, stop);
  const n = times.length;
  const quat = new Set(curves.filter(c => c.kind === 'r').map(c => c.node));
  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = [0, 0, 0, 0];
  for (const c of curves) {
    if (!nodes.has(c.node) || (c.kind === 'e' && quat.has(c.node)) || c.node.startsWith('CusAnimMat_')) continue;
    const seg = { i: 0 };
    if (c.node.startsWith('CusAnimVis_')) {
      if (c.kind !== 'p') continue;
      const on: boolean[] = [];
      for (let k = 0; k < n; k++) { sampleKeys(c.keys, times[k], seg, v); on.push(Math.abs(v[0]) > 1e-3); }
      tracks.push(new THREE.BooleanKeyframeTrack(`${c.node}.visible`, Array.from(times), on));
      continue;
    }
    if (c.kind === 'r' || c.kind === 'e') {
      const out = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) {
        sampleKeys(c.keys, times[k], seg, v);
        if (c.kind === 'r') q.set(v[0], v[1], v[2], v[3]).normalize();
        else q.setFromEuler(e.set(v[0] * D2R, v[1] * D2R, v[2] * D2R, 'YXZ')); // Unity applies z, then x, then y
        let x = q.x, y = -q.y, z = -q.z, w = q.w;
        const o = k * 4;
        if (k > 0 && x * out[o - 4] + y * out[o - 3] + z * out[o - 2] + w * out[o - 1] < 0) { x = -x; y = -y; z = -z; w = -w; }
        out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${c.node}.quaternion`, times, out));
    } else {
      const out = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        sampleKeys(c.keys, times[k], seg, v);
        out[k * 3] = c.kind === 'p' ? -v[0] : v[0]; out[k * 3 + 1] = v[1]; out[k * 3 + 2] = v[2];
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${c.node}.${c.kind === 'p' ? 'position' : 'scale'}`, times, out));
    }
  }
  return new THREE.AnimationClip(name, dur, tracks).optimize();
}

// ---------------------------------------------------------------------------------------------------
// Materials

const WRAP = [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping, THREE.MirroredRepeatWrapping] as const;
const images = new Map<string, Promise<THREE.Texture>>();
const texLoader = new THREE.TextureLoader().setCrossOrigin('anonymous');

function image(href: string) {
  let p = images.get(href);
  if (!p) { p = texLoader.loadAsync(href); images.set(href, p); p.catch(() => images.delete(href)); }
  return p;
}
/** A texture with a Unity transform (scale, offset, wrap), expressed in the GLB's flipped UV space. */
async function texture(href: string, rx: number, ry: number, ox: number, oy: number, wu: number, wv: number) {
  const t = (await image(href)).clone();
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.wrapS = WRAP[wu] ?? THREE.RepeatWrapping; t.wrapT = WRAP[wv] ?? THREE.RepeatWrapping;
  t.repeat.set(rx, ry); t.offset.set(ox, 1 - ry - oy);
  t.anisotropy = 8;
  t.needsUpdate = true;
  t.updateMatrix();
  return t;
}

async function material(src: THREE.Material, e: HomeMat | undefined, base: string, fx?: HomeFlame) {
  const m = new THREE.MeshStandardMaterial({ name: src.name, roughness: 0.62, metalness: 0 });
  if (!e && fx) {
    const [kind, mask, noise, scroll] = fx;
    const [mt, nt] = await Promise.all([mask, noise].map(f => texture(url(UNITY_ROOT, base + f), 1, 1, 0, 0, 0, 0)));
    flameOf.set(m, { mask: mt, noise: nt, core: kind === 'c', scroll });
    return m;
  }
  // Other untextured materials are effect geometry the app shows on demand (Rotom's plasma, glass): hidden.
  if (!e) { m.visible = false; return m; }
  const [file, rx, ry, ox, oy, wu, wv, cut, layer, lrx, lry, lox, loy] = e;
  m.map = await texture(url(UNITY_ROOT, base + file), rx, ry, ox, oy, wu, wv);
  if (cut) m.alphaTest = 0.5;
  // Eyes: the eye texture is transparent where the iris layer shows through.
  if (layer) layerOf.set(m, await texture(url(UNITY_ROOT, base + layer), lrx ?? 1, lry ?? 1, lox ?? 0, loy ?? 0, 0, 0));
  return m;
}

// ---------------------------------------------------------------------------------------------------

const gltf = new GLTFLoader().setCrossOrigin('anonymous');
const text = (href: string) => fetch(href).then(r => { if (!r.ok) throw new Error(`${r.status} ${href}`); return r.text(); });

/** Clip names follow the Scarlet/Violet ones the battle state machine looks for. */
const CLIP_NAMES = { w: 'home_battlewait01_loop', p: 'home_attack01', s: 'home_rangeattack01', r: 'home_roar01' } as const;
const CLIP_KEYS = ['w', 'p', 's', 'r'] as const;

export async function loadHome(dex: number, onProgress?: (loaded: number, total: number) => void): Promise<HomeSource> {
  const h: HomeEntry | undefined = HOME[dex];
  if (!h) throw new Error(`no HOME model for ${dex}`);
  const clipText = (name: string) => text(url(UNITY_ROOT, h.f + 'ac/' + name + '.anim'));
  const anims = Promise.all(CLIP_KEYS.map(k => (h.a[k] ? clipText(h.a[k]!).catch(() => null) : null)));
  const g = await gltf.loadAsync(url(GLB_ROOT, h.g), e => onProgress?.(e.loaded, e.total || e.loaded));
  const scene = g.scene;
  const nodes = new Set<string>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse(o => { nodes.add(o.name); if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // One material per source material, textured from the Unity export.
  const made = new Map<THREE.Material, Promise<THREE.Material>>();
  const short = (name: string) => name.slice(name.indexOf('-') + 1);
  for (const mesh of meshes) {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = await Promise.all(list.map(src => {
      let p = made.get(src);
      if (!p) { p = material(src, h.m[short(src.name)], h.f, h.x?.[short(src.name)]); made.set(src, p); }
      return p;
    }));
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
  }
  const texts = await anims;
  const clips = texts.flatMap((t, i) => (t ? [unityClip(CLIP_NAMES[CLIP_KEYS[i]], t, nodes)] : []));
  return { scene, clips, blink: h.b ? { eyes: h.b, half: [0, 0.75], shut: [0, 0.5] } : undefined };
}
