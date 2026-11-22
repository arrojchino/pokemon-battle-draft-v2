import * as THREE from 'three';
import { PLAZA_R, type Spot } from '@shared';
import { FLOOR_Y } from '../character/MonRig.js';

/** Seat 0 walks in on the left, seat 1 on the right, each turned a little toward the other. */
export const PLAZA_SPAWN: readonly [Spot, Spot] = [{ x: -1.15, z: 0.6, face: 0.6 }, { x: 1.15, z: 0.6, face: -0.6 }];
/** Peer id of the rival in a room's plaza (the main plaza uses the server's member ids). */
export const RIVAL = 'rival';
/** Edge-to-edge distance that counts as standing next to someone. */
export const REACH = 1.1;
/**
 * Least time other people's partners are drawn behind their newest report, in seconds: a little more than the
 * ten-a-second report interval, so there is always a next spot to move toward and the motion never stalls. A peer
 * whose reports come slower or less evenly (a slow link) is drawn further behind, up to MAX_DELAY.
 */
export const INTERP_DELAY = 0.16;
const MAX_DELAY = 0.45;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const clamp = THREE.MathUtils.clamp;

/** Fallback walking pace (units per second) for a partner `h` units tall whose model has no measured stride. */
export function gaitSpeeds(h: number) {
  const walk = 0.8 + 0.6 * h;
  return { walk, run: walk };
}

/** Keeps a walker (a circle of radius r) on the walkable ground; returns the corrected position. */
export type Bounds = (x: number, z: number, r: number) => { x: number; z: number };
/** The round stadium platform. */
export const platform: Bounds = (x, z) => {
  const r = Math.hypot(x, z);
  return r > PLAZA_R ? { x: (x * PLAZA_R) / r, z: (z * PLAZA_R) / r } : { x, z };
};
/** Something round standing on the ground that walkers go around (the plaza host, a fountain). */
export type Obstacle = { x: number; z: number; r: number };
/** Bounds that also keep walkers out of each obstacle: they slide around it, never through. */
export function withObstacles(base: Bounds, obstacles: readonly Obstacle[]): Bounds {
  return (x, z, r) => {
    let at = base(x, z, r);
    for (const o of obstacles) {
      const dx = at.x - o.x, dz = at.z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
      if (d >= min) continue;
      at = base(d > 1e-4 ? o.x + (dx / d) * min : o.x + min, d > 1e-4 ? o.z + (dz / d) * min : o.z, r);
    }
    return at;
  };
}

/** One partner on the field: position, velocity and facing. Plazas are for walking: nobody runs. */
export class Walker {
  x = 0; z = 0; face = 0; vx = 0; vz = 0;
  /** Walking pace, units per second: the model's own stride when it is known, so the feet keep their grip. */
  walk = 1.2;
  /** Same as `walk` (kept for callers that still pass a run pace). */
  run = 1.2;
  radius = 0.33;
  /** Fastest turn, radians per second: big partners turn more slowly. */
  turn = 7;
  private pace = 0;
  /** A facing to turn toward while standing (faceTo); cleared once reached or on walking off. */
  private aim: number | null = null;
  get speed() { return Math.hypot(this.vx, this.vz); }
  size(h: number, stride?: number | null) {
    this.walk = this.run = stride ? clamp(stride, 0.55, 2.4) : gaitSpeeds(h).walk;
    this.radius = 0.18 + 0.22 * h;
    this.turn = clamp(6.5 / Math.sqrt(Math.max(0.5, h)), 3, 8);
  }
  set(s: Spot) { this.x = s.x; this.z = s.z; this.face = s.face; this.vx = this.vz = 0; this.pace = 0; this.aim = null; }
  /**
   * Walk toward a unit direction at `speed` (0 stops): turn toward it at a limited rate, hold back while the
   * turn is still large (a creature turns before it sets off), ease the pace in and out, and stay in bounds.
   */
  steer(dx: number, dz: number, speed: number, dt: number, bounds: Bounds = platform) {
    let want = 0;
    if (speed > 0 && (dx || dz)) {
      this.aim = null;
      const heading = Math.atan2(dx, dz);
      const step = clamp(wrap(heading - this.face) * ease(10, dt), -this.turn * dt, this.turn * dt);
      this.face = wrap(this.face + step);
      want = speed * THREE.MathUtils.smoothstep(Math.cos(wrap(heading - this.face)), 0.15, 0.9);
    } else if (this.aim !== null) {
      const d = wrap(this.aim - this.face);
      this.face = wrap(this.face + clamp(d * ease(8, dt), -this.turn * dt, this.turn * dt));
      if (Math.abs(d) < 0.02) this.aim = null;
    }
    this.pace += (want - this.pace) * ease(want > this.pace ? 6 : 9, dt);
    if (!want && this.pace < 0.03) this.pace = 0;
    const step = this.pace * dt;
    const at = bounds(this.x + Math.sin(this.face) * step, this.z + Math.cos(this.face) * step, this.radius);
    // Against an edge: the pace drops by the share of the step the edge took (it slides along, never through).
    const moved = Math.hypot(at.x - this.x, at.z - this.z);
    if (step > 1e-6 && moved < step * 0.999) this.pace *= moved / step;
    this.vx = dt > 0 ? (at.x - this.x) / dt : 0; this.vz = dt > 0 ? (at.z - this.z) / dt : 0;
    this.x = at.x; this.z = at.z;
  }
  /** Stand still where it is (a turn toward something carries on). */
  stop() { this.vx = this.vz = 0; this.pace = 0; }
  /** Turn on the spot (smoothly, at the turn rate) to look at a point. */
  faceTo(x: number, z: number) { this.aim = Math.atan2(x - this.x, z - this.z); }
}

