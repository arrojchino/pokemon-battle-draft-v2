import * as THREE from 'three';
import { ARENA } from './BattleCamera.js';

/**
 * Pooled effect primitives for move animations. Everything is allocated once when the arena is
 * built; playing an effect only rewrites buffers and uniforms, so a long battle never grows the
 * scene, the GPU memory or the garbage collector's workload.
 */

const V = () => new THREE.Vector3();
const tmpA = V(), tmpB = V(), tmpC = V(), tmpD = V();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => x * x * (3 - 2 * x);

/* ------------------------------------------------------------------ particles */

export const enum Shape { Glow = 0, Leaf = 1, Star = 2, Coin = 3, Ring = 4, Feather = 5, Flake = 6 }

export type ParticleOpts = {
  color: THREE.ColorRepresentation; shape?: Shape; size?: number; sizeEnd?: number; ttl?: number;
  gravity?: number; drag?: number; spin?: number;
  /** Peak opacity (steam, dust and auras read better below 1). */
  alpha?: number;
  /** Orbit around a vertical axis through (cx, cz) at w rad/s. */
  orbit?: { cx: number; cz: number; w: number };
  /** Spring toward a point (homing), strength k. */
  home?: { x: number; y: number; z: number; k: number };
};

/** Something pooled that rides on the particle field's frame: updated, cleared and disposed with it. */
export type FxPart = { update(dt: number): void; clear(): void; dispose(): void };

const MAXP = 2600;

/**
 * One CPU-simulated particle field (a single draw call) used by streams, swirls, sparks, spores,
 * lightning, coins and leaves. Particles are recycled ring-buffer style. The default field glows
 * (additive); a smoke field blends normally, so it can also darken: shadowy wisps, dust and steam.
 */
export class Particles {
  readonly mesh: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private readonly n: number;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private shape: Float32Array; private rot: Float32Array; private vel: Float32Array;
  private life: Float32Array; private ttl: Float32Array; private peak: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private spin: Float32Array;
  private orb: Float32Array; // cx, cz, w
  private home: Float32Array; // x, y, z, k
  private next = 0;
  private emitters: { t: number; dur: number; acc: number; rate: number; spawn: (u: number) => void }[] = [];
  private tickers: { t: number; dur: number; fn: (u: number, dt: number) => void }[] = [];
  private parts: FxPart[] = [];
  private live = 0;
  /** Share of spawned particles that are kept (the Effects setting): 1 all, 0.5 every other on average, 0 none. */
  density = 1;

