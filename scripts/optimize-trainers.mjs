// Offline optimizer for plaza trainer models (VRM 0.x / 1.0, GLB container).
//
//   cd scripts && npm install && node optimize-trainers.mjs            (sources from TRAINER_SRC, see below)
//
// For every model in MODELS it reads the downloaded source VRM, then
//  * strips every morph target no kept expression uses (the trainer drives blink, happy/joy, relaxed/fun, aa/a
//    and surprised only); the other expression groups lose their binds;
//  * downsizes textures (face parts to FACE_TEX, everything else to `tex`) with premultiplied box filtering,
//    re-encoding opaque ones as JPEG and the rest as PNG;
//  * rebuilds the binary chunk with only the data still referenced (unused accessors lose their bufferView,
//    which glTF reads as zeros and three.js never loads);
// and writes frontend/public/trainers/<id>.vrm. It fails when a result is over its size budget (BUDGET_KB).
// Sources and licenses: docs/ASSETS.md (Trainers). Source files are not kept in the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.TRAINER_SRC ?? 'C:/Users/Garza/pbd-wip/trainers/src';
const OUT = path.resolve(here, '../frontend/public/trainers');
const FACE_TEX = 512;
const JPEG_Q = 86;

const VROID = 'pixiv Inc. (VRoid Project)';
/** id, source file (relative to SRC), max texture size, size budget in KB, VRM meta title and author (ASCII). */
export const MODELS = [
  { id: 'shibu', src: 'avatarsample_d_0/AvatarSample_D.vrm', tex: 1024, budget: 4700, title: 'VRoid beta AvatarSample_1 (Sendagaya Shibu)', author: VROID },
  { id: 'vivi', src: 'avatarsample_e/AvatarSample_E.vrm', tex: 1024, budget: 4700, title: 'VRoid beta AvatarSample_2 (Vivi)', author: VROID },
  { id: 'vita', src: 'avatarsample_f/AvatarSample_F.vrm', tex: 1024, budget: 4700, title: 'VRoid beta AvatarSample_3 (Vita)', author: VROID },
  { id: 'hana', src: 'hairsample_female/HairSample_Female.vrm', tex: 1024, budget: 4700, title: 'VRoid HairSample_Female', author: VROID },
  { id: 'kai', src: 'hairsample_male/HairSample_Male.vrm', tex: 1024, budget: 4700, title: 'VRoid HairSample_Male', author: VROID },
  { id: 'kate', src: 'a_kate.vrm', tex: 512, budget: 600, title: '100Avatars 038 Kate', author: 'Polygonal Mind' },
  { id: 'kyle', src: 'a_kyle.vrm', tex: 512, budget: 600, title: '100Avatars 069 Kyle', author: 'Polygonal Mind' },
];

const KEEP_VRM0 = new Set(['blink', 'joy', 'fun', 'a', 'surprised']);
const KEEP_VRM1 = new Set(['blink', 'happy', 'relaxed', 'aa', 'surprised']);
const FACE_RE = /face|eye|brow|mouth|iris|highlight|lash/i;

// ------------------------------------------------------------------ GLB io
function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}
function writeGlb(json, bin) {
  const pad = (b, c) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), c)]) : b);
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), bn = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(bn.length, 0x004e4942), bn]);
}

