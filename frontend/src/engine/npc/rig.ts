// Rig math for the presenter NPC: damping helpers, Euler poses and an analytic two-bone IK that works on
// the VRM *normalized* humanoid (every bone's rest rotation is identity, so a pose is just local rotations).
//
// Conventions: poses and targets are authored in "body space", the VRM 1.0 frame: the character faces +Z,
// her left is +X, up is +Y, units are model metres (before the Presenter's scale). VRM 0.x models are stored
// facing -Z; `flipQ`/`flipV` convert between the two (a 180° turn about Y, the same conversion
// three-vrm-animation applies to VRMA clips).
import * as THREE from 'three';

export type Vec3 = readonly [number, number, number];

/** Frame-rate independent exponential approach factor for a rate `k` (1/s). */
export const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (x: number) => { const t = clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Smooth 0..1..0 bump over [a, b] with ease in/out widths. */
export const bump = (t: number, a: number, b: number, ein: number, eout: number) =>
  smooth((t - a) / ein) * (1 - smooth((t - (b - eout)) / eout));
export const wrapAngle = (a: number) => { let x = (a + Math.PI) % (Math.PI * 2); if (x < 0) x += Math.PI * 2; return x - Math.PI; };
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Smooth value noise (sum of incommensurate sines): calm, never repeats visibly. */
export function drift(t: number, seed: number): number {
  return (Math.sin(t * 0.37 + seed * 1.7) * 0.5 + Math.sin(t * 0.61 + seed * 3.1) * 0.3 + Math.sin(t * 1.13 + seed * 5.3) * 0.2);
}

/** Critically damped spring on a scalar, optionally speed-limited. Returns the new value; `state.v` holds velocity. */
export function spring(x: number, target: number, state: { v: number }, omega: number, dt: number, vmax = Infinity): number {
  // sub-step so large frame gaps stay stable
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = omega * omega * (target - x) - 2 * omega * state.v;
    state.v = clamp(state.v + a * h, -vmax, vmax);
    x += state.v * h;
  }
  return x;
}

export const flipQ = (q: THREE.Quaternion) => q.set(-q.x, q.y, -q.z, q.w);
export const flipV = (v: THREE.Vector3) => v.set(-v.x, v.y, -v.z);

const _e = new THREE.Euler();
export function quatFromEuler(out: THREE.Quaternion, x: number, y: number, z: number, order: THREE.EulerOrder): THREE.Quaternion {
  return out.setFromEuler(_e.set(x, y, z, order));
}

// ------------------------------------------------------------------ two-bone IK
export interface Limb {
  /** Rest position of the upper joint in its parent's frame (body-space axes). */
  root: THREE.Vector3;
  /** Rest direction (unit) and length of the upper and lower segments. */
  a: THREE.Vector3; L1: number;
  b: THREE.Vector3; L2: number;
  /** Rest flex direction: where the lower segment bends toward (unit, orthogonal to a). */
  f: THREE.Vector3;
  /** Rest end-effector frame: `along` (fingers/toes direction) and `normal` (palm/sole normal). */
  along: THREE.Vector3; normal: THREE.Vector3;
}

export function makeLimb(root: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3, flexHint: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3): Limb {
  const a = mid.clone().normalize(); const b = end.clone().normalize();
  const f = flexHint.clone().addScaledVector(a, -flexHint.dot(a)).normalize();
  return { root: root.clone(), a, L1: mid.length(), b, L2: end.length(), f, along: along.clone().normalize(), normal: normal.clone().normalize() };
}

const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Vector3(), _l = new THREE.Vector3();
const _fp = new THREE.Vector3(), _h = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
const _M1 = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

/** Rotation taking the orthonormal frame (x0, y0) to (x1, y1). */
function frameRotation(out: THREE.Quaternion, x0: THREE.Vector3, y0: THREE.Vector3, x1: THREE.Vector3, y1: THREE.Vector3) {
  _M1.makeBasis(x0, y0, _c0.crossVectors(x0, y0));
  _M2.makeBasis(x1, y1, _c1.crossVectors(x1, y1));
  _M1.transpose();
  return out.setFromRotationMatrix(_M2.multiply(_M1));
}

