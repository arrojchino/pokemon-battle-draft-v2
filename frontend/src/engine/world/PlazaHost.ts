import * as THREE from 'three';
import { FLOOR_Y } from '../character/MonRig.js';
import type { Presenter, PresenterGesture } from '../npc/Presenter.js';
import type { Obstacle } from './Plaza.js';

/** The scene is built at about 1.7 m per unit (see character/size.ts); the presenter is 1.67 m tall. */
const SCALE = 1 / 1.7;
/** Where she stands: the far side of the field from where trainers walk in, facing its centre. */
export const HOST_SPOT = { x: 0, z: -6.2 } as const;
/** Her footprint, for walking around her. */
export const HOST_OBSTACLE: Obstacle = { x: HOST_SPOT.x, z: HOST_SPOT.z, r: 0.3 };
/** Where a trainer who clicks her walks to: just in front of her. */
export const HOST_FRONT = { x: HOST_SPOT.x, z: HOST_SPOT.z + 1.05 } as const;
/** Close enough to talk (from her centre to the partner's), with a little more room to leave. */
const NEAR = 2.3, FAR = 2.8;
/** She waves at someone who walks up at most this often. */
const GREET_EVERY = 25;

/**
 * The plaza host: the Pokémon Center presenter standing at the edge of the main plaza. The model (and
 * three-vrm) load in their own chunk the first time the plaza opens, so nothing else pays for them. She turns
 * to and watches the trainer who comes close, waves now and then, and talks while the dialogue types.
 */
export class PlazaHost {
  readonly group = new THREE.Group();
  /** Invisible picking volume (she is a skinned mesh; a cylinder is cheaper and steadier to hit). */
  readonly hitbox: THREE.Mesh;
  private p: Presenter | null = null;
  private loading = false;
  private near = false;
  private greetedAt = -Infinity;
  private clock = 0;
  private reduced = false;
  private look = new THREE.Vector3();

  constructor() {
    this.group.position.set(HOST_SPOT.x, FLOOR_Y, HOST_SPOT.z);
    this.group.visible = false;
    const h = 1.67 * SCALE;
    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, h, 10), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = h / 2;
    this.group.add(this.hitbox);
  }

  /** Show her in the plaza (loading her the first time), hide her everywhere else. */
  setActive(on: boolean, reducedMotion: boolean) {
    this.group.visible = on && !!this.p;
    this.reduced = reducedMotion;
    this.p?.setReducedMotion(reducedMotion);
    if (!on) { this.setNear(false); return; }
    if (this.p || this.loading) return;
    this.loading = true;
    void import('../npc/Presenter.js')
      .then(m => m.Presenter.load({ reducedMotion }))
      .then(p => {
        p.root.scale.setScalar(SCALE);
        p.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.group.add(p.root);
        this.p = p;
        this.group.visible = on;
      })
      .catch(() => { /* offline or blocked: the plaza works without her */ })
      .finally(() => { this.loading = false; });
  }
  get ready() { return !!this.p && this.group.visible; }
  get height() { return 1.67 * SCALE; }

  /**
   * One frame, with where this player's partner stands. Returns whether the partner is close enough to talk,
   * and whether she just waved at it (for the greeting sound).
   */
  update(dt: number, me: { x: number; z: number }, meHeight: number): { near: boolean; greeted: boolean } {
    this.clock += dt;
    const p = this.p;
    if (!p || !this.group.visible) return { near: false, greeted: false };
    const d = Math.hypot(me.x - HOST_SPOT.x, me.z - HOST_SPOT.z);
    const near = this.near ? d < FAR : d < NEAR;
    let greeted = false;
    if (near !== this.near) {
      this.setNear(near);
      if (near && this.clock - this.greetedAt > GREET_EVERY) { p.greet(); this.greetedAt = this.clock; greeted = true; }
    }
    if (near) {
      p.turnToward(me.x, me.z);
      p.lookAt(this.look.set(me.x, FLOOR_Y + meHeight * 0.85, me.z));
    } else p.turnToward(HOST_SPOT.x, HOST_SPOT.z + 3);
    p.update(dt);
    return { near, greeted };
  }
  private setNear(on: boolean) {
    this.near = on;
    if (!this.p) return;
    this.p.setAttentive(on);
    if (!on) { this.p.lookAt(null); this.p.talk(false); }
  }
  talk(on: boolean) { this.p?.talk(on); }
  gesture(kind: PresenterGesture) { if (this.p && !this.p.busy) this.p.gesture(kind); }
  greet() { if (this.p && !this.p.busy) { this.p.greet(); this.greetedAt = this.clock; } }
  /** Whether a ray hits her. */
  hit(ray: THREE.Raycaster) { return this.ready && ray.intersectObject(this.hitbox, false).length > 0; }
  /** The point just above her head, for the talk prompt. */
  head(out: THREE.Vector3) { return out.set(HOST_SPOT.x, FLOOR_Y + this.height + 0.1, HOST_SPOT.z); }
  get reducedMotion() { return this.reduced; }
}
