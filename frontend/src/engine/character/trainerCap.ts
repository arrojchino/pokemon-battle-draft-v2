// The trainer's sporty cap: a rounded crown fitted over the model's own hair (from the hair height field in
// `npc/accessories.ts`), a white front panel, a curved brim and a button. It is built once, skinned to the head
// bone and merged into the shared body geometry, so it costs no extra draw call. Colours come from swatches in
// the trainer atlas: the crown and brim are tinted with the trainer's accent colour by the tint mask.
import * as THREE from 'three';
import type { HeightField } from '../npc/accessories.js';

export type CapSwatch = 'crown' | 'panel' | 'brim' | 'under';

const NI = 40;               // segments around (even, so the front panel edges fall on grid lines)
const NJ = 9;                // rings from the rim to the apex
const PANEL = 4;             // panel half width in segments (4 / 40 of a turn each side)

/**
 * Returns an indexed geometry in the model's raw (VRM 0.x) frame with position, normal, uv, skinIndex and
 * skinWeight, every vertex bound to `headIdx`. `headModel` is the head bone's rest position in that frame.
 */
export function buildTrainerCap(hair: HeightField, sw: Record<CapSwatch, { u: number; v: number }>, headModel: THREE.Vector3, headIdx: number): THREE.BufferGeometry {
  const cz = -0.012;
  const yRim = (th: number) => 0.102 + 0.034 * Math.cos(th);
  // rim radius per direction: just outside the hair at the rim height
  const rr: number[] = [];
  for (let i = 0; i <= NI; i++) {
    const th = -Math.PI + (2 * Math.PI * i) / NI;
    const y = yRim(th);
    let r = 0.125;
    for (let s = 0.04; s < 0.2; s += 0.002) {
      const h = hair.at(Math.sin(th) * s, cz + Math.cos(th) * s);
      if (!(h > y - 0.004)) { r = s; break; }
    }
    rr.push(r - 0.002);                  // hair compresses a little under the band
  }
  rr[NI] = rr[0];
  const rs = rr.map((_, i) => { let s = 0; for (let k = -2; k <= 2; k++) s += rr[(i + k + NI) % NI]; return s / 5; });
  let apex = -Infinity;
  for (let x = -0.04; x <= 0.04; x += 0.01) for (let z = -0.05; z <= 0.03; z += 0.01) apex = Math.max(apex, hair.at(x, cz + z));
  if (!Number.isFinite(apex)) apex = 0.2;
  apex += 0.004;

  // ---- crown grid (indexed, smooth normals)
  const cpos: number[] = [];
  const grid: THREE.Vector3[][] = [];
  for (let i = 0; i <= NI; i++) {
    const th = -Math.PI + (2 * Math.PI * i) / NI;
    const col: THREE.Vector3[] = [];
    for (let j = 0; j <= NJ; j++) {
      const ph = (j / NJ) * (Math.PI / 2);
      const c = Math.cos(ph), s = Math.sin(ph);
      const r = rs[i] * Math.pow(c, 0.85);
      const x = Math.sin(th) * r, z = cz + Math.cos(th) * r;
      let y = yRim(th) + (apex - yRim(th)) * Math.pow(s, 0.8);
      if (j > 0) { const h = hair.at(x, z); if (Number.isFinite(h)) y = Math.max(y, h + 0.003); }
      col.push(new THREE.Vector3(x, y, z));
    }
    grid.push(col);
  }
  for (const col of grid) cpos.push(...col.flatMap(v => [v.x, v.y, v.z]));
  const cidx: number[] = [];
  const at = (i: number, j: number) => i * (NJ + 1) + j;
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) cidx.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
  crown.setIndex(cidx);
  crown.computeVertexNormals();
  orientOutward(crown, new THREE.Vector3(0, yRim(0), cz));
  // weld the seam normals (column 0 == column NI)
  const cn = crown.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j <= NJ; j++) {
    const a = at(0, j), b = at(NI, j);
    const v = new THREE.Vector3().fromBufferAttribute(cn, a).add(new THREE.Vector3().fromBufferAttribute(cn, b)).normalize();
    cn.setXYZ(a, v.x, v.y, v.z); cn.setXYZ(b, v.x, v.y, v.z);
  }
  // per-triangle swatch: the white panel spans the front segments below the top two rings
  const crownTri: CapSwatch[] = [];
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
    const front = i >= NI / 2 - PANEL && i < NI / 2 + PANEL && j < NJ - 2;
    crownTri.push(front ? 'panel' : 'crown', front ? 'panel' : 'crown');
  }

  // ---- brim: top and bottom sheets plus the front edge
  const B = 1.12, NB = 22, NR = 4, L = 0.088, T = 0.0045;
  const bpos: number[] = [], bidx: number[] = [], bsw: CapSwatch[] = [];
  const sheet = (dy: number) => {
    const base = bpos.length / 3;
    for (let i = 0; i <= NB; i++) {
      const th = -B + (2 * B * i) / NB;
      const u = th / B;
      const r = sampleR(rs, th);
      const rim = new THREE.Vector3(Math.sin(th) * r, yRim(th), cz + Math.cos(th) * r);
      const dir = new THREE.Vector3(Math.sin(th), 0, Math.cos(th)).lerp(new THREE.Vector3(0, 0, 1), 0.55).normalize();
      const len = L * Math.pow(Math.max(0, Math.cos(u * Math.PI / 2)), 0.55);
      for (let k = 0; k <= NR; k++) {
        const t = k / NR;
        const p = rim.clone().addScaledVector(dir, len * t);
        p.y += -len * t * 0.17 - 0.016 * u * u * t + dy;   // slopes down and curves at the sides
        bpos.push(p.x, p.y, p.z);
      }
    }
    return base;
  };
  const top = sheet(0.0015), bot = sheet(-T);
  const bi = (base: number, i: number, k: number) => base + i * (NR + 1) + k;
  for (let i = 0; i < NB; i++) for (let k = 0; k < NR; k++) {
    bidx.push(bi(top, i, k), bi(top, i, k + 1), bi(top, i + 1, k), bi(top, i + 1, k), bi(top, i, k + 1), bi(top, i + 1, k + 1));
    bsw.push('brim', 'brim');
    bidx.push(bi(bot, i, k), bi(bot, i + 1, k), bi(bot, i, k + 1), bi(bot, i + 1, k), bi(bot, i + 1, k + 1), bi(bot, i, k + 1));
    bsw.push('under', 'under');
  }
  for (let i = 0; i < NB; i++) {
    bidx.push(bi(top, i, NR), bi(bot, i, NR), bi(top, i + 1, NR), bi(top, i + 1, NR), bi(bot, i, NR), bi(bot, i + 1, NR));
    bsw.push('brim', 'brim');
  }
  const brim = new THREE.BufferGeometry();
  brim.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  brim.setIndex(bidx);
  brim.computeVertexNormals();

  // ---- button on the apex
  const btn = new THREE.SphereGeometry(0.011, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  btn.translate(0, grid[NI / 2][NJ].y - 0.003, grid[NI / 2][NJ].z);
  const btnTri: CapSwatch[] = new Array(btn.getIndex()!.count / 3).fill('crown');

  // ---- flatten: one triangle list, uv per triangle from its swatch (no texel bleeding between swatches)
  const P: number[] = [], N: number[] = [], U: number[] = [];
  const emit = (geo: THREE.BufferGeometry, tri: CapSwatch[]) => {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), idx = geo.getIndex()!;
    for (let t = 0; t < idx.count / 3; t++) {
      const s = sw[tri[t]];
      for (let c = 0; c < 3; c++) {
        const v = idx.getX(t * 3 + c);
        // head-local body space -> model raw frame (VRM 0.x faces -z: flip x and z)
        P.push(headModel.x - p.getX(v), headModel.y + p.getY(v), headModel.z - p.getZ(v));
        N.push(-n.getX(v), n.getY(v), -n.getZ(v));
        U.push(s.u, s.v);
      }
    }
  };
  emit(crown, crownTri); emit(brim, bsw); emit(btn, btnTri);
  crown.dispose(); brim.dispose(); btn.dispose();
  const n = P.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  const si = new Uint16Array(n * 4), swt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = headIdx; swt[i * 4] = 1; }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(swt, 4));
  geo.setIndex(Array.from({ length: n }, (_, i) => i));
  return geo;
}

function sampleR(rs: number[], th: number) {
  const f = ((th + Math.PI) / (2 * Math.PI)) * NI;
  const i = Math.max(0, Math.min(NI - 1, Math.floor(f)));
  const t = f - i;
  return rs[i] * (1 - t) + rs[i + 1] * t;
}

/** Flip the winding (and normals) if the normals point mostly toward `center`. */
function orientOutward(geo: THREE.BufferGeometry, center: THREE.Vector3) {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  let dot = 0;
  for (let i = 0; i < p.count; i++) dot += (p.getX(i) - center.x) * n.getX(i) + (p.getY(i) - center.y) * n.getY(i) + (p.getZ(i) - center.z) * n.getZ(i);
  if (dot >= 0) return;
  const idx = geo.getIndex()!;
  for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, a); }
  geo.computeVertexNormals();
}