/** A walk target: a floor point, or (with `greet`) the side of someone else's partner, followed as it moves. */
type Goal = { x: number; z: number; greet: string | null };
/** A reported spot and when it arrived (this plaza's clock). */
type Snap = Spot & { t: number };
/**
 * Someone else's partner, drawn `delay` seconds behind the reports it gets; `gap` tracks how far apart they
 * arrive. `here` once its rig is on the field.
 */
type Peer = { w: Walker; snaps: Snap[]; here: boolean; pace: number; gap: number; delay: number };
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
export const isMoveKey = (code: string) => code in MOVE_KEYS;

/**
 * A walkable plaza: a room's waiting room (this player and the rival) or the main plaza (everyone in it).
 * This player's partner goes where the keys or a click send it; everyone else's replays the spots the network
 * reports, interpolated a fraction of a second behind so it moves at an even pace. Simulation and a floor
 * marker only: the World turns walkers into rigs and a follow camera.
 */
export class Plaza {
  readonly me = new Walker();
  readonly peers = new Map<string, Peer>();
  /** Movement keys held (KeyboardEvent.code). */
  readonly keys = new Set<string>();
  /** Set to a peer's id when a walk up to it ends beside it; the World plays the greeting. */
  arrived: string | null = null;
  /** Walkable ground (the round platform unless the World sets another). */
  bounds: Bounds = platform;
  /** Seconds this player's partner stays put (getting up from a nap first); movement waits, it is not dropped. */
  hold = 0;
  readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private goal: Goal | null = null;
  private sent: Spot | null = null;
  private sentAt = -1;
  private clock = 0;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 48), mat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = FLOOR_Y + 0.012;
    this.marker.renderOrder = 3;
    this.marker.visible = false;
  }

  /** A new visit: this player's partner at `at`, nobody else on the field yet. */
  enter(at: Spot) {
    this.me.set(at);
    this.peers.clear(); this.goal = null; this.arrived = null; this.keys.clear(); this.hold = 0;
    this.resend();
  }
  /** Send this player's spot again on the next frame (someone just arrived or reconnected). */
  resend() { this.sent = null; this.sentAt = -1; }
  /** Someone else's partner, placed at `at` the first time it is asked for. */
  peer(id: string, at?: Spot): Walker {
    let p = this.peers.get(id);
    if (!p) {
      p = { w: new Walker(), snaps: [], here: false, pace: 0, gap: 0.1, delay: INTERP_DELAY };
      if (at) { p.w.set(at); p.snaps.push({ ...at, t: this.clock - 1 }); }
      this.peers.set(id, p);
    }
    return p.w;
  }
  /** Someone left: forget them (and stop walking up to them). */
  drop(id: string) {
    this.peers.delete(id);
    if (this.goal?.greet === id) this.goal = null;
    if (this.arrived === id) this.arrived = null;
  }
  /** Whether a peer's partner is on the field: only then does it block this player's and answer a click. */
  setHere(id: string, here: boolean) { const p = this.peers.get(id); if (p) p.here = here; }
  /** A spot reported for a peer. Long jumps (a reload, a reconnect) snap instead of crossing the field. */
  hear(id: string, s: Spot) {
    const p = this.peers.get(id);
    if (!p) return;
    const now = this.clock, last = p.snaps[p.snaps.length - 1];
    if (!last || Math.hypot(s.x - p.w.x, s.z - p.w.z) > 3.5) {
      p.w.set(s); p.pace = 0;
      p.snaps = [{ ...s, t: now - 1 }];
      return;
    }
    const since = now - last.t;
    // After a pause the walk starts from where they stood, now, not from a report seconds old.
    if (since > Math.max(0.3, 2.5 * p.gap)) p.snaps.push({ x: last.x, z: last.z, face: last.face, t: now - p.gap });
    // Otherwise it is the report interval: quick to grow, slow to shrink.
    else p.gap = since > p.gap ? since : p.gap + (since - p.gap) * 0.05;
    p.snaps.push({ ...s, t: now });
    if (p.snaps.length > 16) p.snaps.splice(0, p.snaps.length - 16);
  }
  /** Head for a floor point (pulled onto the walkable ground). */
  walkTo(x: number, z: number) {
    const at = this.bounds(x, z, this.me.radius);
    this.goal = { x: at.x, z: at.z, greet: null };
  }
  /** Walk up beside a peer's partner and greet it (it may move meanwhile: the walk follows it). */
  approach(id: string) {
    const p = this.peers.get(id);
    if (!p?.here) return;
    const at = this.beside(p.w);
    if (!at) { this.goal = null; this.arrived = id; return; }
    this.goal = { ...at, greet: id };
  }
  /** Stop where it stands, dropping any walk target (a gesture is about to play). */
  halt() { this.goal = null; this.me.stop(); }
  /** How far behind its reports a peer's partner is drawn, in seconds (its gestures wait as long). */
  delayOf(id: string) { return this.peers.get(id)?.delay ?? INTERP_DELAY; }
  /** Keys held or somewhere to go: the partner wants to walk (the World gets it up from a nap first). */
  get wantsToMove() { return this.keys.size > 0 || !!this.goal; }
  /** Where to stand next to `w`, on this player's side of it; null when already there. */
  private beside(w: Walker): { x: number; z: number } | null {
    const me = this.me;
    let dx = me.x - w.x, dz = me.z - w.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    const gap = me.radius + w.radius + 0.15;
    if (d <= gap + 0.1) return null;
    return { x: w.x + dx * gap, z: w.z + dz * gap };
  }
  /** Distance between this player's partner and a peer's, edge to edge (negative when they overlap). */
  gap(id: string) {
    const w = this.peers.get(id)?.w;
    return w ? Math.hypot(this.me.x - w.x, this.me.z - w.z) - this.me.radius - w.radius : Infinity;
  }
  /** The peer on the field nearest to `w` (this player's partner by default) within `reach`, edge to edge. */
  nearest(reach: number, w: Walker = this.me): string | null {
    let best: string | null = null, bestGap = reach;
    for (const [id, p] of this.peers) {
      if (!p.here || p.w === w) continue;
      const g = Math.hypot(w.x - p.w.x, w.z - p.w.z) - w.radius - p.w.radius;
      if (g < bestGap) { bestGap = g; best = id; }
    }
    return best;
  }
  spot(): Spot { return { x: this.me.x, z: this.me.z, face: this.me.face }; }
  get target(): { x: number; z: number } | null { return this.goal && !this.goal.greet ? this.goal : null; }

  /** One frame. Returns this player's spot when it should go out: at most ten times a second, only when it changed. */
  update(dt: number): Spot | null {
    this.clock += dt;
    const me = this.me;
    let dx = 0, dz = 0, speed = 0;
    for (const code of this.keys) { const v = MOVE_KEYS[code]; if (v) { dx += v[0]; dz += v[1]; } }
    if (dx || dz) {
      // Keys steer relative to the camera, which always looks up the field (-z). They cancel a click.
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      speed = me.walk;
      this.goal = null;
    } else if (this.goal) {
      const g = this.goal;
      // Walking up to someone: keep heading for their side as they move; stop once beside them.
      if (g.greet) {
        const p = this.peers.get(g.greet);
        const at = p?.here ? this.beside(p.w) : null;
        if (!p?.here) this.goal = null;
        else if (!at) { this.goal = null; this.arrived = g.greet; }
        else { g.x = at.x; g.z = at.z; }
      }
      if (this.goal) {
        const gx = g.x - me.x, gz = g.z - me.z, d = Math.hypot(gx, gz);
        // Slow down over the last stretch and stop on the spot instead of drifting past it.
        if (d < (g.greet ? 0.1 : 0.05)) { this.goal = null; me.set({ x: me.x, z: me.z, face: me.face }); if (g.greet) this.arrived = g.greet; }
        else { dx = gx / d; dz = gz / d; speed = me.walk * clamp(d / 0.9, 0.2, 1); }
      }
    }
    if (this.hold > 0) { this.hold = Math.max(0, this.hold - dt); speed = 0; }
    me.steer(dx, dz, speed, dt, this.bounds);

    for (const p of this.peers.values()) this.follow(p, dt);

    // Partners never walk through each other: this player's is pushed out of everyone else's circle.
    for (const [id, p] of this.peers) {
      if (!p.here) continue;
      const w = p.w, ox = me.x - w.x, oz = me.z - w.z, d = Math.hypot(ox, oz), min = me.radius + w.radius;
      if (d >= min) continue;
      const nx = d > 1e-4 ? ox / d : 1, nz = d > 1e-4 ? oz / d : 0;
      me.x = w.x + nx * min; me.z = w.z + nz * min;
      if (this.goal?.greet === id) { this.goal = null; this.arrived = id; }
    }

    // The floor marker pulses where a click sent the partner, and fades once it gets there.
    const t = this.target, mk = this.marker, mat = mk.material;
    if (t) { mk.position.x = t.x; mk.position.z = t.z; mk.visible = true; }
    mat.opacity += ((t ? 0.6 + 0.25 * Math.sin(this.clock * 7) : 0) - mat.opacity) * ease(t ? 18 : 10, dt);
    mk.scale.setScalar(1 + 0.12 * Math.sin(this.clock * 7));
    if (!t && mat.opacity < 0.02) mk.visible = false;

    const s = this.spot(), last = this.sent;
    const changed = !last || Math.abs(s.x - last.x) + Math.abs(s.z - last.z) > 0.015 || Math.abs(wrap(s.face - last.face)) > 0.05;
    if (changed && this.clock - this.sentAt >= 0.1) { this.sent = s; this.sentAt = this.clock; return s; }
    return null;
  }

  /**
   * Someone else's partner: the reported path, interpolated INTERP_DELAY behind the newest report (it holds at
   * the last one when reports stop). Its pace is smoothed for the walk cycle; it faces where it walks, and the
   * reported facing when it stands still.
   */
  private follow(p: Peer, dt: number) {
    const s = p.snaps, w = p.w;
    if (!s.length || dt <= 0) return;
    // The delay follows the report interval gently: a sudden jump would move the partner back along its path.
    p.delay += (clamp(p.gap * 1.25 + 0.03, INTERP_DELAY, MAX_DELAY) - p.delay) * ease(2, dt);
    const rt = this.clock - p.delay;
    let i = 0;
    while (i < s.length - 1 && s[i + 1].t <= rt) i++;
    if (i > 0) s.splice(0, i);
    const a = s[0], b = s[1];
    let x = a.x, z = a.z, face = a.face;
    if (b && rt > a.t) {
      const k = clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
      x = a.x + (b.x - a.x) * k; z = a.z + (b.z - a.z) * k; face = a.face + wrap(b.face - a.face) * k;
    }
    const mx = (x - w.x) / dt, mz = (z - w.z) / dt, m = Math.hypot(mx, mz);
    p.pace += (m - p.pace) * ease(12, dt);
    if (p.pace < 0.02 && m < 0.02) p.pace = 0;
    const k = m > 1e-5 ? p.pace / m : 0;
    w.vx = mx * k; w.vz = mz * k;
    w.x = x; w.z = z;
    const heading = p.pace > 0.12 && m > 0.05 ? Math.atan2(mx, mz) : face;
    w.face = wrap(w.face + clamp(wrap(heading - w.face) * ease(p.pace > 0.12 ? 10 : 8, dt), -w.turn * dt, w.turn * dt));
  }
}
