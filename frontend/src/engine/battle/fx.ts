import * as THREE from 'three';
import { ARENA } from './BattleCamera.js';

/**
 * Pooled effect primitives for move animations. Everything is allocated once when the arena is
 * built; playing an effect only rewrites buffers and uniforms, so a long battle never grows the
 * scene, the GPU memory or the garbage collector's workload.
 */

const V = () => new THREE.Vector3();
const tmpA = V(), tmpB = V(), tmpC = V();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => x * x * (3 - 2 * x);

/* ------------------------------------------------------------------ particles */

export const enum Shape { Glow = 0, Leaf = 1, Star = 2, Coin = 3, Ring = 4 }

export type ParticleOpts = {
  color: THREE.ColorRepresentation; shape?: Shape; size?: number; sizeEnd?: number; ttl?: number;
  gravity?: number; drag?: number; spin?: number;
  /** Orbit around a vertical axis through (cx, cz) at w rad/s. */
  orbit?: { cx: number; cz: number; w: number };
  /** Spring toward a point (homing), strength k. */
  home?: { x: number; y: number; z: number; k: number };
};

const MAXP = 2600;

/**
 * One CPU-simulated particle field (a single draw call) used by streams, swirls, sparks, spores,
 * lightning, coins and leaves. Particles are recycled ring-buffer style.
 */
