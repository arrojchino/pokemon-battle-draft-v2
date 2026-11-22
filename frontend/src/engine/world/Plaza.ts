import * as THREE from 'three';
import { PLAZA_R, type Spot } from '@shared';
import { FLOOR_Y } from '../character/MonRig.js';

/** Seat 0 walks in on the left, seat 1 on the right, each turned a little toward the other. */
export const PLAZA_SPAWN: readonly [Spot, Spot] = [{ x: -1.15, z: 0.6, face: 0.6 }, { x: 1.15, z: 0.6, face: -0.6 }];
/** Peer id of the rival in a room's plaza (the main plaza uses the server's member ids). */
export const RIVAL = 'rival';
/** Edge-to-edge distance within which a spar lands. */
export const REACH = 1.1;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** Ground speeds (units per second) for a partner `h` units tall: longer legs cover more ground. */
export function gaitSpeeds(h: number) {
  const walk = 0.8 + 0.6 * h;
  return { walk, run: walk * 2.2 };
}

/** One partner on the field: position, velocity and facing. */
export class Walker {
  x = 0; z = 0; face = 0; vx = 0; vz = 0;
  walk = 1.2; run = 2.6; radius = 0.33;
  get speed() { return Math.hypot(this.vx, this.vz); }
  size(h: number) { const g = gaitSpeeds(h); this.walk = g.walk; this.run = g.run; this.radius = 0.18 + 0.22 * h; }
  set(s: Spot) { this.x = s.x; this.z = s.z; this.face = s.face; this.vx = this.vz = 0; }
  /** Ease the velocity toward a unit direction times `speed`, move, stay on the platform, turn toward travel. */
  steer(dx: number, dz: number, speed: number, dt: number, accel = 9) {
    const k = ease(accel, dt);
    this.vx += (dx * speed - this.vx) * k; this.vz += (dz * speed - this.vz) * k;
    if (!speed && this.speed < 0.02) this.vx = this.vz = 0;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const r = Math.hypot(this.x, this.z);
    if (r > PLAZA_R) {
      // At the platform's edge: stop there and slide along it instead of pushing out.
      const nx = this.x / r, nz = this.z / r;
      this.x = nx * PLAZA_R; this.z = nz * PLAZA_R;
      const out = this.vx * nx + this.vz * nz;
      if (out > 0) { this.vx -= out * nx; this.vz -= out * nz; }
    }
    if (this.speed > 0.05) this.face += wrap(Math.atan2(this.vx, this.vz) - this.face) * ease(10, dt);
  }
  /** Turn on the spot to look at a point. */
  faceTo(x: number, z: number) { this.face = Math.atan2(x - this.x, z - this.z); }
}

/** A walk target: a floor point, or (with `greet`) the side of someone else's partner, followed as it moves. */
type Goal = { x: number; z: number; run: boolean; greet: string | null };
/** Someone else's partner: it eases toward the spots the network reports. `here` once its rig is on the field. */
type Peer = { w: Walker; net: Spot | null; here: boolean };
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
export const isMoveKey = (code: string) => code in MOVE_KEYS;

/**
 * A walkable plaza: a room's waiting room (this player and the rival) or the main plaza (everyone in it).
 * This player's partner goes where the keys or a click send it; everyone else's eases toward the spots the
 * network reports. Simulation and a floor marker only: the World turns walkers into rigs and a follow camera.
 */