  constructor(o: { smoke?: boolean; max?: number } = {}) {
    const n = this.n = o.max ?? MAXP;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.shape = new Float32Array(n); this.rot = new Float32Array(n); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(1e9); this.ttl = new Float32Array(n).fill(1); this.peak = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n); this.spin = new Float32Array(n);
    this.orb = new Float32Array(n * 3); this.home = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    const smoke = !!o.smoke;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      // Smoke: premultiplied "over" blending, so dark colours darken what is behind them.
      blending: smoke ? THREE.CustomBlending : THREE.AdditiveBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      defines: smoke ? { SMOKE: '' } : {},
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize, aAlpha, aShape, aRot; uniform float uScale;
        varying vec3 vC; varying float vA, vS, vR;
        void main() {
          vC = aColor; vA = aAlpha; vS = aShape; vR = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // aSize is a world-space diameter in metres; ~1300 px per unit depth at 900 px height and a ~38 degree lens.
          gl_PointSize = aSize * uScale * 1300.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA, vS, vR;
        void main() {
          if (vA < 0.004) discard;
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vR), s = sin(vR);
          vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          float a; vec3 col = vC;
          if (vS < 0.5) {
#ifdef SMOKE
            // A soft, lumpy puff with no hot core.
            float r = length(p) * 2.0;
            a = smoothstep(1.0, 0.1, r) * (0.74 + 0.26 * sin(q.x * 11.0 + vR * 2.0) * sin(q.y * 9.0 - vR));
#else
            a = smoothstep(0.5, 0.0, length(p)); a *= a; col = mix(vec3(1.0), vC, 0.55 + 0.45 * (1.0 - a));
#endif
          }
          else if (vS < 1.5) { vec2 l = q * vec2(1.0, 2.6); a = smoothstep(0.5, 0.36, length(l)) * (0.65 + 0.35 * step(abs(q.y), 0.03)); }
          else if (vS < 2.5) { a = max(smoothstep(0.07, 0.0, abs(q.x)) * smoothstep(0.5, 0.0, abs(q.y)), smoothstep(0.07, 0.0, abs(q.y)) * smoothstep(0.5, 0.0, abs(q.x))); a = max(a, smoothstep(0.18, 0.0, length(p))); col = mix(vec3(1.0), vC, 0.5); }
          else if (vS < 3.5) { vec2 k = vec2(q.x / max(abs(cos(vR * 3.0)), 0.15), q.y); float d = length(k); a = smoothstep(0.5, 0.44, d); col = vC * (0.75 + 0.6 * smoothstep(0.44, 0.3, d)) + vec3(0.4) * smoothstep(0.2, 0.0, abs(k.x + k.y)); }
          else if (vS < 4.5) { float d = length(p); a = smoothstep(0.08, 0.0, abs(d - 0.38)); }
          else if (vS < 5.5) {
            // Feather: a curved shaft with soft barbs.
            vec2 f = q; f.x -= 0.32 * f.y * f.y - 0.03;
            float body = smoothstep(0.5, 0.4, length(f * vec2(2.7, 1.0)));
            float shaft = smoothstep(0.03, 0.0, abs(f.x)) * smoothstep(0.5, 0.44, abs(f.y));
            float barbs = 0.7 + 0.3 * sin((f.y - abs(f.x) * 1.5) * 64.0);
            a = max(body * barbs, shaft); col = mix(vC, vec3(1.0), 0.2 + 0.6 * shaft);
          }
          else {
            // Snowflake: six arms with side twigs and a bright centre.
            float r = length(q) * 2.0; float an = atan(q.y, q.x);
            float arms = smoothstep(0.1, 0.0, abs(sin(an * 3.0)) * r);
            float twig = (smoothstep(0.09, 0.0, abs(sin(an * 3.0 + 0.9)) * r) + smoothstep(0.09, 0.0, abs(sin(an * 3.0 - 0.9)) * r)) * step(0.42, r) * step(r, 0.72);
            a = max(max(arms, twig * 0.85) * smoothstep(1.0, 0.82, r), smoothstep(0.22, 0.0, r)); col = mix(vec3(1.0), vC, 0.45);
          }
#ifdef SMOKE
          gl_FragColor = vec4(col * a * vA, a * vA);
#else
          gl_FragColor = vec4(col * 1.7 * a * vA, 1.0);
#endif
        }`,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = smoke ? 7.5 : 8;
  }

  /** Spawn one particle (thinned by `density`, so every burst, stream and swirl scales with it). */
  emit(p: THREE.Vector3, v: THREE.Vector3, o: ParticleOpts) {
    if (this.density < 1 && Math.random() >= this.density) return;
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    const c = tmpColor.set(o.color); this.col.set([c.r, c.g, c.b], i * 3);
    this.life[i] = 0; this.ttl[i] = o.ttl ?? 0.8; this.peak[i] = o.alpha ?? 1;
    this.s0[i] = o.size ?? 0.06; this.s1[i] = o.sizeEnd ?? (o.size ?? 0.06) * 0.3;
    this.shape[i] = o.shape ?? Shape.Glow; this.rot[i] = Math.random() * 6.28; this.spin[i] = o.spin ?? 0;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0;
    if (o.orbit) this.orb.set([o.orbit.cx, o.orbit.cz, o.orbit.w], i * 3); else this.orb[i * 3 + 2] = 0;
    if (o.home) this.home.set([o.home.x, o.home.y, o.home.z, o.home.k], i * 4); else this.home[i * 4 + 3] = 0;
  }

  /** Run a spawner at `rate` particles per second for `dur` seconds; spawn receives progress 0..1. */
  emitter(dur: number, rate: number, spawn: (u: number) => void) { this.emitters.push({ t: 0, dur, acc: 0, rate, spawn }); }
  /**
   * Call `fn` once per frame for `dur` seconds with progress 0..1 (always ending on exactly 1). It runs
   * after the Pokémon have been posed for the frame, so it can nudge them (a Psychic lift).
   */
  ticker(dur: number, fn: (u: number, dt: number) => void) { this.tickers.push({ t: 0, dur, fn }); }
  /** Pooled effects that update, clear and dispose with this field. */
  attach(part: FxPart) { this.parts.push(part); }

  burst(at: THREE.Vector3, n: number, speed: number, o: ParticleOpts & { rise?: number }) {
    for (let k = 0; k < n; k++) {
      tmpA.randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      tmpA.y += (o.rise ?? 0) * speed;
      this.emit(at, tmpA, o);
    }
  }

  /** A turbulent flow from a to b (flamethrower, hydro pump, sludge), optionally arcing. */
  stream(a: THREE.Vector3, b: THREE.Vector3, dur: number, o: ParticleOpts & { rate?: number; spread?: number; speed?: number; arc?: number }) {
    const from = a.clone(), to = b.clone();
    const dist = from.distanceTo(to); const speed = o.speed ?? 5.5; const ttl = dist / speed;
    this.emitter(dur, o.rate ?? 260, () => {
      const dir = tmpB.subVectors(to, from).normalize();
      tmpC.randomDirection().multiplyScalar(o.spread ?? 0.12);
      const v = tmpA.copy(dir).multiplyScalar(speed).addScaledVector(tmpC, speed);
      if (o.arc) v.y += o.arc * speed * 0.5;
      this.emit(from, v, { ...o, ttl: ttl * (0.9 + Math.random() * 0.3), gravity: o.arc ? o.arc * speed * speed / dist : o.gravity });
    });
  }

  /** Particles spiralling up around a point (leaves, wind, spores, buffs). */
  swirl(at: THREE.Vector3, dur: number, o: ParticleOpts & { radius?: number; height?: number; rate?: number; w?: number; inward?: boolean }) {
    const c = at.clone(); const r = o.radius ?? 0.7; const h = o.height ?? 1.4; const w = o.w ?? 4.5;
    this.emitter(dur, o.rate ?? 120, () => {
      const a = Math.random() * Math.PI * 2; const rr = r * (0.6 + Math.random() * 0.5);
      const p = tmpA.set(c.x + Math.cos(a) * rr, c.y - h * 0.36 + Math.random() * h * 0.14, c.z + Math.sin(a) * rr);
      const v = tmpB.set(0, h / (o.ttl ?? 1), 0);
      this.emit(p, v, { ...o, orbit: { cx: c.x, cz: c.z, w: w * (0.8 + Math.random() * 0.4) }, home: o.inward ? { x: c.x, y: c.y + h * 0.43, z: c.z, k: 1.6 } : undefined });
    });
  }

  /** A jagged bolt that re-strikes several times (thunderbolt, volt switch, thunder wave). */
  lightning(a: THREE.Vector3, b: THREE.Vector3, dur: number, color: THREE.ColorRepresentation, jitter = 0.28, density = 70) {
    const from = a.clone(), to = b.clone();
    const strike = () => {
      const seg = 9; let prev = from.clone();
      for (let s = 1; s <= seg; s++) {
        const p = tmpA.lerpVectors(from, to, s / seg);
        if (s < seg) p.add(tmpC.randomDirection().multiplyScalar(jitter));
        const n = Math.ceil(density / seg);
        for (let k = 0; k < n; k++) this.emit(tmpB.lerpVectors(prev, p, k / n), ZERO, { color, size: 0.07 + Math.random() * 0.04, sizeEnd: 0.03, ttl: 0.16 + Math.random() * 0.08 });
        // Occasional branch.
        if (Math.random() < 0.3) for (let k = 0; k < 6; k++) this.emit(tmpB.copy(p).add(tmpC.randomDirection().multiplyScalar(0.06 * k)), ZERO, { color, size: 0.04, sizeEnd: 0.01, ttl: 0.14 });
        prev = p.clone();
      }
    };
    this.emitter(dur, 14, strike);
    strike();
  }

  update(dt: number) {
    for (const part of this.parts) part.update(dt);
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t += dt; e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; e.spawn(Math.min(1, e.t / e.dur)); }
      if (e.t >= e.dur) this.emitters.splice(k, 1);
    }
    for (let k = this.tickers.length - 1; k >= 0; k--) {
      const tk = this.tickers[k];
      tk.t += dt; const u = Math.min(1, tk.t / tk.dur);
      tk.fn(u, dt);
      if (u >= 1) this.tickers.splice(this.tickers.indexOf(tk), 1);
    }
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] >= this.ttl[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      live++;
      const l = (this.life[i] += dt); const u = Math.min(1, l / this.ttl[i]);
      const j = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= d; this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt; this.vel[j + 2] *= d;
      const hk = this.home[i * 4 + 3];
      if (hk > 0) {
        this.vel[j] += (this.home[i * 4] - this.pos[j]) * hk * dt * 4; this.vel[j + 1] += (this.home[i * 4 + 1] - this.pos[j + 1]) * hk * dt * 4; this.vel[j + 2] += (this.home[i * 4 + 2] - this.pos[j + 2]) * hk * dt * 4;
      }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const w = this.orb[j + 2];
      if (w !== 0) {
        const cx = this.orb[j], cz = this.orb[j + 1]; const x = this.pos[j] - cx, z = this.pos[j + 2] - cz;
        const c = Math.cos(w * dt), s = Math.sin(w * dt);
        this.pos[j] = cx + x * c - z * s; this.pos[j + 2] = cz + x * s + z * c;
      }
      this.rot[i] += this.spin[i] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      this.alpha[i] = Math.min(1, l * 20) * (1 - u * u) * this.peak[i];
    }
    this.live = live;
    if (live || this.emitters.length) {
      const a = this.mesh.geometry.attributes;
      for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape', 'aRot']) (a[k] as THREE.BufferAttribute).needsUpdate = true;
    }
    this.mesh.visible = live > 0;
  }
  get active() { return this.live; }
  clear() {
    this.life.fill(1e9); this.emitters.length = 0;
    // Let every ticker put back what it moved.
    const tk = this.tickers.splice(0); for (const x of tk) x.fn(1, 0);
    for (const part of this.parts) part.clear();
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); for (const part of this.parts) part.dispose(); }
}
const ZERO = new THREE.Vector3();
const tmpColor = new THREE.Color();

/* ------------------------------------------------------------------ rings / shockwaves */

type RingJob = { t: number; dur: number; s0: number; s1: number; from: THREE.Vector3; to: THREE.Vector3; flat: boolean; width: number };

/** Expanding rings: shockwaves on the floor, sound waves, psychic pulses. */
export class Rings {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>; job: RingJob | null }[] = [];
  private geo = new THREE.RingGeometry(0.9, 1, 72);
  constructor(n = 10) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 } },
        vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uA; varying vec2 vUv; void main() { gl_FragColor = vec4(uColor * 2.4 * uA, 1.0); }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.visible = false; mesh.renderOrder = 7;
      this.group.add(mesh); this.items.push({ mesh, job: null });
    }
    this.group.add(warmTwin(this.items[0].mesh));
  }
  /** flat: lies on the floor; otherwise faces the camera. `to` makes the ring travel. */
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, o: { dur?: number; s0?: number; s1?: number; flat?: boolean; to?: THREE.Vector3; delay?: number; width?: number } = {}) {
    const it = this.items.find(x => !x.job) ?? this.items[0];
    it.job = { t: -(o.delay ?? 0), dur: o.dur ?? 0.6, s0: o.s0 ?? 0.1, s1: o.s1 ?? 1.4, from: at.clone(), to: (o.to ?? at).clone(), flat: !!o.flat, width: o.width ?? 1 };
    it.mesh.material.uniforms.uColor.value.set(color);
  }
  update(dt: number, camera: THREE.Camera) {
    for (const it of this.items) {
      const j = it.job; if (!j) continue;
      j.t += dt;
      if (j.t < 0) { it.mesh.visible = false; continue; }
      const u = Math.min(1, j.t / j.dur);
      it.mesh.visible = true;
      it.mesh.position.lerpVectors(j.from, j.to, smooth(u));
      const s = j.s0 + (j.s1 - j.s0) * (1 - Math.pow(1 - u, 2.4));
      it.mesh.scale.set(s, s, s * j.width);
      if (j.flat) it.mesh.rotation.set(-Math.PI / 2, 0, 0); else it.mesh.quaternion.copy(camera.quaternion);
      it.mesh.material.uniforms.uA.value = (1 - u) * (1 - u) * Math.min(1, j.t * 30);
      if (u >= 1) { it.job = null; it.mesh.visible = false; }
    }
  }
  clear() { for (const it of this.items) { it.job = null; it.mesh.visible = false; } }
  dispose() { this.geo.dispose(); for (const it of this.items) it.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ beams */

/** A charged energy beam between two points (ice beam, flash cannon, hyper beam style). */
export class Beam {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private t = 1; private dur = 0.7; private width = 0.12; private len = 1; private grow = 0;
  constructor() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uA: { value: 0 }, uWhite: { value: 1 }, uGain: { value: 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN, vV;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uTime, uA, uWhite, uGain; varying vec2 vUv; varying vec3 vN, vV;
        void main() {
          float facing = abs(dot(vN, vV));
          float core = pow(facing, 3.0);
          float stripes = 0.65 + 0.35 * sin(vUv.y * 60.0 - uTime * 40.0);
          vec3 col = mix(uColor * stripes, vec3(1.6), core * uWhite) * uGain;
          float tip = smoothstep(1.0, 0.94, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
          gl_FragColor = vec4(col * (0.4 + 1.6 * facing) * uA * tip, 1.0);
        }`,
    }));
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
  }
  /**
   * `grow` (share of the duration) extends the beam from `a` to `b` instead of snapping it open (a column
   * erupting); `white` scales its white-hot core and `gain` its brightness (a soft shaft of sunlight).
   */
  fire(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, dur = 0.75, width = 0.12, grow = 0, o: { white?: number; gain?: number } = {}) {
    this.t = 0; this.dur = dur; this.width = width; this.grow = grow;
    this.mesh.material.uniforms.uColor.value.set(color);
    this.mesh.material.uniforms.uWhite.value = o.white ?? 1; this.mesh.material.uniforms.uGain.value = o.gain ?? 1;
    this.mesh.position.copy(a);
    const d = tmpA.subVectors(b, a); const len = this.len = d.length();
    this.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    this.mesh.scale.set(width, grow > 0 ? 1e-3 : len, width);
    this.mesh.visible = true;
  }
  update(dt: number, t: number) {
    if (!this.mesh.visible) return;
    this.t += dt; const u = this.t / this.dur;
    // Snap open, wobble, then pinch closed.
    const env = u < 0.12 ? u / 0.12 : u > 0.75 ? Math.max(0, 1 - (u - 0.75) / 0.25) : 1;
    const w = this.width * (0.3 + 0.7 * env) * (1 + 0.12 * Math.sin(t * 70));
    this.mesh.scale.x = this.mesh.scale.z = w;
    if (this.grow > 0) this.mesh.scale.y = Math.max(1e-3, this.len * (1 - Math.pow(1 - Math.min(1, u / this.grow), 3)));
    this.mesh.material.uniforms.uTime.value = t; this.mesh.material.uniforms.uA.value = env;
    if (u >= 1) this.mesh.visible = false;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ slashes */

/** Crescent claw / blade swipes that face the camera. */
export class Slashes {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>; t: number; dur: number; roll: number; at: THREE.Vector3 }[] = [];
  private geo = new THREE.RingGeometry(0.78, 1, 48, 1, 0, Math.PI * 0.95);
  constructor(n = 6) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uP: { value: 0 } },
        vertexShader: /* glsl */`varying vec2 vUv; varying float vTh; void main() { vUv = uv; vTh = atan(position.y, position.x) / 3.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uP; varying float vTh; varying vec2 vUv;
          void main() {
            float head = uP * 1.25; float d = head - vTh;
            float a = smoothstep(0.0, 0.05, d) * smoothstep(0.55, 0.0, d) * (1.0 - smoothstep(0.7, 1.0, uP));
            float thin = 1.0 - abs(length(vUv - 0.5) * 2.0 - 0.89) * 9.0;
            gl_FragColor = vec4(mix(uColor, vec3(1.5), 0.45) * 2.4 * a * clamp(thin + 0.6, 0.0, 1.0), 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.visible = false; mesh.renderOrder = 8;
      this.group.add(mesh); this.items.push({ mesh, t: 1, dur: 0.3, roll: 0, at: V() });
    }
    this.group.add(warmTwin(this.items[0].mesh));
  }
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 1, size = 0.75) {
    for (let k = 0; k < count; k++) {
      const it = this.items.find(x => x.t >= x.dur) ?? this.items[k % this.items.length];
      it.t = -k * 0.07; it.dur = 0.32; it.roll = -0.6 + Math.random() * 1.2 + (k % 2 ? Math.PI : 0);
      it.at.copy(at).add(tmpA.set((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 0.12));
      it.mesh.scale.setScalar(size * (0.85 + Math.random() * 0.3));
      it.mesh.material.uniforms.uColor.value.set(color);
    }
  }
  update(dt: number, camera: THREE.Camera) {
    for (const it of this.items) {
      if (it.t >= it.dur) { it.mesh.visible = false; continue; }
      it.t += dt; if (it.t < 0) { it.mesh.visible = false; continue; }
      it.mesh.visible = true; it.mesh.position.copy(it.at);
      it.mesh.quaternion.copy(camera.quaternion); it.mesh.rotateZ(it.roll);
      it.mesh.material.uniforms.uP.value = it.t / it.dur;
    }
  }
  dispose() { this.geo.dispose(); for (const it of this.items) it.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ debris (rocks, meteors, shards, spikes) */

export type DebrisKind = 'rock' | 'meteor' | 'shard' | 'spike' | 'salt' | 'pillar' | 'stone' | 'sword' | 'gear' | 'link';
/**
 * Scripted motion for a piece: write its position and rotation for `life` seconds after it appeared and
 * return a scale factor (0 hides it). Used for swords that circle, rocks that hover, chains that coil.
 */
export type DebrisDrive = (life: number, p: THREE.Vector3, r: THREE.Euler) => number;
type Piece = { alive: boolean; kind: DebrisKind; p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; life: number; ttl: number; groundY: number; onLand: ((p: THREE.Vector3) => void) | null; onFly: ((p: THREE.Vector3) => void) | null; rise: number; drive: DebrisDrive | null };

/** Deterministic per-vertex jitter (shared seam vertices move together, so no cracks open). */
function roughen(g: THREE.BufferGeometry, amt: number, keep: (y: number) => boolean = () => true) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (!keep(y)) continue;
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453, n = h - Math.floor(h);
    const k = 1 + (n - 0.5) * amt;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A sharp, six-sided stone spire with its base at the origin (Stone Edge). */
function pillarGeo() { return roughen(new THREE.ConeGeometry(0.27, 2.0, 5, 3).translate(0, 1.0, 0), 0.5, y => y < 1.96); }
/** A pointed floating stone (Stealth Rock). */
function stoneGeo() { return roughen(new THREE.OctahedronGeometry(1, 0).scale(0.5, 1.15, 0.42), 0.35); }
/** A straight sword, blade up, extruded from its outline (Swords Dance). */
function swordGeo() {
  const s = new THREE.Shape();
  const pts: [number, number][] = [[0, 1], [0.075, 0.83], [0.075, 0.14], [0.25, 0.15], [0.25, 0.08], [0.042, 0.08], [0.042, -0.16], [0.075, -0.2], [0, -0.26],
    [-0.075, -0.2], [-0.042, -0.16], [-0.042, 0.08], [-0.25, 0.08], [-0.25, 0.15], [-0.075, 0.14], [-0.075, 0.83]];
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 1 }).translate(0, 0, -0.0175);
}
/** A toothed gear with an axle hole (Shift Gear). */
function gearGeo() {
  const s = new THREE.Shape(), teeth = 10;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2, r = i % 4 === 1 || i % 4 === 2 ? 0.5 : 0.39;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.15, 0, Math.PI * 2, true); s.holes.push(hole);
  return new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 1, curveSegments: 14 }).translate(0, 0, -0.05);
}

/** Solid, lit pieces simulated on the CPU and drawn as one instanced mesh per kind. */
export class Debris {
  readonly group = new THREE.Group();
  private meshes = new Map<DebrisKind, THREE.InstancedMesh>();
  private pieces: Piece[] = [];
  private dummy = new THREE.Object3D();
  constructor() {
    const mk = (kind: DebrisKind, geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = false;
      this.meshes.set(kind, m); this.group.add(m);
    };
    const rockMat = new THREE.MeshStandardMaterial({ color: '#8a7a5a', roughness: 0.9, flatShading: true, emissive: '#3a2a10', emissiveIntensity: 0.4 });
    mk('rock', new THREE.IcosahedronGeometry(1, 0), rockMat, 40);
    mk('meteor', new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#5a3a8a', roughness: 0.55, metalness: 0.2, flatShading: true, emissive: '#7a3cff', emissiveIntensity: 0.55 }), 12);
    mk('shard', new THREE.OctahedronGeometry(1, 0).scale(0.45, 1.6, 0.45), new THREE.MeshStandardMaterial({ color: '#bff6ff', roughness: 0.15, metalness: 0.1, emissive: '#4fd8ff', emissiveIntensity: 1.4, transparent: true, opacity: 0.9 }), 30);
    mk('spike', new THREE.ConeGeometry(0.5, 1.6, 5).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#9a8058', roughness: 0.95, flatShading: true, emissive: '#2a1a08', emissiveIntensity: 0.5 }), 30);
    mk('salt', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#fff4e6', roughness: 0.3, emissive: '#ffd9a0', emissiveIntensity: 1.2 }), 24);
    mk('pillar', pillarGeo(), new THREE.MeshStandardMaterial({ color: '#8d8270', roughness: 0.62, metalness: 0.12, flatShading: true, emissive: '#2a2219', emissiveIntensity: 0.35 }), 16);
    mk('stone', stoneGeo(), new THREE.MeshStandardMaterial({ color: '#b39c74', roughness: 0.6, metalness: 0.1, flatShading: true, emissive: '#7a5a2a', emissiveIntensity: 0.55 }), 12);
    mk('sword', swordGeo(), new THREE.MeshStandardMaterial({ color: '#eef3fb', roughness: 0.16, metalness: 0.95, emissive: '#86b8ff', emissiveIntensity: 0.55 }), 8);
    mk('gear', gearGeo(), new THREE.MeshStandardMaterial({ color: '#cfd7e6', roughness: 0.28, metalness: 0.92, emissive: '#3d5f96', emissiveIntensity: 0.4 }), 4);
    mk('link', new THREE.TorusGeometry(0.4, 0.11, 8, 18).scale(1, 1.55, 1), new THREE.MeshStandardMaterial({ color: '#6c2f99', roughness: 0.32, metalness: 0.75, emissive: '#b43cff', emissiveIntensity: 0.9 }), 40);
    for (let i = 0; i < 190; i++) this.pieces.push({ alive: false, kind: 'rock', p: V(), v: V(), r: new THREE.Euler(), w: V(), s: 1, life: 0, ttl: 1, groundY: 0, onLand: null, onFly: null, rise: 0, drive: null });
  }
  private alloc() { return this.pieces.find(x => !x.alive) ?? this.pieces[0]; }

  /** Throw a piece; it lands on groundY (calling onLand) or expires. */
  throw(kind: DebrisKind, p: THREE.Vector3, v: THREE.Vector3, s: number, o: { ttl?: number; groundY?: number; onLand?: (p: THREE.Vector3) => void; onFly?: (p: THREE.Vector3) => void } = {}) {
    const x = this.alloc();
    Object.assign(x, { alive: true, kind, s, life: 0, ttl: o.ttl ?? 2, groundY: o.groundY ?? ARENA.floorY + 0.04, onLand: o.onLand ?? null, onFly: o.onFly ?? null, rise: 0, drive: null });
    x.p.copy(p); x.v.copy(v); x.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); x.w.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
  }
  /** A spike erupting from the floor, then sinking back. */
  erupt(at: THREE.Vector3, s: number, delay = 0, kind: DebrisKind = 'spike') {
    const x = this.alloc();
    Object.assign(x, { alive: true, kind, s, life: -delay, ttl: 0.9, groundY: -10, onLand: null, onFly: null, rise: 1, drive: null });
    x.p.set(at.x, ARENA.floorY - 0.02, at.z); x.v.set(0, 0, 0); x.r.set((Math.random() - 0.5) * 0.6, Math.random() * 6, (Math.random() - 0.5) * 0.6); x.w.set(0, 0, 0);
  }
  /** A piece moved by a script for `ttl` seconds (after `delay`). */
  drive(kind: DebrisKind, s: number, ttl: number, fn: DebrisDrive, delay = 0) {
    const x = this.alloc();
    Object.assign(x, { alive: true, kind, s, life: -delay, ttl, groundY: -10, onLand: null, onFly: null, rise: 0, drive: fn });
    x.v.set(0, 0, 0); x.w.set(0, 0, 0);
  }
  update(dt: number) {
    const counts = new Map<DebrisKind, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    for (const x of this.pieces) {
      if (!x.alive) continue;
      x.life += dt;
      if (x.life < 0) continue;
      let scale = x.s;
      if (x.drive) {
        if (x.life >= x.ttl) { x.alive = false; x.drive = null; continue; }
        scale = x.s * x.drive(x.life, x.p, x.r);
        if (scale <= 1e-4) continue;
      } else if (x.rise) {
        const u = x.life / x.ttl;
        const h = u < 0.18 ? smooth(u / 0.18) : u > 0.65 ? 1 - smooth((u - 0.65) / 0.35) : 1;
        scale = x.s * Math.max(0.001, h);
      } else {
        x.v.y -= 9.8 * dt;
        x.p.addScaledVector(x.v, dt);
        x.r.x += x.w.x * dt; x.r.y += x.w.y * dt; x.r.z += x.w.z * dt;
        x.onFly?.(x.p);
        if (x.p.y <= x.groundY && x.v.y < 0) {
          const cb = x.onLand; x.onLand = null; x.onFly = null; cb?.(x.p);
          x.v.multiplyScalar(0.25); x.v.y = Math.abs(x.v.y) * 0.3; x.p.y = x.groundY;
          x.ttl = Math.min(x.ttl, x.life + 0.35);
        }
        if (x.ttl - x.life < 0.3) scale *= Math.max(0, (x.ttl - x.life) / 0.3);
      }
      if (x.life >= x.ttl) { x.alive = false; continue; }
      const m = this.meshes.get(x.kind)!; const i = counts.get(x.kind)!;
      if (i >= m.instanceMatrix.count) continue;
      this.dummy.position.copy(x.p); this.dummy.rotation.copy(x.r); this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix(); m.setMatrixAt(i, this.dummy.matrix); counts.set(x.kind, i + 1);
    }
    for (const [k, m] of this.meshes) { m.count = counts.get(k)!; m.instanceMatrix.needsUpdate = true; m.visible = m.count > 0; }
  }
  clear() { for (const x of this.pieces) { x.alive = false; x.drive = null; } }
  dispose() { for (const m of this.meshes.values()) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); } }
}

/* ------------------------------------------------------------------ shields and screens */

/** Hex-patterned barrier: a bubble for Protect, a wall panel for Reflect / Light Screen. */
export class Barrier {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private t = 9; private dur = 1.2;
  constructor(geo: THREE.BufferGeometry) {
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: geo.type === 'PlaneGeometry' ? THREE.DoubleSide : THREE.FrontSide,
      uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 }, uTime: { value: 0 }, uFlat: { value: geo.type === 'PlaneGeometry' ? 1 : 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uA, uTime, uFlat; varying vec2 vUv; varying vec3 vN, vV;
        float hex(vec2 p) { p *= vec2(1.0, 1.1547); p.x += mod(floor(p.y), 2.0) * 0.5; vec2 f = abs(fract(p) - 0.5); return max(f.x * 1.5 + f.y, f.y * 2.0); }
        void main() {
          float fres = mix(pow(1.0 - abs(dot(vN, vV)), 2.0), 0.55, uFlat);
          float h = smoothstep(0.92, 1.0, hex(vUv * vec2(18.0, 9.0)));
          float sweep = smoothstep(0.1, 0.0, abs(fract(vUv.y - uTime * 0.6) - 0.5) - 0.4);
          gl_FragColor = vec4(uColor * (fres * 1.1 + h * fres * 0.8 + sweep * 0.12 * fres) * 0.6 * uA, 1.0);
        }`,
    }));
    this.mesh.visible = false; this.mesh.renderOrder = 7;
  }
  fire(color: THREE.ColorRepresentation, dur = 1.3) { this.t = 0; this.dur = dur; this.mesh.material.uniforms.uColor.value.set(color); this.mesh.visible = true; }
  update(dt: number, t: number) {
    if (!this.mesh.visible) return;
    this.t += dt; const u = this.t / this.dur;
    this.mesh.material.uniforms.uA.value = Math.min(1, this.t * 6) * (u > 0.7 ? Math.max(0, 1 - (u - 0.7) / 0.3) : 1);
    this.mesh.material.uniforms.uTime.value = t;
    const s = 0.85 + 0.15 * smooth(Math.min(1, this.t * 5));
    this.mesh.scale.setScalar(s);
    if (u >= 1) this.mesh.visible = false;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ lights */

/** A small pool of real point lights for muzzle flashes, impacts and travelling projectiles. */
export class Flashes {
  readonly group = new THREE.Group();
  private lights: { l: THREE.PointLight; t: number; dur: number; peak: number; follow: (() => THREE.Vector3) | null }[] = [];
  /** `scale`: world size of one stage unit. A light's reach is in world units, so it shrinks with the stage. */
  constructor(n = 3, private scale = 1) {
    for (let i = 0; i < n; i++) {
      // Always visible at zero intensity: toggling visibility would change the light count and force
      // every lit material to recompile mid-battle.
      const l = new THREE.PointLight('#ffffff', 0, 7 * scale, 2);
      this.group.add(l); this.lights.push({ l, t: 1, dur: 1, peak: 0, follow: null });
    }
  }
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, peak = 14, dur = 0.45, follow: (() => THREE.Vector3) | null = null) {
    const it = this.lights.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    // The same illuminance at distances scaled by `scale`: the inverse-square law asks for scale squared.
    it.t = 0; it.dur = dur; it.peak = peak * this.scale * this.scale; it.follow = follow;
    it.l.color.set(color); it.l.position.copy(at);
  }
  update(dt: number) {
    for (const it of this.lights) {
      if (it.t >= it.dur) continue;
      it.t += dt; const u = it.t / it.dur;
      if (it.follow) it.l.position.copy(it.follow());
      it.l.intensity = it.peak * (u < 0.08 ? u / 0.08 : Math.pow(Math.max(0, 1 - u), 2));
      if (u >= 1) { it.l.intensity = 0; it.follow = null; }
    }
  }
  clear() { for (const it of this.lights) { it.t = it.dur; it.l.intensity = 0; } }
}