// ------------------------------------------------------------------ images
function decode(buf, mime) {
  if (mime === 'image/jpeg') { const r = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }); return { w: r.width, h: r.height, d: r.data }; }
  const p = PNG.sync.read(buf); return { w: p.width, h: p.height, d: p.data };
}
/** Halve with a premultiplied 2x2 box until within `max`, then a final premultiplied area resample. */
function shrink(img, max) {
  let { w, h, d } = img;
  const resample = (nw, nh) => {
    const out = new Uint8Array(nw * nh * 4);
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const k = (yy * w + xx) * 4, al = d[k + 3] / 255;
        r += d[k] * al; g += d[k + 1] * al; b += d[k + 2] * al; a += al; n++;
      }
      const o = (y * nw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / n) * 255);
    }
    d = out; w = nw; h = nh;
  };
  while (Math.max(w, h) > max) {
    const f = Math.max(w, h) / max;
    if (f >= 2) resample(Math.max(1, w >> 1), Math.max(1, h >> 1));
    else resample(Math.max(1, Math.round(w / f)), Math.max(1, Math.round(h / f)));
  }
  return { w, h, d };
}
function encode(img) {
  let opaque = true;
  for (let i = 3; i < img.d.length; i += 4) if (img.d[i] < 250) { opaque = false; break; }
  if (opaque) return { mime: 'image/jpeg', buf: Buffer.from(jpeg.encode({ width: img.w, height: img.h, data: img.d }, JPEG_Q).data) };
  const p = new PNG({ width: img.w, height: img.h }); p.data = Buffer.from(img.d);
  return { mime: 'image/png', buf: PNG.sync.write(p, { colorType: 6, deflateLevel: 9 }) };
}

// ------------------------------------------------------------------ morph targets
function stripMorphs(json) {
  const keep = new Map();                                  // mesh index -> Set of kept target indices
  const add = (mesh, idx) => { if (!keep.has(mesh)) keep.set(mesh, new Set()); keep.get(mesh).add(idx); };
  const v0 = json.extensions?.VRM?.blendShapeMaster?.blendShapeGroups;
  const v1 = json.extensions?.VRMC_vrm?.expressions;
  const nodeMesh = n => json.nodes[n]?.mesh;
  if (v0) for (const g of v0) {
    const name = (g.presetName && g.presetName !== 'unknown' ? g.presetName : g.name ?? '').toLowerCase();
    if (KEEP_VRM0.has(name)) for (const b of g.binds ?? []) add(b.mesh, b.index);
  }
  if (v1) for (const [name, e] of Object.entries(v1.preset ?? {})) if (KEEP_VRM1.has(name)) for (const b of e.morphTargetBinds ?? []) add(nodeMesh(b.node), b.index);
  const remap = new Map();                                 // mesh -> Map(old -> new)
  let before = 0, after = 0;
  json.meshes.forEach((mesh, mi) => {
    const n = mesh.primitives[0]?.targets?.length ?? 0;
    if (!n) return;
    before += n;
    const ks = [...(keep.get(mi) ?? [])].filter(i => i < n).sort((a, b) => a - b);
    const m = new Map(ks.map((o, i) => [o, i]));
    remap.set(mi, m);
    after += ks.length;
    for (const p of mesh.primitives) { if (!p.targets) continue; p.targets = ks.map(i => p.targets[i]); if (!p.targets.length) delete p.targets; }
    if (mesh.weights) mesh.weights = ks.map(i => mesh.weights[i] ?? 0);
    if (mesh.extras?.targetNames) mesh.extras.targetNames = ks.map(i => mesh.extras.targetNames[i]);
    if (!ks.length) { delete mesh.weights; if (mesh.extras) delete mesh.extras.targetNames; }
  });
  if (v0) for (const g of v0) g.binds = (g.binds ?? []).filter(b => remap.get(b.mesh)?.has(b.index)).map(b => ({ ...b, index: remap.get(b.mesh).get(b.index) }));
  if (v1) for (const group of [v1.preset ?? {}, v1.custom ?? {}]) for (const e of Object.values(group)) {
    e.morphTargetBinds = (e.morphTargetBinds ?? []).filter(b => remap.get(nodeMesh(b.node))?.has(b.index)).map(b => ({ ...b, index: remap.get(nodeMesh(b.node)).get(b.index) }));
  }
  return { before, after };
}

