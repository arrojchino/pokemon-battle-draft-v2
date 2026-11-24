/**
 * Town layout: every placement the town builds from, the walker colliders and the pure `bounds` solver.
 * No three.js here so tests (and anything else) can import it without a scene.
 *
 * Scale: about 1.7 m per unit (trainers 0.98 tall, partners 0.32 to 1.35). +z points toward the default camera,
 * ground at FLOOR_Y. Ring angles use `ringPos(deg, r)`: 0 deg is +x (east), 90 deg is +z (south), -90 deg is -z (north).
 * Box colliders follow three.js `rotation.y = rot`: world = (c*lx + s*lz, -s*lx + c*lz) with c = cos rot, s = sin rot.
 */
import type { Collider, EnvShot, EnvSpot } from '../types.js';

export const FLOOR_Y = 0.205;
/** Walkable disc radius: every walker stays within RADIUS - r of the origin. */
export const RADIUS = 12.5;
/** Perimeter hedges and walls stand on this ring, just outside the walkable disc. */
export const RIM_R = 12.95;

export const DEG = Math.PI / 180;
export function ringPos(deg: number, r: number): { x: number; z: number } {
  return { x: Math.cos(deg * DEG) * r, z: Math.sin(deg * DEG) * r };
}
/** rotation.y that makes an object's local +z face the origin from ring angle `deg`. */
export function faceInRot(deg: number): number {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return Math.atan2(-c, -s);
}

// ---- landmarks -------------------------------------------------------------------------------
export const FOUNTAIN = { x: 0, z: 0, r: 1.6, collider: 1.7 };
export const PLAZA_R = 5.6;
/** Pokemon Center style hall: footprint centre and half sizes; the glass front is at z = -8.8. */
export const CENTER = { x: 0, z: -11.0, hw: 4.0, hd: 2.2 };
/** Three small shops on the east arc (ring angle in degrees), fronts facing the fountain. */
export const SHOP_R = 10.8;
export const SHOPS = [
  { deg: -18, kind: 'potion' as const },
  { deg: 7, kind: 'ball' as const },
  { deg: 32, kind: 'berry' as const },
];
export const SHOP_HW = 1.75;
export const SHOP_HD = 1.6;
/** Stadium gate arch on the north-east ring. */
export const GATE_DEG = -45;
export const GATE_R = 11.5;
export const GATE_HALF = 2.0;
/** South entrance gateway. */
export const SOUTH_GATE_Z = 12.0;
export const SOUTH_GATE_HALF = 1.8;
/** Shrine garden (west). */
export const GARDEN = {
  torii: { x: -6.9, z: 0, half: 1.25 },
  stage: { x: -9.8, z: 0, r: 1.05 },
  backdrop: { x: -11.25, z: 0, hw: 0.16, hd: 1.35 },
  pond: { x: -9.0, z: -3.9 },
  stoneLanterns: [
    { x: -7.9, z: -1.75 }, { x: -7.9, z: 1.75 }, { x: -10.75, z: -1.95 }, { x: -10.75, z: 1.95 },
  ],
};

export const BENCH_ANGLES = [-157.5, -112.5, -67.5, -22.5, 22.5, 67.5, 112.5, 157.5];
export const BENCH_R = 4.45;
export const BENCH_HW = 0.56;
export const BENCH_HD = 0.2;

/** Street lamps: plaza ring between the paths, then along the avenues. */
export const LAMPS: Array<{ x: number; z: number }> = [
  ...[22.5, 67.5, 112.5, 157.5, -157.5, -112.5, -67.5, -22.5].map(d => ringPos(d, 5.95)),
  { x: -2.75, z: -7.75 }, { x: 2.75, z: -7.75 },
  { x: -1.75, z: 8.7 }, { x: 1.75, z: 8.7 },
  { x: 7.35, z: 2.65 }, { x: 7.3, z: -2.85 },
];

export type TreeKind = 'cherry' | 'maple' | 'round' | 'pine';
/** Trees inside the walkable ring (they block walkers). `s` scales a tree of about 3.6 units. */
export const TREES: Array<{ x: number; z: number; kind: TreeKind; s: number }> = [
  // shrine garden
  { x: -11.0, z: -1.75, kind: 'cherry', s: 1.0 },
  { x: -9.6, z: 3.75, kind: 'cherry', s: 0.95 },
  { x: -7.5, z: 4.4, kind: 'maple', s: 0.8 },
  { x: -11.4, z: 2.95, kind: 'maple', s: 0.72 },
  { x: -7.1, z: -5.5, kind: 'cherry', s: 0.9 },
  // gaps between landmarks on the ring
  { ...ringPos(-31, 11.2), kind: 'round', s: 0.9 },
  { ...ringPos(-60, 11.5), kind: 'pine', s: 0.95 },
  { ...ringPos(-125, 11.0), kind: 'round', s: 1.0 },
  { ...ringPos(-5.5, 11.6), kind: 'cherry', s: 0.62 },
  { ...ringPos(19.5, 11.7), kind: 'maple', s: 0.62 },
  // south lawns
  { ...ringPos(52, 10.3), kind: 'round', s: 0.95 },
  { ...ringPos(70, 11.0), kind: 'cherry', s: 0.85 },
  { ...ringPos(110, 11.0), kind: 'cherry', s: 0.85 },
  { ...ringPos(128, 10.5), kind: 'round', s: 0.95 },
  { ...ringPos(145, 11.3), kind: 'pine', s: 0.85 },
];

