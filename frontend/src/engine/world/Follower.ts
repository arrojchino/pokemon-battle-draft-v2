import { Walker, type Bounds } from './Plaza.js';

/** Where a trainer stands and how fast it moves (units, radians, units per second). */
export type Leader = { x: number; z: number; face: number; speed: number; radius: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A partner Pokemon walking with its trainer. It heads for a spot just behind the trainer and off to one side,
 * at its own walking pace (faster, up to a trot, when it falls behind), stops when it gets there and turns to
 * face where its trainer faces. Pure simulation: the same code runs for every trainer on every screen, fed with
 * that trainer's (interpolated) position, so everyone sees each partner follow the same way.
 */
export class Follower {
  readonly w = new Walker();
  /** -1 left of the trainer, 1 right. */
  side = 1;
  private placed = false;

  /** The spot the partner wants: behind and to the side of the trainer, further for bigger partners. */
  target(l: Leader): { x: number; z: number } {
    const gap = l.radius + this.w.radius + 0.22;
    const back = Math.sin(l.face), fwd = Math.cos(l.face);
    // Right of a trainer facing +z is -x.
    const sx = -fwd * this.side, sz = back * this.side;
    return { x: l.x - back * gap * 0.75 + sx * gap * 0.7, z: l.z - fwd * gap * 0.75 + sz * gap * 0.7 };
  }

  /** Put the partner at its spot beside the trainer at once (arrival, a teleport, a long network jump). */
  snap(l: Leader, bounds: Bounds) {
    const t = this.target(l), at = bounds(t.x, t.z, this.w.radius);
    this.w.set({ x: at.x, z: at.z, face: l.face });
    this.placed = true;
  }

  /** One frame. `hold` keeps it where it is (it is sitting, sleeping or playing a gesture). */
  update(dt: number, l: Leader, bounds: Bounds, hold = false) {
    const w = this.w;
    if (!this.placed) { this.snap(l, bounds); return; }
    const t = this.target(l);
    const dx = t.x - w.x, dz = t.z - w.z, d = Math.hypot(dx, dz);
    // Far behind (a teleport, a long lag spike): appear beside the trainer instead of crossing the map.
    if (d > 7) { this.snap(l, bounds); return; }
    if (hold) { w.steer(0, 0, 0, dt, bounds); return; }
    // Walk at its own pace; trot to catch up when the trainer pulls away, never slower than the trainer.
    const catchUp = Math.min(1.7, Math.max(1, d / 1.2));
    const pace = Math.max(w.walk * catchUp, l.speed * 1.05);
    const moving = d > (w.speed > 0.05 ? 0.06 : 0.35);
    if (moving) w.steer(dx / d, dz / d, pace * Math.min(1, d / 0.6), dt, bounds);
    else {
      // Settled: face where the trainer faces (turning on the spot).
      if (Math.abs(wrap(l.face - w.face)) > 0.3 && l.speed < 0.05) w.faceTo(w.x + Math.sin(l.face), w.z + Math.cos(l.face));
      w.steer(0, 0, 0, dt, bounds);
    }
  }
}
