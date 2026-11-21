import * as THREE from 'three';
import type { TypeName } from '@shared';
import { moveInfo } from '@shared';
import { pokemonArt } from '../../assets.js';
import { easeOutCubic, rand } from '../math.js';
import { ARENA, BattleCamera } from './BattleCamera.js';
import { Barrier, Beam, Debris, Flashes, Particles, Rings, Shape, Slashes, type DebrisKind } from './fx.js';
import { impactDelay, recipeFor, type Aura, type Recipe } from './moveFx.js';

/** Conventional type colours, used for move trails, impacts and Tera crystals. */
export const TYPE_HEX: Record<TypeName, string> = {
  Normal: '#c6c6a7', Fire: '#ff7a2f', Water: '#4f8cff', Electric: '#ffd23f', Grass: '#62d26f', Ice: '#8ff0ff',
  Fighting: '#e0453a', Poison: '#b55bd6', Ground: '#e6c36a', Flying: '#a98ff3', Psychic: '#ff5e9c', Bug: '#b7d335',
  Rock: '#c9b458', Ghost: '#8a6bd1', Dragon: '#7a4dff', Dark: '#8b6f5c', Steel: '#bfc7e0', Fairy: '#ff9bd2', Stellar: '#6fe6d6',
};
const AURA_HEX: Record<Aura, string> = { none: '#ffffff', water: '#5aa8ff', fire: '#ff8a2a', electric: '#ffe45a', wind: '#d9e4ff', ghost: '#9a6bff', stars: '#ffb3e0', ice: '#aef4ff' };

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');
const texCache = new Map<number, Promise<THREE.Texture>>();

/** Name card used when artwork cannot be loaded (offline, blocked host). */
function nameTexture(name: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 512, 512); x.fillStyle = 'rgba(255,255,255,0.95)';
  x.font = '700 64px "Chakra Petch", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name.toUpperCase().slice(0, 12), 256, 256);
  x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 6; x.beginPath(); x.arc(256, 256, 200, 0, Math.PI * 2); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function artTexture(id: number, name: string): Promise<THREE.Texture> {
  let p = texCache.get(id);
  if (!p) {
    p = texLoader.loadAsync(pokemonArt(id)).then(t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }).catch(() => nameTexture(name));
    texCache.set(id, p);
  }
  return p;
}

const CARD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CARD_FRAG = /* glsl */`
  uniform sampler2D map; uniform float uTime, uReveal, uGlitch, uFlash, uDissolve, uStatusAmt, uFlip, uAlpha, uGhost; uniform vec3 uTint, uFlashColor, uStatus;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlip), vUv.y);
    // Horizontal tear bands while glitching.
    float band = step(0.82, h(vec2(floor(uv.y * 24.0), floor(uTime * 18.0))));
    uv.x += (h(vec2(floor(uv.y * 24.0), floor(uTime * 30.0))) - 0.5) * 0.12 * uGlitch * band;
    float off = 0.006 + 0.02 * uGlitch;
    vec4 c = texture2D(map, uv);
    float r = texture2D(map, uv + vec2(off, 0.0)).r, b = texture2D(map, uv - vec2(off, 0.0)).b;
    vec3 col = vec3(r, c.g, b);
    float a = c.a;
    // Rim: alpha edges sampled around the silhouette glow in the type colour.
    float e = 0.012;
    float ring = texture2D(map, uv + vec2(e, 0)).a + texture2D(map, uv - vec2(e, 0)).a + texture2D(map, uv + vec2(0, e)).a + texture2D(map, uv - vec2(0, e)).a;
    float rim = clamp(ring * 0.25 - a, 0.0, 1.0) + (1.0 - a) * step(0.01, ring) * 0.35;
    float scan = 0.82 + 0.18 * sin(uv.y * 420.0 - uTime * 6.0);
    col = mix(col, col * uTint * 1.4, 0.18) * scan;
    col = mix(col, uStatus, uStatusAmt * 0.45 * a);
    col += uTint * rim * 1.8;
    col = mix(col, uFlashColor * 1.5, uFlash * a * 0.75);
    // Materialise: a bright scanline sweeps upward; dissolve: noisy erosion from the bottom.
    float revealEdge = smoothstep(uReveal - 0.04, uReveal, 1.0 - uv.y);
    float sweep = smoothstep(0.06, 0.0, abs((1.0 - uv.y) - uReveal)) * step(uReveal, 0.999);
    // Keep the sweep on the silhouette with soft ends, so it reads as a scan, not a bar across the stage.
    sweep *= smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * (0.25 + 0.75 * step(0.01, ring + a));
    float n = h(floor(uv * 64.0));
    float dissolve = step(uDissolve * 1.15, n * 0.85 + uv.y * 0.3);
    float alpha = max(a, rim * 0.9) * (1.0 - revealEdge) * dissolve;
    alpha *= 0.86 + 0.14 * h(vec2(uTime * 7.0, 1.0)); // faint projector flicker
    col += uTint * sweep * 3.0;
    alpha = max(alpha, sweep) * uAlpha;
    if (alpha < 0.01) discard;
    // Afterimages render as pure tinted light (additive).
    if (uGhost > 0.5) { gl_FragColor = vec4(uTint * 1.6 * alpha, 1.0); return; }
    gl_FragColor = vec4(col, alpha);
  }`;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * A holographic projection of the active Pokémon: the official artwork rendered as light, with
 * scanlines, a type-tinted rim, glitch on impact and a dissolve on faint. Deliberately presented as a
 * projection from a floor emitter, not as a fake 3D model. Your side is mirrored so both Pokémon
 * face each other across the field.
 */