/** Flower planters (raised beds with a stone curb): centre, half sizes, rotation. */
export const PLANTERS: Array<{ x: number; z: number; hw: number; hd: number; rot: number }> = [
  ...[60, 120].map(d => ({ ...ringPos(d, 7.5), hw: 1.25, hd: 0.42, rot: faceInRot(d) })),
  ...[79, 101].map(d => ({ ...ringPos(d, 10.0), hw: 0.75, hd: 0.38, rot: faceInRot(d) })),
  { x: -4.7, z: -7.9, hw: 0.36, hd: 0.7, rot: 0 },
  { x: 4.7, z: -7.9, hw: 0.36, hd: 0.7, rot: 0 },
];

// ---- ground regions (shared by the ground shader and the scatter code) -------------------------------
function sdSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const pax = px - ax, paz = pz - az, bax = bx - ax, baz = bz - az;
  const h = Math.max(0, Math.min(1, (pax * bax + paz * baz) / (bax * bax + baz * baz)));
  return Math.hypot(pax - bax * h, paz - baz * h);
}
function sdBox(px: number, pz: number, bx: number, bz: number): number {
  const dx = Math.abs(px) - bx, dz = Math.abs(pz) - bz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}
/** Signed distance to any paved surface (plaza, avenues, forecourt, promenade). Mirrors the ground shader. */
export function pavedDistance(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ang = Math.atan2(z, x);
  let d = r - PLAZA_R;
  d = Math.min(d, sdSeg(x, z, 0, -5, 0, -7.4) - 1.6);
  d = Math.min(d, sdBox(x, z + 8.35, 5.0, 1.0));
  d = Math.min(d, sdSeg(x, z, 3.7, -3.7, 80, -80) - 1.2);
  d = Math.min(d, sdSeg(x, z, 5, 0.3, 7.6, 0.6) - 1.0);
  d = Math.min(d, Math.max(Math.abs(r - 8.25) - 0.85, Math.max(-0.6 - ang, ang - 0.8) * r));
  d = Math.min(d, sdSeg(x, z, 0, 5, 0, 90) - 1.35);
  d = Math.min(d, sdSeg(x, z, -5, 0, -7.4, 0) - 1.0);
  return d;
}
/** Signed distance to the raked gravel of the shrine garden. */
export function gardenDistance(x: number, z: number): number {
  return Math.hypot(x + 9.9, z * 0.85) - 4.1;
}

// ---- spots --------------------------------------------------------------------------------------
export const SPAWN: EnvSpot = { x: 0, z: 7.5, face: Math.PI };
const gateSpot = ringPos(GATE_DEG, 9.9);
export const SPOTS: { host: EnvSpot; showcase: EnvSpot; showcaseCam: EnvShot; gathering: EnvSpot; gate: EnvSpot } = {
  host: { x: 0, z: -8.0, face: 0 },
  showcase: { x: GARDEN.stage.x, z: GARDEN.stage.z, face: Math.PI / 2 - 0.12 },
  // three-quarter view from the garden path: the moon window and blossoms frame a partner standing on the stage
  showcaseCam: { pos: [GARDEN.stage.x + 2.0, 0.98, GARDEN.stage.z + 1.75], target: [GARDEN.stage.x - 0.12, 0.62, GARDEN.stage.z - 0.06], fov: 34 },
  gathering: { x: 0, z: 2.85, face: 0 },
  gate: { x: gateSpot.x, z: gateSpot.z, face: Math.atan2(Math.cos(GATE_DEG * DEG), Math.sin(GATE_DEG * DEG)) },
};

// ---- colliders ----------------------------------------------------------------------------------
function box(x: number, z: number, hw: number, hd: number, rot = 0): Collider { return { kind: 'box', x, z, hw, hd, rot }; }
function circle(x: number, z: number, r: number): Collider { return { kind: 'circle', x, z, r }; }