export interface IKGoal {
  /** End joint (wrist / ankle) position in the limb parent's frame. */
  target: THREE.Vector3;
  /** Direction the middle joint (elbow / knee) is pushed toward. */
  pole: THREE.Vector3;
  /** Desired end frame in the limb parent's frame, or null to keep the end bone straight. */
  along?: THREE.Vector3 | null; normal?: THREE.Vector3 | null;
  /** Share of the end roll moved into the lower segment (forearm pronation), 0..1. */
  twistShare?: number;
}

/**
 * Solves upper/lower/end local rotations for a limb whose rest rotations are identity.
 * Out quaternions are local to their parents (upper relative to the limb parent frame).
 */
export function solveLimb(limb: Limb, goal: IKGoal, outUpper: THREE.Quaternion, outLower: THREE.Quaternion, outEnd: THREE.Quaternion | null) {
  _d.subVectors(goal.target, limb.root);
  let dist = _d.length();
  const maxReach = (limb.L1 + limb.L2) * 0.9995, minReach = Math.abs(limb.L1 - limb.L2) + 1e-3;
  if (dist < 1e-6) _d.set(0, -1, 0); else _d.multiplyScalar(1 / dist);
  dist = clamp(dist, minReach, maxReach);
  const cosA = clamp((limb.L1 * limb.L1 + dist * dist - limb.L2 * limb.L2) / (2 * limb.L1 * dist), -1, 1);
  const A = Math.acos(cosA);
  _p.copy(goal.pole).addScaledVector(_d, -goal.pole.dot(_d));
  if (_p.lengthSq() < 1e-8) { _p.set(0, 0, 1).addScaledVector(_d, -_d.z); if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0); }
  _p.normalize();
  _u.copy(_d).multiplyScalar(Math.cos(A)).addScaledVector(_p, Math.sin(A)); // upper segment direction
  _m.copy(limb.root).addScaledVector(_u, limb.L1);                           // middle joint
  _l.copy(limb.root).addScaledVector(_d, dist).sub(_m).normalize();          // lower segment direction
  _fp.copy(_l).addScaledVector(_u, -_l.dot(_u));
  if (_fp.lengthSq() < 1e-8) _fp.copy(_p).negate();
  _fp.normalize();
  frameRotation(outUpper, limb.a, limb.f, _u, _fp);
  // lower: shortest arc from its rest direction to the wanted one, in the upper bone's frame
  _q1.copy(outUpper).invert();
  _t3.copy(_l).applyQuaternion(_q1);
  outLower.setFromUnitVectors(limb.b, _t3);
  if (!outEnd) return;
  if (!goal.along || !goal.normal) { outEnd.identity(); return; }
  // wanted end frame in the limb parent's frame
  _t1.copy(goal.along).normalize();
  _t2.copy(goal.normal).addScaledVector(_t1, -goal.normal.dot(_t1)).normalize();
  _h.copy(limb.normal).addScaledVector(limb.along, -limb.normal.dot(limb.along)).normalize();
  frameRotation(_q2, limb.along, _h, _t1, _t2);                 // end rotation in the parent frame
  // forearm roll: turn the lower segment about its own axis toward the palm normal
  const share = goal.twistShare ?? 0.6;
  if (share > 0) {
    _q3.multiplyQuaternions(outUpper, outLower);                 // lower segment frame in parent space
    const axis = _t3.copy(limb.b).applyQuaternion(_q3);          // forearm axis (parent space)
    const cur = _m.copy(_h).applyQuaternion(_q3);                // palm normal if the wrist stayed straight
    cur.addScaledVector(axis, -cur.dot(axis));
    const want = _p.copy(_t2).addScaledVector(axis, -_t2.dot(axis));
    if (cur.lengthSq() > 1e-8 && want.lengthSq() > 1e-8) {
      cur.normalize(); want.normalize();
      const ang = Math.atan2(_u.crossVectors(cur, want).dot(axis), cur.dot(want));
      _q1.setFromAxisAngle(limb.b, ang * share);
      outLower.multiply(_q1);
    }
  }
  _q3.multiplyQuaternions(outUpper, outLower).invert();
  outEnd.multiplyQuaternions(_q3, _q2);
}

/** Swing-limits a local rotation toward identity: keeps `share` of it (cheap wrist/ankle comfort clamp). */
export function soften(q: THREE.Quaternion, maxAngle: number) {
  const ang = 2 * Math.acos(clamp(Math.abs(q.w), -1, 1));
  if (ang > maxAngle) q.slerp(_q1.identity(), 1 - maxAngle / ang);
  return q;
}
