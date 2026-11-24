import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Frame, GeoBag, bentBeam, curvedRoof, gableWall, paperLantern } from './geo.js';
import { KIND } from './materials.js';
import type { AOBlob, LightPool } from './textures.js';
import { CLOTH_CELL } from './textures.js';
import {
  BENCH_ANGLES, BENCH_R, CENTER, FLOOR_Y, GARDEN, GATE_DEG, GATE_HALF, GATE_R, LAMPS, PLANTERS, RIM_R, SHOPS, SHOP_R,
  SOUTH_GATE_HALF, SOUTH_GATE_Z, faceInRot, ringPos, DEG,
} from './layout.js';

const G = FLOOR_Y;

export type Halo = { pos: THREE.Vector3; col: THREE.Color; data: [number, number, number, number] };

/** Everything the builders write into: merged-geometry bags per material plus baked-light and particle inputs. */
export type Ctx = {
  stat: GeoBag; emis: GeoBag; fol: GeoBag; cloth: GeoBag; win: GeoBag; water: GeoBag;
  pools: LightPool[]; ao: AOBlob[]; halos: Halo[];
  petals: Array<{ x: number; y: number; z: number; r: number }>;
  fireflies: Array<{ x: number; y: number; z: number; r: number }>;
  wires: number[];
  /** Fountain sculpture (rotates slowly): separate bags so it can be its own small mesh. */
  sculpt: GeoBag; sculptGlow: GeoBag;
  portal: { frame: Frame; w: number; h: number } | null;
  lightSpots: Record<'fountain' | 'center' | 'shops' | 'stage', THREE.Vector3>;
};

export function newCtx(): Ctx {
  return {
    stat: new GeoBag({ aKind: { size: 1, def: [0] } }),
    emis: new GeoBag({ aFlick: { size: 1, def: [0] } }),
    fol: new GeoBag({ aWind: { size: 2, def: [0, 0] } }),
    cloth: new GeoBag({ aSway: { size: 4, def: [0, 0, 1, 0] } }),
    win: new GeoBag({ aWin: { size: 4, def: [1, 1, 0, 0] } }),
    water: new GeoBag({ aW: { size: 1, def: [0] } }),
    sculpt: new GeoBag({ aKind: { size: 1, def: [0] } }),
    sculptGlow: new GeoBag({ aFlick: { size: 1, def: [0] } }),
    pools: [], ao: [], halos: [], petals: [], fireflies: [], wires: [],
    portal: null,
    lightSpots: { fountain: new THREE.Vector3(), center: new THREE.Vector3(), shops: new THREE.Vector3(), stage: new THREE.Vector3() },
  };
}

