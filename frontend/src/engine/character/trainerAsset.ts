// Shared data for every plaza trainer, built once from the presenter VRM (VRoid AvatarSample_4, CC0).
//
// The VRM is downloaded and parsed once (through `Presenter.fetchVrm`), then baked into a compact form that
// every Trainer instance shares:
//  * one texture atlas (all colour maps, cropped to their used UV area, packed into 2048 px) and one RGBA tint
//    mask (outfit, accent, hair, legwear weights) at half resolution;
//  * three geometries: the body (skin, dress, shoes, both hair meshes) with and without the code-built cap,
//    and the face (opaque group + blended group, 41 morph targets for expressions);
//  * the bone hierarchy as plain data (instances build their own bones from it) and the inverse bind matrices;
//  * a pooled float texture for bone matrices: every instance writes its matrices into its own slice of one
//    shared DataTexture, so a new trainer adds no texture (the skinning shader reads at `boneOffset`).
// After baking, the parsed VRM is dropped; it is never rendered.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VRMExpressionMorphTargetBind, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { Presenter } from '../npc/Presenter.js';
import { hairHeightField } from '../npc/accessories.js';
import { flipV } from '../npc/rig.js';
import { buildTrainerCap, type CapSwatch } from './trainerCap.js';

export type ExprName = 'blink' | 'happy' | 'relaxed' | 'aa' | 'surprised';
export interface ExprBind { index: number; weight: number }

export interface TrainerAsset {
  /** Bone hierarchy in traversal order (parents first). Positions are rest local offsets (raw VRM 0.x frame). */
  bones: { name: string; parent: number; pos: THREE.Vector3 }[];
  boneInverses: THREE.Matrix4[];
  human: Partial<Record<VRMHumanBoneName, number>>;
  /** Rest local offsets per humanoid bone in body space (VRM 1.0 frame: face +z, left +x). */
  rest: Partial<Record<VRMHumanBoneName, THREE.Vector3>>;
  bodyGeo: THREE.BufferGeometry;
  bodyCapGeo: THREE.BufferGeometry;
  /** Outline shells: skin, dress and shoes only (VRoid hair has no outline), without and with the cap. */
  outlineGeo: THREE.BufferGeometry;
  outlineCapGeo: THREE.BufferGeometry;
  faceGeo: THREE.BufferGeometry;
  morphCount: number;
  expr: Record<ExprName, ExprBind[]>;
  atlas: THREE.DataTexture;
  mask: THREE.DataTexture;
  /** Mean linear luminance of the texels under each mask channel (outfit, accent, hair, legwear). */
  ref: THREE.Vector4;
  /** Model height (soles to hair top) and sole height, model metres. */
  rawHeight: number;
  floor: number;
  sphere: THREE.Sphere;
  /** Secondary chains (bone indices from root to tip). */
  hairChains: number[][];
  skirtSides: number[];
  bytes: number;
}

// ------------------------------------------------------------------ bone pool
const POOL_W = 256;            // texels per row (64 bones)
const POOL_CAP = 32;           // instances per pool texture

export class BonePool {
  readonly tex: THREE.DataTexture;
  readonly data: Float32Array;
  readonly stride: number;     // bones per slot
  private free: number[] = [];
  constructor(bonesPerInstance: number) {
    const rows = Math.ceil((bonesPerInstance * 4) / POOL_W);
    this.stride = (rows * POOL_W) / 4;
    this.data = new Float32Array(POOL_W * rows * POOL_CAP * 4);
    this.tex = new THREE.DataTexture(this.data, POOL_W, rows * POOL_CAP, THREE.RGBAFormat, THREE.FloatType);
    this.tex.name = 'TrainerBonePool';
    this.tex.needsUpdate = true;
    for (let i = POOL_CAP - 1; i >= 0; i--) this.free.push(i);
  }
  get full() { return this.free.length === 0; }
  take(): number { return this.free.pop()!; }
  give(slot: number) { this.free.push(slot); }
}
const pools: BonePool[] = [];
export function takeBoneSlot(bones: number): { pool: BonePool; slot: number } {
  let pool = pools.find(p => !p.full);
  if (!pool) { pool = new BonePool(bones); pools.push(pool); }
  return { pool, slot: pool.take() };
}

