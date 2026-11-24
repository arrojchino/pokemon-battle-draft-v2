import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Constant or per-vertex value for an extra attribute (p = world position after the part's matrix). */
type AttrValue = number[] | ((p: THREE.Vector3, n: THREE.Vector3) => number[]);
type ColorValue = THREE.ColorRepresentation | [number, number, number] | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color);

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _nm = new THREE.Matrix3();

/**
 * Collects parts for one merged mesh. Every part gets position, normal, uv, colour and the bag's extra attributes,
 * so a whole family of props (all stone, wood and plaster of the town) renders in one draw call.
 */
export class GeoBag {
  private parts: THREE.BufferGeometry[] = [];
  constructor(private extras: Record<string, { size: number; def: number[] }> = {}) {}

  get count(): number { return this.parts.length; }

  add(src: THREE.BufferGeometry, color: ColorValue, m?: THREE.Matrix4, attrs: Record<string, AttrValue> = {}): this {
    const g = src.index ? src.toNonIndexed() : src.clone();
    src.dispose();
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const n = pos.count;
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const col = new Float32Array(n * 3);
    const fixed = typeof color === 'function' ? null : Array.isArray(color) ? new THREE.Color(color[0], color[1], color[2]) : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      let c = fixed;
      if (!c) { _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i); c = _c.copy((color as (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color)(_p, _n)); }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const [name, spec] of Object.entries(this.extras)) {
      const v = attrs[name] ?? spec.def;
      const arr = new Float32Array(n * spec.size);
      if (typeof v === 'function') {
        for (let i = 0; i < n; i++) {
          _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i);
          const r = v(_p, _n);
          for (let k = 0; k < spec.size; k++) arr[i * spec.size + k] = r[k] ?? 0;
        }
      } else for (let i = 0; i < n; i++) for (let k = 0; k < spec.size; k++) arr[i * spec.size + k] = v[k] ?? 0;
      g.setAttribute(name, new THREE.BufferAttribute(arr, spec.size));
    }
    g.morphAttributes = {};
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const out = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!out) throw new Error('GeoBag: merge failed');
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

/** A local frame (position on the ground plane and rotation about y) for building props in local coordinates. */
export class Frame {
  readonly base: THREE.Matrix4;
  constructor(x: number, y: number, z: number, rot: number) {
    this.base = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  }
  /** World matrix of a local transform: position, Euler rotation (x, y, z) and scale. */
  m(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz),
    );
    return this.base.clone().multiply(local);
  }
  /** World position of a local point. */
  p(x: number, y: number, z: number): THREE.Vector3 { return new THREE.Vector3(x, y, z).applyMatrix4(this.base); }
  /** World direction of a local direction. */
  d(x: number, y: number, z: number): THREE.Vector3 { return new THREE.Vector3(x, y, z).applyMatrix3(_nm.setFromMatrix4(this.base)).normalize(); }
}

export function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

/**
 * A curved Japanese gable roof: two concave slopes (steep at the ridge, flat at the eaves) with corners that lift.
 * Centred on the origin, eave line at y = 0, ridge at y = rise, ridge along x. `uv` is in world units
 * (u along the eave, v down the slope) for the tile pattern. Returns { top, under } so callers can colour them.
 */