// ---- helpers ---------------------------------------------------------------------------------------
const C = (hex: THREE.ColorRepresentation, k = 1): THREE.Color => new THREE.Color(hex).multiplyScalar(k);
function S(ctx: Ctx, g: THREE.BufferGeometry, color: THREE.ColorRepresentation | THREE.Color, kind: number, m: THREE.Matrix4): void {
  ctx.stat.add(g, color instanceof THREE.Color ? [color.r, color.g, color.b] : color, m, { aKind: [kind] });
}
function E(ctx: Ctx, g: THREE.BufferGeometry, color: THREE.Color, m: THREE.Matrix4, flick = 0): void {
  ctx.emis.add(g, [color.r, color.g, color.b], m, { aFlick: [flick] });
}
function W(ctx: Ctx, g: THREE.BufferGeometry, tint: THREE.ColorRepresentation, m: THREE.Matrix4, cols: number, rows: number, style: number, seed: number): void {
  ctx.win.add(g, tint, m, { aWin: [cols, rows, style, seed] });
}
function halo(ctx: Ctx, p: THREE.Vector3, col: THREE.Color, size: number, flicker = 0, core = 0): void {
  ctx.halos.push({ pos: p.clone(), col, data: [size, Math.random(), flicker, core] });
}
function pool(ctx: Ctx, p: { x: number; z: number }, r: number, color: THREE.ColorRepresentation, i: number): void {
  ctx.pools.push({ x: p.x, z: p.z, r, color, i });
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r: number, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
const cyl = (rt: number, rb: number, h: number, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);

const COL = {
  white: '#efece6', red: '#d22a36', redDeep: '#b81f2b', metal: '#272b34', stone: '#8a867f', stoneDark: '#5d5a56',
  woodDark: '#4a2f21', wood: '#8c5d3b', woodLight: '#a8774e', plaster: '#e9e0cc', tile: '#3b4459', vermilion: '#d3402b',
  black: '#1b1a1e', gold: '#d6a443', hedge: '#2e5a2b',
};
const WARM = C('#ffb46a', 3.2);
const WARM_SOFT = new THREE.Color('#ffc58a');
const CYAN = C('#3ee6ff', 3.0);

/** A tiled roof with tiles on top, dark wood underneath and a fascia, placed with matrix m. */
function tiledRoof(ctx: Ctx, m: THREE.Matrix4, halfW: number, halfD: number, rise: number, lift: number, tile: THREE.ColorRepresentation, segU = 16, segV = 8, sides?: number[], ridge = true): void {
  const r = curvedRoof(halfW, halfD, rise, lift, segU, segV, 0.07, sides);
  S(ctx, r.top, tile, KIND.tile, m);
  S(ctx, r.under, COL.woodDark, KIND.wood, m);
  S(ctx, r.edge, '#2a2a30', KIND.paint, m);
  if (ridge && (!sides || sides.length === 2)) {
    const rg = cyl(0.06, 0.06, halfW * 2 + 0.05, 8); rg.rotateZ(Math.PI / 2); rg.translate(0, rise + 0.03, 0);
    S(ctx, rg, '#23252c', KIND.gloss, m);
    for (const sx of [-1, 1]) {
      const end = box(0.14, 0.2, 0.18); end.translate(sx * (halfW + 0.02), rise + 0.08, 0);
      S(ctx, end, '#23252c', KIND.gloss, m);
    }
  }
}

function chochin(ctx: Ctx, f: Frame, x: number, y: number, z: number, col: THREE.Color, r = 0.12, h = 0.28): void {
  E(ctx, paperLantern(r, h, 12), col, f.m(x, y, z), 1);
  for (const sy of [-1, 1]) S(ctx, cyl(r * 0.6, r * 0.6, 0.035, 10), COL.black, KIND.gloss, f.m(x, y + sy * (h / 2 + 0.012), z));
  S(ctx, cyl(0.008, 0.008, 0.18, 4), COL.black, KIND.metal, f.m(x, y + h / 2 + 0.1, z));
  halo(ctx, f.p(x, y, z), col.clone().multiplyScalar(0.55), 0.9, 1, 0);
}

// ---- Pokemon Center style hall ------------------------------------------------------------------------
export function buildCenter(ctx: Ctx): void {
  const f = new Frame(CENTER.x, G, CENTER.z, 0);
  const hd = CENTER.hd; // 2.2, glass front at local z = 2.1
  S(ctx, box(8.2, 0.22, 4.6), COL.stoneDark, KIND.stone, f.m(0, 0.11, 0));
  S(ctx, rbox(7.8, 2.62, 4.2, 0.3, 3), COL.white, KIND.plaster, f.m(0, 0.22 + 1.31, 0));
  S(ctx, box(7.84, 0.14, 4.24), '#3a3f4a', KIND.paint, f.m(0, 0.3, 0));
  S(ctx, rbox(8.02, 0.42, 4.42, 0.18, 3), COL.red, KIND.gloss, f.m(0, 3.03, 0));
  S(ctx, rbox(8.3, 0.9, 4.7, 0.42, 4), COL.redDeep, KIND.gloss, f.m(0, 3.69, 0));
  // upper drum and dome
  S(ctx, cyl(1.42, 1.52, 0.6, 40), COL.white, KIND.plaster, f.m(0, 4.44, -0.3));
  S(ctx, new THREE.SphereGeometry(1.5, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), COL.red, KIND.gloss, f.m(0, 4.72, -0.3, 0, 0, 0, 1, 0.55, 1));
  E(ctx, new THREE.TorusGeometry(1.5, 0.025, 6, 64), CYAN, f.m(0, 4.73, -0.3, Math.PI / 2));
  // light strip under the band (front and sides)
  E(ctx, box(7.7, 0.04, 0.04), CYAN, f.m(0, 2.79, 2.12));
  for (const sx of [-1, 1]) E(ctx, box(0.04, 0.04, 4.0), CYAN, f.m(sx * 3.92, 2.79, 0));
  // emblem: white disc, red upper half, dark band, glowing button, halo ring
  const ez = hd + 0.26, ey = 3.55;
  S(ctx, cyl(0.8, 0.8, 0.08, 48), COL.white, KIND.gloss, f.m(0, ey, ez, Math.PI / 2));
  S(ctx, new THREE.CylinderGeometry(0.7, 0.7, 0.04, 48, 1, false, Math.PI / 2, Math.PI), COL.red, KIND.gloss, f.m(0, ey, ez + 0.04, Math.PI / 2));
  S(ctx, box(1.42, 0.11, 0.05), '#22232a', KIND.gloss, f.m(0, ey, ez + 0.05));
  S(ctx, cyl(0.23, 0.23, 0.07, 32), '#22232a', KIND.gloss, f.m(0, ey, ez + 0.06, Math.PI / 2));
  S(ctx, cyl(0.17, 0.17, 0.08, 32), COL.white, KIND.gloss, f.m(0, ey, ez + 0.07, Math.PI / 2));
  E(ctx, cyl(0.1, 0.1, 0.02, 24), C('#bff6ff', 4.0), f.m(0, ey, ez + 0.115, Math.PI / 2));
  E(ctx, new THREE.TorusGeometry(0.82, 0.03, 8, 64), C('#dff8ff', 2.6), f.m(0, ey, ez));
  halo(ctx, f.p(0, ey, ez + 0.2), C('#9fe8ff', 0.9), 2.6, 0, 0);
  // entrance: sliding glass doors, transom, frame, canopy with a light strip
  W(ctx, new THREE.PlaneGeometry(2.2, 1.55), '#fff2e0', f.m(0, 0.22 + 0.775, 2.115), 1, 1, 2, 0.3);
  W(ctx, new THREE.PlaneGeometry(2.2, 0.5), '#ffe8cc', f.m(0, 2.06, 2.115), 4, 1, 0, 0.7);
  for (const sx of [-1, 1]) S(ctx, box(0.1, 2.1, 0.1), '#c8ccd4', KIND.metal, f.m(sx * 1.15, 0.22 + 1.05, 2.13));
  S(ctx, box(2.4, 0.08, 0.1), '#c8ccd4', KIND.metal, f.m(0, 1.8, 2.13));
  S(ctx, rbox(3.1, 0.14, 1.05, 0.06), COL.red, KIND.gloss, f.m(0, 2.42, 2.55));
  E(ctx, box(2.7, 0.03, 0.05), C('#fff1dc', 3.6), f.m(0, 2.345, 2.98));
  for (const sx of [-1, 1]) E(ctx, cyl(0.06, 0.06, 0.02, 16), C('#fff1dc', 3.6), f.m(sx * 0.8, 2.34, 2.5));
  // side windows on the front, framed
  for (const sx of [-1, 1]) for (const wx of [1.95, 3.1]) {
    W(ctx, new THREE.PlaneGeometry(0.9, 1.05), '#ffe1c0', f.m(sx * wx, 1.45, 2.115), 2, 1, 0, sx * wx);
    S(ctx, box(1.02, 0.08, 0.08), COL.white, KIND.gloss, f.m(sx * wx, 0.88, 2.15));
    S(ctx, box(1.02, 0.06, 0.06), COL.white, KIND.gloss, f.m(sx * wx, 2.0, 2.14));
    pool(ctx, f.p(sx * wx, 0, 2.6), 1.3, '#ffcf99', 0.45);
  }
  for (const sx of [-1, 1]) for (const wz of [-1.0, 0.6]) W(ctx, new THREE.PlaneGeometry(1.1, 1.05), '#ffe1c0', f.m(sx * 3.905, 1.45, wz, 0, sx * Math.PI / 2), 2, 1, 0, wz + sx);
  // rooftop units
  for (const sx of [-2.6, 2.4]) S(ctx, box(0.6, 0.3, 0.5), '#9aa0aa', KIND.metal, f.m(sx, 4.25, -1.2));
  pool(ctx, f.p(0, 0, 3.0), 3.0, '#ffd09a', 1.7);
  for (const sx of [-3, 0, 3]) pool(ctx, f.p(sx, 0, 2.5), 1.6, '#3ee6ff', 0.22);
  ctx.lightSpots.center.copy(f.p(0, 1.75, 3.3));
  ctx.ao.push({ x: CENTER.x, z: CENTER.z, hw: 4.15, hd: 2.35, rot: 0, a: 0.6, blur: 0.35 });
}

// ---- shops ----------------------------------------------------------------------------------------
const SHOP_STYLE = {
  potion: { tile: '#3b4762', accent: C('#6ee7ff', 2.4), lantern: C('#ff5a3a', 2.6), icon: '#8b54e0' },
  ball: { tile: '#4a2f3c', accent: C('#ff4a5a', 2.6), lantern: C('#ffd27a', 2.8), icon: COL.red },
  berry: { tile: '#2f4f4f', accent: C('#ffc94a', 2.4), lantern: C('#ff6a3a', 2.6), icon: '#4c63e6' },
};

export function buildShops(ctx: Ctx): void {
  SHOPS.forEach((s, idx) => {
    const p = ringPos(s.deg, SHOP_R);
    const f = new Frame(p.x, G, p.z, faceInRot(s.deg));
    const st = SHOP_STYLE[s.kind];
    S(ctx, box(3.6, 0.18, 3.3), '#6c6964', KIND.stone, f.m(0, 0.09, 0));
    S(ctx, box(3.3, 1.75, 3.0), COL.woodDark, KIND.wood, f.m(0, 0.18 + 0.875, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S(ctx, box(0.14, 1.78, 0.14), '#3a2418', KIND.wood, f.m(sx * 1.62, 0.18 + 0.89, sz * 1.47));
    // storefront: lit interior behind the noren, lattice windows either side
    W(ctx, new THREE.PlaneGeometry(1.15, 1.38), '#ffd9b0', f.m(0, 0.18 + 0.69, 1.505), 1, 1, 0, idx * 3.1);
    S(ctx, box(1.3, 0.09, 0.08), '#3a2418', KIND.wood, f.m(0, 1.6, 1.53));
    for (const sx of [-1, 1]) {
      W(ctx, new THREE.PlaneGeometry(0.82, 0.9), '#ffcf8a', f.m(sx * 1.05, 1.02, 1.505), 7, 3, 1, idx + sx);
      S(ctx, box(0.92, 0.07, 0.1), '#3a2418', KIND.wood, f.m(sx * 1.05, 0.54, 1.53));
      S(ctx, box(0.92, 0.07, 0.1), '#3a2418', KIND.wood, f.m(sx * 1.05, 1.5, 1.53));
      // little goods stand under each window
      S(ctx, box(0.8, 0.28, 0.16), COL.wood, KIND.wood, f.m(sx * 1.05, 0.32, 1.6));
    }
    // noren: three strips hanging from a rod, with a slit between them
    S(ctx, cyl(0.018, 0.018, 1.3, 6), '#2a1a12', KIND.wood, f.m(0, 1.63, 1.6, 0, 0, Math.PI / 2));
    const cell = CLOTH_CELL[s.kind];
    for (let k = 0; k < 3; k++) {
      const w = 0.4, h = 0.58;
      const g = new THREE.PlaneGeometry(w - 0.02, h, 3, 6);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (cell[0] + (k + uv.getX(i)) / 3) * 0.5, (1 - cell[1]) * 0.5 + uv.getY(i) * 0.5);
      const ox = (k - 1) * w;
      const dir = f.d(0, 0, 1);
      ctx.cloth.add(g, '#ffffff', f.m(ox, 1.63 - h / 2, 1.61), { aSway: (pp: THREE.Vector3) => [dir.x, 0, dir.z, Math.max(0, (G + 1.63 - pp.y) / h)] });
    }
    // upper floor
    S(ctx, box(3.1, 1.0, 2.8), COL.plaster, KIND.plaster, f.m(0, 1.93 + 0.5, 0));
    for (const y of [1.95, 2.9]) S(ctx, box(3.18, 0.09, 2.88), '#3a2418', KIND.wood, f.m(0, y, 0));
    for (const sx of [-1, 1]) S(ctx, box(0.1, 1.0, 2.88), '#3a2418', KIND.wood, f.m(sx * 1.55, 2.43, 0));
    for (const sx of [-1, 1]) W(ctx, new THREE.PlaneGeometry(0.62, 0.42), '#ffd49a', f.m(sx * 0.95, 2.45, 1.405), 4, 2, 1, idx * 2 + sx);
    // pent roof over the storefront, main gable roof with gables and ridge
    tiledRoof(ctx, f.m(0, 1.82, 1.5), 1.92, 0.68, 0.22, 0.05, st.tile, 12, 4, [1], false);
    tiledRoof(ctx, f.m(0, 2.9, 0), 1.98, 1.88, 0.82, 0.18, st.tile, 16, 8);
    for (const sx of [-1, 1]) S(ctx, gableWall(1.4, 1.88, 0.82, 0.18, 1.55 / 1.98, 0.08), COL.plaster, KIND.plaster, f.m(sx * 1.55, 2.92, 0));
    // round signboard with the shop's icon in relief and an accent ring
    S(ctx, cyl(0.3, 0.3, 0.05, 32), COL.woodLight, KIND.wood, f.m(0, 2.45, 1.43, Math.PI / 2));
    E(ctx, new THREE.TorusGeometry(0.31, 0.016, 6, 40), st.accent, f.m(0, 2.45, 1.46));
    halo(ctx, f.p(0, 2.45, 1.6), st.accent.clone().multiplyScalar(0.25), 1.2, 0, 0);
    shopIcon(ctx, f, s.kind, 0, 2.45, 1.52, st.icon);
    // paper lanterns under the pent roof
    for (const sx of [-1, 1]) chochin(ctx, f, sx * 1.42, 1.5, 1.98, st.lantern);
    pool(ctx, f.p(0, 0, 2.6), 2.4, '#ffb46e', 1.1);
    for (const sx of [-1, 1]) pool(ctx, f.p(sx * 1.42, 0, 2.3), 1.3, '#ff8a4a', 0.6);
    ctx.ao.push({ x: p.x, z: p.z, hw: 1.85, hd: 1.7, rot: faceInRot(s.deg), a: 0.55, blur: 0.3 });
    if (s.kind === 'ball') ctx.lightSpots.shops.copy(f.p(0, 1.9, 3.0));
  });
}

function shopIcon(ctx: Ctx, f: Frame, kind: 'potion' | 'ball' | 'berry', x: number, y: number, z: number, col: string): void {
  if (kind === 'potion') {
    const pts = [[0, -0.15], [0.11, -0.14], [0.13, -0.08], [0.12, 0.0], [0.05, 0.05], [0.045, 0.1], [0, 0.1]].map(([a, b]) => new THREE.Vector2(a, b));
    S(ctx, new THREE.LatheGeometry(pts, 16), col, KIND.gloss, f.m(x, y, z + 0.05));
    S(ctx, cyl(0.055, 0.055, 0.05, 12), COL.white, KIND.gloss, f.m(x, y + 0.12, z + 0.05));
  } else if (kind === 'ball') {
    S(ctx, new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), COL.red, KIND.gloss, f.m(x, y, z + 0.06));
    S(ctx, new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), COL.white, KIND.gloss, f.m(x, y, z + 0.06));
    S(ctx, new THREE.TorusGeometry(0.15, 0.015, 6, 24), '#202028', KIND.gloss, f.m(x, y, z + 0.06, Math.PI / 2));
    S(ctx, cyl(0.045, 0.045, 0.03, 16), COL.white, KIND.gloss, f.m(x, y, z + 0.2, Math.PI / 2));
  } else {
    S(ctx, new THREE.SphereGeometry(0.13, 16, 10), col, KIND.gloss, f.m(x, y - 0.02, z + 0.06, 0, 0, 0, 1, 0.92, 1));
    S(ctx, new THREE.ConeGeometry(0.06, 0.14, 6), '#3f8a3a', KIND.paint, f.m(x + 0.05, y + 0.14, z + 0.06, 0, 0, -0.7));
  }
}