/* ------------------------------------------------------------------ lightning */

const BSEG = 16;
type BoltJob = {
  t: number; dur: number; a: THREE.Vector3; b: THREE.Vector3; jitter: number; arc: number; bow: number; width: number; taper: number;
  restrike: number; next: number; grow: number; struck: number; kids: BoltItem[]; follow: (() => THREE.Vector3) | null;
};
type BoltItem = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; job: BoltJob | null; pts: THREE.Vector3[]; off: THREE.Vector3[]; kid: boolean };

/**
 * Jagged lightning drawn as camera-facing ribbons: a white-hot core inside a coloured glow. Each bolt
 * re-strikes along a new fractal path several times while it lives, can fork into short branches, and
 * can grow from its source to its target (the strike travelling).
 */
/**
 * BattleStage.prewarm() compiles programs for direct output to the screen, but the stage renders into the
 * composer's linear target: a second program variant, which pool meshes hidden while idle only compile on
 * first use (a hitch mid-move). This twin shares the mesh's material and geometry, draws once inside the first
 * render-target pass with an empty draw range (nothing is rasterised), then hides for good.
 */
export function warmTwin(src: THREE.Mesh | THREE.Points): THREE.Mesh | THREE.Points {
  const w = src instanceof THREE.Points ? new THREE.Points(src.geometry, src.material) : new THREE.Mesh(src.geometry, src.material);
  w.frustumCulled = false;
  let saved = Infinity;
  w.onBeforeRender = (_r, _s, _c, g) => { saved = g.drawRange.count; g.setDrawRange(g.drawRange.start, 0); };
  w.onAfterRender = (r, _s, _c, g) => { g.setDrawRange(g.drawRange.start, saved); if (r.getRenderTarget()) w.visible = false; };
  return w;
}