export function curvedRoof(halfW: number, halfD: number, rise: number, lift: number, segU = 16, segV = 8, thick = 0.08, sides: number[] = [1, -1]): { top: THREE.BufferGeometry; under: THREE.BufferGeometry; edge: THREE.BufferGeometry } {
  const topPos: number[] = [], topUv: number[] = [], topIdx: number[] = [];
  const subPos: number[] = [], subIdx: number[] = [];
  const edgePos: number[] = [], edgeIdx: number[] = [];
  const y = (u: number, s: number) => rise * Math.pow(1 - s, 1.6) + lift * s * s * Math.pow(Math.abs(u), 4) + lift * 0.25 * u * u * s;
  for (const side of sides) {
    const base = topPos.length / 3;
    const sbase = subPos.length / 3;
    for (let j = 0; j <= segV; j++) {
      const s = j / segV;
      for (let i = 0; i <= segU; i++) {
        const u = -1 + (2 * i) / segU;
        const x = u * halfW, z = side * s * halfD, yy = y(u, s);
        topPos.push(x, yy, z);
        topUv.push(x, 0);
        subPos.push(x, yy - thick, z);
      }
    }
    // v coordinate: arc length down the slope at u = 0
    let acc = 0;
    for (let j = 0; j <= segV; j++) {
      if (j > 0) { const s = j / segV, s0 = (j - 1) / segV; acc += Math.hypot(halfD * (s - s0), y(0, s) - y(0, s0)); }
      for (let i = 0; i <= segU; i++) topUv[(base + j * (segU + 1) + i) * 2 + 1] = acc;
    }
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
      if (side > 0) { topIdx.push(base + a, base + c, base + b, base + b, base + c, base + d); subIdx.push(sbase + a, sbase + b, sbase + c, sbase + b, sbase + d, sbase + c); }
      else { topIdx.push(base + a, base + b, base + c, base + b, base + d, base + c); subIdx.push(sbase + a, sbase + c, sbase + b, sbase + b, sbase + c, sbase + d); }
    }
    // fascia along the eave and the two gable edges
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= segU; i++) ring.push([-1 + (2 * i) / segU, 1]);
    const strips: Array<Array<[number, number]>> = [ring];
    const g1: Array<[number, number]> = [], g2: Array<[number, number]> = [];
    for (let j = 0; j <= segV; j++) { g1.push([-1, j / segV]); g2.push([1, j / segV]); }
    strips.push(g1, g2);
    for (const strip of strips) {
      const eb = edgePos.length / 3;
      for (const [u, s] of strip) {
        const x = u * halfW, z = side * s * halfD, yy = y(u, s);
        edgePos.push(x, yy, z, x, yy - thick, z);
      }
      for (let k = 0; k < strip.length - 1; k++) {
        const a = eb + k * 2, b = a + 1, c = a + 2, d = a + 3;
        edgeIdx.push(a, b, c, c, b, d, a, c, b, c, d, b); // both windings: thin strips seen from either side
      }
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
  top.setIndex(topIdx); top.computeVertexNormals();
  const under = new THREE.BufferGeometry();
  under.setAttribute('position', new THREE.Float32BufferAttribute(subPos, 3));
  under.setIndex(subIdx); under.computeVertexNormals();
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  edge.setIndex(edgeIdx); edge.computeVertexNormals();
  return { top, under, edge };
}

/** Height of the curved roof surface (same formula as `curvedRoof`) for fitting gables and ridges. */
export function roofHeight(rise: number, lift: number, u: number, s: number): number {
  return rise * Math.pow(1 - s, 1.6) + lift * s * s * Math.pow(Math.abs(u), 4) + lift * 0.25 * u * u * s;
}

/** A gable-end wall that follows the roof profile (for walls of half depth `halfD` under a roof of `roofHalfD`). */
export function gableWall(halfD: number, roofHalfD: number, rise: number, lift: number, u: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = 10;
  shape.moveTo(-halfD, 0);
  for (let i = 0; i <= n; i++) {
    const z = -halfD + (2 * halfD * i) / n;
    const s = Math.abs(z) / roofHalfD;
    shape.lineTo(z, roofHeight(rise, lift, u, s) - 0.05);
  }
  shape.lineTo(halfD, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/** A box beam bent upward toward both ends (torii and gate lintels). */
export function bentBeam(len: number, h: number, d: number, lift: number, seg = 16): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, h, d, seg, 1, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (len / 2);
    p.setY(i, p.getY(i) + lift * Math.pow(Math.abs(x), 2.6));
  }
  g.computeVertexNormals();
  return g;
}

/** A lumpy leaf clump: icosphere displaced by smooth noise (kept watertight before normals). */
export function blob(radius: number, detail: number, seed: number, rough = 0.22): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const merged = mergeVerticesSimple(g);
  const p = merged.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + rough * (Math.sin(n.x * 3.1 + seed) * Math.sin(n.y * 2.7 + seed * 1.3) * Math.sin(n.z * 3.3 + seed * 0.7) + 0.35 * Math.sin(n.x * 7.0 + n.z * 5.0 + seed * 2.1));
    v.copy(n).multiplyScalar(radius * k);
    v.y *= n.y < 0 ? 0.62 : 1.0; // flatter undersides
    p.setXYZ(i, v.x, v.y, v.z);
  }
  merged.computeVertexNormals();
  return merged;
}

/** Weld coincident vertices (IcosahedronGeometry is non-indexed) so displacement keeps the surface closed. */
function mergeVerticesSimple(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(k);
  }
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setIndex(idx);
  return out;
}

/** A paper lantern (chochin): ribbed lathe body; caps are separate. Height ~ h, radius ~ r. */
export function paperLantern(r: number, h: number, seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = r * (0.55 + 0.45 * Math.sin(t * Math.PI)) * (1 - 0.04 * (i % 2));
    pts.push(new THREE.Vector2(rr, -h / 2 + t * h));
  }
  return new THREE.LatheGeometry(pts, seg);
}