// ---- stadium gate ------------------------------------------------------------------------------------
export function buildGate(ctx: Ctx): void {
  const g = ringPos(GATE_DEG, GATE_R);
  const f = new Frame(g.x, G, g.z, faceInRot(GATE_DEG));
  for (const sx of [-1, 1]) {
    const x = sx * GATE_HALF;
    S(ctx, rbox(1.0, 0.6, 1.0, 0.08), '#8f8b84', KIND.stone, f.m(x, 0.3, 0));
    S(ctx, box(0.7, 3.8, 0.7), '#e8ebf1', KIND.gloss, f.m(x, 0.6 + 1.9, 0));
    S(ctx, rbox(0.86, 0.3, 0.86, 0.06), COL.red, KIND.gloss, f.m(x, 4.55, 0));
    E(ctx, new THREE.SphereGeometry(0.12, 16, 8), C('#ff3b4a', 4), f.m(x, 4.82, 0));
    halo(ctx, f.p(x, 4.82, 0), C('#ff3b4a', 0.8), 1.4, 0.5, 0);
    for (const ox of [-0.36, 0.36]) E(ctx, box(0.02, 3.2, 0.06), CYAN, f.m(x + ox, 2.5, 0.2));
    // banners on the tower fronts
    const bw = 0.54, bh = 2.2;
    const bg = new THREE.PlaneGeometry(bw, bh, 2, 10);
    const uv = bg.getAttribute('uv') as THREE.BufferAttribute;
    const cell = CLOTH_CELL.banner;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (cell[0] + uv.getX(i)) * 0.5, (1 - cell[1]) * 0.5 + uv.getY(i) * 0.5);
    const dir = f.d(0, 0, 1);
    ctx.cloth.add(bg, '#ffffff', f.m(x, 4.1 - bh / 2, 0.37), { aSway: (pp: THREE.Vector3) => [dir.x, 0, dir.z, Math.max(0, (G + 4.1 - pp.y) / bh) * 0.6] });
    S(ctx, cyl(0.02, 0.02, 0.66, 6), COL.gold, KIND.metal, f.m(x, 4.12, 0.38, 0, 0, Math.PI / 2));
    // flanking wall and railing out to the rim
    S(ctx, box(1.5, 0.55, 0.4), '#7f7b75', KIND.stone, f.m(sx * 3.3, 0.275, -0.2));
    S(ctx, box(1.5, 0.05, 0.08), '#2a2e38', KIND.metal, f.m(sx * 3.3, 0.95, -0.2));
    for (const px of [2.65, 3.3, 3.95]) S(ctx, box(0.05, 0.42, 0.05), '#2a2e38', KIND.metal, f.m(sx * px, 0.75, -0.2));
  }
  // arch with an inner glow ring and a crest
  S(ctx, new THREE.TorusGeometry(GATE_HALF, 0.17, 12, 48, Math.PI), '#e8ebf1', KIND.gloss, f.m(0, 4.4, 0));
  E(ctx, new THREE.TorusGeometry(GATE_HALF - 0.2, 0.04, 8, 48, Math.PI), CYAN, f.m(0, 4.4, 0.05));
  const cy = 4.4 + GATE_HALF + 0.1;
  S(ctx, cyl(0.5, 0.5, 0.1, 40), COL.gold, KIND.metal, f.m(0, cy, 0.08, Math.PI / 2));
  S(ctx, new THREE.CylinderGeometry(0.42, 0.42, 0.06, 40, 1, false, Math.PI / 2, Math.PI), COL.red, KIND.gloss, f.m(0, cy, 0.14, Math.PI / 2));
  S(ctx, new THREE.CylinderGeometry(0.42, 0.42, 0.06, 40, 1, false, -Math.PI / 2, Math.PI), COL.white, KIND.gloss, f.m(0, cy, 0.14, Math.PI / 2));
  S(ctx, box(0.86, 0.07, 0.06), '#202028', KIND.gloss, f.m(0, cy, 0.17));
  E(ctx, cyl(0.1, 0.1, 0.04, 20), C('#bff6ff', 4), f.m(0, cy, 0.19, Math.PI / 2));
  for (const sx of [-1, 1]) { // wings
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.75, 0.32); sh.lineTo(0.6, 0.05); sh.lineTo(0.85, -0.05); sh.lineTo(0.55, -0.12); sh.lineTo(0, -0.12);
    const wg = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false });
    S(ctx, wg, COL.gold, KIND.metal, f.m(sx * 0.45, cy + 0.02, 0.06, 0, 0, 0, sx, 1, 1));
  }
  halo(ctx, f.p(0, cy, 0.4), C('#ffd27a', 0.5), 2.0, 0, 0);
  // portal and the glowing marker on the floor
  ctx.portal = { frame: f, w: GATE_HALF - 0.36, h: 4.4 + GATE_HALF - 0.36 };
  E(ctx, new THREE.RingGeometry(0.5, 0.56, 48), C('#6ef0ff', 2.4), f.m(0, 0.014, 1.6, -Math.PI / 2));
  E(ctx, new THREE.RingGeometry(0.66, 0.68, 48), C('#6ef0ff', 1.4), f.m(0, 0.014, 1.6, -Math.PI / 2));
  pool(ctx, f.p(0, 0, 0.6), 3.4, '#3ee6ff', 1.6);
  pool(ctx, f.p(0, 0, 1.6), 1.2, '#9ff4ff', 0.8);
  ctx.ao.push({ x: g.x, z: g.z, hw: 2.6, hd: 0.6, rot: faceInRot(GATE_DEG), a: 0.4, blur: 0.4 });
}

