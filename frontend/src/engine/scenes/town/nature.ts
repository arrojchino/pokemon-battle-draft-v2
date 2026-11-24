import * as THREE from 'three';
import { GeoBag, blob } from './geo.js';
import { KIND, patchMaterial, type TownUniforms } from './materials.js';
import type { Ctx } from './structures.js';
import { leafClump } from './structures.js';
import { mulberry } from './textures.js';
import {
  FLOOR_Y, GARDEN, PLANTERS, RADIUS, TREES, buildColliders, gardenDistance, pavedDistance, pushOut, type TreeKind,
} from './layout.js';

const G = FLOOR_Y;

const PALETTE: Record<TreeKind, string[]> = {
  cherry: ['#ffb3cf', '#f59abd', '#ffcfe0', '#f7a6c6'],
  maple: ['#d9452b', '#ee6a2a', '#c7342c', '#f08a34'],
  round: ['#3f7a3c', '#4b8a42', '#356c36', '#5a9446'],
  pine: ['#2c5a3a', '#336842', '#284f35'],
};

/** One stylised tree: bark trunk and branches in the static bag, wind-swayed leaf clumps in the foliage bag. */
export function buildTree(ctx: Ctx, x: number, z: number, kind: TreeKind, s: number, seed: number, detail = 2): void {
  const rnd = mulberry(seed * 977 + 13);
  const H = 3.6 * s;
  const windOf = (p: THREE.Vector3) => [THREE.MathUtils.clamp((p.y - G) / H, 0, 1) * 1.2, seed];
  const bark = kind === 'cherry' ? '#4a3029' : kind === 'pine' ? '#4a3a30' : '#3d2c22';
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25).normalize();
  const trunkH = (kind === 'pine' ? 1.9 : 1.45) * s;
  const seg = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 9, 2);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    ctx.stat.add(g, bark, m, { aKind: [KIND.bark] });
  };
  const base = new THREE.Vector3(x, G - 0.05, z);
  const top = base.clone().addScaledVector(lean, trunkH);
  seg(base, top, 0.16 * s, 0.1 * s);
  // root flare
  ctx.stat.add(new THREE.ConeGeometry(0.26 * s, 0.3 * s, 9, 1, true), bark, new THREE.Matrix4().makeTranslation(x, G + 0.1 * s, z), { aKind: [KIND.bark] });
  const cols = PALETTE[kind];
  const blobAt = (p: THREE.Vector3, r: number, sy: number, i: number) => {
    const base = new THREE.Color(cols[i % cols.length]);
    const g = blob(r, detail, seed * 3.1 + i, 0.2);
    const cy = p.y;
    ctx.fol.add(g, (pp: THREE.Vector3) => base.clone().multiplyScalar(0.62 + 0.5 * THREE.MathUtils.clamp((pp.y - cy) / (r * sy) * 0.5 + 0.5, 0, 1)),
      new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(1, sy, 1)),
      { aWind: windOf });
  };
  if (kind === 'pine') {
    // cloud-pruned pine: a curving trunk with flat foliage pads
    let prev = top.clone();
    const pads: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const next = prev.clone().add(new THREE.Vector3(Math.sin(seed + k * 2.1) * 0.35 * s, 0.55 * s, Math.cos(seed + k * 1.7) * 0.3 * s));
      seg(prev, next, (0.1 - k * 0.02) * s, (0.08 - k * 0.02) * s);
      prev = next; pads.push(next.clone());
    }
    pads.unshift(top.clone().add(new THREE.Vector3(0.5 * s, -0.15 * s, 0.1 * s)));
    pads.forEach((p, i) => {
      if (i === 0) seg(top.clone().addScaledVector(lean, -0.2 * s), p, 0.06 * s, 0.04 * s);
      blobAt(p.clone().add(new THREE.Vector3(0, 0.12 * s, 0)), (0.62 - i * 0.07) * s, 0.42, i);
    });
  } else {
    const branches = 3;
    const crowns: THREE.Vector3[] = [];
    for (let k = 0; k < branches; k++) {
      const a = (k / branches) * Math.PI * 2 + rnd() * 0.8;
      const out = kind === 'round' ? 0.35 : 0.65;
      const end = top.clone().add(new THREE.Vector3(Math.cos(a) * out * s, (0.55 + rnd() * 0.35) * s, Math.sin(a) * out * s));
      seg(top.clone().addScaledVector(lean, -0.15 * s), end, 0.07 * s, 0.04 * s);
      crowns.push(end);
    }
    const n = kind === 'round' ? 5 : 6;
    for (let i = 0; i < n; i++) {
      const c = crowns[i % crowns.length];
      const a = rnd() * Math.PI * 2;
      const spread = (kind === 'round' ? 0.35 : 0.55) * s;
      const p = c.clone().add(new THREE.Vector3(Math.cos(a) * spread * rnd(), (rnd() * 0.5 - 0.05) * s + (kind === 'round' ? i * 0.12 * s : 0), Math.sin(a) * spread * rnd()));
      const r = (kind === 'round' ? 0.62 : 0.6 + rnd() * 0.22) * s;
      blobAt(p, r, kind === 'round' ? 1.05 : 0.78, i);
    }
    if (kind === 'round') blobAt(top.clone().add(new THREE.Vector3(0, 1.45 * s, 0)), 0.55 * s, 1.0, 9);
    if (kind === 'cherry') ctx.petals.push({ x, y: top.y + 0.9 * s, z, r: 1.2 * s });
  }
  ctx.ao.push({ x, z, r: 1.5 * s, a: 0.42 });
  ctx.ao.push({ x, z, r: 0.45 * s, a: 0.35 });
}