// ------------------------------------------------------------------ loading
let pending: Promise<TrainerAsset> | null = null;
export function loadTrainerAsset(): Promise<TrainerAsset> {
  pending ??= Presenter.fetchVrm().then(({ vrm, bytes }) => bake(vrm, bytes)).catch(err => { pending = null; throw err; });
  return pending;
}

const yieldFrame = () => new Promise<void>(r => setTimeout(r, 0));

type Kind = 'skin' | 'dress' | 'shoes' | 'hair' | 'ribbon' | 'face' | 'brow' | 'plain';
type Part = 'body' | 'faceOpaque' | 'faceAlpha';
interface MatInfo { key: string; part: Part; kind: Kind; order: number; prio: number }

function classify(name: string): MatInfo | null {
  const n = name.replace(/ \(Outline\)$/, '');
  const T: [RegExp, Part, Kind, number, number][] = [
    [/Body_00_SKIN/, 'body', 'skin', 0, 0.8],
    [/Tops_01_CLOTH/, 'body', 'dress', 1, 0.9],
    [/Shoes_01_CLOTH/, 'body', 'shoes', 2, 0.55],
    [/HairBack_00_HAIR/, 'body', 'hair', 3, 0.55],
    [/HAIR_03/, 'body', 'ribbon', 6, 0.5],
    [/HAIR_0[12]/, 'body', 'hair', 4, 0.75],
    [/Face_00_SKIN/, 'faceOpaque', 'face', 0, 1],
    [/FaceMouth/, 'faceOpaque', 'plain', 1, 0.55],
    [/EyeWhite/, 'faceOpaque', 'plain', 2, 0.5],
    [/EyeIris/, 'faceOpaque', 'plain', 3, 0.9],
    [/FaceEyeline/, 'faceAlpha', 'plain', 0, 0.75],
    [/FaceBrow/, 'faceAlpha', 'brow', 1, 0.55],
    [/EyeHighlight/, 'faceAlpha', 'plain', 2, 0.5],
    [/EyeExtra/, 'faceAlpha', 'plain', 3, 0.45],
    [/FaceEyelash/, 'faceAlpha', 'plain', 4, 0.75],
  ];
  for (const [re, part, kind, order, prio] of T) if (re.test(n)) return { key: n, part, kind, order, prio };
  return null;
}

interface Region { key: string; kind: Kind; img: CanvasImageSource; iw: number; ih: number; u0: number; v0: number; u1: number; v1: number; prio: number; x: number; y: number; w: number; h: number }

const ATLAS = 2048, GUTTER = 6;
/** Share of hair strand triangles kept by the distance LOD. */
export const FAR_HAIR = 0.5;

function pack(regions: Region[], extra: { w: number; h: number }): { x: number; y: number } | null {
  // shelf packing, tallest first, at the largest uniform scale that fits
  for (let s = 1; s > 0.3; s *= 0.94) {
    for (const r of regions) {
      r.w = Math.max(8, Math.round((r.u1 - r.u0) * r.iw * s * r.prio));
      r.h = Math.max(8, Math.round((r.v1 - r.v0) * r.ih * s * r.prio));
    }
    const items = [...regions].sort((a, b) => b.h - a.h);
    let x = 0, y = 0, shelf = 0, ok = true;
    for (const r of items) {
      if (x + r.w + GUTTER > ATLAS) { x = 0; y += shelf + GUTTER; shelf = 0; }
      if (y + r.h + GUTTER > ATLAS) { ok = false; break; }
      r.x = x + GUTTER / 2; r.y = y + GUTTER / 2;
      x += r.w + GUTTER; shelf = Math.max(shelf, r.h);
    }
    if (!ok) continue;
    // the cap swatches go after the last shelf (or at the end of it)
    if (x + extra.w + GUTTER <= ATLAS && y + extra.h + GUTTER <= ATLAS) return { x: x + GUTTER / 2, y: y + GUTTER / 2 };
    y += shelf + GUTTER;
    if (y + extra.h + GUTTER <= ATLAS) return { x: GUTTER / 2, y: y + GUTTER / 2 };
  }
  return null;
}

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb8 = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

