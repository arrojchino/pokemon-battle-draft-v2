import type { EnvShot, Vec3 } from '../types.js';
import { FLOOR_Y, pathX, pathY } from './layout.js';
import { clamp, smooth } from './shared.js';

/**
 * The intro's camera: keyframes in time, interpolated per component with a clamped cubic spline (C2 continuous,
 * so velocity and acceleration never jump), starting already in motion and ending at rest. Keys that frame the
 * partner are offsets from the partner spot scaled by f = clamp(sqrt(h / 1.1), 0.6, 1.4).
 */

/** A key: camera position and look-at point (kept within ~12 units of the camera so the spline never swings). */
type Key = { t: number; pos: Vec3; target: Vec3; fov: number };

const DEG = Math.PI / 180;

/** Clamped cubic spline through (t_i, y_i) with prescribed end slopes. */
class Spline {
  private readonly M: Float64Array;
  constructor(private readonly ts: number[], private readonly ys: number[], v0: number, vN: number) {
    const n = ts.length;
    const h: number[] = [];
    for (let i = 0; i < n - 1; i++) h.push(ts[i + 1] - ts[i]);
    const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), d = new Float64Array(n);
    b[0] = 2 * h[0]; c[0] = h[0]; d[0] = 6 * ((ys[1] - ys[0]) / h[0] - v0);
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i];
      d[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
    }
    a[n - 1] = h[n - 2]; b[n - 1] = 2 * h[n - 2]; d[n - 1] = 6 * (vN - (ys[n - 1] - ys[n - 2]) / h[n - 2]);
    for (let i = 1; i < n; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; d[i] -= m * d[i - 1]; }
    const M = new Float64Array(n);
    M[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i];
    this.M = M;
  }
  at(t: number): number {
    const { ts, ys, M } = this;
    const n = ts.length;
    if (t <= ts[0]) return ys[0];
    if (t >= ts[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const A = (ts[i + 1] - t) / h, B = (t - ts[i]) / h;
    return A * ys[i] + B * ys[i + 1] + ((A * A * A - A) * M[i] + (B * B * B - B) * M[i + 1]) * (h * h) / 6;
  }
}

export const DURATION = 12.5;
export const BEATS = [
  { t: 6.2, kind: 'reveal' as const },
  { t: 9.0, kind: 'title' as const },
  { t: DURATION, kind: 'end' as const },
];

/** A point on the path centre line at z, raised by `up` and shifted sideways by `side`. */
const onPath = (z: number, side: number, up: number): Vec3 => [pathX(z) + side, pathY(z) + up, z];

/**
 * The flight. Look-at points stay close to the camera (a few to 12 units), so the target spline never swings
 * between near and far points. Frames with the partner use offsets scaled by f (hero) or g (gentler, wide shots).
 */
export function buildKeys(h: number): Key[] {
  const f = clamp(Math.sqrt(h / 1.1), 0.6, 1.4);
  const g = 0.8 + 0.2 * f;
  const P: Vec3 = [0, FLOOR_Y, 0];
  const rel = (k: number, o: Vec3): Vec3 => [P[0] + o[0] * k, P[1] + o[1] * k, P[2] + o[2] * k];
  /** Look from `pos` toward azimuth/pitch (degrees), at a point `d` ahead. */
  const look = (pos: Vec3, az: number, pitch: number, d = 12): Vec3 => {
    const a = az * DEG, p = pitch * DEG;
    return [pos[0] + Math.sin(a) * Math.cos(p) * d, pos[1] + Math.sin(p) * d, pos[2] - Math.cos(a) * Math.cos(p) * d];
  };
  const K = (t: number, pos: Vec3, target: Vec3, fov: number): Key => ({ t, pos, target, fov });
  const crest1: Vec3 = [0.15, 1.7, 15.2], crest2: Vec3 = [-0.45, 5.4, 10.6];
  const hc = clamp(h, 0.4, 2.2);
  // the hero distance grows faster than f for tall partners so they keep head room inside the letterbox
  const kh = f * (1 + Math.max(0, f - 1) * 0.75);
  const sweep = rel(f, [-2.6, 1.85, 5.0]), hero = rel(kh, [0.34, 0.62, 3.1]);
  const heroD = Math.hypot(hero[0], hero[2]);
  const heroPitch = Math.atan2(FLOOR_Y + hc * 0.5 - hero[1], heroD) / DEG + 1.2;
  // wide shots pull back at least as far as the hero distance grew, so tall partners never get a dolly-in
  const gm = Math.max(g, kh * 0.95), ge = Math.max(g, kh * 0.8);
  const mid = rel(gm, [0.85, 1.4, 5.1]), end = rel(ge, [1.2, 2.1, 7.2]);
  const after: Vec3 = [hero[0] + 0.3 * g, hero[1] + 0.3 * g, hero[2] + 0.75 * g];
  return [
    // low dolly through the gate tunnel
    K(0.0, onPath(34.4, -0.22, 0.62), onPath(25.5, 0.05, 1.05), 38),
    K(1.8, onPath(27.9, -0.16, 0.66), onPath(18.8, 0.0, 1.2), 38),
    K(3.4, onPath(21.6, -0.08, 0.82), onPath(11.5, 0.0, 1.55), 39),
    // out of the tunnel, crane up over the crest: the valley opens below
    K(4.6, crest1, look(crest1, -2, -5), 40),
    K(5.9, crest2, look(crest2, -3, -19), 41),
    // the reveal (6.2) lands on the dais in the lower middle; the camera sweeps down and round from the left,
    // the partner against the town and the stadium
    K(7.5, sweep, rel(f, [0.1, 0.5, -0.4]), 36),
    // hero: low and close, the partner right of centre, the moon over its left shoulder above the town lights
    K(8.75, hero, look(hero, -16, heroPitch, heroD), 33),
    // ease out of the hero shot: keep the moon left of the title as the camera starts to rise
    K(9.7, after, look(after, -15, heroPitch - 2, heroD * 1.2), 34.5),
    // title: rise and pull back to the closing frame (title top centre, partner below it, moon upper left)
    K(10.6, mid, look(mid, -14, -3.2, 5.5 * gm), 37),
    K(DURATION, end, look(end, -13, -4.2, 8 * ge), 40),
  ];
}

export class CameraTrack {
  private sp: Spline[] = [];
  constructor(h = 1.0) { this.setHeight(h); }
  setHeight(h: number) {
    const keys = buildKeys(h);
    const ts = keys.map((k) => k.t);
    const k0 = keys[0], k1 = keys[1], dt = k1.t - k0.t;
    // start already moving along the path at the first segment's pace; end at rest
    const ch = (sel: (k: Key) => number) => new Spline(ts, keys.map(sel), (sel(k1) - sel(k0)) / dt, 0);
    this.sp = [
      ch((k) => k.pos[0]), ch((k) => k.pos[1]), ch((k) => k.pos[2]),
      ch((k) => k.target[0]), ch((k) => k.target[1]), ch((k) => k.target[2]), ch((k) => k.fov),
    ];
  }
  shotAt(t: number, out: EnvShot): EnvShot {
    const tt = clamp(t, 0, DURATION);
    const s = this.sp;
    // a breath of handheld drift (smooth sines), gone by the closing frame
    const hh = 1 - smooth(DURATION - 2.2, DURATION, tt);
    const dx = (Math.sin(tt * 0.83 + 0.4) * 0.012 + Math.sin(tt * 1.97 + 2.1) * 0.005) * hh;
    const dy = (Math.sin(tt * 1.13 + 1.7) * 0.01 + Math.sin(tt * 2.41) * 0.004) * hh;
    out.pos[0] = s[0].at(tt) + dx; out.pos[1] = s[1].at(tt) + dy; out.pos[2] = s[2].at(tt);
    out.target[0] = s[3].at(tt) + dx * 0.5; out.target[1] = s[4].at(tt) + dy * 0.5; out.target[2] = s[5].at(tt);
    out.fov = s[6].at(tt);
    return out;
  }
}