export class Plaza {
  readonly me = new Walker();
  readonly peers = new Map<string, Peer>();
  /** Movement keys held (KeyboardEvent.code). */
  readonly keys = new Set<string>();
  running = false;
  /** Set to a peer's id when a walk up to it ends beside it; the World plays the greeting. */
  arrived: string | null = null;
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
    this.peers.clear(); this.goal = null; this.arrived = null; this.keys.clear(); this.running = false;
    this.resend();
  }
  /** Send this player's spot again on the next frame (someone just arrived or reconnected). */
  resend() { this.sent = null; this.sentAt = -1; }
  /** Someone else's partner, placed at `at` the first time it is asked for. */
  peer(id: string, at?: Spot): Walker {
    let p = this.peers.get(id);
    if (!p) { p = { w: new Walker(), net: null, here: false }; if (at) p.w.set(at); this.peers.set(id, p); }
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
  /** A spot reported for a peer. Long jumps (a reload, a reconnect) snap instead of sprinting across. */
  hear(id: string, s: Spot) {
    const p = this.peers.get(id);
    if (!p) return;
    p.net = s;
    if (Math.hypot(s.x - p.w.x, s.z - p.w.z) > 3.5) p.w.set(s);
  }
  /** Head for a floor point, clamped to the platform; far points are run to. */
  walkTo(x: number, z: number) {
    const r = Math.hypot(x, z), k = r > PLAZA_R ? PLAZA_R / r : 1;
    const gx = x * k, gz = z * k;
    this.goal = { x: gx, z: gz, run: Math.hypot(gx - this.me.x, gz - this.me.z) > 2.2, greet: null };
  }
  /** Walk up beside a peer's partner and greet it (it may move meanwhile: the walk follows it). */
  approach(id: string) {
    const p = this.peers.get(id);
    if (!p?.here) return;
    const at = this.beside(p.w);
    if (!at) { this.goal = null; this.arrived = id; return; }
    this.goal = { ...at, run: Math.hypot(p.w.x - this.me.x, p.w.z - this.me.z) > 2.4, greet: id };
  }
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
      speed = this.running ? me.run : me.walk;
      this.goal = null;
    } else if (this.goal) {
      const g = this.goal;
      // Walking up to someone: keep heading for their side as they move; stop once beside them.
      if (g.greet) {
        const p = this.peers.get(g.greet);
        const at = p?.here ? this.beside(p.w) : null;
        if (!p?.here) this.goal = null;
        else if (!at) { this.goal = null; me.vx = me.vz = 0; this.arrived = g.greet; }
        else { g.x = at.x; g.z = at.z; }
      }
      if (this.goal) {
        const gx = g.x - me.x, gz = g.z - me.z, d = Math.hypot(gx, gz);
        // Ease in over the last stretch, then stop on the spot instead of drifting past it.
        if (d < (g.greet ? 0.1 : 0.05)) { this.goal = null; me.vx = me.vz = 0; if (g.greet) this.arrived = g.greet; }
        else { dx = gx / d; dz = gz / d; speed = (g.run ? me.run : me.walk) * Math.min(1, Math.max(0.15, d / 0.7)); }
      }
    }
    me.steer(dx, dz, speed, dt);

    // Everyone else eases toward their reported spot and settles into the facing it reported.
    for (const p of this.peers.values()) {
      const w = p.w, n = p.net;
      if (!n) continue;
      const gx = n.x - w.x, gz = n.z - w.z, d = Math.hypot(gx, gz);
      if (d > 0.01) w.steer(gx / d, gz / d, Math.min(w.run * 1.3, d * 7), dt, 14);
      else w.steer(0, 0, 0, dt, 14);
      if (w.speed < 0.12) w.face += wrap(n.face - w.face) * ease(8, dt);
    }

    // Partners never walk through each other: this player's is pushed out of everyone else's circle.
    for (const [id, p] of this.peers) {
      if (!p.here) continue;
      const w = p.w, ox = me.x - w.x, oz = me.z - w.z, d = Math.hypot(ox, oz), min = me.radius + w.radius;
      if (d >= min) continue;
      const nx = d > 1e-4 ? ox / d : 1, nz = d > 1e-4 ? oz / d : 0;
      me.x = w.x + nx * min; me.z = w.z + nz * min;
      const into = me.vx * nx + me.vz * nz;
      if (into < 0) { me.vx -= into * nx; me.vz -= into * nz; }
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
}