export function buildTrees(ctx: Ctx): void {
  TREES.forEach((t, i) => buildTree(ctx, t.x, t.z, t.kind, t.s, i + 1));
  // bushes along the Center and the shrine path
  const bushes: Array<[number, number, number, string]> = [
    [-4.45, -9.45, 0.42, '#3d7a3a'], [4.45, -9.45, 0.42, '#3d7a3a'], [-8.3, -2.9, 0.38, '#47803e'], [-8.4, 2.9, 0.36, '#2f6a34'],
    [-11.9, -0.3, 0.32, '#3d7a3a'], [-11.7, 0.95, 0.28, '#d76a9a'], [-11.75, -1.1, 0.3, '#5a8f46'],
  ];
  bushes.forEach(([x, z, r, c], i) => {
    leafClump(ctx, x, G + r * 0.55, z, r, c, i * 1.7, 0.4, 2, 0.75);
    ctx.ao.push({ x, z, r: r * 1.8, a: 0.4 });
  });
}

// ---- grass and flower cards ------------------------------------------------------------------------------
const CELL = { grass: [0, 0.5], pink: [0.5, 0.5], gold: [0, 0], blue: [0.5, 0] } as const;

export function createCards(mat: THREE.Material, tier: 'low' | 'medium' | 'high'): { mesh: THREE.InstancedMesh; full: number } {
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2 + 0.3;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);

  const rnd = mulberry(4242);
  const colliders = buildColliders();
  const items: Array<{ x: number; z: number; cell: readonly [number, number]; w: number; h: number; tint: number }> = [];
  const blocked = (x: number, z: number, r: number) => colliders.some(c => pushOut(c, x, z, r) !== null);
  // planters: dense flowers
  for (const p of PLANTERS) {
    const n = Math.round(p.hw * p.hd * 4 * 26);
    const cell = [CELL.pink, CELL.gold, CELL.blue][Math.abs(Math.round(p.x * 3)) % 3];
    for (let i = 0; i < n; i++) {
      const lx = (rnd() * 2 - 1) * (p.hw - 0.08), lz = (rnd() * 2 - 1) * (p.hd - 0.08);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      items.push({ x: p.x + c * lx + s * lz, z: p.z - s * lx + c * lz, cell: rnd() < 0.25 ? CELL.grass : cell, w: 0.3, h: 0.24 + rnd() * 0.08, tint: 0.85 + rnd() * 0.3 });
    }
  }
  // flowers along the hedges and around tree bases on the lawns
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, r = 11.6 + rnd() * 0.75;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pavedDistance(x, z) < 0.2 || gardenDistance(x, z) < 0.3 || blocked(x, z, 0.05)) continue;
    const cell = [CELL.pink, CELL.gold, CELL.blue, CELL.grass][Math.floor(rnd() * 4)];
    items.push({ x, z, cell, w: 0.32, h: 0.26 + rnd() * 0.1, tint: 0.85 + rnd() * 0.3 });
  }
  for (const t of TREES) {
    if (gardenDistance(t.x, t.z) < 0.5) continue;
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = 0.42 * t.s + 0.1 + rnd() * 0.6;
      const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      if (pavedDistance(x, z) < 0.15 || Math.hypot(x, z) > RADIUS + 0.3) continue;
      items.push({ x, z, cell: rnd() < 0.5 ? CELL.grass : (t.kind === 'cherry' ? CELL.pink : CELL.gold), w: 0.3, h: 0.24, tint: 0.85 + rnd() * 0.3 });
    }
  }
  // garden: flowers by the pond and backdrop
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const x = GARDEN.pond.x + Math.cos(a) * 2.25, z = GARDEN.pond.z + Math.sin(a) * 1.45;
    if (pavedDistance(x, z) < 0.15) continue;
    items.push({ x, z, cell: rnd() < 0.5 ? CELL.blue : CELL.grass, w: 0.3, h: 0.25, tint: 0.9 + rnd() * 0.2 });
  }
  // grass tufts across the lawns
  let tries = 0;
  const tufts = 1300;
  let placed = 0;
  while (placed < tufts && tries < tufts * 6) {
    tries++;
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (RADIUS + 0.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pavedDistance(x, z) < 0.12 || gardenDistance(x, z) < 0.05 || blocked(x, z, 0.08)) continue;
    items.push({ x, z, cell: rnd() < 0.06 ? CELL.pink : CELL.grass, w: 0.26 + rnd() * 0.12, h: 0.14 + rnd() * 0.1, tint: 0.75 + rnd() * 0.4 });
    placed++;
  }
  // shuffle so halving the count on low thins everything evenly
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const cells = new Float32Array(items.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  items.forEach((it, i) => {
    q.setFromEuler(e.set(0, rnd() * Math.PI, 0));
    m.compose(v.set(it.x, G - 0.01, it.z), q, sc.set(it.w, it.h, it.w));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(it.tint));
    cells[i * 2] = it.cell[0]; cells[i * 2 + 1] = it.cell[1];
  });
  geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
  mesh.count = tier === 'low' ? Math.floor(items.length / 2) : items.length;
  mesh.frustumCulled = false;
  return { mesh, full: items.length };
}