// ---- south entrance ----------------------------------------------------------------------------------
export function buildSouthGate(ctx: Ctx): void {
  const f = new Frame(0, G, SOUTH_GATE_Z, 0);
  for (const sx of [-1, 1]) {
    const x = sx * SOUTH_GATE_HALF;
    S(ctx, rbox(0.55, 0.36, 0.55, 0.05), '#807c76', KIND.rock, f.m(x, 0.18, 0));
    S(ctx, cyl(0.13, 0.15, 2.3, 12), '#5b3a26', KIND.wood, f.m(x, 0.36 + 1.15, 0));
    S(ctx, box(2.2, 0.5, 0.36), '#807c76', KIND.stone, f.m(sx * 3.1, 0.25, 0.1));
    S(ctx, box(2.24, 0.06, 0.4), '#6a6660', KIND.stone, f.m(sx * 3.1, 0.53, 0.1));
  }
  S(ctx, bentBeam(4.3, 0.16, 0.22, 0.06), '#5b3a26', KIND.wood, f.m(0, 2.18, 0));
  S(ctx, box(3.7, 0.11, 0.14), '#5b3a26', KIND.wood, f.m(0, 1.86, 0));
  tiledRoof(ctx, f.m(0, 2.3, 0), 2.45, 0.72, 0.42, 0.12, COL.tile, 16, 5);
  // a hanging emblem plaque (ball shape) and two lanterns
  S(ctx, cyl(0.17, 0.17, 0.05, 24), COL.woodLight, KIND.wood, f.m(0, 2.02, -0.13, Math.PI / 2));
  S(ctx, new THREE.CylinderGeometry(0.13, 0.13, 0.03, 24, 1, false, Math.PI / 2, Math.PI), COL.red, KIND.gloss, f.m(0, 2.02, -0.16, Math.PI / 2));
  for (const sx of [-1, 1]) chochin(ctx, f, sx * 1.15, 1.52, 0, C('#ffb860', 2.8));
  pool(ctx, f.p(0, 0, 0), 2.6, '#ffb46e', 1.1);
  // the road keeps going south: lamps receding into the fog
  for (let i = 0; i < 6; i++) {
    const z = SOUTH_GATE_Z + 3.5 + i * 5.5;
    for (const sx of [-1, 1]) streetLamp(ctx, sx * 2.0, z, i > 2 ? 0 : 1);
  }
}