class Hologram {
  readonly group = new THREE.Group();
  readonly card: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly ghosts: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private base: THREE.Mesh;
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private crystal: THREE.LineSegments;
  readonly uniforms = {
    map: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uTint: { value: new THREE.Color('#7fe9ff') },
    uReveal: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color('#ffffff') },
    uDissolve: { value: 0 }, uStatus: { value: new THREE.Color('#000000') }, uStatusAmt: { value: 0 },
    uFlip: { value: 0 }, uAlpha: { value: 1 }, uGhost: { value: 0 },
  };
  private home = new THREE.Vector3();
  private shake = 0; private sidestep = 0; private hop = 0;
  private revealT = 1; private dissolveT = 0; private dissolving = false;
  private crystalAmt = 0; private crystalTarget = 0;
  private loadToken = 0;
  // Physical rush: out to the target, a beat at contact, back home.
  private dashT = 1; private dashDur = 0.75; private dashTo = new THREE.Vector3(); private spinning = false; private vanish = false;
  private trail: THREE.Vector3[] = Array.from({ length: 10 }, () => new THREE.Vector3());
  present = false;

  constructor(readonly side: 0 | 1) {
    this.uniforms.uFlip.value = side === 0 ? 1 : 0;
    const geo = new THREE.PlaneGeometry(1.32, 1.32);
    this.card = new THREE.Mesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: this.uniforms, vertexShader: CARD_VERT, fragmentShader: CARD_FRAG }));
    this.card.position.y = ARENA.cardY;
    this.card.renderOrder = 6;
    this.group.add(this.card);
    // Afterimages share every uniform except their own opacity and ghost mode.
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { ...this.uniforms, uAlpha: { value: 0 }, uGhost: { value: 1 } }, vertexShader: CARD_VERT, fragmentShader: CARD_FRAG }));
      g.visible = false; g.renderOrder = 5; this.ghosts.push(g);
    }

    // Emitter disc and a soft light cone feeding the projection.
    this.base = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fe9ff').multiplyScalar(2), transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide }));
    this.base.rotation.x = -Math.PI / 2; this.base.position.y = 0.215;
    this.group.add(this.base);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.36, 1.9, 32, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTint: this.uniforms.uTint, uTime: this.uniforms.uTime, uAmt: { value: 0.25 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform vec3 uTint; uniform float uTime, uAmt; varying vec2 vUv;
        void main() { float a = (1.0 - vUv.y) * 0.5 * (0.7 + 0.3 * sin(vUv.x * 60.0 + uTime * 3.0)); gl_FragColor = vec4(uTint * a * uAmt, 1.0); }`,
    }));
    this.beam.position.y = 1.15;
    this.group.add(this.beam);

    // Tera crystal: a faceted wire shell around the projection.
    const cgeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.95, 1));
    this.crystal = new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false }));
    this.crystal.position.y = ARENA.cardY; this.crystal.scale.set(0.9, 1.15, 0.6);
    this.group.add(this.crystal);
    this.group.visible = false;
  }

  place(p: THREE.Vector3) { this.home.copy(p); this.group.position.copy(p); }
  /** Where the projection is right now (follows rushes). */
  center(out = new THREE.Vector3()) { return this.card.getWorldPosition(out); }

  async show(artId: number, name: string, tint: string, instant: boolean) {
    const token = ++this.loadToken;
    this.group.visible = true; this.present = true;
    this.uniforms.uTint.value.set(tint);
    (this.base.material as THREE.MeshBasicMaterial).color.set(tint).multiplyScalar(2);
    this.dissolving = false; this.dissolveT = 0; this.uniforms.uDissolve.value = 0; this.uniforms.uAlpha.value = 1;
    this.crystalTarget = 0; this.uniforms.uStatusAmt.value = 0; this.dashT = 1;
    this.revealT = instant ? 1 : 0;
    const tex = await artTexture(artId, name);
    if (token !== this.loadToken) return;
    this.uniforms.map.value = tex;
    if (!instant) this.revealT = 0;
  }
  /** Rush to just in front of `to`; contact lands at 55% of the duration. */
  dash(to: THREE.Vector3, o: { fast?: boolean; spin?: boolean; vanish?: boolean }) {
    this.dashT = 0; this.dashDur = o.fast ? 0.48 : 0.74; this.spinning = !!o.spin; this.vanish = !!o.vanish;
    tmp.subVectors(to, this.home).setY(0);
    const len = tmp.length();
    this.dashTo.copy(this.home).addScaledVector(tmp.normalize(), Math.max(0, len - 0.85));
    for (const p of this.trail) p.copy(this.home);
  }
  hit(strength: number, color: string) { this.shake = Math.min(1, 0.35 + strength); this.uniforms.uGlitch.value = Math.min(1, 0.4 + strength); this.uniforms.uFlash.value = 0.8; this.uniforms.uFlashColor.value.set(color); }
  distort(amount = 0.8) { this.uniforms.uGlitch.value = Math.max(this.uniforms.uGlitch.value, amount); }
  heal() { this.uniforms.uFlash.value = 0.5; this.uniforms.uFlashColor.value.set('#7dffb0'); this.hop = 1; }
  pulse(color: string, amount = 0.6) { this.uniforms.uFlash.value = amount; this.uniforms.uFlashColor.value.set(color); this.hop = 1; }
  dodge() { this.sidestep = 1; }
  faint() { this.dissolving = true; this.dissolveT = 0; this.crystalTarget = 0; }
  tera(color: string) { this.crystalTarget = 1; (this.crystal.material as THREE.LineBasicMaterial).color.set(color).multiplyScalar(2.2); this.uniforms.uFlash.value = 1; this.uniforms.uFlashColor.value.set(color); this.uniforms.uTint.value.set(color); }
  status(color: string | null) { if (color) { this.uniforms.uStatus.value.set(color); this.uniforms.uStatusAmt.value = 1; } else this.uniforms.uStatusAmt.value = 0; }
  hide() { this.group.visible = false; this.present = false; this.dashT = 1; for (const g of this.ghosts) g.visible = false; }

  update(dt: number, t: number, camera: THREE.Camera, reduced: boolean) {
    if (!this.group.visible) { for (const g of this.ghosts) g.visible = false; return; }
    this.uniforms.uTime.value = t;
    this.revealT = Math.min(1, this.revealT + dt / (reduced ? 0.2 : 0.75));
    this.uniforms.uReveal.value = easeOutCubic(this.revealT);
    this.uniforms.uGlitch.value *= Math.exp(-5 * dt);
    this.uniforms.uFlash.value *= Math.exp(-7 * dt);
    if (this.dissolving) {
      this.dissolveT = Math.min(1, this.dissolveT + dt / (reduced ? 0.4 : 1.1));
      this.uniforms.uDissolve.value = this.dissolveT;
      if (this.dissolveT >= 1) { this.hide(); this.dissolving = false; return; }
    }
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.sidestep = Math.max(0, this.sidestep - dt * 2.5);
    this.hop = Math.max(0, this.hop - dt * 2.2);

    // Rush path.
    let k = 0; let spin = 0;
    if (this.dashT < 1) {
      this.dashT = Math.min(1, this.dashT + dt / (reduced ? this.dashDur * 2 : this.dashDur));
      const u = this.dashT;
      k = u < 0.55 ? Math.pow(u / 0.55, 2.2) : u < 0.68 ? 1 : 1 - smooth((u - 0.68) / 0.32);
      if (this.spinning) spin = u * Math.PI * 4;
      this.uniforms.uAlpha.value = this.vanish ? (u > 0.12 && u < 0.5 ? 0.08 : 1) : 1;
    }
    if (reduced) k *= 0.25;
    const sx = reduced ? 0 : (rand(t * 60) - 0.5) * 0.12 * this.shake;
    const dodge = reduced ? 0 : Math.sin(this.sidestep * Math.PI) * 0.4;
    tmp.lerpVectors(this.home, this.dashTo, k);
    // Dodge sideways relative to the field line.
    const sideSign = this.side === 0 ? -1 : 1;
    this.group.position.set(tmp.x + sx + dodge * sideSign * 0.7, Math.sin(this.hop * Math.PI) * 0.18 + (k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.25 : 0), tmp.z + dodge * sideSign * -0.7);
    this.card.position.y = ARENA.cardY + Math.sin(t * 1.6 + this.side * 2) * 0.03;
    // Face the camera around Y only, like a projection would.
    this.card.lookAt(camera.position.x, this.card.getWorldPosition(tmp2).y, camera.position.z);
    if (spin) this.card.rotateY(spin);

    // Afterimages trail the rush.
    const moving = this.dashT < 1 && !reduced;
    this.trail.unshift(this.trail.pop()!.copy(this.card.getWorldPosition(tmp2)));
    this.ghosts.forEach((g, i) => {
      g.visible = moving;
      if (!moving) return;
      g.position.copy(this.trail[(i + 1) * 3 - 1]);
      g.quaternion.copy(this.card.getWorldQuaternion(new THREE.Quaternion()));
      g.material.uniforms.uAlpha.value = (0.45 - i * 0.12) * (this.vanish ? 1.6 : 1);
    });

    this.crystalAmt += (this.crystalTarget - this.crystalAmt) * (1 - Math.exp(-4 * dt));
    (this.crystal.material as THREE.LineBasicMaterial).opacity = this.crystalAmt * (0.55 + 0.25 * Math.sin(t * 3));
    this.crystal.rotation.y += dt * 0.5;
    this.crystal.visible = this.crystalAmt > 0.01;
    (this.beam.material.uniforms.uAmt as { value: number }).value = 0.18 + 0.4 * this.uniforms.uFlash.value;
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; mat?.dispose(); });
    for (const g of this.ghosts) g.material.dispose();
  }
}

/** A glowing orb with a short trail (shadow ball, moonblast, seeds, sludge). */
class Orb {
  readonly mesh: THREE.Points;
  private pos: Float32Array;
  private t = 1; private linger = 1; private from = new THREE.Vector3(); private to = new THREE.Vector3(); private dur = 0.5; private arc = 0.45;
  readonly head = new THREE.Vector3();
  readonly mat: THREE.ShaderMaterial;
  onArrive: (() => void) | null = null;
  static N = 24;
  constructor() {
    this.pos = new Float32Array(Orb.N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = new Float32Array(Orb.N); for (let i = 0; i < Orb.N; i++) idx[i] = i / (Orb.N - 1);
    g.setAttribute('aI', new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uScale: { value: 1 }, uSize: { value: 1 } },
      vertexShader: /* glsl */`attribute float aI; varying float vI; uniform float uScale, uSize;
        void main() { vI = aI; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = mix(64.0, 8.0, aI) * uSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vI;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * (1.0 - vI * 0.9); gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.4 + vI * 0.6) * 2.4 * a, 1.0); }`,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 7;
  }
  get busy() { return this.mesh.visible; }
  fire(from: THREE.Vector3, to: THREE.Vector3, color: string, o: { dur?: number; arc?: number; size?: number }, onArrive: () => void) {
    this.from.copy(from); this.to.copy(to); this.t = 0; this.linger = 0; this.dur = o.dur ?? 0.5; this.arc = o.arc ?? 0.45;
    this.mat.uniforms.uColor.value.set(color); this.mat.uniforms.uSize.value = o.size ?? 1; this.mesh.visible = true; this.onArrive = onArrive;
    for (let i = 0; i < Orb.N; i++) this.pos.set([from.x, from.y, from.z], i * 3);
    this.head.copy(from);
  }
  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    this.pos.copyWithin(3, 0, (Orb.N - 1) * 3);
    const p = this.t;
    this.head.lerpVectors(this.from, this.to, p); this.head.y += Math.sin(p * Math.PI) * this.arc;
    this.pos[0] = this.head.x; this.pos[1] = this.head.y; this.pos[2] = this.head.z;
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    if (this.t >= 1) {
      if (this.onArrive) { const cb = this.onArrive; this.onArrive = null; cb(); }
      this.linger += dt; if (this.linger > 0.15) this.mesh.visible = false; // let the trail collapse into the impact
    }
  }
  stop() { this.mesh.visible = false; this.onArrive = null; }
}

const STATUS_HEX: Record<string, string> = { brn: '#ff6a2a', par: '#ffd23f', psn: '#b55bd6', tox: '#9b3cc9', slp: '#8fa3c6', frz: '#8ff0ff' };

/**
 * The battle layer of the stage: two holograms on a Pokémon-style diagonal field, a library of
 * pooled move effects (particles, beams, lightning, rings, slashes, debris, barriers, real point
 * lights), hit-stop, screen punch and a cinematic camera, all driven by BattleFx events.
 */
export class BattleStage {
  readonly group = new THREE.Group();
  readonly cam = new BattleCamera();
  private holos: [Hologram, Hologram];
  private orbs = Array.from({ length: 6 }, () => new Orb());
  private particles = new Particles();
  private rings = new Rings(12);
  private beams = [new Beam(), new Beam()];
  private slashes = new Slashes(8);
  private debris = new Debris();
  private shields: [Barrier, Barrier];
  private walls: [Barrier, Barrier];
  private flashes = new Flashes(3);
  private jobs: { at: number; fn: () => void }[] = [];
  private time = 0;
  private impactAt: [number, number] = [0, 0];
  private freeze = 0;
  /** Camera impulse, zoom punch, screen punch and screen flash the World applies each frame. */
  shake = 0; fovPunch = 0; screenPunch = 0;
  readonly screenFlash = { color: new THREE.Color('#ffffff'), amt: 0 };
  onImpact: ((color: string) => void) | null = null;

  constructor(private camera: THREE.Camera, private reduced: () => boolean) {
    this.holos = [new Hologram(0), new Hologram(1)];
    this.holos.forEach((h, i) => h.place(ARENA.mon[i]));
    for (const h of this.holos) { this.group.add(h.group); for (const g of h.ghosts) this.group.add(g); }
    for (const o of this.orbs) this.group.add(o.mesh);
    for (const b of this.beams) this.group.add(b.mesh);
    this.group.add(this.particles.mesh, this.rings.group, this.slashes.group, this.debris.group, this.flashes.group);
    const sphere = new THREE.SphereGeometry(0.95, 40, 24);
    this.shields = [new Barrier(sphere), new Barrier(sphere.clone())];
    this.walls = [new Barrier(new THREE.PlaneGeometry(1.8, 1.5)), new Barrier(new THREE.PlaneGeometry(1.8, 1.5))];
    ([0, 1] as const).forEach(s => {
      const m = ARENA.mon[s]; const o = ARENA.mon[1 - s];
      this.shields[s].mesh.position.set(m.x, ARENA.cardY, m.z);
      const w = this.walls[s].mesh; w.position.lerpVectors(m, o, 0.28).setY(ARENA.cardY); w.lookAt(o.x, ARENA.cardY, o.z);
      this.group.add(this.shields[s].mesh, w);
    });
  }

  /* ---------------- helpers */
  private later(delay: number, fn: () => void) { if (delay <= 0) fn(); else this.jobs.push({ at: this.time + delay, fn }); }
  private home(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, ARENA.cardY, m.z); }
  private foot(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, ARENA.floorY + 0.03, m.z); }
  private center(side: 0 | 1, out = new THREE.Vector3()) { return this.holos[side].center(out); }
  private orb() { return this.orbs.find(o => !o.busy) ?? this.orbs[0]; }
  private light(at: THREE.Vector3, color: string, peak = 8, dur = 0.45, follow: (() => THREE.Vector3) | null = null) { if (!this.reduced()) this.flashes.fire(at, color, peak, dur, follow); }
  private ballistic(from: THREE.Vector3, to: THREE.Vector3, T: number, out = new THREE.Vector3()) { return out.subVectors(to, from).divideScalar(T).setY((to.y - from.y) / T + 4.9 * T); }
  private kickScreen(strength: number, color: string, flash = 0) {
    this.screenPunch = Math.max(this.screenPunch, strength);
    if (flash > 0 && !this.reduced()) { this.screenFlash.color.set(color); this.screenFlash.amt = Math.max(this.screenFlash.amt, flash); }
  }

  /* ---------------- events */
  switchIn(side: 0 | 1, artId: number, name: string, tint: string, instant: boolean) {
    const reduced = this.reduced();
    void this.holos[side].show(artId, name, tint, instant || reduced);
    if (instant) return;
    const f = this.foot(side);
    this.particles.burst(f, 40, 2.2, { color: tint, size: 0.06, ttl: 0.9, rise: 1.2, drag: 2 });
    this.rings.fire(f, tint, { flat: true, s0: 0.2, s1: 1.4, dur: 0.6 });
    this.light(this.home(side), tint, 10, 0.8);
    if (!reduced) this.cam.switchIn(side);
  }

  move(side: 0 | 1, move: string, type: TypeName, category: 'Physical' | 'Special' | 'Status', target: 0 | 1 | null) {
    const r = recipeFor(move, type, category);
    const color = TYPE_HEX[type];
    const tgt: 0 | 1 = target === null || target === side ? (1 - side) as 0 | 1 : target;
    const selfMove = r.kind === 'self';
    const delay = impactDelay(r);
    if (!selfMove && r.kind !== 'hazard' && r.kind !== 'field') this.impactAt[tgt] = this.time + delay;
    const style = r.kind === 'dash' ? 'dash' : (r.kind === 'rain' && r.debris !== 'coin') || r.kind === 'quake' || r.kind === 'field' || r.kind === 'hazard' ? 'field' : selfMove ? 'self' : 'projectile';
    const big = (r.kind === 'dash' && !!r.big) || (moveInfo(move)?.power ?? 0) >= 110;
    if (!this.reduced()) this.cam.attack(side, style, delay, tgt, big);
    this.play(r, side, tgt, color);
  }

  private play(r: Recipe, s: 0 | 1, t: 0 | 1, color: string) {
    const A = this.home(s), B = this.home(t);
    const P = this.particles;
    switch (r.kind) {
      case 'dash': {
        this.holos[s].dash(B, { fast: r.fast, spin: r.impact === 'spin', vanish: r.vanish });
        const delay = impactDelay(r);
        if (r.aura && r.aura !== 'none') {
          const ac = AURA_HEX[r.aura];
          P.emitter(delay + 0.05, 160, () => {
            const c = this.center(s, tmp);
            P.emit(c.add(tmp2.randomDirection().multiplyScalar(0.35)), tmp2.randomDirection().multiplyScalar(0.4), { color: ac, size: r.aura === 'electric' ? 0.04 : 0.09, sizeEnd: 0.02, ttl: 0.35, shape: r.aura === 'stars' ? Shape.Star : Shape.Glow, spin: 6 });
          });
          if (r.aura === 'electric') this.later(delay * 0.5, () => P.lightning(this.center(s), B, 0.15, ac, 0.2, 40));
        }
        this.later(delay, () => this.contact(r, t, color));
        if (r.drain) this.later(delay + 0.2, () => { P.stream(B, A, 0.45, { color: '#7dffb0', size: 0.05, rate: 140, speed: 3.2, spread: 0.2 }); this.later(0.5, () => this.holos[s].heal()); });
        break;
      }
      case 'orb': {
        const n = r.count ?? 1;
        for (let k = 0; k < n; k++) this.later(k * 0.09, () => {
          const to = tmp.copy(B).add(tmp2.set((Math.random() - 0.5) * 0.4 * (n > 1 ? 1 : 0), (Math.random() - 0.5) * 0.3 * (n > 1 ? 1 : 0), 0)).clone();
          if (r.shards) {
            const from = A.clone();
            this.debris.throw('shard', from, this.ballistic(from, to, 0.5), 0.09, { ttl: 0.5, groundY: -5 });
            this.later(0.5, () => this.impactBurst(to, color, 0.6));
            return;
          }
          const o = this.orb();
          o.fire(A, to, r.seeds ? '#9cff6a' : color, { dur: 0.55, arc: r.arc ?? 0.3, size: r.size ?? 1 }, () => {
            this.impactBurst(to, color, Math.min(1.4, 0.5 + (r.size ?? 1) * 0.4));
            if (r.splash) P.burst(to, 30, 2.5, { color, size: 0.08, ttl: 0.8, gravity: 6, rise: 0.8 });
            if (r.star) this.rings.fire(to, color, { s0: 0.2, s1: 1.2, dur: 0.45 });
          });
          if (k === 0) this.light(A, color, 8, 0.6, () => o.head);
          if (r.star) P.emitter(0.55, 70, () => P.emit(o.head, tmp2.randomDirection().multiplyScalar(0.3), { color, shape: Shape.Star, size: 0.09, ttl: 0.5, spin: 3 }));
        });
        if (r.drain) this.later(impactDelay(r) + 0.15, () => { P.stream(B, A, 0.45, { color: '#ff9bd2', size: 0.05, rate: 140, speed: 3.2, spread: 0.2 }); this.later(0.5, () => this.holos[s].heal()); });
        break;
      }
      case 'stream': {
        const from = r.reverse ? B : A, to = r.reverse ? A : B;
        const look = r.shape === 'fire' ? { color: '#ff7a22', size: 0.1, sizeEnd: 0.34, shape: Shape.Glow, spread: 0.1 }
          : r.shape === 'water' ? { color: '#6fb6ff', size: 0.08, sizeEnd: 0.16, shape: Shape.Glow, spread: 0.06 }
          : r.shape === 'leaf' ? { color: '#7dff8a', size: 0.08, sizeEnd: 0.05, shape: Shape.Leaf, spread: 0.18, spin: 9 }
          : { color, size: 0.08, sizeEnd: 0.12, shape: Shape.Glow, spread: 0.1 };
        if (r.swirlSelf) P.swirl(A, 0.6, { color: '#ffb347', radius: 0.6, height: 1.6, rate: 160, size: 0.07, ttl: 0.7 });
        this.later(r.swirlSelf ? 0.2 : 0, () => {
          P.stream(from, to, 0.6, { ...look, rate: r.big ? 460 : 300, speed: r.reverse ? 3.6 : 6, arc: r.arc, ttl: 0.6 });
          if (r.shape === 'fire') P.stream(from, to, 0.6, { color: '#fff2a8', size: 0.06, sizeEnd: 0.16, rate: 140, speed: 6.5, spread: 0.05 });
          if (r.shape === 'water') P.stream(from, to, 0.6, { color: '#e8f6ff', size: 0.04, sizeEnd: 0.08, rate: 160, speed: 7, spread: 0.03 });
          if (r.rings) for (let k = 0; k < 3; k++) this.rings.fire(from, look.color, { to, s0: 0.25, s1: 0.7, dur: 0.5, delay: k * 0.12 });
          this.light(from, look.color, 10, 0.8);
          this.later(0.35, () => this.light(to, look.color, 12, 0.6));
        });
        if (!r.reverse) this.later(impactDelay(r), () => this.impactBurst(B, look.color, r.big ? 1.2 : 0.8));
        else this.later(0.75, () => this.holos[s].heal());
        break;
      }
      case 'beam': {
        this.rings.fire(A, color, { s0: 1.1, s1: 0.1, dur: 0.22 });
        this.later(0.12, () => {
          this.beams[s].fire(A, B, color, 0.75, r.width ?? 0.12);
          this.light(A, color, 10, 0.8); this.light(B, color, 14, 0.8);
          this.kickScreen(0.25, color, 0.05);
        });
        this.later(impactDelay(r), () => {
          this.impactBurst(B, color, 1);
          if (r.shards) for (let k = 0; k < 7; k++) this.debris.throw('shard', B, tmp.randomDirection().multiplyScalar(2.2).setY(2 + Math.random() * 2), 0.07, { ttl: 1 });
        });
        break;
      }
      case 'bolt': {
        const from = r.uturn || !r.small ? A.clone().setY(A.y + 0.2) : A;
        const sky = new THREE.Vector3(B.x + 0.3, 5, B.z - 0.5);
        P.lightning(r.small ? from : sky, B, r.small ? 0.25 : 0.45, '#fff5b0', r.small ? 0.18 : 0.32, r.small ? 70 : 150);
        if (!r.small) P.lightning(from, B, 0.3, '#ffe45a', 0.25, 90);
        this.light(B, '#ffe45a', 22, 0.5);
        this.kickScreen(0.2, '#fff4b0', r.small ? 0.04 : 0.12);
        this.later(impactDelay(r), () => this.impactBurst(B, '#ffe45a', 0.9));
        break;
      }
      case 'rings': {
        if (r.travel) for (let k = 0; k < 4; k++) this.rings.fire(A, color, { to: B, s0: 0.2, s1: 0.95, dur: 0.55, delay: k * 0.08 });
        else if (r.both) { for (const x of [A, B]) for (let k = 0; k < 2; k++) this.rings.fire(x, color, { s0: 0.1, s1: 1.1, dur: 0.5, delay: k * 0.12 }); }
        else for (let k = 0; k < 3; k++) this.rings.fire(B, color, { s0: 1.4, s1: 0.2, dur: 0.4, delay: k * 0.1 });
        if (r.distort) { this.later(0.15, () => this.holos[t].distort(1)); this.kickScreen(0.35, color, 0.05); }
        this.light(r.travel ? A : B, color, 9, 0.7);
        if (r.travel) this.later(impactDelay(r), () => this.impactBurst(B, color, 0.7));
        break;
      }
      case 'swirl': {
        if (r.shape === 'leaf') {
          P.stream(A, B, 0.7, { color: '#7dff8a', size: 0.1, sizeEnd: 0.07, shape: Shape.Leaf, spin: 10, rate: 220, speed: 4.5, spread: 0.3 });
          this.later(0.45, () => P.swirl(B, 0.5, { color: '#a8ff7a', shape: Shape.Leaf, size: 0.09, radius: 0.6, height: 1.6, rate: 200, w: 7, spin: 8, ttl: 0.6 }));
        } else if (r.shape === 'wind') {
          P.swirl(B, 1.0, { color: '#e6efff', size: 0.05, sizeEnd: 0.02, radius: 0.45, height: 2.6, rate: 360, w: 10, ttl: 0.7 });
          this.rings.fire(this.foot(t), '#e6efff', { flat: true, s0: 0.3, s1: 1.6, dur: 0.8 });
          this.later(0.3, () => this.holos[t].distort(0.6));
        } else if (r.shape === 'petal') {
          P.swirl(B, 0.7, { color: '#ff9bd2', shape: Shape.Leaf, size: 0.1, radius: 0.7, height: 1.2, rate: 220, w: 6, spin: 6, ttl: 0.7, inward: true });
          this.later(0.35, () => this.slashes.fire(B, '#ffd1ea', 2, 0.6));
        } else if (r.shape === 'spore') {
          P.swirl(B, 0.9, { color: '#d8ff8a', size: 0.04, sizeEnd: 0.06, radius: 0.8, height: 0.6, rate: 160, w: 1.5, ttl: 1.1, inward: true });
        } else {
          for (let k = 0; k < 3; k++) {
            this.later(k * 0.1, () => this.orb().fire(A, tmp.copy(B).add(tmp2.set((k - 1) * 0.3, 0, 0)).clone(), '#5fb0ff', { dur: 0.6, arc: 0.5 + k * 0.15, size: 0.8 }, () => P.burst(B, 14, 1.4, { color: '#5fb0ff', size: 0.07, ttl: 0.6, rise: 1 })));
          }
        }
        this.light(B, color, 8, 0.9);
        break;
      }
      case 'rain': {
        const n = r.count ?? 5;
        if (r.debris === 'coin') {
          P.emitter(0.8, 70, () => {
            const p = tmp.set(B.x + (Math.random() - 0.5) * 1.4, 2.4 + Math.random() * 0.8, B.z + (Math.random() - 0.5) * 1.0);
            P.emit(p, tmp2.set(0, -2.2, 0), { color: '#ffd04a', shape: Shape.Coin, size: 0.14, sizeEnd: 0.13, ttl: 1.1, gravity: 2.2, spin: 12 });
          });
          this.later(0.55, () => { this.impactBurst(B, '#ffd04a', 1); this.light(B, '#ffd04a', 14, 0.8); });
          break;
        }
        const kind: DebrisKind = r.debris === 'hammer' ? 'meteor' : r.debris;
        const scale = r.debris === 'hammer' ? 0.6 : r.debris === 'meteor' ? 0.32 : r.debris === 'salt' ? 0.08 : 0.18;
        for (let k = 0; k < n; k++) this.later(k * (r.debris === 'salt' ? 0.04 : 0.12), () => {
          const land = this.foot(t).add(tmp2.set((Math.random() - 0.5) * (n > 1 ? 1.1 : 0), 0, (Math.random() - 0.5) * (n > 1 ? 0.8 : 0)));
          // From the sky behind the target, so nothing falls past the lens.
          const start = land.clone().add(tmp2.set(0.5 + Math.random() * 0.6, 4.8 + Math.random(), -2.6 - Math.random()));
          const trail = r.debris === 'meteor' || r.debris === 'hammer' ? '#c79bff' : r.debris === 'rock' ? '#e8d29a' : null;
          this.debris.throw(kind, start, this.ballistic(start, land, 0.72), scale, {
            ttl: 2,
            onFly: trail ? p => { for (let i = 0; i < 2; i++) this.particles.emit(p, tmp2.randomDirection().multiplyScalar(0.25), { color: trail, size: Math.min(0.14, scale * 0.45), sizeEnd: 0.01, ttl: 0.4 }); } : undefined,
            onLand: p => {
              const at = p.clone();
              this.particles.burst(at.setY(0.2), r.debris === 'salt' ? 6 : 26, 2.6, { color: r.debris === 'meteor' ? '#b48cff' : '#e8d29a', size: 0.07, ttl: 0.7, gravity: 4, rise: 0.8 });
              if (r.debris !== 'salt') this.rings.fire(at.setY(ARENA.floorY + 0.03), color, { flat: true, s0: 0.1, s1: r.debris === 'hammer' ? 2.6 : 1, dur: 0.5 });
              if (r.debris === 'meteor' || r.debris === 'hammer') { this.light(at.setY(0.5), color, 16, 0.5); this.shake = Math.max(this.shake, r.debris === 'hammer' ? 1 : 0.45); }
            },
          });
        });
        if (r.debris === 'meteor' || r.debris === 'hammer') this.light(B.clone().setY(3), color, 6, 1.2);
        if (r.debris === 'hammer') this.later(0.75, () => this.quakeAt(t, color, 0.9));
        break;
      }
      case 'quake': this.quakeAt(t, color, 1, A); break;
      case 'self': this.selfFx(r.effect, s, color); break;
      case 'hazard': {
        const f = this.foot(t);
        for (let k = 0; k < 5; k++) this.later(k * 0.07, () => {
          const land = f.clone().add(tmp2.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.1));
          if (r.debris === 'toxic') { const o = this.orb(); o.fire(A, land, '#b55bd6', { dur: 0.6, arc: 1.2, size: 0.5 }, () => P.burst(land, 10, 1.2, { color: '#c77dff', size: 0.06, ttl: 0.7, gravity: 3 })); return; }
          this.debris.throw(r.debris === 'rock' ? 'rock' : 'spike', A.clone(), this.ballistic(A, land, 0.6), r.debris === 'rock' ? 0.12 : 0.08, { ttl: 1.6, onLand: p => P.burst(p.clone().setY(0.1), 8, 1.2, { color: '#e8d29a', size: 0.05, ttl: 0.5, gravity: 3 }) });
        });
        break;
      }
      case 'field': {
        const c = r.color ?? color;
        P.emitter(0.9, 260, () => {
          const p = tmp.set(-4 + Math.random() * 0.5, ARENA.floorY + Math.random() * 2, -2.5 + Math.random() * 5);
          P.emit(p, tmp2.set(7 + Math.random() * 2, (Math.random() - 0.5) * 0.4, -1 + Math.random() * 0.5), { color: c, size: 0.05, sizeEnd: 0.02, ttl: 1.2 });
        });
        this.rings.fire(new THREE.Vector3(0, ARENA.floorY + 0.03, 0), c, { flat: true, s0: 0.5, s1: 4, dur: 0.9 });
        break;
      }
    }
  }

  /** Physical contact: the hit itself, flavoured by impact style and aura. */
  private contact(r: Extract<Recipe, { kind: 'dash' }>, t: 0 | 1, color: string) {
    const B = this.center(t);
    const big = !!r.big;
    switch (r.impact) {
      case 'slash': this.slashes.fire(B, color, big ? 3 : 2, big ? 1 : 0.8); break;
      case 'bite': this.slashes.fire(B, color, 2, 0.6); break;
      case 'punch': this.rings.fire(B, '#ffffff', { s0: 0.1, s1: big ? 1.3 : 0.9, dur: 0.3 }); this.rings.fire(B, color, { s0: 0.1, s1: big ? 1.7 : 1.2, dur: 0.42, delay: 0.04 }); break;
      case 'spin': this.rings.fire(this.foot(t), color, { flat: true, s0: 0.2, s1: 1.4, dur: 0.4 }); this.slashes.fire(B, color, 2, 0.7); break;
      case 'quake': this.quakeAt(t, color, big ? 0.8 : 0.5); break;
      case 'flurry':
        for (let k = 0; k < 5; k++) this.later(k * 0.075, () => {
          const at = tmp.copy(B).add(tmp2.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.5, 0.1)).clone();
          this.rings.fire(at, k % 2 ? '#ffffff' : color, { s0: 0.05, s1: 0.55, dur: 0.22 });
          this.particles.burst(at, 8, 2, { color, size: 0.05, ttl: 0.35 });
        });
        break;
      default: break;
    }
    if (r.aura === 'water') this.particles.burst(B, 40, 3, { color: '#7fc1ff', size: 0.06, ttl: 0.8, gravity: 7, rise: 0.6 });
    if (r.aura === 'fire') this.particles.burst(B, 34, 2.4, { color: '#ff8a2a', size: 0.1, sizeEnd: 0.03, ttl: 0.6, rise: 0.8 });
    if (r.aura === 'electric') this.particles.lightning(B.clone().add(tmp2.set(-0.4, 0.5, 0)), B.clone().add(tmp2.set(0.4, -0.4, 0)), 0.2, '#fff5b0', 0.25, 40);
    if (r.aura === 'ice') for (let k = 0; k < 6; k++) this.debris.throw('shard', B, tmp.randomDirection().multiplyScalar(2).setY(2.5), 0.06, { ttl: 0.9 });
    if (r.aura === 'stars') this.particles.burst(B, 24, 2.2, { color: '#ffc4ea', shape: Shape.Star, size: 0.12, ttl: 0.7, spin: 4 });
    if (r.aura === 'ghost') this.particles.burst(B, 26, 1.6, { color: '#9a6bff', size: 0.1, sizeEnd: 0.02, ttl: 0.8, rise: 1 });
    this.impactBurst(B, color, big ? 1.1 : 0.7);
  }

  private quakeAt(t: 0 | 1, color: string, power: number, from?: THREE.Vector3) {
    const f = this.foot(t);
    const origin = from ? from.clone().setY(ARENA.floorY + 0.03) : f.clone();
    this.rings.fire(origin, color, { flat: true, s0: 0.3, s1: 4.5 * power, dur: 0.9 });
    this.rings.fire(origin, '#ffffff', { flat: true, s0: 0.2, s1: 3.2 * power, dur: 0.7, delay: 0.08 });
    const n = Math.round(4 + power * 5);
    for (let k = 0; k < n; k++) {
      const u = (k + 1) / n;
      const at = new THREE.Vector3().lerpVectors(origin, f, from ? u : 1).add(new THREE.Vector3((Math.random() - 0.5) * (from ? 0.5 : 1.3), 0, (Math.random() - 0.5) * (from ? 0.5 : 1.0)));
      this.debris.erupt(at, 0.14 + Math.random() * 0.12 * power, from ? u * 0.3 : Math.random() * 0.15);
    }
    this.later(from ? 0.3 : 0.05, () => { this.shake = Math.max(this.shake, 0.6 + 0.4 * power); this.particles.burst(f.clone().setY(0.2), 40, 2.4, { color: '#e8d29a', size: 0.07, ttl: 0.8, gravity: 5, rise: 0.9 }); this.light(f.clone().setY(0.6), color, 10, 0.6); });
  }

  private selfFx(effect: Extract<Recipe, { kind: 'self' }>['effect'], s: 0 | 1, color: string) {
    const A = this.home(s), f = this.foot(s), P = this.particles, h = this.holos[s];
    switch (effect) {
      case 'buff': P.swirl(A, 0.8, { color, size: 0.06, radius: 0.65, height: 1.8, rate: 150, w: 5, ttl: 0.8 }); this.rings.fire(f, color, { flat: true, s0: 1.4, s1: 0.2, dur: 0.6 }); this.later(0.6, () => h.pulse(color)); break;
      case 'blades': P.swirl(A, 0.9, { color: '#e8f0ff', shape: Shape.Star, size: 0.16, radius: 0.75, height: 0.4, rate: 60, w: 9, ttl: 0.9, spin: 5 }); this.later(0.6, () => { this.slashes.fire(A, '#ffffff', 2, 0.8); h.pulse('#ffffff'); }); break;
      case 'dragon': P.swirl(A, 1, { color: '#ff5a7a', size: 0.08, radius: 0.55, height: 2.4, rate: 260, w: 8, ttl: 0.8 }); P.swirl(A, 1, { color: '#7a4dff', size: 0.06, radius: 0.75, height: 2, rate: 160, w: -6, ttl: 0.9 }); this.later(0.7, () => h.pulse('#b28bff')); break;
      case 'heal': P.swirl(A, 0.9, { color: '#9dffc4', shape: Shape.Star, size: 0.1, radius: 0.7, height: 1.6, rate: 90, w: 2, ttl: 1, spin: 3 }); this.later(0.5, () => h.heal()); this.light(A, '#7dffb0', 8, 1); break;
      case 'protect': this.shields[s].fire(color === TYPE_HEX.Poison ? '#c77dff' : '#7ff9ff', 1.3); this.light(A, '#7ff9ff', 8, 0.6); break;
      case 'screen': this.walls[s].fire(color, 1.5); this.light(A, color, 6, 0.8); break;
      case 'sleep': for (let k = 0; k < 3; k++) this.rings.fire(A.clone().add(tmp2.set(0.2, 0.6, 0)), '#bcd0ff', { to: A.clone().add(tmp2.set(0.5 + k * 0.1, 1.2, 0)), s0: 0.05, s1: 0.25, dur: 0.9, delay: k * 0.25 }); break;
      case 'sub': P.burst(A, 50, 2, { color: '#ffffff', size: 0.08, ttl: 0.6 }); h.distort(1); h.pulse('#ffffff', 0.9); break;
      case 'transform': h.distort(1); this.rings.fire(A, '#d6a6ff', { s0: 0.1, s1: 1.5, dur: 0.6 }); P.burst(A, 40, 1.8, { color: '#d6a6ff', size: 0.07, ttl: 0.8 }); break;
      case 'revive': this.beams[s].fire(f, f.clone().setY(6), '#fff6c0', 1.3, 0.4); P.swirl(A, 1.1, { color: '#fff6c0', shape: Shape.Star, size: 0.1, radius: 0.6, height: 2.5, rate: 100, w: 3, ttl: 1.1 }); this.light(A, '#fff6c0', 14, 1.2); break;
      case 'curse': P.swirl(A, 1, { color: '#8a6bd1', size: 0.1, sizeEnd: 0.02, radius: 0.7, height: 1.2, rate: 120, w: -3, ttl: 1, inward: true }); this.later(0.6, () => h.distort(0.8)); break;
      case 'drum': for (let k = 0; k < 3; k++) this.later(k * 0.2, () => { this.rings.fire(A, '#ff6a6a', { s0: 0.2, s1: 1.2, dur: 0.3 }); this.shake = Math.max(this.shake, 0.25); }); this.later(0.65, () => h.pulse('#ff4d6d', 0.9)); break;
    }
  }

  private impactBurst(at: THREE.Vector3, color: string, power: number) {
    this.particles.burst(at, Math.round(20 + 30 * power), 2 + power * 1.8, { color, size: 0.06 + 0.03 * power, sizeEnd: 0.01, ttl: 0.55, drag: 2.5 });
    this.particles.burst(at, 10, 1.2, { color: '#ffffff', shape: Shape.Star, size: 0.12 * power, ttl: 0.25, spin: 4 });
    this.light(at, color, 5 + power * 5, 0.4);
  }

  hit(side: 0 | 1, lost: number, crit: boolean, effect: 'super' | 'resist' | 'immune' | 'normal', color: string) {
    const play = () => {
      const h = this.holos[side];
      if (effect === 'immune') { h.dodge(); return; }
      const strength = Math.min(1, lost * 1.6 + (crit ? 0.3 : 0) + (effect === 'super' ? 0.3 : 0));
      h.hit(strength, effect === 'super' ? color : crit ? '#ffffff' : '#ff4d6d');
      this.particles.burst(this.center(side), Math.round(12 + strength * 30), 1.4 + strength * 2, { color: effect === 'super' ? color : '#ffd1dc', size: 0.06, ttl: 0.5, drag: 2 });
      const heavy = crit || effect === 'super' || lost > 0.45;
      if (heavy) {
        this.shake = Math.max(this.shake, 0.4 + strength * 0.6); this.onImpact?.(color);
        if (!this.reduced()) { this.freeze = crit ? 0.12 : 0.08; this.fovPunch = Math.max(this.fovPunch, 2 + strength * 4); }
        this.kickScreen(0.3 + strength * 0.35, crit ? '#ffffff' : color, crit ? 0.08 : 0.04);
      }
    };
    const wait = this.impactAt[side] - this.time;
    if (wait > 0.02) this.later(wait, play); else play();
  }
  heal(side: 0 | 1) {
    this.holos[side].heal();
    this.particles.swirl(this.home(side), 0.6, { color: '#7dffb0', shape: Shape.Star, size: 0.08, radius: 0.6, height: 1.4, rate: 70, w: 2, ttl: 0.8, spin: 3 });
  }
  miss(side: 0 | 1) { const wait = this.impactAt[side] - this.time; this.later(Math.max(0, wait - 0.12), () => this.holos[side].dodge()); }
  faint(side: 0 | 1) {
    const wait = Math.max(0, this.impactAt[side] - this.time);
    this.later(wait, () => {
      this.holos[side].faint();
      this.particles.burst(this.center(side), 60, 1.4, { color: '#cfd6ff', size: 0.06, ttl: 1.4, rise: 1.2, drag: 1.5 });
      if (!this.reduced()) this.cam.faint(side);
    });
  }
  tera(side: 0 | 1, type: TypeName, instant = false) {
    const c = TYPE_HEX[type];
    this.holos[side].tera(c);
    if (instant) return;
    const A = this.home(side);
    this.particles.burst(A, 90, 3.2, { color: c, shape: Shape.Star, size: 0.12, ttl: 1, drag: 2.5, spin: 5 });
    this.rings.fire(A, c, { s0: 0.2, s1: 2.2, dur: 0.7 });
    this.rings.fire(this.foot(side), c, { flat: true, s0: 0.2, s1: 2.6, dur: 0.9 });
    this.light(A, c, 22, 1.2);
    this.shake = Math.max(this.shake, 0.5); this.onImpact?.(c);
    this.kickScreen(0.6, c, 0.12);
    if (!this.reduced()) this.cam.tera(side);
  }
  status(side: 0 | 1, s: string | null) { this.holos[side].status(s ? STATUS_HEX[s] ?? null : null); }
  boost(side: 0 | 1, up: boolean) {
    const at = this.home(side).setY(up ? 0.4 : 1.7);
    this.particles.burst(at, 26, 1.2, { color: up ? '#7fe9ff' : '#ff7a7a', size: 0.06, ttl: 0.8, rise: up ? 1.4 : -1.4, drag: 1 });
  }
  clear() {
    for (const h of this.holos) h.hide();
    for (const o of this.orbs) o.stop();
    this.particles.clear(); this.rings.clear(); this.debris.clear(); this.flashes.clear();
    this.jobs.length = 0; this.cam.reset(); this.impactAt = [0, 0];
  }
  setPixelScale(s: number) { for (const o of this.orbs) o.mat.uniforms.uScale.value = s; this.particles.mat.uniforms.uScale.value = s; }

  update(dt: number) {
    // Hit-stop: a few frames of near-freeze sell heavy impacts.
    if (this.freeze > 0) { this.freeze -= dt; dt *= 0.06; }
    this.time += dt;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= this.time) { const j = this.jobs[i]; this.jobs.splice(i, 1); j.fn(); }
    const reduced = this.reduced();
    for (const h of this.holos) h.update(dt, this.time, this.camera, reduced);
    for (const o of this.orbs) o.update(dt);
    this.particles.update(dt);
    this.rings.update(dt, this.camera);
    for (const b of this.beams) b.update(dt, this.time);
    this.slashes.update(dt, this.camera);
    this.debris.update(dt);
    for (const b of [...this.shields, ...this.walls]) b.update(dt, this.time);
    this.flashes.update(dt);
    this.screenPunch = Math.max(0, this.screenPunch - dt * 3);
    this.screenFlash.amt = Math.max(0, this.screenFlash.amt - dt * 1.2);
  }

  dispose() {
    for (const h of this.holos) h.dispose();
    for (const o of this.orbs) { o.mesh.geometry.dispose(); o.mat.dispose(); }
    this.particles.dispose(); this.rings.dispose(); this.slashes.dispose(); this.debris.dispose();
    for (const b of this.beams) b.dispose();
    for (const b of [...this.shields, ...this.walls]) b.dispose();
    for (const p of texCache.values()) void p.then(t => t.dispose());
    texCache.clear();
  }
}
