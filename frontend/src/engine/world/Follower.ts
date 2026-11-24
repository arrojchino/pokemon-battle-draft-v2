import { Walker, type Bounds } from './Plaza.js';

/** Where a trainer stands and how fast it moves (units, radians, units per second). */
export type Leader = { x: number; z: number; face: number; speed: number; radius: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TRAIL = 48;

/**
 * A partner Pokemon walking with its trainer, the way partners do in the games:
 *  - on the move it walks in the trainer's footsteps: it heads for a point a little way back along the path the
 *    trainer actually walked (a breadcrumb trail), so it rounds corners behind them instead of cutting across or
 *    swinging around them, slightly off to its side;
 *  - when the trainer stops it settles behind and to the side it is already on (it never runs a lap to the other
 *    side), and turns to face where its trainer faces;
 *  - turning on the spot does not move it: only walking does;
 *  - it eases in and out at its own pace, trots to catch up, never slower than the trainer.
 * Pure simulation fed with each trainer's (interpolated) position, so every screen sees the same follow.
 */
export class Follower {
  readonly w = new Walker();
  /** -1 left of the trainer, 1 right (the side it starts on; it then keeps whichever side it is on). */
  side = 1;
  private placed = false;
  /** The trainer's recent path, newest last (x, z pairs), sampled every few centimetres of travel. */
  private trail: number[] = [];
  /** The facing the settle spot is built from: it follows the trainer's walking direction, not a turn on the spot. */
  private settleFace = 0;
  private walking = false;

  private gap(l: Leader) { return l.radius + this.w.radius + 0.22; }

  /** The settle spot: behind and to the partner's side of the trainer, further for bigger partners. */
  target(l: Leader, face = this.placed ? this.settleFace : l.face): { x: number; z: number } {
    const gap = this.gap(l);
    const back = Math.sin(face), fwd = Math.cos(face);
    // Right of a trainer facing +z is -x.
    const sx = -fwd * this.side, sz = back * this.side;
    return { x: l.x - back * gap * 0.75 + sx * gap * 0.7, z: l.z - fwd * gap * 0.75 + sz * gap * 0.7 };
  }

  /** Put the partner at its spot beside the trainer at once (arrival, a teleport, a long network jump). */
  snap(l: Leader, bounds: Bounds) {
    this.settleFace = l.face;
    const t = this.target(l, l.face), at = bounds(t.x, t.z, this.w.radius);
    this.w.set({ x: at.x, z: at.z, face: l.face });
    this.trail = [l.x, l.z];
    this.placed = true;
  }

  /** The point `dist` back along the trainer's path, with the path direction there. */
  private along(l: Leader, dist: number) {
    const tr = this.trail;
    let ax = l.x, az = l.z, left = dist;
    for (let i = tr.length - 2; i >= 0; i -= 2) {
      const bx = tr[i], bz = tr[i + 1], seg = Math.hypot(ax - bx, az - bz);
      if (seg >= left && seg > 1e-6) { const k = left / seg; return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dir: Math.atan2(ax - bx, az - bz) }; }
      left -= seg; ax = bx; az = bz;
    }
    // Path shorter than the gap (just started walking): straight behind the trainer.
    return { x: l.x - Math.sin(l.face) * dist, z: l.z - Math.cos(l.face) * dist, dir: l.face };
  }

  /** One frame. `hold` keeps it where it is (it is sitting, sleeping or playing a gesture). */
  update(dt: number, l: Leader, bounds: Bounds, hold = false) {
    const w = this.w;
    if (!this.placed) { this.snap(l, bounds); return; }
    // Far behind (a teleport, a long lag spike): appear beside the trainer instead of crossing the map.
    if (Math.hypot(l.x - w.x, l.z - w.z) > 7) { this.snap(l, bounds); return; }
    // Record the path the trainer walks.
    const tr = this.trail, n = tr.length;
    if (Math.hypot(l.x - tr[n - 2], l.z - tr[n - 1]) > 0.06) { tr.push(l.x, l.z); if (tr.length > TRAIL * 2) tr.splice(0, 2); }
    const walking = l.speed > 0.08;
    if (walking) this.settleFace = l.face;
    if (this.walking && !walking) {
      // Just stopped: settle on the side it is already on (relative to where the trainer faces).
      const rx = w.x - l.x, rz = w.z - l.z, right = -Math.cos(l.face) * rx + Math.sin(l.face) * rz;
      if (Math.abs(right) > 0.05) this.side = right > 0 ? 1 : -1;
    }
    this.walking = walking;
    if (hold) { w.steer(0, 0, 0, dt, bounds); return; }

    let t: { x: number; z: number };
    if (walking) {
      // In the trainer's footsteps, a partner's length back along the path, slightly to its side.
      const gap = this.gap(l), p = this.along(l, gap * 1.05), off = gap * 0.32 * this.side;
      t = { x: p.x - Math.cos(p.dir) * off, z: p.z + Math.sin(p.dir) * off };
    } else t = this.target(l);
    const dx = t.x - w.x, dz = t.z - w.z, d = Math.hypot(dx, dz);
    // Walk at its own pace; trot to catch up when the trainer pulls away, never slower than the trainer.
    const catchUp = Math.min(1.7, Math.max(1, d / 1.2));
    const pace = Math.max(w.walk * catchUp, l.speed * (d > 0.25 ? 1.05 : 0.95));
    const moving = d > (w.speed > 0.05 ? 0.06 : walking ? 0.12 : 0.35);
    if (moving) w.steer(dx / d, dz / d, pace * Math.min(1, d / 0.6), dt, bounds);
    else {
      // Settled: face where the trainer faces (turning on the spot).
      if (Math.abs(wrap(l.face - w.face)) > 0.3 && l.speed < 0.05) w.faceTo(w.x + Math.sin(l.face), w.z + Math.cos(l.face));
      w.steer(0, 0, 0, dt, bounds);
    }
  }
}
