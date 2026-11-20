import * as THREE from 'three';
import type { TypeName } from '@shared';
import { pokemonArt } from '../../assets.js';
import { easeOutCubic, rand } from '../math.js';

/** Conventional type colours, used for move trails, impacts and Tera crystals. */
export const TYPE_HEX: Record<TypeName, string> = {
  Normal: '#c6c6a7', Fire: '#ff7a2f', Water: '#4f8cff', Electric: '#ffd23f', Grass: '#62d26f', Ice: '#8ff0ff',
  Fighting: '#e0453a', Poison: '#b55bd6', Ground: '#e6c36a', Flying: '#a98ff3', Psychic: '#ff5e9c', Bug: '#b7d335',
  Rock: '#c9b458', Ghost: '#8a6bd1', Dragon: '#7a4dff', Dark: '#8b6f5c', Steel: '#bfc7e0', Fairy: '#ff9bd2', Stellar: '#6fe6d6',
};

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

/**
 * A holographic projection of the active Pokémon: the official artwork rendered as light, with
 * scanlines, a type-tinted rim, glitch on impact and a dissolve on faint. Deliberately presented as a
 * projection from a floor emitter, not as a fake 3D model.
 */
class Hologram {
  readonly group = new THREE.Group();
  readonly card: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private base: THREE.Mesh;
  private beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private crystal: THREE.LineSegments;
  readonly uniforms = {
    map: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uTint: { value: new THREE.Color('#7fe9ff') },
    uReveal: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color('#ffffff') },
    uDissolve: { value: 0 }, uStatus: { value: new THREE.Color('#000000') }, uStatusAmt: { value: 0 },
  };
  private home = new THREE.Vector3();
  private lunge = 0; private lungeDir = 1; private shake = 0; private sidestep = 0;
  private revealT = 1; private dissolveT = 0; private dissolving = false;
  private crystalAmt = 0; private crystalTarget = 0;
  private loadToken = 0;
  present = false;

  constructor(readonly side: 0 | 1) {
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 1.32), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: this.uniforms,
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float uTime, uReveal, uGlitch, uFlash, uDissolve, uStatusAmt; uniform vec3 uTint, uFlashColor, uStatus;
        varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
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
          col = mix(col, uFlashColor * 2.0, uFlash * a);
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
          if (alpha < 0.01 && sweep < 0.01) discard;
          gl_FragColor = vec4(col, max(alpha, sweep));
        }`,
    }));
    this.card.position.y = 1.0;
    this.card.renderOrder = 6;
    this.group.add(this.card);

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
    const geo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.95, 1));
    this.crystal = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, toneMapped: false }));
    this.crystal.position.y = 1.0; this.crystal.scale.set(0.9, 1.15, 0.6);
    this.group.add(this.crystal);
    this.group.visible = false;
  }

  place(x: number, z: number) { this.home.set(x, 0, z); this.group.position.copy(this.home); }

  async show(artId: number, name: string, tint: string, instant: boolean) {
    const token = ++this.loadToken;
    this.group.visible = true; this.present = true;
    this.uniforms.uTint.value.set(tint);
    (this.base.material as THREE.MeshBasicMaterial).color.set(tint).multiplyScalar(2);
    this.dissolving = false; this.dissolveT = 0; this.uniforms.uDissolve.value = 0;
    this.crystalTarget = 0; this.uniforms.uStatusAmt.value = 0;
    this.revealT = instant ? 1 : 0;
    const tex = await artTexture(artId, name);
    if (token !== this.loadToken) return;
    this.uniforms.map.value = tex;
    if (!instant) this.revealT = 0;
  }
  lungeAt(dir: number) { this.lunge = 1; this.lungeDir = dir; }
  hit(strength: number, color: string) { this.shake = Math.min(1, 0.35 + strength); this.uniforms.uGlitch.value = Math.min(1, 0.4 + strength); this.uniforms.uFlash.value = 0.8; this.uniforms.uFlashColor.value.set(color); }
  heal() { this.uniforms.uFlash.value = 0.5; this.uniforms.uFlashColor.value.set('#7dffb0'); }
  dodge() { this.sidestep = 1; }
  faint() { this.dissolving = true; this.dissolveT = 0; this.crystalTarget = 0; }
  tera(color: string) { this.crystalTarget = 1; (this.crystal.material as THREE.LineBasicMaterial).color.set(color).multiplyScalar(2.2); this.uniforms.uFlash.value = 1; this.uniforms.uFlashColor.value.set(color); this.uniforms.uTint.value.set(color); }
  status(color: string | null) { if (color) { this.uniforms.uStatus.value.set(color); this.uniforms.uStatusAmt.value = 1; } else this.uniforms.uStatusAmt.value = 0; }

  update(dt: number, t: number, camera: THREE.Camera, reduced: boolean) {
    if (!this.group.visible) return;
    this.uniforms.uTime.value = t;
    this.revealT = Math.min(1, this.revealT + dt / (reduced ? 0.2 : 0.75));
    this.uniforms.uReveal.value = easeOutCubic(this.revealT);
    this.uniforms.uGlitch.value *= Math.exp(-5 * dt);
    this.uniforms.uFlash.value *= Math.exp(-7 * dt);
    if (this.dissolving) {
      this.dissolveT = Math.min(1, this.dissolveT + dt / (reduced ? 0.4 : 1.1));
      this.uniforms.uDissolve.value = this.dissolveT;
      if (this.dissolveT >= 1) { this.group.visible = false; this.present = false; this.dissolving = false; }
    }
    this.lunge = Math.max(0, this.lunge - dt * 3.2);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.sidestep = Math.max(0, this.sidestep - dt * 2.5);
    const l = reduced ? 0 : Math.sin(this.lunge * Math.PI) * 0.45;
    const sx = reduced ? 0 : (rand(t * 60) - 0.5) * 0.12 * this.shake;
    const dodge = reduced ? 0 : Math.sin(this.sidestep * Math.PI) * 0.35;
    this.group.position.set(this.home.x + l * this.lungeDir + sx + dodge * -this.lungeDir, 0, this.home.z + l * 0.25);
    this.card.position.y = 1.0 + Math.sin(t * 1.6 + this.side * 2) * 0.03;
    // Face the camera around Y only, like a projection would.
    this.card.lookAt(camera.position.x, this.card.getWorldPosition(tmp).y, camera.position.z);
    this.crystalAmt += (this.crystalTarget - this.crystalAmt) * (1 - Math.exp(-4 * dt));
    (this.crystal.material as THREE.LineBasicMaterial).opacity = this.crystalAmt * (0.55 + 0.25 * Math.sin(t * 3));
    this.crystal.rotation.y += dt * 0.5;
    this.crystal.visible = this.crystalAmt > 0.01;
    (this.beam.material.uniforms.uAmt as { value: number }).value = 0.18 + 0.4 * this.uniforms.uFlash.value;
  }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; mat?.dispose(); });
  }
}
const tmp = new THREE.Vector3();

/** A glowing orb with a short trail flying between holograms (special moves). */
class Bolt {
  readonly mesh: THREE.Points;
  private pos: Float32Array;
  private t = 1; private linger = 0; private from = new THREE.Vector3(); private to = new THREE.Vector3(); private dur = 0.45;
  readonly mat: THREE.ShaderMaterial;
  onArrive: (() => void) | null = null;
  static N = 24;
  constructor() {
    this.pos = new Float32Array(Bolt.N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = new Float32Array(Bolt.N); for (let i = 0; i < Bolt.N; i++) idx[i] = i / (Bolt.N - 1);
    g.setAttribute('aI', new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#ffffff') }, uScale: { value: 1 } },
      vertexShader: /* glsl */`attribute float aI; varying float vI; uniform float uScale;
        void main() { vI = aI; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = mix(64.0, 8.0, aI) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vI;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * (1.0 - vI * 0.9); gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.4 + vI * 0.6) * 2.4 * a, 1.0); }`,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 7;
  }
  fire(from: THREE.Vector3, to: THREE.Vector3, color: string, onArrive: () => void) {
    this.from.copy(from); this.to.copy(to); this.t = 0; this.linger = 0; this.mat.uniforms.uColor.value.set(color); this.mesh.visible = true; this.onArrive = onArrive;
    for (let i = 0; i < Bolt.N; i++) this.pos.set([from.x, from.y, from.z], i * 3);
  }
  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    // Shift trail, head follows a shallow arc.
    this.pos.copyWithin(3, 0, (Bolt.N - 1) * 3);
    const p = this.t; const x = this.from.x + (this.to.x - this.from.x) * p; const z = this.from.z + (this.to.z - this.from.z) * p;
    const y = this.from.y + (this.to.y - this.from.y) * p + Math.sin(p * Math.PI) * 0.45;
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    if (this.t >= 1) {
      if (this.onArrive) { const cb = this.onArrive; this.onArrive = null; cb(); }
      this.linger += dt; if (this.linger > 0.15) this.mesh.visible = false; // let the trail collapse into the impact
    }
  }
}

/** Radial spark burst (impacts, boosts, heals) driven entirely by a time uniform. */
class Burst {
  readonly mesh: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private t = 10;
  constructor(n = 90) {
    const g = new THREE.BufferGeometry();
    const dir = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1, s = 0.5 + Math.random(); dir.set([Math.cos(a) * Math.sqrt(1 - e * e) * s, e * s, Math.sin(a) * Math.sqrt(1 - e * e) * s, 0.5 + Math.random() * 0.5], i * 4); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 10 }, uColor: { value: new THREE.Color('#ffffff') }, uSpread: { value: 1 }, uRise: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */`uniform float uT, uSpread, uRise, uScale; attribute vec4 aDir; varying float vA;
        void main() {
          float t = uT * aDir.w;
          vec3 p = aDir.xyz * uSpread * (1.0 - exp(-t * 4.0)) * 0.9;
          p.y += uRise * t * 1.2 - (1.0 - abs(uRise)) * t * t * 0.6;
          vA = 1.0 - smoothstep(0.15, 1.0, uT);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 22.0 * aDir.w * uScale / -mv.z; gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor * 2.6 * smoothstep(0.5, 0.0, d) * vA, 1.0); }`,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 7;
  }
  fire(at: THREE.Vector3, color: string, spread = 1, rise = 0) {
    this.mesh.position.copy(at); this.t = 0; this.mesh.visible = true;
    this.mat.uniforms.uColor.value.set(color); this.mat.uniforms.uSpread.value = spread; this.mat.uniforms.uRise.value = rise;
  }
  update(dt: number) { if (!this.mesh.visible) return; this.t += dt; this.mat.uniforms.uT.value = this.t; if (this.t > 1.3) this.mesh.visible = false; }
}

const STATUS_HEX: Record<string, string> = { brn: '#ff6a2a', par: '#ffd23f', psn: '#b55bd6', tox: '#9b3cc9', slp: '#8fa3c6', frz: '#8ff0ff' };

/**
 * The battle layer of the stage: two holograms, projectiles, bursts and camera impulses, driven by
 * BattleFx events from the battle controller.
 */
export class BattleStage {
  readonly group = new THREE.Group();
  private holos: [Hologram, Hologram];
  private bolts = [new Bolt(), new Bolt()];
  private bursts = Array.from({ length: 6 }, () => new Burst());
  private burstIdx = 0;
  private time = 0;
  /** Camera impulse the World adds to the director (crit/super-effective impacts). */
  shake = 0;
  onImpact: ((color: string) => void) | null = null;

  constructor(private camera: THREE.Camera, private reduced: () => boolean) {
    this.holos = [new Hologram(0), new Hologram(1)];
    this.holos[0].place(-0.88, 0.5); this.holos[1].place(0.88, 0.12);
    for (const h of this.holos) this.group.add(h.group);
    for (const b of this.bolts) this.group.add(b.mesh);
    for (const b of this.bursts) this.group.add(b.mesh);
  }

  private burst(at: THREE.Vector3, color: string, spread = 1, rise = 0) {
    const b = this.bursts[this.burstIdx++ % this.bursts.length]; b.fire(at, color, spread, rise);
  }
  private center(side: 0 | 1, out = new THREE.Vector3()) { return this.holos[side].card.getWorldPosition(out); }

  switchIn(side: 0 | 1, artId: number, name: string, tint: string, instant: boolean) {
    void this.holos[side].show(artId, name, tint, instant || this.reduced());
    if (!instant) this.burst(this.center(side).setY(0.4), tint, 0.6, 1);
  }
  move(side: 0 | 1, type: TypeName, category: 'Physical' | 'Special' | 'Status', target: 0 | 1 | null) {
    const color = TYPE_HEX[type];
    const from = this.center(side);
    if (category === 'Status' || target === null || target === side) { this.burst(from, color, 0.9, 0.6); return; }
    if (category === 'Physical') { this.holos[side].lungeAt(side === 0 ? 1 : -1); return; }
    const to = this.center(target);
    const bolt = this.bolts[side];
    bolt.fire(from, to, color, () => this.burst(to, color, 0.8));
  }
  hit(side: 0 | 1, lost: number, crit: boolean, effect: 'super' | 'resist' | 'immune' | 'normal', color: string) {
    const h = this.holos[side];
    if (effect === 'immune') { h.dodge(); return; }
    const strength = Math.min(1, lost * 1.6 + (crit ? 0.3 : 0) + (effect === 'super' ? 0.3 : 0));
    h.hit(strength, effect === 'super' ? color : crit ? '#ffffff' : '#ff4d6d');
    this.burst(this.center(side), effect === 'super' ? color : '#ffd1dc', 0.6 + strength * 0.8);
    if (crit || effect === 'super' || lost > 0.45) { this.shake = Math.max(this.shake, 0.4 + strength * 0.6); this.onImpact?.(color); }
  }
  heal(side: 0 | 1) { this.holos[side].heal(); this.burst(this.center(side), '#7dffb0', 0.5, 1); }
  miss(side: 0 | 1) { this.holos[side].dodge(); }
  faint(side: 0 | 1) { this.holos[side].faint(); this.burst(this.center(side), '#cfd6ff', 1.1, 1); }
  tera(side: 0 | 1, type: TypeName) { this.holos[side].tera(TYPE_HEX[type]); this.burst(this.center(side), TYPE_HEX[type], 1.4, 0.4); this.shake = Math.max(this.shake, 0.5); this.onImpact?.(TYPE_HEX[type]); }
  status(side: 0 | 1, s: string | null) { this.holos[side].status(s ? STATUS_HEX[s] ?? null : null); }
  boost(side: 0 | 1, up: boolean) { this.burst(this.center(side).setY(up ? 0.5 : 1.6), up ? '#7fe9ff' : '#ff7a7a', 0.4, up ? 1 : -1); }
  clear() { for (const h of this.holos) { h.group.visible = false; h.present = false; } }
  setPixelScale(s: number) { for (const b of this.bolts) b.mat.uniforms.uScale.value = s; for (const b of this.bursts) b.mat.uniforms.uScale.value = s; }

  update(dt: number) {
    this.time += dt;
    const reduced = this.reduced();
    for (const h of this.holos) h.update(dt, this.time, this.camera, reduced);
    for (const b of this.bolts) b.update(dt);
    for (const b of this.bursts) b.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  dispose() {
    for (const h of this.holos) h.dispose();
    for (const b of [...this.bolts, ...this.bursts]) { b.mesh.geometry.dispose(); b.mat.dispose(); }
    for (const p of texCache.values()) void p.then(t => t.dispose());
    texCache.clear();
  }
}
