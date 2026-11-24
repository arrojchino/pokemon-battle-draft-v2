import * as THREE from 'three';
import { FLOOR_Y } from '../character/MonRig.js';
import type { Presenter, PresenterGesture } from '../npc/Presenter.js';
import type { Obstacle } from './Plaza.js';

/** The scene is built at about 1.7 m per unit (see character/size.ts); the presenter is 1.67 m tall. */
const SCALE = 1 / 1.7;
/** Where she stands and which way she faces (the town puts her at the Center's door). */
export type HostSpot = { x: number; z: number; face: number };
export const HOST_SPOT_DEFAULT: HostSpot = { x: 0, z: -6.2, face: 0 };
/** Her footprint, for walking around her. */
export const hostObstacle = (s: HostSpot): Obstacle => ({ x: s.x, z: s.z, r: 0.3 });
/** Where a trainer who clicks her walks to: just in front of her. */
export const hostFront = (s: HostSpot) => ({ x: s.x + Math.sin(s.face) * 1.05, z: s.z + Math.cos(s.face) * 1.05 });
/** Close enough to talk (from her centre to the partner's), with a little more room to leave. */
const NEAR = 2.3, FAR = 2.8;
/** She waves at someone who walks up at most this often. */
const GREET_EVERY = 25;
/** Seconds of the fade when she arrives after the plaza is already showing. */
const FADE_IN = 0.7;
/** Meshes that start casting shadows per frame once she is shown (each new caster compiles a depth program). */
const SHADOWS_PER_FRAME = 3;

/** Timings of the last preparation, in milliseconds, for profiling (`__WORLD__.plazaHost.timings`). */
export type HostTimings = { download?: number; build?: number; textures?: number; compile?: number; warm?: number; warmMax?: number; total?: number };
type MatState = { m: THREE.Material; transparent: boolean; opacity: number };
const WARM_CAMERA = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 10);
WARM_CAMERA.position.set(0, 1, 5);
const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/**
 * The plaza host: the Pokémon Center presenter standing at the edge of the main plaza. The model (and
 * three-vrm) load in their own chunk. `prepare` downloads, builds, uploads and compiles her ahead of time
 * (while the title screen idles, or behind the plaza's entry veil), one step per frame, so showing her never
 * stalls a frame. She turns to and watches the trainer who comes close, waves now and then, and talks while
 * the dialogue types.
 */
export class PlazaHost {
  readonly group = new THREE.Group();
  /** Invisible picking volume (she is a skinned mesh; a cylinder is cheaper and steadier to hit). */
  readonly hitbox: THREE.Mesh;
  readonly timings: HostTimings = {};
  private p: Presenter | null = null;
  private preparing: Promise<void> | null = null;
  private active = false;
  /** Set once the plaza is on screen without a veil: from then on she fades in instead of appearing. */
  private exposed = false;
  private fade = 1;
  private mats: MatState[] = [];
  private casters: THREE.Mesh[] = [];
  private near = false;
  private greetedAt = -Infinity;
  private clock = 0;
  private reduced = false;
  private look = new THREE.Vector3();
  /** Where she stands (see `setSpot`). */
  spot: HostSpot = { ...HOST_SPOT_DEFAULT };