export class Particles {
  readonly mesh: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private pos = new Float32Array(MAXP * 3);
  private col = new Float32Array(MAXP * 3);
  private size = new Float32Array(MAXP);
  private alpha = new Float32Array(MAXP);
  private shape = new Float32Array(MAXP);
  private rot = new Float32Array(MAXP);
  private vel = new Float32Array(MAXP * 3);
  private life = new Float32Array(MAXP).fill(1e9);
  private ttl = new Float32Array(MAXP).fill(1);
  private s0 = new Float32Array(MAXP); private s1 = new Float32Array(MAXP);
  private grav = new Float32Array(MAXP); private drag = new Float32Array(MAXP); private spin = new Float32Array(MAXP);
  private orb = new Float32Array(MAXP * 3); // cx, cz, w
  private home = new Float32Array(MAXP * 4); // x, y, z, k
  private next = 0;
  private emitters: { t: number; dur: number; acc: number; rate: number; spawn: (u: number) => void }[] = [];
  private live = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
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
          if (vS < 0.5) { a = smoothstep(0.5, 0.0, length(p)); a *= a; col = mix(vec3(1.0), vC, 0.55 + 0.45 * (1.0 - a)); }
          else if (vS < 1.5) { vec2 l = q * vec2(1.0, 2.6); a = smoothstep(0.5, 0.36, length(l)) * (0.65 + 0.35 * step(abs(q.y), 0.03)); }
          else if (vS < 2.5) { a = max(smoothstep(0.07, 0.0, abs(q.x)) * smoothstep(0.5, 0.0, abs(q.y)), smoothstep(0.07, 0.0, abs(q.y)) * smoothstep(0.5, 0.0, abs(q.x))); a = max(a, smoothstep(0.18, 0.0, length(p))); col = mix(vec3(1.0), vC, 0.5); }
          else if (vS < 3.5) { vec2 k = vec2(q.x / max(abs(cos(vR * 3.0)), 0.15), q.y); float d = length(k); a = smoothstep(0.5, 0.44, d); col = vC * (0.75 + 0.6 * smoothstep(0.44, 0.3, d)) + vec3(0.4) * smoothstep(0.2, 0.0, abs(k.x + k.y)); }
          else { float d = length(p); a = smoothstep(0.08, 0.0, abs(d - 0.38)); }
          gl_FragColor = vec4(col * 1.7 * a * vA, 1.0);
        }`,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
  }

  /** Spawn one particle. */
  emit(p: THREE.Vector3, v: THREE.Vector3, o: ParticleOpts) {
    const i = this.next; this.next = (this.next + 1) % MAXP;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    const c = tmpColor.set(o.color); this.col.set([c.r, c.g, c.b], i * 3);
    this.life[i] = 0; this.ttl[i] = o.ttl ?? 0.8;
    this.s0[i] = o.size ?? 0.06; this.s1[i] = o.sizeEnd ?? (o.size ?? 0.06) * 0.3;
    this.shape[i] = o.shape ?? Shape.Glow; this.rot[i] = Math.random() * 6.28; this.spin[i] = o.spin ?? 0;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0;
    if (o.orbit) this.orb.set([o.orbit.cx, o.orbit.cz, o.orbit.w], i * 3); else this.orb[i * 3 + 2] = 0;
    if (o.home) this.home.set([o.home.x, o.home.y, o.home.z, o.home.k], i * 4); else this.home[i * 4 + 3] = 0;
  }

  /** Run a spawner at `rate` particles per second for `dur` seconds; spawn receives progress 0..1. */
  emitter(dur: number, rate: number, spawn: (u: number) => void) { this.emitters.push({ t: 0, dur, acc: 0, rate, spawn }); }

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
      const p = tmpA.set(c.x + Math.cos(a) * rr, c.y - 0.5 + Math.random() * 0.2, c.z + Math.sin(a) * rr);
      const v = tmpB.set(0, h / (o.ttl ?? 1), 0);
      this.emit(p, v, { ...o, orbit: { cx: c.x, cz: c.z, w: w * (0.8 + Math.random() * 0.4) }, home: o.inward ? { x: c.x, y: c.y + 0.6, z: c.z, k: 1.6 } : undefined });
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
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k];
      e.t += dt; e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; e.spawn(Math.min(1, e.t / e.dur)); }
      if (e.t >= e.dur) this.emitters.splice(k, 1);
    }
    let live = 0;
    for (let i = 0; i < MAXP; i++) {
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
      this.alpha[i] = Math.min(1, l * 20) * (1 - u * u);
    }
    this.live = live;
    if (live || this.emitters.length) {
      const a = this.mesh.geometry.attributes;
      for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape', 'aRot']) (a[k] as THREE.BufferAttribute).needsUpdate = true;
    }
    this.mesh.visible = live > 0;
  }
  get active() { return this.live; }
  clear() { this.life.fill(1e9); this.emitters.length = 0; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
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
  private t = 1; private dur = 0.7; private width = 0.12;
  constructor() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uA: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN, vV;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uTime, uA; varying vec2 vUv; varying vec3 vN, vV;
        void main() {
          float facing = abs(dot(vN, vV));
          float core = pow(facing, 3.0);
          float stripes = 0.65 + 0.35 * sin(vUv.y * 60.0 - uTime * 40.0);
          vec3 col = mix(uColor * stripes, vec3(1.6), core);
          float tip = smoothstep(1.0, 0.94, vUv.y) * smoothstep(0.0, 0.03, vUv.y);
          gl_FragColor = vec4(col * (0.4 + 1.6 * facing) * uA * tip, 1.0);
        }`,
    }));
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
  }
  fire(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, dur = 0.75, width = 0.12) {
    this.t = 0; this.dur = dur; this.width = width;
    this.mesh.material.uniforms.uColor.value.set(color);
    this.mesh.position.copy(a);
    const d = tmpA.subVectors(b, a); const len = d.length();
    this.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    this.mesh.scale.set(width, len, width);
    this.mesh.visible = true;
  }
  update(dt: number, t: number) {
    if (!this.mesh.visible) return;
    this.t += dt; const u = this.t / this.dur;
    // Snap open, wobble, then pinch closed.
    const env = u < 0.12 ? u / 0.12 : u > 0.75 ? Math.max(0, 1 - (u - 0.75) / 0.25) : 1;
    const w = this.width * (0.3 + 0.7 * env) * (1 + 0.12 * Math.sin(t * 70));
    this.mesh.scale.x = this.mesh.scale.z = w;
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

export type DebrisKind = 'rock' | 'meteor' | 'shard' | 'spike' | 'salt';
type Piece = { alive: boolean; kind: DebrisKind; p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number; life: number; ttl: number; groundY: number; onLand: ((p: THREE.Vector3) => void) | null; onFly: ((p: THREE.Vector3) => void) | null; rise: number };

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
    mk('rock', new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#8a7a5a', roughness: 0.9, flatShading: true, emissive: '#3a2a10', emissiveIntensity: 0.4 }), 40);
    mk('meteor', new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#5a3a8a', roughness: 0.55, metalness: 0.2, flatShading: true, emissive: '#7a3cff', emissiveIntensity: 0.55 }), 12);
    mk('shard', new THREE.OctahedronGeometry(1, 0).scale(0.45, 1.6, 0.45), new THREE.MeshStandardMaterial({ color: '#bff6ff', roughness: 0.15, metalness: 0.1, emissive: '#4fd8ff', emissiveIntensity: 1.4, transparent: true, opacity: 0.9 }), 30);
    mk('spike', new THREE.ConeGeometry(0.5, 1.6, 5).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#9a8058', roughness: 0.95, flatShading: true, emissive: '#2a1a08', emissiveIntensity: 0.5 }), 30);
    mk('salt', new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#fff4e6', roughness: 0.3, emissive: '#ffd9a0', emissiveIntensity: 1.2 }), 24);
    for (let i = 0; i < 136; i++) this.pieces.push({ alive: false, kind: 'rock', p: V(), v: V(), r: new THREE.Euler(), w: V(), s: 1, life: 0, ttl: 1, groundY: 0, onLand: null, onFly: null, rise: 0 });
  }
  private alloc() { return this.pieces.find(x => !x.alive) ?? this.pieces[0]; }

  /** Throw a piece; it lands on groundY (calling onLand) or expires. */
  throw(kind: DebrisKind, p: THREE.Vector3, v: THREE.Vector3, s: number, o: { ttl?: number; groundY?: number; onLand?: (p: THREE.Vector3) => void; onFly?: (p: THREE.Vector3) => void } = {}) {
    const x = this.alloc();
    Object.assign(x, { alive: true, kind, s, life: 0, ttl: o.ttl ?? 2, groundY: o.groundY ?? ARENA.floorY + 0.04, onLand: o.onLand ?? null, onFly: o.onFly ?? null, rise: 0 });
    x.p.copy(p); x.v.copy(v); x.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); x.w.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
  }
  /** A spike erupting from the floor, then sinking back. */
  erupt(at: THREE.Vector3, s: number, delay = 0, kind: DebrisKind = 'spike') {
    const x = this.alloc();
    Object.assign(x, { alive: true, kind, s, life: -delay, ttl: 0.9, groundY: -10, onLand: null, onFly: null, rise: 1 });
    x.p.set(at.x, ARENA.floorY - 0.02, at.z); x.v.set(0, 0, 0); x.r.set((Math.random() - 0.5) * 0.6, Math.random() * 6, (Math.random() - 0.5) * 0.6); x.w.set(0, 0, 0);
  }
  update(dt: number) {
    const counts = new Map<DebrisKind, number>();
    for (const k of this.meshes.keys()) counts.set(k, 0);
    for (const x of this.pieces) {
      if (!x.alive) continue;
      x.life += dt;
      if (x.life < 0) continue;
      let scale = x.s;
      if (x.rise) {
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
  clear() { for (const x of this.pieces) x.alive = false; }
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
  constructor(n = 3) {
    for (let i = 0; i < n; i++) {
      // Always visible at zero intensity: toggling visibility would change the light count and force
      // every lit material to recompile mid-battle.
      const l = new THREE.PointLight('#ffffff', 0, 7, 2);
      this.group.add(l); this.lights.push({ l, t: 1, dur: 1, peak: 0, follow: null });
    }
  }
  fire(at: THREE.Vector3, color: THREE.ColorRepresentation, peak = 14, dur = 0.45, follow: (() => THREE.Vector3) | null = null) {
    const it = this.lights.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    it.t = 0; it.dur = dur; it.peak = peak; it.follow = follow;
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