// ---- shrine garden ----------------------------------------------------------------------------------
export function buildGarden(ctx: Ctx): void {
  // torii-like gate, original proportions; local x runs along world -z
  const t = GARDEN.torii;
  const f = new Frame(t.x, G, t.z, Math.PI / 2);
  for (const sx of [-1, 1]) {
    S(ctx, cyl(0.105, 0.13, 2.55, 16), COL.vermilion, KIND.gloss, f.m(sx * t.half, 1.275, 0, 0, 0, sx * 0.025));
    S(ctx, cyl(0.15, 0.16, 0.24, 16), COL.black, KIND.gloss, f.m(sx * t.half, 0.12, 0));
  }
  S(ctx, box(3.05, 0.14, 0.1), COL.vermilion, KIND.gloss, f.m(0, 2.0, 0));
  S(ctx, bentBeam(3.4, 0.13, 0.2, 0.14), COL.vermilion, KIND.gloss, f.m(0, 2.5, 0));
  S(ctx, bentBeam(3.65, 0.12, 0.24, 0.16), COL.black, KIND.gloss, f.m(0, 2.63, 0));
  S(ctx, box(0.12, 0.38, 0.1), COL.vermilion, KIND.gloss, f.m(0, 2.25, 0));
  S(ctx, box(0.32, 0.3, 0.05), COL.black, KIND.gloss, f.m(0, 2.25, 0.07));
  S(ctx, cyl(0.08, 0.08, 0.02, 20), COL.gold, KIND.metal, f.m(0, 2.25, 0.1, Math.PI / 2));
  // stone lanterns
  for (const l of GARDEN.stoneLanterns) stoneLantern(ctx, l.x, l.z);
  // stage: wooden deck flush with the ground, stone rim
  const s = GARDEN.stage;
  const sf = new Frame(s.x, G, s.z, 0);
  S(ctx, cyl(s.r, s.r, 0.06, 48), '#8a5a36', KIND.wood, sf.m(0, -0.018, 0));
  const rim = new THREE.LatheGeometry([[s.r - 0.005, -0.03], [s.r - 0.005, 0.03], [s.r + 0.1, 0.03], [s.r + 0.13, -0.03]].map(([a, b]) => new THREE.Vector2(a, b)), 48);
  S(ctx, rim, '#9a958c', KIND.rock, sf.m(0, 0, 0));
  E(ctx, new THREE.RingGeometry(s.r - 0.09, s.r - 0.07, 64), C('#ffd9a0', 1.6), sf.m(0, 0.0135, 0, -Math.PI / 2));
  // backdrop: posts, plaster wall with a glowing moon window, small tiled roof, lanterns
  const b = GARDEN.backdrop;
  const bf = new Frame(b.x, G, b.z, Math.PI / 2);
  for (const sx of [-1, 1]) S(ctx, box(0.14, 2.35, 0.14), '#3a2418', KIND.wood, bf.m(sx * 1.3, 1.175, 0));
  S(ctx, box(2.48, 1.85, 0.1), COL.plaster, KIND.plaster, bf.m(0, 0.38 + 0.925, 0));
  S(ctx, box(2.5, 0.38, 0.13), COL.woodDark, KIND.wood, bf.m(0, 0.19, 0));
  S(ctx, box(2.6, 0.1, 0.16), '#3a2418', KIND.wood, bf.m(0, 2.27, 0));
  E(ctx, cyl(0.6, 0.6, 0.02, 48), C('#ffe2b0', 1.7), bf.m(0, 1.3, 0.055, Math.PI / 2), 0.3);
  S(ctx, new THREE.TorusGeometry(0.63, 0.045, 8, 48), '#3a2418', KIND.wood, bf.m(0, 1.3, 0.07));
  for (const ox of [-0.3, 0, 0.3]) { const ch = 2 * Math.sqrt(0.6 * 0.6 - ox * ox); S(ctx, box(0.025, ch, 0.025), '#2a1a12', KIND.wood, bf.m(ox, 1.3, 0.08)); }
  for (const oy of [-0.2, 0.2]) { const ch = 2 * Math.sqrt(0.6 * 0.6 - oy * oy); S(ctx, box(ch, 0.025, 0.025), '#2a1a12', KIND.wood, bf.m(0, 1.3 + oy, 0.08)); }
  halo(ctx, bf.p(0, 1.3, 0.3), C('#ffd9a0', 0.35), 2.4, 0, 0);
  tiledRoof(ctx, bf.m(0, 2.32, 0), 1.6, 0.42, 0.24, 0.09, COL.tile, 12, 4);
  for (const sx of [-1, 1]) chochin(ctx, bf, sx * 1.0, 1.98, 0.32, C('#ffd7a0', 2.6), 0.1, 0.24);
  pool(ctx, { x: s.x, z: s.z }, 2.5, '#ffc4a0', 1.1);
  pool(ctx, bf.p(0, 0, 0.4), 1.4, '#ffe0b0', 0.7);
  ctx.lightSpots.stage.set(s.x + 1.3, G + 1.9, s.z + 1.0);
  ctx.ao.push({ x: b.x, z: b.z, hw: 0.25, hd: 1.4, rot: 0, a: 0.5, blur: 0.25 });
  // pond: kidney-shaped water with a rock border
  const pd = GARDEN.pond;
  const shape = new THREE.Shape();
  const n = 48;
  const rad = (a: number) => 1 + 0.2 * Math.sin(2 * a + 0.5) + 0.08 * Math.cos(3 * a);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rad(a) * 1.85, y = Math.sin(a) * rad(a) * 1.1;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const pg = new THREE.ShapeGeometry(shape, 1);
  ctx.water.add(pg, '#ffffff', new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(pd.x, G + 0.022, pd.z), { aW: [2] });
  const rocks = 34;
  for (let i = 0; i < rocks; i++) {
    const a = (i / rocks) * Math.PI * 2 + Math.sin(i * 7.1) * 0.04;
    const rr = rad(a);
    const x = pd.x + Math.cos(a) * rr * 1.85 * 1.02, z = pd.z + Math.sin(a) * rr * 1.1 * 1.04;
    const sz = 0.13 + 0.07 * Math.abs(Math.sin(i * 3.7));
    const geo = new THREE.IcosahedronGeometry(sz, 0);
    S(ctx, geo, i % 3 ? '#6f6b66' : '#85807a', KIND.rock, new THREE.Matrix4().compose(new THREE.Vector3(x, G + sz * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(i, i * 2, 0)), new THREE.Vector3(1.3, 0.6, 1.0)));
  }
  // a few big garden rocks and bamboo against the wall
  for (const [x, z, sz] of [[-10.6, -5.6, 0.35], [-11.6, -3.2, 0.28], [-8.0, 3.0, 0.22]] as const) {
    S(ctx, new THREE.IcosahedronGeometry(sz, 1), '#6b6863', KIND.rock, new THREE.Matrix4().compose(new THREE.Vector3(x, G + sz * 0.35, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, x, 0.2)), new THREE.Vector3(1.4, 0.75, 1.1)));
    ctx.ao.push({ x, z, r: sz * 2.2, a: 0.35 });
  }
  for (const deg of [150, 168, 196, 212]) {
    const c = ringPos(deg, 12.75);
    for (let k = 0; k < 7; k++) {
      const x = c.x + Math.sin(k * 2.3 + deg) * 0.35, z = c.z + Math.cos(k * 1.7 + deg) * 0.35, h = 2.6 + (k % 3) * 0.5;
      S(ctx, cyl(0.03, 0.035, h, 6), '#5e8a3a', KIND.paint, new THREE.Matrix4().compose(new THREE.Vector3(x, G + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(k) * 0.06, 0, Math.cos(k) * 0.06)), new THREE.Vector3(1, 1, 1)));
    }
    for (let k = 0; k < 3; k++) leafClump(ctx, c.x + Math.sin(k * 2.1) * 0.3, G + 2.3 + k * 0.45, c.z + Math.cos(k * 2.1) * 0.3, 0.42, '#4f7d34', k + deg, 0.8);
  }
  ctx.fireflies.push({ x: pd.x, y: G + 0.7, z: pd.z, r: 2.2 }, { x: -9.5, y: G + 0.9, z: 2.6, r: 2.0 });
}

