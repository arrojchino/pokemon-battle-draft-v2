import * as THREE from 'three';

/** Frame-rate independent exponential approach: identical feel at 30, 60, 144 Hz. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampFactor = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

/** Critically damped spring (Game Programming Gems 4, "smoothDamp"). Mutates `state.v`. */
export function smoothDamp(current: number, target: number, state: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

/** Vector3 version with preallocated per-axis velocity. */
export class SmoothVec3 {
  readonly value = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  private vx = { v: 0 }; private vy = { v: 0 }; private vz = { v: 0 };
  constructor(x = 0, y = 0, z = 0) { this.value.set(x, y, z); this.target.set(x, y, z); }
  update(smoothTime: number, dt: number) {
    this.value.set(
      smoothDamp(this.value.x, this.target.x, this.vx, smoothTime, dt),
      smoothDamp(this.value.y, this.target.y, this.vy, smoothTime, dt),
      smoothDamp(this.value.z, this.target.z, this.vz, smoothTime, dt),
    );
    return this.value;
  }
  snap() { this.value.copy(this.target); this.vx.v = this.vy.v = this.vz.v = 0; }
}

export const smoothstep = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Cheap smooth 1D noise from incommensurate sines; deterministic per seed, no allocation. */
export const wobble = (t: number, seed: number) =>
  (Math.sin(t * 1.0 + seed * 12.9898) * 0.5 + Math.sin(t * 2.31 + seed * 4.1414) * 0.3 + Math.sin(t * 4.73 + seed * 7.233) * 0.2);

export const rand = (seed: number) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