// ---- far scenery: instanced trees and houses beyond the hedges ---------------------------------------------
function farClear(x: number, z: number): boolean {
  const r = Math.hypot(x, z);
  if (r < 14.6) return false;
  if (z > 10 && Math.abs(x) < 4.2) return false; // south road
  if (x > 6 && z < -6 && Math.abs(x + z) / Math.SQRT2 < 4.5) return false; // stadium avenue
  return true;
}

export function createFarTrees(mat: THREE.Material, count: number): THREE.InstancedMesh {
  const bag = new GeoBag({ aWind: { size: 2, def: [0, 0] } });
  const trunk = new THREE.CylinderGeometry(0.08, 0.12, 1.4, 6);
  trunk.translate(0, 0.7, 0);
  bag.add(trunk, '#3a2a20', undefined, { aWind: [0, 0] });
  for (let i = 0; i < 3; i++) {
    const g = blob(0.85 - i * 0.12, 1, i * 2.3, 0.18);
    g.translate(Math.sin(i * 2.1) * 0.35, 1.7 + i * 0.5, Math.cos(i * 2.1) * 0.35);
    bag.add(g, (p: THREE.Vector3) => new THREE.Color('#ffffff').multiplyScalar(0.65 + 0.15 * p.y), undefined, { aWind: (p: THREE.Vector3) => [p.y / 3, i] });
  }
  const geo = bag.build();
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const rnd = mulberry(99);
  const tones = ['#2f5f36', '#3a6e3b', '#26502f', '#f2a6c4', '#2b5a3c', '#c9472d'];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < count && guard++ < count * 20) {
    const a = rnd() * Math.PI * 2, r = 14.6 + Math.pow(rnd(), 1.6) * 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!farClear(x, z)) continue;
    const s = 0.9 + rnd() * 0.8;
    m.compose(new THREE.Vector3(x, G - 0.05, z), q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(tones[Math.floor(rnd() * (r < 18 ? 4 : tones.length))]));
    i++;
  }
  mesh.count = i;
  mesh.frustumCulled = false;
  return mesh;
}