export function leafClump(ctx: Ctx, x: number, y: number, z: number, r: number, col: THREE.ColorRepresentation, seed: number, wind: number, detail = 1, sy = 1): void {
  const base = new THREE.Color(col);
  const g = new THREE.IcosahedronGeometry(r, detail);
  ctx.fol.add(g, (p: THREE.Vector3) => base.clone().multiplyScalar(0.7 + 0.45 * THREE.MathUtils.clamp((p.y - y) / r + 0.5, 0, 1)),
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(seed, seed * 1.3, 0)), new THREE.Vector3(1, sy, 1)),
    { aWind: [wind, seed] });
}

function stoneLantern(ctx: Ctx, x: number, z: number): void {
  const f = new Frame(x, G, z, 0.4);
  const st = '#8d8981';
  S(ctx, cyl(0.2, 0.22, 0.1, 6), st, KIND.rock, f.m(0, 0.05, 0));
  S(ctx, cyl(0.065, 0.08, 0.4, 8), st, KIND.rock, f.m(0, 0.3, 0));
  S(ctx, cyl(0.2, 0.15, 0.08, 6), st, KIND.rock, f.m(0, 0.54, 0));
  S(ctx, box(0.24, 0.22, 0.24), st, KIND.rock, f.m(0, 0.69, 0));
  const lc = C('#ffb05a', 3.0);
  E(ctx, box(0.13, 0.12, 0.25), lc, f.m(0, 0.7, 0), 1);
  E(ctx, box(0.25, 0.12, 0.13), lc, f.m(0, 0.7, 0), 1);
  S(ctx, new THREE.ConeGeometry(0.3, 0.17, 6), st, KIND.rock, f.m(0, 0.885, 0));
  S(ctx, new THREE.SphereGeometry(0.055, 8, 6), st, KIND.rock, f.m(0, 1.0, 0));
  halo(ctx, f.p(0, 0.7, 0), C('#ffb05a', 0.7), 1.0, 1, 0);
  pool(ctx, { x, z }, 1.3, '#ffa860', 0.85);
  ctx.ao.push({ x, z, r: 0.45, a: 0.4 });
}