export class Bolts {
  /** World size of one stage unit (a stage shown as a miniature): the ribbon width is in view space and must follow it. */
  scale = 1;
  readonly group = new THREE.Group();
  private items: BoltItem[] = [];
  private sA = V(); private sB = V(); private sC = V();
  /** Reduce flashing: steady brightness, no flash on each re-strike. */
  calm = false;
  constructor(n = 18) {
    const N = BSEG + 1;
    const idx: number[] = [];
    for (let k = 0; k < BSEG; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < n; i++) {
      const g = new THREE.BufferGeometry();
      const side = new Float32Array(N * 2), uu = new Float32Array(N * 2);
      for (let k = 0; k < N; k++) { side[k * 2] = -1; side[k * 2 + 1] = 1; uu[k * 2] = uu[k * 2 + 1] = k / BSEG; }
      g.setIndex(idx);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setAttribute('aU', new THREE.BufferAttribute(uu, 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color('#ffffff') }, uA: { value: 0 }, uW: { value: 0.06 }, uTip: { value: 1 }, uTaper: { value: 0.35 } },
        vertexShader: /* glsl */`
          attribute vec3 aTan; attribute float aSide, aU; uniform float uW, uTaper;
          varying float vSide, vU;
          void main() {
            vSide = aSide; vU = aU;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vec4 mt = modelViewMatrix * vec4(position + aTan, 1.0);
            vec2 d = mt.xy / max(-mt.z, 0.01) - mv.xy / max(-mv.z, 0.01);
            float l = length(d); d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
            mv.xy += vec2(-d.y, d.x) * aSide * uW * (1.0 - uTaper * aU);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor, uCore; uniform float uA, uTip; varying float vSide, vU;
          void main() {
            if (vU > uTip) discard;
            float x = abs(vSide);
            float core = smoothstep(0.26, 0.0, x), glow = (1.0 - x) * (1.0 - x) * (1.0 - x);
            float head = smoothstep(0.12, 0.0, uTip - vU) * step(uTip, 0.999);
            gl_FragColor = vec4((uColor * glow * 1.5 + uCore * (core * 1.7 + head * 2.0)) * uA, 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 8;
      this.group.add(mesh);
      this.items.push({ mesh, job: null, pts: Array.from({ length: N }, V), off: Array.from({ length: N }, V), kid: false });
    }
    this.group.add(warmTwin(this.items[0].mesh));
  }
  /**
   * Strike from a to b. jitter: fractal displacement (m); arc: upward bulge and bow: sideways bulge (share
   * of the length); grow: seconds for the strike to travel; follow: re-reads the source on each re-strike.
   */
  fire(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, o: { dur?: number; jitter?: number; arc?: number; bow?: number; width?: number; taper?: number; restrike?: number; delay?: number; branches?: number; grow?: number; core?: THREE.ColorRepresentation; follow?: () => THREE.Vector3 } = {}) {
    const main = this.items.find(x => !x.job); if (!main) return;
    const job: BoltJob = {
      t: -(o.delay ?? 0), dur: o.dur ?? 0.4, a: a.clone(), b: b.clone(), jitter: o.jitter ?? 0.2, arc: o.arc ?? 0, bow: o.bow ?? 0,
      width: o.width ?? 0.06, taper: o.taper ?? 0.35, restrike: o.restrike ?? 0.06, next: 0, grow: o.grow ?? 0, struck: 0, kids: [], follow: o.follow ?? null,
    };
    main.job = job; main.kid = false; main.mesh.material.uniforms.uColor.value.set(color); main.mesh.material.uniforms.uCore.value.set(o.core ?? '#ffffff');
    for (let k = 0; k < (o.branches ?? 0); k++) {
      const it = this.items.find(x => !x.job); if (!it) break;
      it.job = job; it.kid = true; it.mesh.material.uniforms.uColor.value.set(color); it.mesh.material.uniforms.uCore.value.set(o.core ?? '#ffffff');
      job.kids.push(it);
    }
  }
  private build(it: BoltItem, a: THREE.Vector3, b: THREE.Vector3, jitter: number, arc: number, bow: number) {
    const P = it.pts, O = it.off, n = BSEG;
    const d = tmpA.subVectors(b, a); const len = d.length();
    const side = tmpB.crossVectors(d, UP); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
    const up = tmpC.crossVectors(side, d).normalize();
    O[0].set(0, 0, 0); O[n].set(0, 0, 0);
    for (let step = n / 2, amp = jitter; step >= 1; step /= 2, amp *= 0.68)
      for (let k = step; k < n; k += step * 2)
        O[k].addVectors(O[k - step], O[k + step]).multiplyScalar(0.5).add(tmpD.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * amp));
    for (let k = 0; k <= n; k++) {
      const u = k / n, s = Math.sin(Math.PI * u);
      P[k].copy(a).addScaledVector(d, u).addScaledVector(up, arc * len * s).addScaledVector(side, bow * len * s).add(O[k]);
    }
    const pos = it.mesh.geometry.attributes.position as THREE.BufferAttribute, tan = it.mesh.geometry.attributes.aTan as THREE.BufferAttribute;
    for (let k = 0; k <= n; k++) {
      const t = tmpA.subVectors(P[Math.min(n, k + 1)], P[Math.max(0, k - 1)]);
      for (let e = 0; e < 2; e++) { pos.setXYZ(k * 2 + e, P[k].x, P[k].y, P[k].z); tan.setXYZ(k * 2 + e, t.x, t.y, t.z); }
    }
    pos.needsUpdate = true; tan.needsUpdate = true;
  }
  private strike(it: BoltItem, j: BoltJob) {
    if (j.follow) j.a.copy(j.follow());
    this.build(it, j.a, j.b, j.jitter, j.arc, j.bow);
    const len = j.a.distanceTo(j.b);
    for (const kid of j.kids) {
      const i0 = 3 + Math.floor(Math.random() * (BSEG - 7));
      const from = this.sA.copy(it.pts[i0]);
      const dir = this.sB.subVectors(it.pts[i0 + 1], it.pts[i0 - 1]).normalize().add(tmpC.randomDirection().multiplyScalar(0.9)).normalize();
      const to = this.sC.copy(from).addScaledVector(dir, len * (0.14 + Math.random() * 0.16));
      this.build(kid, from, to, j.jitter * 0.5, 0, 0);
    }
    j.struck = j.t; j.next = j.t + j.restrike * (0.7 + Math.random() * 0.6);
  }
  update(dt: number) {
    for (const it of this.items) {
      const j = it.job; if (!j || it.kid) continue;
      j.t += dt;
      const u = j.t / j.dur;
      if (j.t < 0 || u >= 1) {
        it.mesh.visible = false; for (const x of j.kids) x.mesh.visible = false;
        if (u >= 1) { it.job = null; for (const x of j.kids) { x.job = null; x.kid = false; } }
        continue;
      }
      if (j.t >= j.next) this.strike(it, j);
      const tip = j.grow > 0 ? Math.min(1, j.t / j.grow) : 1;
      const env = Math.min(1, j.t / 0.025) * (u > 0.7 ? (1 - u) / 0.3 : 1);
      const a = this.calm ? env * 0.7 : env * (0.6 + 0.4 * Math.random()) * (1 + 0.8 * Math.exp(-(j.t - j.struck) * 40));
      const w = j.width * this.scale * (0.85 + 0.3 * Math.random());
      const U = it.mesh.material.uniforms;
      it.mesh.visible = true; U.uA.value = a; U.uW.value = w; U.uTip.value = tip; U.uTaper.value = j.taper;
      for (const x of j.kids) {
        const K = x.mesh.material.uniforms;
        x.mesh.visible = tip >= 1; K.uA.value = a * 0.75; K.uW.value = w * 0.55; K.uTip.value = 1; K.uTaper.value = 0.8;
      }
    }
  }
  clear() { for (const it of this.items) { it.job = null; it.kid = false; it.mesh.visible = false; } }
  dispose() { for (const it of this.items) { it.mesh.geometry.dispose(); it.mesh.material.dispose(); } }
}

/* ------------------------------------------------------------------ flares (starbursts, moons, suns) */

type FlareItem = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; t: number; dur: number; s0: number; s1: number; hold: number; fadeIn: number; peak: number; spin: number; at: THREE.Vector3; follow: (() => THREE.Vector3) | null };

/**
 * Camera-facing light shapes: a rayed starburst (Dazzling Gleam, impact glints, a rising Wish star) or a
 * glowing disc with a halo (the Moonblast moon, the Morning Sun sun).
 */
export class Flares {
  readonly group = new THREE.Group();
  private items: FlareItem[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  /** Brightness ceiling (lowered by Reduce flashing). */
  cap = 1;
  constructor(n: number, private cam: () => THREE.Camera) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uA: { value: 0 }, uRays: { value: 8 }, uRot: { value: 0 }, uMode: { value: 0 }, uSharp: { value: 12 } },
        vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor, uCore; uniform float uA, uRays, uRot, uMode, uSharp; varying vec2 vUv;
          void main() {
            vec2 p = vUv * 2.0 - 1.0; float r = length(p);
            if (r > 1.0) discard;
            float an = atan(p.y, p.x) + uRot;
            vec3 col;
            if (uMode < 0.5) {
              float rays = pow(abs(cos(an * uRays * 0.5)), uSharp) + pow(abs(cos(an * uRays + 0.8)), uSharp * 3.0) * 0.45;
              float fall = pow(max(1.0 - r, 0.0), 1.6);
              col = uColor * (rays * fall * 1.6 + exp(-r * 5.0) * 0.5) + uCore * exp(-r * r * 40.0) * 2.2;
            } else if (uMode < 1.5) {
              float disc = smoothstep(0.52, 0.49, r);
              float maria = 0.84 + 0.16 * sin(p.x * 9.0 + 1.3) * sin(p.y * 7.0 - 0.4);
              float limb = 0.72 + 0.28 * sqrt(max(0.0, 1.0 - r * r * 4.0));
              float halo = exp(-max(r - 0.5, 0.0) * 6.0) * (1.0 - disc) * smoothstep(1.0, 0.55, r);
              col = uCore * disc * limb * maria * 1.5 + uColor * halo * 1.3;
            } else {
              // A hollow glowing shell with a soft outer glow: whatever dark core sits inside shows through.
              float shell = smoothstep(0.28, 0.42, r) * smoothstep(0.62, 0.45, r);
              float outer = exp(-max(r - 0.45, 0.0) * 6.0) * smoothstep(1.0, 0.6, r) * 0.55;
              float swirl = 0.7 + 0.3 * sin(an * 5.0);
              float inner = smoothstep(0.42, 0.0, r) * 0.16;
              col = uColor * (shell * 1.7 * swirl + outer + inner) + uCore * shell * swirl * 0.5;
            }
            gl_FragColor = vec4(col * uA, 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.visible = false; mesh.renderOrder = 8; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.items.push({ mesh, t: 1, dur: 1, s0: 1, s1: 1, hold: 0.5, fadeIn: 0.1, peak: 1, spin: 0, at: V(), follow: null });
    }
    this.group.add(warmTwin(this.items[0].mesh));
  }
  /** mode 0: starburst with `rays` rays; mode 1: disc with halo (a moon); mode 2: hollow shell (a dark orb's rim). Sizes are diameters in metres. */
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, o: { core?: THREE.ColorRepresentation; s0?: number; s1?: number; dur?: number; rays?: number; sharp?: number; mode?: 0 | 1 | 2; spin?: number; delay?: number; hold?: number; fadeIn?: number; peak?: number; follow?: () => THREE.Vector3 } = {}) {
    const it = this.items.find(x => x.t >= x.dur) ?? this.items.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    Object.assign(it, { t: -(o.delay ?? 0), dur: o.dur ?? 0.5, s0: o.s0 ?? 0.2, s1: o.s1 ?? 1.2, hold: o.hold ?? 0.35, fadeIn: o.fadeIn ?? 0.08, peak: o.peak ?? 1, spin: o.spin ?? 0, follow: o.follow ?? null });
    it.at.copy(at);
    const U = it.mesh.material.uniforms;
    U.uColor.value.set(color); U.uCore.value.set(o.core ?? '#ffffff'); U.uRays.value = o.rays ?? 8; U.uSharp.value = o.sharp ?? 12;
    U.uMode.value = o.mode ?? 0; U.uRot.value = Math.random() * 6.28; U.uA.value = 0;
  }
  update(dt: number) {
    const cam = this.cam();
    for (const it of this.items) {
      if (it.t >= it.dur) { it.mesh.visible = false; continue; }
      it.t += dt;
      if (it.t < 0) { it.mesh.visible = false; continue; }
      const u = Math.min(1, it.t / it.dur);
      if (it.follow) it.at.copy(it.follow());
      it.mesh.visible = u < 1;
      it.mesh.position.copy(it.at);
      it.mesh.quaternion.copy(cam.quaternion);
      it.mesh.scale.setScalar(Math.max(1e-3, it.s0 + (it.s1 - it.s0) * (1 - Math.pow(1 - u, 3))));
      const fin = it.fadeIn > 0 ? Math.min(1, u / it.fadeIn) : 1;
      const fout = u > it.hold ? 1 - smooth(Math.min(1, (u - it.hold) / Math.max(1e-3, 1 - it.hold))) : 1;
      const U = it.mesh.material.uniforms;
      U.uA.value = it.peak * fin * fout * this.cap;
      U.uRot.value += it.spin * dt;
    }
  }
  clear() { for (const it of this.items) { it.t = it.dur; it.mesh.visible = false; } }
  dispose() { this.geo.dispose(); for (const it of this.items) it.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ wave (Surf, Sludge Wave) */

/**
 * A breaking wave: one curved sheet whose cross-section (a long back slope rising to a crest, then a
 * lip curling forward) is built in the vertex shader. It rises behind the user, sweeps across the
 * field so its crest passes over the target at the impact time, then collapses.
 */
export class Wave {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private t = 1; private dur = 1; private rise = 0.25; private hitAt = 0.8; private speed = 1;
  private start = V(); private dir = V(); private side = V(); private basis = new THREE.Matrix4();
  private W = 2.6; private H = 1.4; private h = 0; private clock = 0;
  constructor() {
    const g = new THREE.PlaneGeometry(1, 1, 44, 20);
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uDeep: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() }, uA: { value: 0 }, uTime: { value: 0 }, uLip: { value: 2.1 }, uBack: { value: 1.3 } },
      vertexShader: /* glsl */`
        uniform float uLip, uBack, uTime;
        varying vec2 vUv; varying vec3 vN, vV;
        vec2 prof(float v) {
          if (v < 0.62) { float s = v / 0.62; return vec2(-uBack * (1.0 - s), 1.0 - (1.0 - s) * (1.0 - s)); }
          float s = (v - 0.62) / 0.38; float a = s * uLip;
          return vec2(0.3 * sin(a), 0.7 + 0.3 * cos(a));
        }
        void main() {
          vUv = uv;
          float u = uv.x, v = uv.y;
          float bump = mix(0.3, 1.0, sin(3.14159 * u)) * (1.0 + 0.07 * sin(u * 13.0 + uTime * 4.0));
          vec2 pr = prof(v);
          vec3 pos = vec3(u - 0.5, pr.y * bump, pr.x * bump);
          vec2 d = prof(min(v + 0.02, 1.0)) - prof(max(v - 0.02, 0.0));
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          vN = normalize(normalMatrix * normalize(vec3(0.0, d.x, -d.y))); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uDeep, uMid, uFoam; uniform float uA, uTime;
        varying vec2 vUv; varying vec3 vN, vV;
        void main() {
          float u = vUv.x, v = vUv.y;
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          vec3 col = mix(uDeep, uMid, smoothstep(0.05, 0.7, v));
          float flow = 0.5 + 0.5 * sin(v * 30.0 - uTime * 10.0 + sin(u * 23.0) * 1.5);
          float streak = 0.5 + 0.5 * sin(u * 61.0 + sin(v * 7.0 + uTime) * 2.5);
          col += uMid * 0.4 * flow * streak;
          float fn = 0.5 + 0.5 * sin(u * 47.0 + uTime * 5.0) * sin(u * 19.0 - uTime * 3.0 + v * 12.0);
          float foam = clamp(smoothstep(0.58, 0.76, v + fn * 0.14) + smoothstep(0.93, 1.0, v), 0.0, 1.0);
          col = mix(col, uFoam * 1.35, foam * 0.9) + uFoam * fres * 0.45;
          float edge = smoothstep(0.0, 0.14, u) * smoothstep(1.0, 0.86, u);
          float alpha = clamp(0.5 + 0.4 * foam + 0.3 * fres, 0.0, 1.0) * edge * smoothstep(0.0, 0.12, v) * uA;
          gl_FragColor = vec4(col * alpha, alpha);
        }`,
    }));
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    this.warm = warmTwin(this.mesh);
  }
  /** Add next to `mesh` (not under it: the mesh is hidden while idle). */
  readonly warm: THREE.Object3D;
  get active() { return this.t < this.dur; }
  /**
   * start: floor point behind the user where the wave rises; target: floor point under the target, which
   * the crest crosses at `hitAt` seconds. Sizes in metres.
   */
  fire(start: THREE.Vector3, target: THREE.Vector3, o: { width: number; height: number; deep: THREE.ColorRepresentation; mid: THREE.ColorRepresentation; foam: THREE.ColorRepresentation; dur: number; rise: number; hitAt: number }) {
    this.start.copy(start);
    this.dir.subVectors(target, start).setY(0);
    const dist = this.dir.length(); this.dir.normalize();
    this.side.set(this.dir.z, 0, -this.dir.x);
    this.basis.makeBasis(this.side, UP, this.dir);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    this.t = 0; this.dur = o.dur; this.rise = o.rise; this.hitAt = o.hitAt; this.speed = dist / Math.max(0.05, o.hitAt - o.rise);
    this.W = o.width; this.H = o.height; this.h = 0;
    const U = this.mesh.material.uniforms;
    U.uDeep.value.set(o.deep); U.uMid.value.set(o.mid); U.uFoam.value.set(o.foam); U.uA.value = 0;
    this.mesh.visible = true;
    this.place();
  }
  /** World position of the crest at `u` (0..1 along it), right now. */
  crest(u: number, out: THREE.Vector3) {
    const bump = 0.3 + 0.7 * Math.sin(Math.PI * u);
    return out.copy(this.mesh.position).addScaledVector(this.side, (u - 0.5) * this.W).setY(this.mesh.position.y + this.h * bump);
  }
  /** Where the crest line is along the field right now. */
  get front() { return this.mesh.position; }
  private place() {
    const t = this.t, travel = Math.max(0, t - this.rise) * this.speed;
    this.mesh.position.copy(this.start).addScaledVector(this.dir, travel);
    const up = t < this.rise ? 1 - Math.pow(1 - t / this.rise, 3) : 1;
    const fall = t > this.hitAt + 0.1 ? smooth(Math.min(1, (t - this.hitAt - 0.1) / Math.max(0.05, this.dur - this.hitAt - 0.1))) : 0;
    this.h = this.H * Math.max(0.02, up * (1 - 0.75 * fall));
    this.mesh.scale.set(this.W, this.h, this.h);
    const U = this.mesh.material.uniforms;
    U.uLip.value = 2.0 + 1.3 * fall; U.uBack.value = 1.35;
    U.uA.value = Math.min(1, t / 0.12) * (1 - fall);
  }
  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t += dt; this.clock += dt;
    this.mesh.material.uniforms.uTime.value = this.clock;
    if (this.t >= this.dur) { this.mesh.visible = false; return; }
    this.place();
  }
  clear() { this.t = this.dur; this.mesh.visible = false; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/* ------------------------------------------------------------------ glowing ground cracks */

type CrackItem = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; t: number; dur: number; grow: number };

/** Glowing fissures spreading over the floor from a point (Earth Power, Earthquake, Ruination). */
export class Cracks {
  readonly group = new THREE.Group();
  private items: CrackItem[] = [];
  private geo = new THREE.PlaneGeometry(2, 2);
  constructor(n = 3) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 }, uGrow: { value: 0 }, uSeed: { value: 0 } },
        vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 uColor; uniform float uA, uGrow, uSeed; varying vec2 vUv;
          float h1(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
          void main() {
            vec2 p = vUv * 2.0 - 1.0; float r = length(p);
            if (r > 1.0) discard;
            float an = atan(p.y, p.x), lines = 0.0;
            for (int i = 0; i < 8; i++) {
              float fi = float(i);
              float base = (fi + 0.2 + h1(fi) * 0.6) * 0.785398;
              float len = 0.5 + 0.5 * h1(fi + 9.0);
              float ang = base + 0.28 * sin(r * 8.0 + fi * 2.3 + uSeed) + 0.1 * sin(r * 21.0 + fi * 4.1);
              float d = abs(mod(an - ang + 3.14159, 6.28318) - 3.14159) * r;
              float w = 0.042 * (1.0 - r / len) + 0.006;
              lines = max(lines, smoothstep(w, w * 0.15, d) * step(r, min(len, uGrow)));
              float bang = ang + (h1(fi + 3.0) - 0.5) * 0.9 + 0.15 * sin(r * 17.0 + fi);
              float db = abs(mod(an - bang + 3.14159, 6.28318) - 3.14159) * r;
              float r0 = 0.22 + 0.25 * h1(fi + 5.0);
              lines = max(lines, 0.8 * smoothstep(w * 0.8, 0.0, db) * step(r0, r) * step(r, min(len * 0.85, uGrow)));
            }
            float pool = exp(-r * r * 14.0) * smoothstep(0.0, 0.3, uGrow);
            float a = (lines + pool * 0.6) * uA * smoothstep(1.0, 0.85, r);
            gl_FragColor = vec4(uColor * a * 2.2 + vec3(1.0) * lines * uA * 0.6, 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat); mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 4;
      this.group.add(mesh); this.items.push({ mesh, t: 1, dur: 1, grow: 0.3 });
    }
    this.group.add(warmTwin(this.items[0].mesh));
  }
  /** radius in metres; the fissures spread over `grow` seconds and fade over the last 40% of `dur`. */
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, o: { radius?: number; dur?: number; grow?: number; delay?: number } = {}) {
    const it = this.items.find(x => x.t >= x.dur) ?? this.items[0];
    it.t = -(o.delay ?? 0); it.dur = o.dur ?? 1.2; it.grow = o.grow ?? 0.3;
    it.mesh.position.set(at.x, ARENA.floorY + 0.012, at.z); it.mesh.scale.setScalar((o.radius ?? 1) / 1);
    it.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
    const U = it.mesh.material.uniforms; U.uColor.value.set(color); U.uSeed.value = Math.random() * 10; U.uA.value = 0; U.uGrow.value = 0;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (it.t >= it.dur) { it.mesh.visible = false; continue; }
      it.t += dt;
      if (it.t < 0) { it.mesh.visible = false; continue; }
      const u = Math.min(1, it.t / it.dur);
      it.mesh.visible = u < 1;
      const U = it.mesh.material.uniforms;
      U.uGrow.value = 1 - Math.pow(1 - Math.min(1, it.t / it.grow), 2);
      U.uA.value = Math.min(1, it.t / 0.05) * (u > 0.6 ? 1 - smooth((u - 0.6) / 0.4) : 1);
    }
  }
  clear() { for (const it of this.items) { it.t = it.dur; it.mesh.visible = false; } }
  dispose() { this.geo.dispose(); for (const it of this.items) it.mesh.material.dispose(); }
}