/** Lit houses (instanced): body + hip roof, window lights from the instance seed in the fragment shader. */
export function createHouses(u: TownUniforms, count: number): { mesh: THREE.InstancedMesh; material: THREE.MeshStandardMaterial } {
  const pos: number[] = [], col: number[] = [], part: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color, p: number) => {
    for (const v of [a, b, c, a, c, d]) { pos.push(...v); col.push(cc.r, cc.g, cc.b); part.push(p); }
  };
  const wall = new THREE.Color('#d8cfbd'), roof = new THREE.Color('#2e3446'), under = new THREE.Color('#3a2a20');
  // body: unit box centred in x/z, y 0..1
  const h = 0.5;
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], wall, 0);
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], wall, 0);
  quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], wall, 0);
  quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], wall, 0);
  // hip roof with overhang
  const o = 0.62, ry = 1.42, rx = 0.22;
  quad([-o, 0.95, o], [o, 0.95, o], [rx, ry, 0], [-rx, ry, 0], roof, 1);
  quad([o, 0.95, -o], [-o, 0.95, -o], [-rx, ry, 0], [rx, ry, 0], roof, 1);
  for (const v of [[o, 0.95, o], [o, 0.95, -o], [rx, ry, 0]]) { pos.push(...v); col.push(roof.r, roof.g, roof.b); part.push(1); }
  for (const v of [[-o, 0.95, -o], [-o, 0.95, o], [-rx, ry, 0]]) { pos.push(...v); col.push(roof.r, roof.g, roof.b); part.push(1); }
  quad([-o, 0.95, -o], [o, 0.95, -o], [o, 0.95, o], [-o, 0.95, o], under, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geo.computeVertexNormals();
  const material = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), {
    key: 'town-houses',
    uniforms: u,
    vHead: 'attribute float aPart; varying float vPart; varying vec3 vLoc; varying vec3 vLN; varying vec3 vSc; varying float vSeed;',
    vBegin: /* glsl */`
      vPart = aPart; vLoc = position; vLN = normal;
      #ifdef USE_INSTANCING
        vSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSeed = fract(instanceMatrix[3].x * 0.1234 + instanceMatrix[3].z * 0.3117);
      #else
        vSc = vec3(1.0); vSeed = 0.0;
      #endif
    `,
    fHead: 'varying float vPart; varying vec3 vLoc; varying vec3 vLN; varying vec3 vSc; varying float vSeed;',
    fColor: 'diffuseColor.rgb *= 0.85 + 0.25 * tNoise(vTW.xz * 0.7 + vTW.y);',
    fEmissive: /* glsl */`
      if (vPart < 0.5 && abs(vLN.y) < 0.5) {
        float hx = abs(vLN.x) > 0.5 ? vLoc.z * vSc.z : vLoc.x * vSc.x;
        float hy = vLoc.y * vSc.y;
        vec2 cell = vec2(floor(hx / 0.95), floor(hy / 1.15));
        vec2 f = vec2(fract(hx / 0.95), fract(hy / 1.15));
        float inWin = step(abs(f.x - 0.5), 0.24) * step(abs(f.y - 0.55), 0.2) * step(0.4, hy) * step(hy, vSc.y - 0.25);
        float rnd = tHash(cell + vSeed * 91.0 + vLN.xz * 7.0);
        vec3 lit = rnd > 0.86 ? vec3(0.6, 0.85, 1.6) : vec3(2.4, 1.45, 0.65);
        float on = step(0.42, rnd);
        totalEmissiveRadiance += inWin * mix(vec3(0.01, 0.015, 0.03), lit * (0.8 + 0.4 * fract(rnd * 13.0)), on);
        diffuseColor.rgb *= 1.0 - inWin * 0.8;
      }
      totalEmissiveRadiance += diffuseColor.rgb * townLight(vTW, vTN) * 0.5;
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const rnd = mulberry(321);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  let i = 0, guard = 0;
  while (i < count && guard++ < count * 30) {
    const a = rnd() * Math.PI * 2, r = 16.5 + Math.pow(rnd(), 1.3) * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!farClear(x, z)) continue;
    if (x > 0 && z < 0 && Math.abs(Math.atan2(z, x) + Math.PI / 4) < 0.12) continue;
    const w = 2.4 + rnd() * 2.2, d = 2.2 + rnd() * 1.8, hh = (rnd() < 0.3 ? 3.4 : 2.1) + rnd() * 0.8 + (r > 30 ? rnd() * 2.5 : 0);
    const face = Math.atan2(-x, -z) + (rnd() - 0.5) * 0.5;
    m.compose(new THREE.Vector3(x, G - 0.05, z), q.setFromEuler(new THREE.Euler(0, face, 0)), new THREE.Vector3(w, hh, d));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHSL(0.08 + rnd() * 0.06, 0.15, 0.75 + rnd() * 0.2).convertSRGBToLinear().multiplyScalar(1.4));
    i++;
  }
  mesh.count = i;
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** Distant hills (ring) and the stadium on the north-east horizon, in the far material; beams separately. */
export function createFarGeometry(): { hills: THREE.BufferGeometry; stadium: THREE.BufferGeometry; beams: THREE.BufferGeometry } {
  // hills: rings of vertices with noisy heights
  const radii = [55, 85, 125, 180, 260];
  const seg = 160;
  const pos: number[] = [], col: number[] = [], kind: number[] = [], idx: number[] = [];
  const hcol = new THREE.Color('#0a1226');
  const height = (a: number, ri: number) => {
    if (ri === 0) return -1;
    const n = Math.sin(a * 3 + ri) * 0.5 + Math.sin(a * 7.3 + ri * 2.1) * 0.3 + Math.sin(a * 17.1 + ri) * 0.15;
    const base = [0, 7, 17, 30, 18][ri];
    return base * (0.65 + 0.35 * n) + (ri === 3 ? Math.max(0, Math.sin(a * 2 + 1)) * 18 : 0);
  };
  for (let ri = 0; ri < radii.length; ri++) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a) * radii[ri], height(a, ri), Math.sin(a) * radii[ri]);
    const shade = 1 - ri * 0.12;
    col.push(hcol.r * shade, hcol.g * shade, hcol.b * shade); kind.push(0);
  }
  for (let ri = 0; ri < radii.length - 1; ri++) for (let i = 0; i < seg; i++) {
    const a = ri * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const hills = new THREE.BufferGeometry();
  hills.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hills.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hills.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  hills.setIndex(idx);
  hills.computeVertexNormals();

  const SC = new THREE.Vector3(92, 0, -92);
  const bag = new GeoBag({ aKind: { size: 1, def: [1] } });
  const v = (a: number, b: number) => new THREE.Vector2(a, b);
  bag.add(new THREE.LatheGeometry([v(30, -2), v(31, 6), v(32.5, 13), v(33.5, 16), v(33, 16.6), v(28, 15.5)], 64), '#141b38', new THREE.Matrix4().makeTranslation(SC.x, 0, SC.z), { aKind: [1] });
  bag.add(new THREE.TorusGeometry(33.2, 0.35, 6, 96), [3.2, 3.4, 3.8], new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(SC.x, 16.7, SC.z), { aKind: [2] });
  bag.add(new THREE.TorusGeometry(31.6, 0.25, 6, 96), [0.6, 2.4, 3.4], new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(SC.x, 8.5, SC.z), { aKind: [2] });
  const heads: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = SC.x + Math.cos(a) * 35, z = SC.z + Math.sin(a) * 35;
    bag.add(new THREE.BoxGeometry(0.8, 28, 0.8), '#0d1124', new THREE.Matrix4().makeTranslation(x, 12, z), { aKind: [2] });
    bag.add(new THREE.BoxGeometry(4.5, 2.2, 1.2), [6, 6.2, 6.6], new THREE.Matrix4().makeRotationY(-a).setPosition(x, 26.5, z), { aKind: [2] });
    heads.push(new THREE.Vector3(x, 26.5, z));
  }
  const stadium = bag.build();
  const beamBag = new GeoBag();
  heads.forEach((h, i) => {
    const g = new THREE.CylinderGeometry(9, 0.8, 140, 16, 1, true);
    g.translate(0, 70, 0);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(i * 2.3) * 0.25, 0, Math.cos(i * 1.7) * 0.25 - 0.08));
    beamBag.add(g, '#ffffff', new THREE.Matrix4().compose(h, tilt, new THREE.Vector3(1, 1, 1)));
  });
  return { hills, stadium, beams: beamBag.build() };
}