// ---- fountain ---------------------------------------------------------------------------------------
export function buildFountain(ctx: Ctx): void {
  const f = new Frame(0, G, 0, 0);
  const v = (a: number, b: number) => new THREE.Vector2(a, b);
  S(ctx, new THREE.LatheGeometry([v(1.5, -0.02), v(1.5, 0.2), v(1.53, 0.26), v(1.38, 0.27), v(1.38, 0.0)], 72), '#b9b2a6', KIND.rock, f.m(0, 0, 0));
  S(ctx, new THREE.LatheGeometry([v(1.36, 0.25), v(1.62, 0.26), v(1.64, 0.33), v(1.6, 0.36), v(1.4, 0.36), v(1.36, 0.32)], 72), '#ebe6dc', KIND.gloss, f.m(0, 0, 0));
  E(ctx, new THREE.TorusGeometry(1.56, 0.012, 4, 96), C('#7ff0ff', 2.2), f.m(0, 0.362, 0, Math.PI / 2));
  ctx.water.add(new THREE.CircleGeometry(1.4, 64), '#ffffff', f.m(0, 0.27, 0, -Math.PI / 2), { aW: [0] });
  S(ctx, new THREE.LatheGeometry([v(0.36, 0), v(0.3, 0.12), v(0.22, 0.5), v(0.2, 0.9), v(0.3, 0.98)], 24), '#b9b2a6', KIND.rock, f.m(0, 0, 0));
  S(ctx, new THREE.LatheGeometry([v(0.18, 0.96), v(0.5, 0.98), v(0.76, 1.08), v(0.8, 1.16), v(0.76, 1.19), v(0.7, 1.15), v(0.4, 1.1), v(0.2, 1.1)], 40), '#ebe6dc', KIND.gloss, f.m(0, 0, 0));
  ctx.water.add(new THREE.CircleGeometry(0.72, 40), '#ffffff', f.m(0, 1.15, 0, -Math.PI / 2), { aW: [0] });
  ctx.water.add(new THREE.CylinderGeometry(0.79, 0.93, 0.88, 48, 1, true), '#ffffff', f.m(0, 0.71, 0), { aW: [1] });
  // sculpture: a stylised ball cradled by a crescent moon, rotating slowly (own mesh)
  const sc = ctx.sculpt, sg = ctx.sculptGlow;
  const SK = (g: THREE.BufferGeometry, c: THREE.ColorRepresentation, k: number, m: THREE.Matrix4) => sc.add(g, c, m, { aKind: [k] });
  const m = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  SK(cyl(0.06, 0.09, 0.42, 12), COL.gold, KIND.metal, m(0, 1.36, 0));
  const by = 1.92;
  SK(new THREE.TorusGeometry(0.46, 0.06, 10, 40, Math.PI * 1.25), COL.gold, KIND.metal, m(0, by, 0, 0, 0, -Math.PI * 1.12));
  SK(new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), COL.red, KIND.gloss, m(0, by, 0));
  SK(new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#f2f0ea', KIND.gloss, m(0, by, 0));
  SK(new THREE.TorusGeometry(0.3, 0.03, 8, 48), '#202028', KIND.gloss, m(0, by, 0, Math.PI / 2));
  for (const sz of [-1, 1]) {
    SK(cyl(0.09, 0.09, 0.05, 20), '#f2f0ea', KIND.gloss, m(0, by, sz * 0.3, Math.PI / 2));
    sg.add(cyl(0.05, 0.05, 0.02, 16), [0.6, 3.2, 4.2], m(0, by, sz * 0.33, Math.PI / 2), { aFlick: [0] });
  }
  sg.add(new THREE.TorusGeometry(0.312, 0.008, 4, 64), [0.5, 2.6, 3.4], m(0, by, 0, Math.PI / 2), { aFlick: [0] });
  // uplights around the basin foot
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    E(ctx, box(0.1, 0.03, 0.1), C('#7ff0ff', 3), f.m(Math.cos(a) * 1.72, 0.015, Math.sin(a) * 1.72, 0, -a));
  }
  halo(ctx, new THREE.Vector3(0, G + by, 0), C('#7fe8ff', 0.25), 2.2, 0, 0);
  pool(ctx, { x: 0, z: 0 }, 3.3, '#5fd8ff', 0.75);
  ctx.lightSpots.fountain.set(0, G + 1.0, 0.4);
  ctx.ao.push({ x: 0, z: 0, r: 2.0, a: 0.35 });
}

// ---- benches, lamps, planters ------------------------------------------------------------------------
export function buildBenches(ctx: Ctx): void {
  for (const d of BENCH_ANGLES) {
    const p = ringPos(d, BENCH_R);
    const f = new Frame(p.x, G, p.z, faceInRot(d));
    for (const sx of [-1, 1]) S(ctx, rbox(0.12, 0.25, 0.38, 0.02), '#8c8880', KIND.rock, f.m(sx * 0.42, 0.125, 0));
    for (let k = 0; k < 4; k++) S(ctx, box(1.12, 0.035, 0.08), '#9b6a42', KIND.wood, f.m(0, 0.268, -0.13 + k * 0.087));
    for (const sx of [-1, 1]) S(ctx, box(0.03, 0.32, 0.03), '#2a2e38', KIND.metal, f.m(sx * 0.42, 0.4, -0.18, -0.12));
    for (let k = 0; k < 2; k++) S(ctx, box(1.12, 0.055, 0.03), '#9b6a42', KIND.wood, f.m(0, 0.4 + k * 0.1, -0.2 - k * 0.012, -0.12));
    ctx.ao.push({ x: p.x, z: p.z, hw: 0.62, hd: 0.24, rot: faceInRot(d), a: 0.45, blur: 0.12 });
  }
}

