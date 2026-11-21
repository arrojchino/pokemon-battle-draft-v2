import * as THREE from 'three';
import type { TypeName } from '@shared';
import { moveInfo } from '@shared';
import { pokemonArt } from '../../assets.js';
import { easeOutCubic } from '../math.js';
import { ARENA, BattleCamera } from './BattleCamera.js';
import { Barrier, Beam, Debris, Flashes, Particles, Rings, Shape, Slashes, type DebrisKind } from './fx.js';
import { impactDelay, recipeFor, windup, type Aura, type Recipe } from './moveFx.js';
import type { Cue } from '../../audio/sound.js';
import { MonBody, hasModel, loadMonModel } from '../character/monModel.js';

/** Battling Pokémon models are normalised to this height and stand on the platform top. */
const MON_HEIGHT = 1.2;
const PLATFORM_Y = 0.205;

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

/** Seconds a thrown Poké Ball takes to reach its spot before the Pokémon comes out. */
export const BALL_FLIGHT = 0.42;
const BALL_GEO = new THREE.SphereGeometry(0.085, 32, 20);
/** A classic Poké Ball, shaded in its own shader: red top, white bottom, black band and button. */
function pokeBallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uOpen: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vP; varying vec3 vN; void main() { vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uOpen; varying vec3 vP; varying vec3 vN;
      void main() {
        vec3 p = normalize(vP);
        vec3 col = p.y > 0.0 ? vec3(0.86, 0.12, 0.06) : vec3(0.94, 0.95, 0.97);
        col = mix(col, vec3(0.04), smoothstep(0.085, 0.06, abs(p.y)));
        float r = length(p.xy);
        float front = step(0.0, p.z);
        col = mix(col, vec3(0.04), front * smoothstep(0.31, 0.29, r));
        col = mix(col, vec3(0.97), front * smoothstep(0.21, 0.19, r));
        vec3 L = normalize(vec3(0.35, 0.85, 0.45));
        float d = 0.4 + 0.6 * max(dot(vN, L), 0.0);
        float s = pow(max(dot(reflect(-L, vN), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
        gl_FragColor = vec4(col * d + s * 0.7 + vec3(uOpen * 2.5), 1.0);
      }`,
  });
}

/**
 * The active Pokémon on one side of the field. It appears at once as a holographic projection of the
 * official artwork (scanlines, type-tinted rim, glitch on impact, dissolve on faint); when the
 * Pokémon 3D API has a model for the species, the model is sent out in its place as soon as it has
 * downloaded, facing its opponent, with its own battle idle, attack, damage and faint animations where
 * the model has them. Alternate forms without their own model keep the projection.
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
  /** Where the opposing Pokémon stands: models face it. */
  readonly foe = new THREE.Vector3();
  private body: MonBody | null = null;
  private bodyDex = 0;
  private bodyIn = 1;
  private yaw = 0;
  /** Static models fall over procedurally when they faint (0..1). */
  private topple = 0;
  private ball: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private ballT = 1; private ballFrom = new THREE.Vector3(); private ballOpen = 0;
  /** Called when the thrown ball opens and the Pokémon comes out. */
  onOpen: ((side: 0 | 1) => void) | null = null;
  private asleep = false;
  /** Ceiling for the hit/heal/Tera flash on the projection (lowered by Reduce flashing). */
  flashCap = 1;

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
    this.ball = new THREE.Mesh(BALL_GEO, pokeBallMaterial());
    this.ball.visible = false; this.ball.castShadow = true;
  }
  /** The ball flies in world space, so it lives outside the Pokémon's group. */
  get ballMesh() { return this.ball; }

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
    this.topple = 0; this.asleep = false;
    // Sent out from a thrown Poké Ball: nothing shows until it opens.
    if (!instant) {
      this.ballT = 0; this.ballOpen = 0;
      this.ballFrom.copy(this.home).add(this.side === 0 ? tmp.set(-1.3, 1.5, 2.1) : tmp.set(1.1, 1.7, -1.9));
      this.bodyIn = 0; this.revealT = 0;
    } else this.ballT = 1;
    // 3D model: the same species comes back as it was (revived or switched back in); a new one loads
    // while the projection stands in for it.
    const dex = artId <= 1025 && hasModel(artId) ? artId : 0;
    if (this.body && this.bodyDex !== dex) { this.body.dispose(); this.body = null; this.bodyDex = 0; }
    this.card.visible = !this.body; this.beam.visible = !this.body;
    if (this.body) { this.body.reset(); this.body.root.rotation.x = 0; this.bodyIn = instant ? 1 : 0; }
    else if (dex) {
      void loadMonModel(dex, MON_HEIGHT).then(m => {
        if (token !== this.loadToken || !this.present || this.dissolving) { for (const mat of m.materials) mat.dispose(); return; }
        this.body = new MonBody(m, 'battle'); this.bodyDex = dex;
        this.body.root.position.y = PLATFORM_Y;
        this.group.add(this.body.root);
        this.card.visible = false; this.beam.visible = false;
        // Arriving after the ball opened (a slow download): grow in with a flash of its own.
        if (this.ballT >= 1) { this.bodyIn = instant ? 1 : 0; if (!instant) this.body.hit('#ffffff', 1); }
        if (this.asleep) this.body.setIdle('sleep');
      }).catch(() => { /* the projection stays */ });
    }
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
    // Stop where the two bodies meet instead of passing through the target.
    this.dashTo.copy(this.home).addScaledVector(tmp.normalize(), Math.max(0, len - (this.body ? 0.55 + this.body.radius * 1.4 : 0.85)));
    for (const p of this.trail) p.copy(this.home);
  }
  hit(strength: number, color: string) {
    this.shake = Math.min(1, 0.35 + strength); this.uniforms.uGlitch.value = Math.min(1, 0.4 + strength); this.uniforms.uFlash.value = 0.8; this.uniforms.uFlashColor.value.set(color);
    const b = this.body;
    if (!b) return;
    b.hit(color, Math.min(1, 0.5 + strength) * this.flashCap);
    // Recoil: the model's own damage clip (the heavier one for big hits) plus a procedural flinch.
    if (!this.asleep) b.act(strength > 0.6 ? ['damage02', 'damage01'] : ['damage01'], { speed: 1.1, fade: 0.08 });
    b.pulse('hit');
  }
  /**
   * The attacker's own motion, timed so its strike lands `strikeIn` seconds from now: the model's attack
   * clip (contact), ranged attack clip (special and non-contact) or roar/cheer (self moves), sped up or
   * slowed to fit; models without clips wind up and strike procedurally.
   */
  attack(kind: 'contact' | 'ranged' | 'self', strikeIn: number) {
    const b = this.body;
    if (!b) return;
    if (this.asleep) { b.pulse('hit'); return; }
    const names = kind === 'contact' ? ['attack01', 'attack02'] : kind === 'ranged' ? ['rangeattack01', 'attack02', 'attack01'] : ['roar01', 'glad01', 'rangeattack01'];
    if (!b.strike(names, strikeIn)) b.pulse(kind === 'self' ? 'roar' : 'attack', strikeIn);
  }
  /** Winner's celebration. */
  celebrate() { if (!this.body || this.dissolving) return; if (!this.body.act(['glad01', 'roar01'])) this.body.pulse('cheer'); this.hop = 1; }
  distort(amount = 0.8) { this.uniforms.uGlitch.value = Math.max(this.uniforms.uGlitch.value, amount); }
  heal() { this.uniforms.uFlash.value = 0.5; this.uniforms.uFlashColor.value.set('#7dffb0'); this.hop = 1; this.body?.hit('#7dffb0', 0.6 * this.flashCap); }
  pulse(color: string, amount = 0.6) { this.uniforms.uFlash.value = amount; this.uniforms.uFlashColor.value.set(color); this.hop = 1; this.body?.hit(color, amount * this.flashCap); }
  dodge() { this.sidestep = 1; }
  faint() {
    this.dissolving = true; this.dissolveT = 0; this.crystalTarget = 0;
    const b = this.body;
    if (!b) return;
    // The model's own collapse (then its knocked-out loop); models without one topple over.
    if (b.act(['down01_start'], { hold: true, fade: 0.1 })) window.setTimeout(() => { if (this.dissolving) b.loop(['down01_loop']); }, 380);
    else if (!b.act(['damage02'], { hold: true })) this.topple = 0.0001;
  }
  tera(color: string) { this.crystalTarget = 1; (this.crystal.material as THREE.LineBasicMaterial).color.set(color).multiplyScalar(2.2); this.uniforms.uFlash.value = 1; this.uniforms.uFlashColor.value.set(color); this.uniforms.uTint.value.set(color); this.body?.hit(color, this.flashCap); }
  status(color: string | null, asleep = false) {
    if (color) { this.uniforms.uStatus.value.set(color); this.uniforms.uStatusAmt.value = 1; } else this.uniforms.uStatusAmt.value = 0;
    // Asleep: the model's sleep loop (or a drowsy droop); other statuses tint it.
    this.body?.setTint(asleep ? null : color, 0.28);
    if (asleep !== this.asleep) { this.asleep = asleep; this.body?.setIdle(asleep ? 'sleep' : 'battle'); }
  }
  hide() { this.group.visible = false; this.present = false; this.dashT = 1; this.ballT = 1; this.ball.visible = false; for (const g of this.ghosts) g.visible = false; }

  update(dt: number, t: number, camera: THREE.Camera, reduced: boolean, foeCenter: THREE.Vector3) {
    if (!this.group.visible) { for (const g of this.ghosts) g.visible = false; return; }
    this.uniforms.uTime.value = t;
    // Poké Ball throw: an arc with backspin, then it pops open in a flash and the Pokémon comes out.
    if (this.ballT < 1) {
      this.ballT = Math.min(1, this.ballT + dt / BALL_FLIGHT);
      const u = this.ballT, land = tmp.copy(this.home).setY(0.62);
      this.ball.visible = true;
      this.ball.position.lerpVectors(this.ballFrom, land, u);
      this.ball.position.y += Math.sin(u * Math.PI) * 0.7;
      this.ball.rotation.x -= dt * 22; this.ball.rotation.y = this.side === 0 ? 0.6 : -2.4;
      this.ball.scale.setScalar(1);
      if (this.ballT >= 1) { this.ballOpen = 1; this.revealT = 0; this.bodyIn = 0; this.body?.hit('#ffffff', 1); this.onOpen?.(this.side); }
      this.card.visible = false; if (this.body) this.body.root.visible = false;
      return;
    }
    if (this.ballOpen > 0) {
      this.ballOpen = Math.max(0, this.ballOpen - dt / 0.16);
      this.ball.material.uniforms.uOpen.value = 1 - this.ballOpen;
      this.ball.scale.setScalar(1 + (1 - this.ballOpen) * 1.6);
      this.ball.visible = this.ballOpen > 0;
    } else this.ball.visible = false;
    this.card.visible = !this.body;
    if (this.body) this.body.root.visible = true;
    this.revealT = Math.min(1, this.revealT + dt / (reduced ? 0.2 : 0.75));
    this.uniforms.uReveal.value = easeOutCubic(this.revealT);
    this.uniforms.uGlitch.value *= Math.exp(-5 * dt);
    this.uniforms.uFlash.value = Math.min(this.flashCap, this.uniforms.uFlash.value * Math.exp(-7 * dt));
    if (this.dissolving) {
      // A model plays its faint, then fades; the projection erodes.
      this.dissolveT = Math.min(1, this.dissolveT + dt / (reduced ? 0.4 : this.body ? 1.6 : 1.1));
      this.uniforms.uDissolve.value = this.dissolveT;
      this.body?.setOpacity(1 - smooth(Math.max(0, (this.dissolveT - 0.45) / 0.55)));
      if (this.topple > 0) this.topple = Math.min(1, this.topple + dt / 0.55);
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
    // Recoil wobble: a smooth, quickly damped sway (random per-frame jitter read as stutter).
    const sx = reduced ? 0 : Math.sin(t * 34) * 0.06 * this.shake * this.shake * (this.body ? 0.6 : 1);
    const dodge = reduced ? 0 : Math.sin(this.sidestep * Math.PI) * 0.4;
    tmp.lerpVectors(this.home, this.dashTo, k);
    // Dodge sideways relative to the field line.
    const sideSign = this.side === 0 ? -1 : 1;
    this.group.position.set(tmp.x + sx + dodge * sideSign * 0.7, Math.sin(this.hop * Math.PI) * 0.18 + (k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.25 : 0), tmp.z + dodge * sideSign * -0.7);
    this.card.position.y = ARENA.cardY + Math.sin(t * 1.6 + this.side * 2) * 0.03;
    // Face the camera around Y only, like a projection would.
    this.card.lookAt(camera.position.x, this.card.getWorldPosition(tmp2).y, camera.position.z);
    if (spin) this.card.rotateY(spin);

    if (this.body) {
      // Grow out of the send-out flash, then face the foe (turned a little toward the camera, as in the games).
      this.bodyIn = Math.min(1, this.bodyIn + dt / (reduced ? 0.15 : 0.4));
      const u = this.bodyIn, s = u >= 1 ? 1 : 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);
      this.body.root.scale.setScalar(Math.max(0.001, s));
      tmp2.lerpVectors(this.foe, camera.position, this.side === 0 ? 0.3 : 0.4);
      const want = Math.atan2(tmp2.x - this.group.position.x, tmp2.z - this.group.position.z);
      this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * (1 - Math.exp(-10 * dt));
      this.body.root.rotation.y = this.yaw + spin;
      // Procedural faint for models without a collapse clip: tip over sideways and settle.
      const tp = this.topple > 0 ? smooth(this.topple) : 0;
      this.body.root.rotation.z = tp * 1.35 * (this.side === 0 ? 1 : -1);
      this.body.root.position.y = PLATFORM_Y - tp * 0.08;
      if (!this.dissolving) this.body.setOpacity(this.uniforms.uAlpha.value);
      // The head follows the opponent.
      this.body.lookAt(this.dissolving || this.asleep ? null : foeCenter);
      this.body.update(dt);
    }

    // Afterimages trail the rush (the projection only).
    const moving = this.dashT < 1 && !reduced && !this.body;
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
    this.body?.dispose(); this.body = null;
    this.ball.removeFromParent(); this.ball.material.dispose();
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
  private foeCenter = new THREE.Vector3();
  private freeze = 0;
  /** Effects setting: point-light flash strength (0..1), and calm = no screen flashes, dimmer hologram flashes. */
  private lightAmt = 1;
  private calm = false;
  /** Camera impulse, zoom punch, screen punch and screen flash the World applies each frame. */
  shake = 0; fovPunch = 0; screenPunch = 0;
  readonly screenFlash = { color: new THREE.Color('#ffffff'), amt: 0 };
  onImpact: ((color: string) => void) | null = null;
  /** Sound cue requests (cue, stereo pan, gain); the World forwards them to the app's sound engine. */
  onSound: ((cue: Cue, pan: number, gain?: number) => void) | null = null;

  constructor(private camera: THREE.Camera, private reduced: () => boolean) {
    this.holos = [new Hologram(0), new Hologram(1)];
    this.holos.forEach((h, i) => { h.place(ARENA.mon[i]); h.foe.copy(ARENA.mon[1 - i]); this.group.add(h.ballMesh); h.onOpen = s => this.ballOpened(s); });
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
  private snd(cue: Cue, side: 0 | 1 | null = null, gain = 1) { this.onSound?.(cue, side === null ? 0 : side === 0 ? -0.45 : 0.45, gain); }
  private later(delay: number, fn: () => void) { if (delay <= 0) fn(); else this.jobs.push({ at: this.time + delay, fn }); }
  private home(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, ARENA.cardY, m.z); }
  private foot(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, ARENA.floorY + 0.03, m.z); }
  private center(side: 0 | 1, out = new THREE.Vector3()) { return this.holos[side].center(out); }
  private orb() { return this.orbs.find(o => !o.busy) ?? this.orbs[0]; }
  private light(at: THREE.Vector3, color: string, peak = 8, dur = 0.45, follow: (() => THREE.Vector3) | null = null) { if (!this.reduced() && this.lightAmt > 0) this.flashes.fire(at, color, peak * this.lightAmt, dur, follow); }
  private ballistic(from: THREE.Vector3, to: THREE.Vector3, T: number, out = new THREE.Vector3()) { return out.subVectors(to, from).divideScalar(T).setY((to.y - from.y) / T + 4.9 * T); }
  private kickScreen(strength: number, color: string, flash = 0) {
    this.screenPunch = Math.max(this.screenPunch, strength);
    if (flash > 0 && !this.reduced() && !this.calm) { this.screenFlash.color.set(color); this.screenFlash.amt = Math.max(this.screenFlash.amt, flash); }
  }

  /** Effects intensity (particle density and light-flash strength, 0..1) and Reduce flashing. */
  setEffects(particles: number, lights: number, calm: boolean) {
    this.particles.density = particles;
    this.lightAmt = calm ? Math.min(lights, 0.35) : lights;
    this.calm = calm;
    for (const h of this.holos) h.flashCap = calm ? 0.3 : 1;
  }

  /* ---------------- events */
  private switchTint: [string, string] = ['#ffffff', '#ffffff'];
  switchIn(side: 0 | 1, artId: number, name: string, tint: string, instant: boolean) {
    const reduced = this.reduced();
    this.switchTint[side] = tint;
    void this.holos[side].show(artId, name, tint, instant || reduced);
    if (instant) return;
    if (reduced) { this.ballOpened(side); return; }
    this.snd('dash', side, 0.5);
    this.cam.switchIn(side);
  }
  /** The ball pops: a white flash, a ring and sparks in the Pokémon's colour where it lands. */
  private ballOpened(side: 0 | 1) {
    const tint = this.switchTint[side];
    this.snd('switchIn', side);
    const f = this.foot(side);
    this.particles.burst(tmp.copy(this.home(side)).setY(0.62), 50, 2.6, { color: '#ffffff', size: 0.07, ttl: 0.5, drag: 3 });
    this.particles.burst(f, 40, 2.2, { color: tint, size: 0.06, ttl: 0.9, rise: 1.2, drag: 2 });
    this.rings.fire(f, tint, { flat: true, s0: 0.2, s1: 1.4, dur: 0.6 });
    this.light(this.home(side), '#ffffff', 14, 0.5);
  }
  /** The last Pokémon standing celebrates. */
  victory(side: 0 | 1) { this.holos[side].celebrate(); }

  move(side: 0 | 1, move: string, type: TypeName, category: 'Physical' | 'Special' | 'Status', target: 0 | 1 | null) {
    const r = recipeFor(move, type, category);
    const color = TYPE_HEX[type];
    const tgt: 0 | 1 = target === null || target === side ? (1 - side) as 0 | 1 : target;
    const selfMove = r.kind === 'self';
    const delay = impactDelay(r);
    // Wind-up first (the attacker's anticipation), then the effect; the damage line waits for both.
    const lead = windup(r);
    if (!selfMove && r.kind !== 'hazard' && r.kind !== 'field') this.impactAt[tgt] = this.time + lead + delay;
    const style = r.kind === 'dash' ? 'dash' : (r.kind === 'rain' && r.debris !== 'coin') || r.kind === 'quake' || r.kind === 'field' || r.kind === 'hazard' ? 'field' : selfMove ? 'self' : 'projectile';
    const big = (r.kind === 'dash' && !!r.big) || (moveInfo(move)?.power ?? 0) >= 110;
    if (!this.reduced()) this.cam.attack(side, style, lead + delay, tgt, big);
    // Contact moves strike when the rush connects; everything else releases as the effect starts.
    this.holos[side].attack(r.kind === 'dash' ? 'contact' : selfMove ? 'self' : 'ranged', r.kind === 'dash' ? lead + delay : Math.max(0.25, lead));
    if (lead > 0) this.later(lead, () => this.play(r, side, tgt, color)); else this.play(r, side, tgt, color);
  }

  private play(r: Recipe, s: 0 | 1, t: 0 | 1, color: string) {
    const A = this.home(s), B = this.home(t);
    const P = this.particles;
    switch (r.kind) {
      case 'dash': {
        this.holos[s].dash(B, { fast: r.fast, spin: r.impact === 'spin', vanish: r.vanish });
        this.snd('dash', s);
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
        if (r.drain) this.later(delay + 0.2, () => { this.snd('heal', s, 0.7); P.stream(B, A, 0.45, { color: '#7dffb0', size: 0.05, rate: 140, speed: 3.2, spread: 0.2 }); this.later(0.5, () => this.holos[s].heal()); });
        break;
      }
      case 'orb': {
        const n = r.count ?? 1;
        for (let k = 0; k < n; k++) this.later(k * 0.09, () => {
          const to = tmp.copy(B).add(tmp2.set((Math.random() - 0.5) * 0.4 * (n > 1 ? 1 : 0), (Math.random() - 0.5) * 0.3 * (n > 1 ? 1 : 0), 0)).clone();
          if (r.shards) {
            this.snd('slash', s, 0.6);
            const from = A.clone();
            this.debris.throw('shard', from, this.ballistic(from, to, 0.5), 0.09, { ttl: 0.5, groundY: -5 });
            this.later(0.5, () => this.impactBurst(to, color, 0.6));
            return;
          }
          const o = this.orb();
          this.snd('orb', s, n > 1 ? 0.5 : 1);
          o.fire(A, to, r.seeds ? '#9cff6a' : color, { dur: 0.55, arc: r.arc ?? 0.3, size: r.size ?? 1 }, () => {
            this.snd('orbHit', t, n > 1 ? 0.5 : 1);
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
          this.snd(r.shape === 'fire' ? 'fire' : r.shape === 'leaf' ? 'leaves' : 'water', s);
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
        this.snd('beamCharge', s);
        this.later(0.12, () => {
          this.snd('beam', s);
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
        this.snd('zap', t, r.small ? 0.6 : 1);
        this.kickScreen(0.2, '#fff4b0', r.small ? 0.04 : 0.12);
        this.later(impactDelay(r), () => this.impactBurst(B, '#ffe45a', 0.9));
        break;
      }
      case 'rings': {
        if (r.travel) for (let k = 0; k < 4; k++) this.rings.fire(A, color, { to: B, s0: 0.2, s1: 0.95, dur: 0.55, delay: k * 0.08 });
        else if (r.both) { for (const x of [A, B]) for (let k = 0; k < 2; k++) this.rings.fire(x, color, { s0: 0.1, s1: 1.1, dur: 0.5, delay: k * 0.12 }); }
        else for (let k = 0; k < 3; k++) this.rings.fire(B, color, { s0: 1.4, s1: 0.2, dur: 0.4, delay: k * 0.1 });
        this.snd('rings', r.travel ? s : t);
        if (r.distort) { this.later(0.15, () => this.holos[t].distort(1)); this.kickScreen(0.35, color, 0.05); }
        this.light(r.travel ? A : B, color, 9, 0.7);
        if (r.travel) this.later(impactDelay(r), () => this.impactBurst(B, color, 0.7));
        break;
      }
      case 'swirl': {
        this.snd(r.shape === 'wind' ? 'wind' : r.shape === 'spore' ? 'status' : r.shape === 'wisp' ? 'orb' : 'leaves', t);
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
          this.snd('coins', t);
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
          if (r.debris !== 'salt' || k === 0) this.snd('meteor', t, r.debris === 'meteor' || r.debris === 'hammer' ? 1 : 0.5);
          const land = this.foot(t).add(tmp2.set((Math.random() - 0.5) * (n > 1 ? 1.1 : 0), 0, (Math.random() - 0.5) * (n > 1 ? 0.8 : 0)));
          // From the sky behind the target, so nothing falls past the lens.
          const start = land.clone().add(tmp2.set(0.5 + Math.random() * 0.6, 4.8 + Math.random(), -2.6 - Math.random()));
          const trail = r.debris === 'meteor' || r.debris === 'hammer' ? '#c79bff' : r.debris === 'rock' ? '#e8d29a' : null;
          this.debris.throw(kind, start, this.ballistic(start, land, 0.72), scale, {
            ttl: 2,
            onFly: trail ? p => { for (let i = 0; i < 2; i++) this.particles.emit(p, tmp2.randomDirection().multiplyScalar(0.25), { color: trail, size: Math.min(0.14, scale * 0.45), sizeEnd: 0.01, ttl: 0.4 }); } : undefined,
            onLand: p => {
              this.snd(r.debris === 'salt' ? 'hazard' : 'meteorHit', t, r.debris === 'meteor' ? 0.8 : r.debris === 'hammer' ? 1.2 : 0.5);
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
      case 'quake': this.snd('quake', null); this.quakeAt(t, color, 1, A); break;
      case 'self': this.selfFx(r.effect, s, color); break;
      case 'hazard': {
        this.snd('hazard', t);
        const f = this.foot(t);
        for (let k = 0; k < 5; k++) this.later(k * 0.07, () => {
          const land = f.clone().add(tmp2.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.1));
          if (r.debris === 'toxic') { const o = this.orb(); o.fire(A, land, '#b55bd6', { dur: 0.6, arc: 1.2, size: 0.5 }, () => P.burst(land, 10, 1.2, { color: '#c77dff', size: 0.06, ttl: 0.7, gravity: 3 })); return; }
          this.debris.throw(r.debris === 'rock' ? 'rock' : 'spike', A.clone(), this.ballistic(A, land, 0.6), r.debris === 'rock' ? 0.12 : 0.08, { ttl: 1.6, onLand: p => P.burst(p.clone().setY(0.1), 8, 1.2, { color: '#e8d29a', size: 0.05, ttl: 0.5, gravity: 3 }) });
        });
        break;
      }
      case 'field': {
        this.snd('wind', null);
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
    this.snd(r.impact === 'slash' || r.impact === 'spin' ? 'slash' : r.impact === 'bite' ? 'bite' : r.impact === 'quake' ? 'meteorHit' : 'punch', t, big ? 1.2 : 1);
    if (r.aura === 'fire') this.snd('fire', t, 0.5); else if (r.aura === 'water') this.snd('water', t, 0.5); else if (r.aura === 'electric') this.snd('zap', t, 0.6);
    switch (r.impact) {
      case 'slash': this.slashes.fire(B, color, big ? 3 : 2, big ? 1 : 0.8); break;
      case 'bite': this.slashes.fire(B, color, 2, 0.6); break;
      case 'punch': this.rings.fire(B, '#ffffff', { s0: 0.1, s1: big ? 1.3 : 0.9, dur: 0.3 }); this.rings.fire(B, color, { s0: 0.1, s1: big ? 1.7 : 1.2, dur: 0.42, delay: 0.04 }); break;
      case 'spin': this.rings.fire(this.foot(t), color, { flat: true, s0: 0.2, s1: 1.4, dur: 0.4 }); this.slashes.fire(B, color, 2, 0.7); break;
      case 'quake': this.quakeAt(t, color, big ? 0.8 : 0.5); break;
      case 'flurry':
        for (let k = 0; k < 5; k++) this.later(k * 0.075, () => {
          if (k) this.snd('punch', t, 0.6);
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
    this.snd(effect === 'heal' || effect === 'revive' ? 'heal' : effect === 'protect' || effect === 'screen' ? 'shield' : effect === 'curse' ? 'debuff' : effect === 'sleep' ? 'status' : effect === 'sub' || effect === 'transform' ? 'rings' : effect === 'drum' ? 'punch' : 'buff', s);
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
      if (effect === 'immune') { h.dodge(); this.snd('miss', side); return; }
      const strength = Math.min(1, lost * 1.6 + (crit ? 0.3 : 0) + (effect === 'super' ? 0.3 : 0));
      h.hit(strength, effect === 'super' ? color : crit ? '#ffffff' : '#ff4d6d');
      this.particles.burst(this.center(side), Math.round(12 + strength * 30), 1.4 + strength * 2, { color: effect === 'super' ? color : '#ffd1dc', size: 0.06, ttl: 0.5, drag: 2 });
      const heavy = crit || effect === 'super' || lost > 0.45;
      this.snd(heavy || lost > 0.3 ? 'hitBig' : 'hit', side, effect === 'resist' ? 0.6 : 1);
      if (crit) this.snd('crit', side); else if (effect === 'super') this.snd('super', side); else if (effect === 'resist') this.snd('resist', side);
      if (heavy) {
        this.shake = Math.max(this.shake, 0.4 + strength * 0.6); this.onImpact?.(color);
        // Impact frames: a brief hit-stop on crits and super-effective hits only.
        if (!this.reduced()) { this.freeze = crit ? 0.09 : effect === 'super' ? 0.06 : 0; this.fovPunch = Math.max(this.fovPunch, 2 + strength * 4); }
        this.kickScreen(0.3 + strength * 0.35, crit ? '#ffffff' : color, crit ? 0.08 : 0.04);
      }
    };
    const wait = this.impactAt[side] - this.time;
    if (wait > 0.02) this.later(wait, play); else play();
  }
  heal(side: 0 | 1) {
    this.holos[side].heal();
    this.snd('heal', side, 0.6);
    this.particles.swirl(this.home(side), 0.6, { color: '#7dffb0', shape: Shape.Star, size: 0.08, radius: 0.6, height: 1.4, rate: 70, w: 2, ttl: 0.8, spin: 3 });
  }
  miss(side: 0 | 1) { const wait = this.impactAt[side] - this.time; this.later(Math.max(0, wait - 0.12), () => { this.holos[side].dodge(); this.snd('miss', side); }); }
  faint(side: 0 | 1) {
    const wait = Math.max(0, this.impactAt[side] - this.time);
    this.later(wait, () => {
      this.holos[side].faint();
      this.snd('faint', side);
      this.particles.burst(this.center(side), 60, 1.4, { color: '#cfd6ff', size: 0.06, ttl: 1.4, rise: 1.2, drag: 1.5 });
      if (!this.reduced()) this.cam.faint(side);
    });
  }
  tera(side: 0 | 1, type: TypeName, instant = false) {
    const c = TYPE_HEX[type];
    this.holos[side].tera(c);
    if (instant) return;
    this.snd('tera', side);
    const A = this.home(side);
    this.particles.burst(A, 90, 3.2, { color: c, shape: Shape.Star, size: 0.12, ttl: 1, drag: 2.5, spin: 5 });
    this.rings.fire(A, c, { s0: 0.2, s1: 2.2, dur: 0.7 });
    this.rings.fire(this.foot(side), c, { flat: true, s0: 0.2, s1: 2.6, dur: 0.9 });
    this.light(A, c, 22, 1.2);
    this.shake = Math.max(this.shake, 0.5); this.onImpact?.(c);
    this.kickScreen(0.6, c, 0.12);
    if (!this.reduced()) this.cam.tera(side);
  }
  status(side: 0 | 1, s: string | null) { this.holos[side].status(s ? STATUS_HEX[s] ?? null : null, s === 'slp'); if (s) this.snd('status', side); }
  boost(side: 0 | 1, up: boolean) {
    this.snd(up ? 'buff' : 'debuff', side, 0.7);
    const at = this.home(side).setY(up ? 0.4 : 1.7);
    this.particles.burst(at, 26, 1.2, { color: up ? '#7fe9ff' : '#ff7a7a', size: 0.06, ttl: 0.8, rise: up ? 1.4 : -1.4, drag: 1 });
  }
  clear() {
    for (const h of this.holos) h.hide();
    for (const o of this.orbs) o.stop();
    this.particles.clear(); this.rings.clear(); this.debris.clear(); this.flashes.clear();
    this.jobs.length = 0; this.cam.reset(); this.impactAt = [0, 0];
  }
  /**
   * Compile every effect's shaders now (pooled meshes are hidden until first use, and the renderer only
   * compiles what is visible), so no move stalls a frame compiling the first time it is played.
   */
  prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const hidden: THREE.Object3D[] = [];
    this.group.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const done = renderer.compileAsync(this.group, this.camera, scene);
    for (const o of hidden) o.visible = false;
    return done;
  }
  setPixelScale(s: number) { for (const o of this.orbs) o.mat.uniforms.uScale.value = s; this.particles.mat.uniforms.uScale.value = s; }

  update(dt: number) {
    // Hit-stop: a few frames of near-freeze sell heavy impacts.
    if (this.freeze > 0) { this.freeze -= dt; dt *= 0.06; }
    this.time += dt;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= this.time) { const j = this.jobs[i]; this.jobs.splice(i, 1); j.fn(); }
    const reduced = this.reduced();
    for (const h of this.holos) h.update(dt, this.time, this.camera, reduced, this.holos[1 - h.side].center(this.foeCenter));
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