// ------------------------------------------------------------------ rebuild binary
function rebuild(json, bin, newImages) {
  const usedAcc = new Set();
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    Object.values(p.attributes).forEach(a => usedAcc.add(a));
    if (p.indices !== undefined) usedAcc.add(p.indices);
    for (const t of p.targets ?? []) Object.values(t).forEach(a => usedAcc.add(a));
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
  for (const an of json.animations ?? []) for (const s of an.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }
  const views = [], parts = [];
  let off = 0;
  const push = (data, src) => {
    const view = { buffer: 0, byteOffset: off, byteLength: data.length };
    if (src?.byteStride) view.byteStride = src.byteStride;
    if (src?.target) view.target = src.target;
    parts.push(data); off += data.length;
    const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    views.push(view); return views.length - 1;
  };
  const viewMap = new Map();
  json.accessors.forEach((acc, i) => {
    if (acc.bufferView === undefined) return;
    if (!usedAcc.has(i)) { delete acc.bufferView; delete acc.byteOffset; return; }
    if (!viewMap.has(acc.bufferView)) {
      const v = json.bufferViews[acc.bufferView];
      viewMap.set(acc.bufferView, push(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), v));
    }
    acc.bufferView = viewMap.get(acc.bufferView);
  });
  (json.images ?? []).forEach((im, i) => {
    const n = newImages[i];
    im.bufferView = push(n.buf, null); im.mimeType = n.mime;
  });
  json.bufferViews = views;
  const out = Buffer.concat(parts);
  json.buffers = [{ byteLength: out.length }];
  return out;
}

// ------------------------------------------------------------------ main
function optimize(m) {
  const srcBuf = fs.readFileSync(path.join(SRC, m.src));
  const { json, bin } = readGlb(srcBuf);
  const morphs = stripMorphs(json);
  const images = (json.images ?? []).map(im => {
    const v = json.bufferViews[im.bufferView];
    const raw = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const img = decode(raw, im.mimeType);
    const max = FACE_RE.test(im.name ?? '') ? Math.min(FACE_TEX, m.tex) : m.tex;
    if (Math.max(img.w, img.h) <= 64) return { buf: Buffer.from(raw), mime: im.mimeType };
    const enc = encode(shrink(img, max));
    return enc.buf.length < raw.length ? enc : { buf: Buffer.from(raw), mime: im.mimeType };
  });
  const outBin = rebuild(json, bin, images);
  // ASCII meta (the VRoid files carry Japanese titles; the project allows no CJK anywhere) and the license
  const meta = json.extensions?.VRM?.meta ?? json.extensions?.VRMC_vrm?.meta;
  if (meta) {
    if ('title' in meta || json.extensions?.VRM) { meta.title = m.title; meta.author = m.author; meta.licenseName = 'CC0'; meta.otherLicenseUrl = ''; }
    else { meta.name = m.title; meta.authors = [m.author]; }
  }
  // record what was done in the file itself
  json.asset = { ...json.asset, extras: { ...(json.asset.extras ?? {}), pbd: `optimize-trainers: textures <= ${m.tex}px (face ${FACE_TEX}), morphs ${morphs.before} -> ${morphs.after}` } };
  const text = JSON.stringify(json);
  const cjk = text.match(/[　-鿿가-힯＀-￯]/);
  if (cjk) throw new Error(`${m.id}: CJK text left in the glTF JSON near "${text.slice(Math.max(0, cjk.index - 40), cjk.index + 10)}"`);
  const glb = writeGlb(json, outBin);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${m.id}.vrm`), glb);
  const kb = Math.round(glb.length / 1024);
  const imgKb = Math.round(images.reduce((s, x) => s + x.buf.length, 0) / 1024);
  return { id: m.id, srcKb: Math.round(srcBuf.length / 1024), kb, imgKb, morphs: `${morphs.before}->${morphs.after}`, budget: m.budget, ok: kb <= m.budget };
}

const only = process.argv.slice(2);
const rows = MODELS.filter(m => !only.length || only.includes(m.id)).map(optimize);
console.table(rows);
if (rows.some(r => !r.ok)) { console.error('OVER BUDGET'); process.exit(1); }
console.log('TRAINERS_OK');