export function streetLamp(ctx: Ctx, x: number, z: number, poolOn = 1): void {
  const f = new Frame(x, G, z, Math.PI / 4);
  S(ctx, cyl(0.07, 0.1, 0.18, 8), COL.metal, KIND.metal, f.m(0, 0.09, 0));
  S(ctx, cyl(0.03, 0.035, 1.9, 8), COL.metal, KIND.metal, f.m(0, 1.1, 0));
  S(ctx, box(0.24, 0.03, 0.24), COL.metal, KIND.metal, f.m(0, 2.06, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) S(ctx, box(0.02, 0.27, 0.02), COL.metal, KIND.metal, f.m(sx * 0.1, 2.2, sz * 0.1));
  E(ctx, box(0.18, 0.25, 0.18), WARM, f.m(0, 2.2, 0), 0.3);
  S(ctx, new THREE.ConeGeometry(0.2, 0.13, 4), COL.metal, KIND.metal, f.m(0, 2.4, 0, 0, Math.PI / 4));
  S(ctx, new THREE.SphereGeometry(0.03, 8, 6), COL.gold, KIND.metal, f.m(0, 2.48, 0));
  halo(ctx, f.p(0, 2.2, 0), WARM_SOFT.clone().multiplyScalar(0.9), 1.4, 0.2, 0);
  if (poolOn) pool(ctx, { x, z }, 2.5, '#ffc47e', 1.15);
  ctx.ao.push({ x, z, r: 0.3, a: 0.4 });
}

export function buildLamps(ctx: Ctx): void {
  for (const l of LAMPS) streetLamp(ctx, l.x, l.z);
  // the avenue to the stadium continues beyond the gate
  for (let i = 1; i <= 7; i++) {
    const c = ringPos(GATE_DEG, GATE_R + 2.5 + i * 5.5);
    const t = ringPos(GATE_DEG + 90, 2.1);
    for (const s of [-1, 1]) streetLamp(ctx, c.x + t.x * s, c.z + t.z * s, 0);
  }
}

export function buildPlanters(ctx: Ctx): void {
  for (const p of PLANTERS) {
    const f = new Frame(p.x, G, p.z, p.rot);
    S(ctx, rbox(p.hw * 2 + 0.08, 0.3, p.hd * 2 + 0.08, 0.05), '#8a857d', KIND.stone, f.m(0, 0.15, 0));
    S(ctx, box(p.hw * 2 - 0.06, 0.02, p.hd * 2 - 0.06), '#24180f', KIND.rock, f.m(0, 0.3, 0));
    ctx.ao.push({ x: p.x, z: p.z, hw: p.hw + 0.1, hd: p.hd + 0.1, rot: p.rot, a: 0.4, blur: 0.12 });
  }
}

// ---- perimeter: hedges, garden wall -----------------------------------------------------------------------
const HEDGE_RANGES: Array<[number, number]> = [[-140, -108], [-72, -62], [-28, -27], [-8.8, -2.2], [16.2, 22.8], [41, 70], [110, 140]];

export function buildRim(ctx: Ctx): void {
  const r = RIM_R + 0.3;
  for (const [a0, a1] of HEDGE_RANGES) {
    const arc = (a1 - a0) * DEG * r;
    const n = Math.max(1, Math.round(arc / 1.25));
    const step = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const d = a0 + step * (i + 0.5);
      const p = ringPos(d, r);
      const len = step * DEG * r + 0.12;
      const f = new Frame(p.x, G, p.z, faceInRot(d));
      S(ctx, rbox(len, 0.95, 0.72, 0.22, 2), COL.hedge, KIND.hedge, f.m(0, 0.47, 0));
      S(ctx, box(len, 0.12, 0.1), '#77736c', KIND.stone, f.m(0, 0.06, 0.42));
    }
  }
  // garden wall with a tiled coping, west side
  const wr = RIM_R + 0.2;
  const a0 = 140, a1 = 220;
  const n = Math.round(((a1 - a0) * DEG * wr) / 1.4);
  const step = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const d = a0 + step * (i + 0.5);
    const p = ringPos(d, wr);
    const len = step * DEG * wr + 0.04;
    const f = new Frame(p.x, G, p.z, faceInRot(d));
    S(ctx, box(len, 0.3, 0.34), '#7a766f', KIND.stone, f.m(0, 0.15, 0));
    S(ctx, box(len, 1.05, 0.24), '#e4dac4', KIND.plaster, f.m(0, 0.3 + 0.525, 0));
    tiledRoof(ctx, f.m(0, 1.33, 0), len / 2 + 0.01, 0.27, 0.1, 0.0, COL.tile, 4, 2, undefined, false);
    S(ctx, box(len, 0.05, 0.08), '#23252c', KIND.gloss, f.m(0, 1.45, 0));
  }
}

// ---- string lights ------------------------------------------------------------------------------------
const BULBS = [C('#ffd9a0', 3.2), C('#ffc94a', 3.0), C('#ff6a7a', 3.0), C('#7ff0ff', 3.0)];

export function stringLight(ctx: Ctx, a: THREE.Vector3, b: THREE.Vector3, sag: number, spacing = 0.42): void {
  const len = a.distanceTo(b);
  const n = Math.max(2, Math.round(len / 0.2));
  const pt = (t: number) => new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
  let prev = pt(0);
  for (let i = 1; i <= n; i++) { const p = pt(i / n); ctx.wires.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p; }
  const nb = Math.max(1, Math.floor(len / spacing));
  for (let i = 1; i < nb; i++) {
    const p = pt(i / nb).add(new THREE.Vector3(0, -0.04, 0));
    halo(ctx, p, BULBS[(((i + Math.round(a.x * 3)) % BULBS.length) + BULBS.length) % BULBS.length].clone(), 0.22, 0.15, 1.1);
  }
}

export function buildStringLights(ctx: Ctx): void {
  const top = (p: { x: number; z: number }, y = 2.45) => new THREE.Vector3(p.x, G + y, p.z);
  const ring = LAMPS.slice(0, 8);
  const order = [0, 1, 2, 3, 4, 5, 6, 7]; // 22.5, 67.5, ... around the plaza
  for (let i = 0; i < order.length; i++) stringLight(ctx, top(ring[order[i]]), top(ring[order[(i + 1) % order.length]]), 0.32);
  // forecourt of the Center, south avenue, toward the south gate
  stringLight(ctx, top(LAMPS[8]), top(LAMPS[9]), 0.35);
  stringLight(ctx, top(LAMPS[10]), top(LAMPS[11]), 0.3);
  for (const sx of [-1, 1]) stringLight(ctx, top(LAMPS[sx < 0 ? 10 : 11]), new THREE.Vector3(sx * SOUTH_GATE_HALF, G + 2.15, SOUTH_GATE_Z - 0.15), 0.25);
  // promenade lamps to the shop eaves
  SHOPS.forEach((s, i) => {
    const p = ringPos(s.deg, SHOP_R);
    const f = new Frame(p.x, G, p.z, faceInRot(s.deg));
    const lamp = i === 0 ? LAMPS[13] : LAMPS[12];
    for (const sx of i === 1 ? [-1, 1] : [i === 0 ? -1 : 1]) stringLight(ctx, top(lamp), f.p(sx * 1.85, 2.0, 2.15), 0.25);
  });
}