  constructor() {
    this.group.position.set(this.spot.x, FLOOR_Y, this.spot.z);
    this.group.visible = false;
    const h = 1.67 * SCALE;
    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, h, 10), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = h / 2;
    this.group.add(this.hitbox);
  }

  /**
   * Download, build, upload and compile her without showing her. Each heavy step gets its own frame;
   * shaders compile with `compileAsync` against the real scene and lights, in both the opaque and the
   * transparent variant (the fade-in uses the second). Resolves once she can be shown with no stall;
   * safe to call again (it returns the same promise). Rejects when the model cannot be loaded.
   */
  prepare(renderer: THREE.WebGLRenderer, compile: (o: THREE.Object3D) => Promise<unknown>, onProgress?: (f: number) => void): Promise<void> {
    if (this.p) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const t0 = performance.now();
    const T = this.timings;
    this.preparing = (async () => {
      const { Presenter } = await import('../npc/Presenter.js');
      const { vrm, bytes } = await Presenter.fetchVrm({ reducedMotion: this.reduced, onProgress: (l, t) => onProgress?.(t ? 0.7 * l / t : 0) });
      T.download = performance.now() - t0;
      await frame();
      let t = performance.now();
      const p = Presenter.fromVrm(vrm, bytes, { reducedMotion: this.reduced });
      p.root.scale.setScalar(SCALE);
      const mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      p.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // Shadows switch on a few meshes per frame once she is shown.
        m.castShadow = false; this.casters.push(m);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          mats.add(mat);
          for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) textures.add(v);
          const u = (mat as THREE.ShaderMaterial).uniforms;
          if (u) for (const x of Object.values(u)) if (x?.value instanceof THREE.Texture) textures.add(x.value);
        }
      });
      this.mats = [...mats].map(m => ({ m, transparent: m.transparent, opacity: m.opacity }));
      T.build = performance.now() - t;
      onProgress?.(0.75);
      // Upload textures a few per frame, so the first visible frame does not upload them all at once.
      await frame();
      t = performance.now();
      let n = 0;
      for (const tex of textures) { renderer.initTexture(tex); if (++n % 2 === 0) await frame(); }
      T.textures = performance.now() - t;
      onProgress?.(0.85);
      // Programs: compile against the real lights. The opaque pass is what she normally draws with; the
      // transparent pass is the variant used while she fades in (a different program in three.js).
      t = performance.now();
      await compile(p.root);
      for (const s of this.mats) { s.m.transparent = true; s.m.needsUpdate = true; }
      await compile(p.root);
      for (const s of this.mats) { s.m.transparent = s.transparent; s.m.needsUpdate = true; }
      T.compile = performance.now() - t;
      // One draw off screen with a flat material: uploads the vertex buffers and builds the skinning and
      // blend-shape textures (her face has dozens of shapes), work that otherwise lands on her first visible frame.
      await frame();
      t = performance.now();
      const tmp = new THREE.Scene(), rt = new THREE.WebGLRenderTarget(4, 4), flat = new THREE.MeshBasicMaterial();
      tmp.overrideMaterial = flat; tmp.add(p.root);
      // One mesh per frame: the face alone (blend shapes) is the bulk of it.
      const meshes: THREE.Mesh[] = [];
      p.root.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
      for (const m of meshes) m.visible = false;
      for (const m of meshes) {
        m.visible = true;
        const w0 = performance.now(), prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt); renderer.render(tmp, WARM_CAMERA); renderer.setRenderTarget(prev);
        m.visible = false;
        T.warmMax = Math.max(T.warmMax ?? 0, performance.now() - w0);
        await frame();
      }
      for (const m of meshes) m.visible = true;
      tmp.remove(p.root); rt.dispose(); flat.dispose();
      T.warm = performance.now() - t;
      await frame();
      this.group.add(p.root);
      this.p = p;
      p.setReducedMotion(this.reduced);
      T.total = performance.now() - t0;
      onProgress?.(1);
      this.show();
    })();
    this.preparing.catch(() => { this.preparing = null; });
    return this.preparing;
  }

  /** Show her in the plaza, hide her everywhere else. Loading is started by `prepare`. */
  setActive(on: boolean, reducedMotion: boolean) {
    this.active = on;
    if (!on) this.exposed = false;
    this.reduced = reducedMotion;
    this.p?.setReducedMotion(reducedMotion);
    this.show();
    if (!on) this.setNear(false);
  }
  /** The plaza is now on screen with nothing covering it: anything that arrives later fades in. */
  expose() { this.exposed = this.active; }

  private show() {
    const was = this.group.visible;
    this.group.visible = this.active && !!this.p;
    if (this.group.visible && !was && this.exposed && !this.reduced) this.startFade();
  }
  private startFade() {
    this.fade = 0;
    for (const s of this.mats) { s.m.transparent = true; s.m.opacity = 0; s.m.needsUpdate = true; }
  }
  private stepFade(dt: number) {
    if (this.fade >= 1) return;
    this.fade = Math.min(1, this.fade + dt / FADE_IN);
    const k = this.fade * this.fade * (3 - 2 * this.fade);
    if (this.fade < 1) for (const s of this.mats) s.m.opacity = s.opacity * k;
    else for (const s of this.mats) { s.m.opacity = s.opacity; s.m.transparent = s.transparent; s.m.needsUpdate = true; }
  }

  get ready() { return !!this.p && this.group.visible; }
  get loaded() { return !!this.p; }
  get height() { return 1.67 * SCALE; }

  /**
   * One frame, with where this player's partner stands. Returns whether the partner is close enough to talk,
   * and whether she just waved at it (for the greeting sound).
   */
  update(dt: number, me: { x: number; z: number }, meHeight: number): { near: boolean; greeted: boolean } {
    this.clock += dt;
    const p = this.p;
    if (!p || !this.group.visible) return { near: false, greeted: false };
    this.stepFade(dt);
    // Each new shadow caster compiles a depth program on its first shadow pass: all at once while the entry veil
    // covers the plaza, a few per frame when she arrives on an uncovered plaza.
    for (let i = 0; (!this.exposed || i < SHADOWS_PER_FRAME) && this.casters.length; i++) this.casters.pop()!.castShadow = true;
    const d = Math.hypot(me.x - this.spot.x, me.z - this.spot.z);
    const near = this.near ? d < FAR : d < NEAR;
    let greeted = false;
    if (near !== this.near) {
      this.setNear(near);
      if (near && this.clock - this.greetedAt > GREET_EVERY) { p.greet(); this.greetedAt = this.clock; greeted = true; }
    }
    if (near) {
      p.turnToward(me.x, me.z);
      p.lookAt(this.look.set(me.x, FLOOR_Y + meHeight * 0.85, me.z));
    } else p.turnToward(this.spot.x + Math.sin(this.spot.face) * 3, this.spot.z + Math.cos(this.spot.face) * 3);
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
  head(out: THREE.Vector3) { return out.set(this.spot.x, FLOOR_Y + this.height + 0.1, this.spot.z); }
  /** Stand somewhere else (the town's host spot), facing `face`. */
  setSpot(s: HostSpot) { this.spot = { ...s }; this.group.position.set(s.x, FLOOR_Y, s.z); }
  get reducedMotion() { return this.reduced; }
}