async function bake(vrm: VRM, bytes: number): Promise<TrainerAsset> {
  const scene = vrm.scene;
  scene.updateMatrixWorld(true);
  // ---------------------------------------------------------------- bones
  const hips = vrm.humanoid.getRawBoneNode('hips');
  if (!hips) throw new Error('Trainer: VRM has no hips');
  let top: THREE.Object3D = hips;
  while (top.parent && top.parent !== scene) top = top.parent;
  const bones: TrainerAsset['bones'] = [];
  const index = new Map<THREE.Object3D, number>();
  const restWorld: THREE.Matrix4[] = [];
  const walk = (o: THREE.Object3D, parent: number) => {
    const i = bones.length;
    index.set(o, i);
    bones.push({ name: o.name, parent, pos: o.position.clone() });
    const local = new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);
    restWorld.push(parent < 0 ? local : new THREE.Matrix4().multiplyMatrices(restWorld[parent], local));
    for (const c of o.children) if (!(c as THREE.Mesh).isMesh) walk(c, i);
  };
  walk(top, -1);
  const boneInverses = restWorld.map(m => m.clone().invert());
  const human: TrainerAsset['human'] = {};
  const rest: TrainerAsset['rest'] = {};
  for (const n of Object.keys(vrm.humanoid.humanBones) as VRMHumanBoneName[]) {
    const node = vrm.humanoid.getRawBoneNode(n);
    const i = node ? index.get(node) : undefined;
    if (i === undefined || !node) continue;
    human[n] = i;
    rest[n] = flipV(node.position.clone());
  }

  // ---------------------------------------------------------------- primitives
  type Prim = { mesh: THREE.SkinnedMesh; info: MatInfo; mat: THREE.Material & { map?: THREE.Texture | null } };
  const prims: Prim[] = [];
  scene.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Prim['mat'];
    const info = classify(mat.name);
    if (info && mat.map) prims.push({ mesh: m, info, mat });
  });

  // used UV area per material
  const regions = new Map<string, Region>();
  for (const p of prims) {
    const uv = p.mesh.geometry.getAttribute('uv');
    const idx = p.mesh.geometry.getIndex();
    let r = regions.get(p.info.key);
    if (!r) {
      const img = p.mat.map!.image as CanvasImageSource & { width: number; height: number };
      r = { key: p.info.key, kind: p.info.kind, img, iw: img.width, ih: img.height, u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, prio: p.info.prio, x: 0, y: 0, w: 0, h: 0 };
      regions.set(p.info.key, r);
    }
    const n = idx ? idx.count : uv.count;
    for (let k = 0; k < n; k++) {
      const v = idx ? idx.getX(k) : k;
      const u = uv.getX(v), w = uv.getY(v);
      if (u < r.u0) r.u0 = u; if (u > r.u1) r.u1 = u;
      if (w < r.v0) r.v0 = w; if (w > r.v1) r.v1 = w;
    }
  }
  const regs = [...regions.values()];
  for (const r of regs) { r.u0 -= 2 / r.iw; r.v0 -= 2 / r.ih; r.u1 += 2 / r.iw; r.v1 += 2 / r.ih; }
  const SW = 12; // swatch size
  const capAt = pack(regs, { w: SW * 4 + 8, h: SW });
  if (!capAt) throw new Error('Trainer: atlas packing failed');

  // ---------------------------------------------------------------- atlas pixels
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  for (const r of regs) {
    const sx = r.w / ((r.u1 - r.u0) * r.iw), sy = r.h / ((r.v1 - r.v0) * r.ih);
    // the crop may run past the image edge (wrapped UVs): draw the tiled neighbours too, clipped to the slot
    for (const pad of [GUTTER / 2, 0]) {
      g.save();
      g.beginPath(); g.rect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad); g.clip();
      for (let ty = Math.floor(r.v0); ty <= Math.floor(r.v1); ty++) for (let tx = Math.floor(r.u0); tx <= Math.floor(r.u1); tx++) {
        const ox = r.x + (tx - r.u0) * r.iw * sx, oy = r.y + (ty - r.v0) * r.ih * sy;
        if (pad > 0) { // edge extension into the gutter: the slot drawn slightly larger
          g.drawImage(r.img, ox - pad, oy - pad, r.iw * sx + 2 * pad, r.ih * sy + 2 * pad);
        } else g.drawImage(r.img, ox, oy, r.iw * sx, r.ih * sy);
      }
      g.restore();
    }
  }
  await yieldFrame();
  const img = g.getImageData(0, 0, ATLAS, ATLAS);
  const px = img.data;
  canvas.width = canvas.height = 1;

  // ---------------------------------------------------------------- tint mask (half resolution) + references
  const M = ATLAS / 2;
  const mask = new Uint8Array(M * M * 4);
  const sum = [0, 0, 0, 0], wsum = [0, 0, 0, 0];
  for (const r of regs) {
    if (r.kind === 'face' || r.kind === 'plain') continue;
    const x0 = Math.floor(r.x / 2) - 1, y0 = Math.floor(r.y / 2) - 1, x1 = Math.ceil((r.x + r.w) / 2) + 1, y1 = Math.ceil((r.y + r.h) / 2) + 1;
    for (let y = Math.max(0, y0); y < Math.min(M, y1); y++) for (let x = Math.max(0, x0); x < Math.min(M, x1); x++) {
      // average the 2x2 atlas block so region edges stay anti-aliased in the half-size mask
      let o = 0, ac = 0, hr = 0, lg = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const k = ((y * 2 + sy) * ATLAS + x * 2 + sx) * 4;
        const a = px[k + 3] / 255;
        const R = px[k] / 255, G = px[k + 1] / 255, B = px[k + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
        const s = mx > 0 ? d / mx : 0;
        let h = 0;
        if (d > 1e-5) h = mx === R ? ((G - B) / d + 6) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
        h *= 60;
        const gold = smoothstep(0.3, 0.45, s) * (h > 22 && h < 70 && mx > 0.35 ? 1 : 0);
        let po = 0, pa = 0, ph = 0, pl = 0;
        switch (r.kind) {
          case 'dress': { const pink = smoothstep(0.15, 0.3, s); pa = (1 - gold) * pink; po = (1 - gold) * (1 - pink); break; }
          case 'shoes': pa = 1 - gold; break;
          case 'skin': { const skin = h >= 4 && h <= 45 && s > 0.1 && s < 0.62 ? 1 : 0; pl = (1 - skin) * (1 - gold); break; }
          case 'hair': ph = 1; break;
          case 'ribbon': po = 1; break;
          case 'brow': ph = 0.8; break;
          default: break;
        }
        o += po / 4; ac += pa / 4; hr += ph / 4; lg += pl / 4;
        if (a > 0.5) {
          const l = 0.2126 * srgbToLin(R) + 0.7152 * srgbToLin(G) + 0.0722 * srgbToLin(B);
          if (po > 0.5 && r.kind === 'dress') { sum[0] += l; wsum[0]++; }
          if (pa > 0.5) { sum[1] += l; wsum[1]++; }
          if (ph > 0.5) { sum[2] += l; wsum[2]++; }
          if (pl > 0.5) { sum[3] += l; wsum[3]++; }
        }
      }
      const m = (y * M + x) * 4;
      mask[m] = Math.round(o * 255); mask[m + 1] = Math.round(ac * 255); mask[m + 2] = Math.round(hr * 255); mask[m + 3] = Math.round(lg * 255);
    }
    await yieldFrame();
  }
  const ref = new THREE.Vector4(...[0, 1, 2, 3].map(c => (wsum[c] > 0 ? sum[c] / wsum[c] : 0.5)) as [number, number, number, number]);

  // cap swatches: crown (accent at the reference luminance), white panel, brim (darker accent), underside
  const swatch = (i: number, lin: number, rgbaMask: [number, number, number, number], keep?: [number, number, number]) => {
    const sx = capAt.x + i * (SW + 2), sy = capAt.y;
    const v = linToSrgb8(Math.min(1, lin));
    for (let y = sy - 1; y < sy + SW + 1; y++) for (let x = sx - 1; x < sx + SW + 1; x++) {
      const k = (y * ATLAS + x) * 4;
      px[k] = keep ? keep[0] : v; px[k + 1] = keep ? keep[1] : v; px[k + 2] = keep ? keep[2] : v; px[k + 3] = 255;
    }
    for (let y = Math.floor(sy / 2); y < Math.ceil((sy + SW) / 2); y++) for (let x = Math.floor(sx / 2); x < Math.ceil((sx + SW) / 2); x++) {
      const m = (y * M + x) * 4;
      mask[m] = rgbaMask[0]; mask[m + 1] = rgbaMask[1]; mask[m + 2] = rgbaMask[2]; mask[m + 3] = rgbaMask[3];
    }
    return { u: (sx + SW / 2) / ATLAS, v: (sy + SW / 2) / ATLAS };
  };
  const sw: Record<CapSwatch, { u: number; v: number }> = {
    crown: swatch(0, ref.y, [0, 255, 0, 0]),
    panel: swatch(1, 1, [0, 0, 0, 0], [246, 246, 248]),
    brim: swatch(2, ref.y * 0.62, [0, 255, 0, 0]),
    under: swatch(3, 1, [0, 0, 0, 0], [52, 54, 66]),
  };

  // bleed colour into fully transparent texels of cut-out parts so filtered edges do not turn dark
  for (const r of regs) {
    if (r.kind !== 'hair' && r.kind !== 'ribbon' && r.kind !== 'dress') continue;
    const x0 = Math.max(1, r.x - 3), y0 = Math.max(1, r.y - 3), x1 = Math.min(ATLAS - 1, r.x + r.w + 3), y1 = Math.min(ATLAS - 1, r.y + r.h + 3);
    const OFF = [-4, 4, -ATLAS * 4, ATLAS * 4];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * ATLAS + x) * 4;
      if (px[k + 3] > 8) continue;
      let n = 0, rr = 0, gg = 0, bb = 0;
      for (const o of OFF) { const q = k + o; if (px[q + 3] > 8) { rr += px[q]; gg += px[q + 1]; bb += px[q + 2]; n++; } }
      if (n) { px[k] = rr / n; px[k + 1] = gg / n; px[k + 2] = bb / n; }
    }
    await yieldFrame();
  }

  const atlas = new THREE.DataTexture(new Uint8Array(px.buffer, px.byteOffset, px.byteLength), ATLAS, ATLAS, THREE.RGBAFormat);
  atlas.name = 'TrainerAtlas';
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  atlas.anisotropy = 4;
  atlas.flipY = false;
  atlas.needsUpdate = true;
  const maskTex = new THREE.DataTexture(mask, M, M, THREE.RGBAFormat);
  maskTex.name = 'TrainerTintMask';
  maskTex.generateMipmaps = true;
  maskTex.minFilter = THREE.LinearMipmapLinearFilter; maskTex.magFilter = THREE.LinearFilter;
  maskTex.flipY = false;
  maskTex.needsUpdate = true;

  // ---------------------------------------------------------------- geometry
  const remapGeo = (p: Prim, morphN = 0): THREE.BufferGeometry => {
    const src = p.mesh.geometry;
    const r = regions.get(p.info.key)!;
    const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), uv = src.getAttribute('uv');
    const si = src.getAttribute('skinIndex'), sw2 = src.getAttribute('skinWeight');
    const n = pos.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), SI = new Uint16Array(n * 4), SWt = new Float32Array(n * 4);
    const sk = p.mesh.skeleton.bones;
    for (let i = 0; i < n; i++) {
      P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
      N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i);
      U[i * 2] = (r.x + ((uv.getX(i) - r.u0) / (r.u1 - r.u0)) * r.w) / ATLAS;
      U[i * 2 + 1] = (r.y + ((uv.getY(i) - r.v0) / (r.v1 - r.v0)) * r.h) / ATLAS;
      for (let c = 0; c < 4; c++) {
        const b = sk[si.getComponent(i, c)];
        SI[i * 4 + c] = (b && index.get(b)) ?? 0;
        SWt[i * 4 + c] = sw2.getComponent(i, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SWt, 4));
    const idx = src.getIndex();
    geo.setIndex(idx ? new THREE.BufferAttribute(Uint32Array.from(idx.array as ArrayLike<number>), 1) : null);
    if (src.morphAttributes.position) {
      geo.morphAttributes.position = src.morphAttributes.position.map(a => new THREE.BufferAttribute(Float32Array.from({ length: a.count * 3 }, (_, k) => a.getComponent(Math.floor(k / 3), k % 3)), 3));
      geo.morphTargetsRelative = src.morphTargetsRelative;
    } else if (morphN > 0) {
      // a face primitive without shapes still has to merge with the others: give it zero targets
      geo.morphAttributes.position = Array.from({ length: morphN }, () => new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.morphTargetsRelative = true;
    }
    return geo;
  };
  const byPart = (part: Part) => prims.filter(p => p.info.part === part).sort((a, b) => a.info.order - b.info.order);
  // body order: outlined shell (skin, dress, shoes), back hair, [cap], hair strands. The shadow pass draws only
  // up to the strands (`userData.shadowCount`): a 1 m figure's shadow does not need 18k hair triangles.
  const bodySrc = byPart('body');
  const shellParts = bodySrc.filter(p => p.info.kind !== 'hair' && p.info.kind !== 'ribbon').map(p => remapGeo(p));
  const backParts = bodySrc.filter(p => /HairBack/.test(p.info.key)).map(p => remapGeo(p));
  // strands sorted big first: the distance LOD draws only the leading ones (`userData.farCount`)
  const strandParts = bodySrc.filter(p => (p.info.kind === 'hair' || p.info.kind === 'ribbon') && !/HairBack/.test(p.info.key)).map(p => remapGeo(p))
    .sort((a, b) => b.getIndex()!.count - a.getIndex()!.count);
  const strandTotal = strandParts.reduce((n, x) => n + x.getIndex()!.count, 0);
  let farStrands = 0, farStrandCount = 0;
  while (farStrands < strandParts.length && farStrandCount < strandTotal * FAR_HAIR) farStrandCount += strandParts[farStrands++].getIndex()!.count;
  const bodyParts = [...shellParts, ...backParts, ...strandParts];
  const idxCount = (gs: THREE.BufferGeometry[]) => gs.reduce((n, x) => n + x.getIndex()!.count, 0);
  const bodyGeo = mergeGeometries(bodyParts, false)!;
  bodyGeo.userData.shadowCount = idxCount([...shellParts, ...backParts]);
  bodyGeo.userData.farCount = bodyGeo.userData.shadowCount + farStrandCount;
  const outlineGeo = mergeGeometries(shellParts, false)!;
  const faceMorphs = Math.max(0, ...prims.filter(p => p.info.part !== 'body').map(p => p.mesh.geometry.morphAttributes.position?.length ?? 0));
  const fo = byPart('faceOpaque').map(p => remapGeo(p, faceMorphs)), fa = byPart('faceAlpha').map(p => remapGeo(p, faceMorphs));
  const faceGeo = mergeGeometries([...fo, ...fa], true)!;
  const opaqueCount = fo.reduce((s, x) => s + x.getIndex()!.count, 0);
  faceGeo.clearGroups();
  faceGeo.addGroup(0, opaqueCount, 0);
  faceGeo.addGroup(opaqueCount, faceGeo.getIndex()!.count - opaqueCount, 1);
  [...fo, ...fa].forEach(x => x.dispose());
  const morphCount = faceGeo.morphAttributes.position?.length ?? 0;

  bodyGeo.computeBoundingBox();
  const bb = bodyGeo.boundingBox!;
  const floor = bb.min.y;
  const rawHeight = bb.max.y - floor;

  // cap, fitted to the hair (head-local body space), skinned to the head bone
  const headIdx = human.head!;
  const headModel = new THREE.Vector3().setFromMatrixPosition(restWorld[headIdx]);   // raw frame
  const hairMeshes = prims.filter(p => p.info.kind === 'hair').map(p => p.mesh as THREE.Mesh);
  const field = hairHeightField(hairMeshes, flipV(headModel.clone()), true);
  const capGeo = buildTrainerCap(field, sw, headModel, headIdx);
  const bodyCapGeo = mergeGeometries([...shellParts, ...backParts, capGeo, ...strandParts], false)!;
  bodyCapGeo.userData.shadowCount = idxCount([...shellParts, ...backParts, capGeo]);
  bodyCapGeo.userData.farCount = bodyCapGeo.userData.shadowCount + farStrandCount;
  const outlineCapGeo = mergeGeometries([outlineGeo, capGeo], false)!;
  capGeo.dispose();
  bodyParts.forEach(x => x.dispose());

  // expressions
  const expr = { blink: [], happy: [], relaxed: [], aa: [], surprised: [] } as Record<ExprName, ExprBind[]>;
  const em = vrm.expressionManager;
  for (const name of Object.keys(expr) as ExprName[]) {
    const e = em?.getExpression(name);
    if (!e) continue;
    const seen = new Set<number>();
    for (const b of e.binds) if (b instanceof VRMExpressionMorphTargetBind && !seen.has(b.index)) { seen.add(b.index); expr[name].push({ index: b.index, weight: b.weight }); }
  }

  // secondary chains
  const children = (i: number) => bones.map((b, k) => (b.parent === i ? k : -1)).filter(k => k >= 0);
  const chainFrom = (i: number) => { const c = [i]; let k = i; for (;;) { const ch = children(k); if (ch.length !== 1) break; k = ch[0]; c.push(k); } return c; };
  const hairChains = children(headIdx).filter(k => /HairJoint/.test(bones[k].name)).map(chainFrom);
  const skirtSides = bones.map((b, k) => (/SkirtSide1$/.test(b.name) ? k : -1)).filter(k => k >= 0);

  // drop the parsed model (it was never rendered, so nothing reached the GPU)
  for (const p of prims) {
    const map = p.mat.map;
    const im = map?.image as { close?: () => void } | undefined;
    im?.close?.();
  }
  scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });

  const center = new THREE.Vector3(0, floor + rawHeight * 0.5, 0);
  return {
    bones, boneInverses, human, rest, bodyGeo, bodyCapGeo, outlineGeo, outlineCapGeo, faceGeo, morphCount, expr, atlas, mask: maskTex, ref,
    rawHeight, floor, sphere: new THREE.Sphere(center, rawHeight * 0.75), hairChains, skirtSides, bytes,
  };
}