export function buildColliders(): Collider[] {
  const out: Collider[] = [];
  out.push(circle(FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.collider));
  out.push(box(CENTER.x, CENTER.z, CENTER.hw, CENTER.hd));
  for (const s of SHOPS) { const p = ringPos(s.deg, SHOP_R); out.push(box(p.x, p.z, SHOP_HW, SHOP_HD, faceInRot(s.deg))); }
  { // gate: two towers and a deep block behind the portal so nobody slips past it
    const rot = faceInRot(GATE_DEG);
    const c = Math.cos(rot), s = Math.sin(rot);
    const g = ringPos(GATE_DEG, GATE_R);
    for (const side of [-1, 1]) { const lx = side * GATE_HALF; out.push(circle(g.x + c * lx, g.z - s * lx, 0.6)); }
    const back = ringPos(GATE_DEG, GATE_R + 0.75);
    out.push(box(back.x, back.z, GATE_HALF, 0.8, rot));
  }
  for (const sx of [-SOUTH_GATE_HALF, SOUTH_GATE_HALF]) out.push(circle(sx, SOUTH_GATE_Z, 0.3));
  // shrine garden
  for (const sz of [-GARDEN.torii.half, GARDEN.torii.half]) out.push(circle(GARDEN.torii.x, sz, 0.18));
  out.push(box(GARDEN.backdrop.x, GARDEN.backdrop.z, GARDEN.backdrop.hw, GARDEN.backdrop.hd));
  out.push(circle(GARDEN.pond.x, GARDEN.pond.z, 1.05));
  out.push(circle(GARDEN.pond.x - 1.0, GARDEN.pond.z + 0.3, 0.8));
  out.push(circle(GARDEN.pond.x + 1.05, GARDEN.pond.z - 0.2, 0.75));
  for (const l of GARDEN.stoneLanterns) out.push(circle(l.x, l.z, 0.22));
  // street furniture
  for (const l of LAMPS) out.push(circle(l.x, l.z, 0.14));
  for (const t of TREES) out.push(circle(t.x, t.z, 0.3 * t.s + 0.08));
  for (const d of BENCH_ANGLES) { const p = ringPos(d, BENCH_R); out.push(box(p.x, p.z, BENCH_HW, BENCH_HD, faceInRot(d))); }
  for (const p of PLANTERS) out.push(box(p.x, p.z, p.hw, p.hd, p.rot));
  return out;
}

/** Push a walker circle (x, z, r) out of one collider; returns null when they do not overlap. */
export function pushOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
  if (c.kind === 'circle') {
    let dx = x - c.x, dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { // dead centre: push toward the origin side (or +z when the collider sits on the origin)
      const ox = -c.x, oz = -c.z, ol = Math.hypot(ox, oz);
      if (ol > 1e-6) { dx = ox / ol; dz = oz / ol; } else { dx = 0; dz = 1; }
      d = 1;
    }
    return { x: c.x + (dx / d) * min, z: c.z + (dz / d) * min };
  }
  const co = Math.cos(c.rot), si = Math.sin(c.rot);
  const dx = x - c.x, dz = z - c.z;
  let lx = co * dx - si * dz;
  let lz = si * dx + co * dz;
  const qx = Math.max(-c.hw, Math.min(c.hw, lx));
  const qz = Math.max(-c.hd, Math.min(c.hd, lz));
  const ex = lx - qx, ez = lz - qz;
  const d = Math.hypot(ex, ez);
  if (d >= r) return null;
  if (d > 1e-9) {
    lx = qx + (ex / d) * r; lz = qz + (ez / d) * r;
  } else { // centre inside the box: leave through the nearest face
    const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
    if (px < pz) lx = (lx < 0 ? -1 : 1) * (c.hw + r);
    else lz = (lz < 0 ? -1 : 1) * (c.hd + r);
  }
  return { x: c.x + co * lx + si * lz, z: c.z - si * lx + co * lz };
}

/** Keep a walker of radius r inside the walkable disc and outside every collider (slides along surfaces). */
export function solveBounds(colliders: readonly Collider[], radius: number, x: number, z: number, r: number): { x: number; z: number } {
  const maxR = Math.max(0, radius - r);
  let px = x, pz = z;
  const clamp = () => {
    const d = Math.hypot(px, pz);
    if (d > maxR) { px *= maxR / d; pz *= maxR / d; }
  };
  clamp();
  for (let it = 0; it < 6; it++) {
    let moved = false;
    for (const c of colliders) {
      const p = pushOut(c, px, pz, r);
      if (p) { px = p.x; pz = p.z; moved = true; }
    }
    clamp();
    if (!moved) return { x: px, z: pz };
  }
  // Still wedged (a corner where a building meets the rim pushes back and forth): walk toward the plaza until clear.
  const free = (x0: number, z0: number) => Math.hypot(x0, z0) <= maxR + 1e-9 && !colliders.some(c => pushOut(c, x0, z0, r - 1e-6));
  if (free(px, pz)) return { x: px, z: pz };
  const d = Math.hypot(px, pz);
  for (let s = d; s > 0; s -= 0.04) {
    const qx = (px / d) * s, qz = (pz / d) * s;
    if (free(qx, qz)) {
      // settle once more so the result sits against the surface rather than a step inside open ground
      let ox = qx, oz = qz;
      for (const c of colliders) { const p = pushOut(c, ox, oz, r); if (p) { ox = p.x; oz = p.z; } }
      return free(ox, oz) ? { x: ox, z: oz } : { x: qx, z: qz };
    }
  }
  return { x: px, z: pz };
}
