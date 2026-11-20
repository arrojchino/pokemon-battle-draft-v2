import * as THREE from 'three';
import { SmoothVec3, smoothDamp, wobble } from './math.js';

export type Shot = { pos: [number, number, number]; target: [number, number, number]; fov: number; time?: number };

/**
 * Spring-driven camera. Shots blend with critically damped springs (no overshoot, no linear tweens),
 * plus a subtle handheld drift and pointer parallax so frames never feel frozen.
 */
export class CameraDirector {
  private pos = new SmoothVec3(0, 1.5, 6);
  private target = new SmoothVec3(0, 1.2, 0);
  private fov = 32; private fovV = { v: 0 };
  private fovTarget = 32;
  private smooth = 1.1;
  private t = 0;
  readonly pointer = new THREE.Vector2();
  private par = new THREE.Vector2();
  reducedMotion = false;
  private shakeAmt = 0;
  /** Short camera impulse for big impacts (ignored with reduced motion). */
  kick(amount: number) { if (!this.reducedMotion) this.shakeAmt = Math.max(this.shakeAmt, amount); }

  constructor(private camera: THREE.PerspectiveCamera) {}

  cut(shot: Shot) { this.go(shot); this.pos.snap(); this.target.snap(); this.fov = shot.fov; this.fovV.v = 0; }
  go(shot: Shot) {
    this.pos.target.set(...shot.pos); this.target.target.set(...shot.target); this.fovTarget = shot.fov;
    this.smooth = shot.time ?? 1.1;
    if (this.reducedMotion) { this.pos.snap(); this.target.snap(); this.fov = shot.fov; }
  }

  update(dt: number) {
    this.t += dt;
    const p = this.pos.update(this.smooth * 0.5, dt);
    const tg = this.target.update(this.smooth * 0.42, dt);
    this.fov = smoothDamp(this.fov, this.fovTarget, this.fovV, this.smooth * 0.5, dt);
    const drift = this.reducedMotion ? 0 : 1;
    this.par.x += (this.pointer.x - this.par.x) * (1 - Math.exp(-2.5 * dt));
    this.par.y += (this.pointer.y - this.par.y) * (1 - Math.exp(-2.5 * dt));
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sk = this.shakeAmt * this.shakeAmt * 0.06;
    this.camera.position.set(
      p.x + (wobble(this.t * 0.25, 1) * 0.02 + this.par.x * 0.12) * drift + wobble(this.t * 40, 3) * sk,
      p.y + (wobble(this.t * 0.21, 2) * 0.015 + this.par.y * 0.05) * drift + wobble(this.t * 37, 4) * sk,
      p.z,
    );
    this.camera.lookAt(tg.x + this.par.x * 0.03 * drift, tg.y + this.par.y * 0.02 * drift, tg.z);
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}
