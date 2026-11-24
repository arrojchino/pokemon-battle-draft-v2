import * as THREE from 'three';
import type { TypeName } from '@shared';
import { moveInfo } from '@shared';
import { pokemonArt } from '../../assets.js';
import { easeOutCubic } from '../math.js';
import { ARENA, BattleCamera } from './BattleCamera.js';
import { FieldPersist, type SideLayers } from './persist.js';
import { Barrier, Beam, Bolts, Cracks, Debris, Flares, Flashes, Particles, Rings, Shape, Slashes, Wave, warmTwin, type DebrisKind, type ParticleOpts } from './fx.js';
import { impactDelay, recipeFor, windup, type Aura, type Recipe, type SelfEffect } from './moveFx.js';
import type { Cue } from '../../audio/sound.js';
import { MonBody, hasModel, loadMonModel } from '../character/monModel.js';
import { TransformFx } from './transform.js'; // transform (ditto)
import { monSize } from '../character/size.js';

/** Battling Pokémon models are normalised to this height and stand on the platform top. */
/** The particle field's spawners, with every size scaled for one Pokémon (see BattleStage.px). */
type ScaledParticles = Pick<Particles, 'emit' | 'emitter' | 'burst' | 'swirl' | 'stream' | 'lightning'>;
/** The recipe variant for one kind of move. */
type Of<K extends Recipe['kind']> = Extract<Recipe, { kind: K }>;
const PLATFORM_Y = 0.205;

/** Conventional type colours, used for move trails, impacts and Tera crystals. */
export const TYPE_HEX: Record<TypeName, string> = {
  Normal: '#c6c6a7', Fire: '#ff7a2f', Water: '#4f8cff', Electric: '#ffd23f', Grass: '#62d26f', Ice: '#8ff0ff',
  Fighting: '#e0453a', Poison: '#b55bd6', Ground: '#e6c36a', Flying: '#a98ff3', Psychic: '#ff5e9c', Bug: '#b7d335',
  Rock: '#c9b458', Ghost: '#8a6bd1', Dragon: '#7a4dff', Dark: '#8b6f5c', Steel: '#bfc7e0', Fairy: '#ff9bd2', Stellar: '#6fe6d6',
};
const AURA_HEX: Record<Aura, string> = { none: '#ffffff', water: '#5aa8ff', fire: '#ff8a2a', electric: '#ffe45a', wind: '#d9e4ff', ghost: '#9a6bff', stars: '#ffb3e0', ice: '#aef4ff', blaze: '#cfeaff', bug: '#c8f05a' };

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
const tmp3 = new THREE.Vector3();
const ZERO3 = new THREE.Vector3();
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
  /** Body height: predicted from the Pokédex height until the model has loaded, then measured. */
  private h = 0.7;
  get height() { return this.h; }
  /** Chest height, where effects aim. */
  get cy() { return PLATFORM_Y + this.h * 0.55; }
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
    this.card.position.y = 0.6;
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
    this.crystal.position.y = 0.6;
    this.group.add(this.crystal);
    this.group.visible = false;
    this.ball = new THREE.Mesh(BALL_GEO, pokeBallMaterial());
    this.ball.visible = false; this.ball.castShadow = true;
  }
  /** The ball flies in world space, so it lives outside the Pokémon's group. */
  get ballMesh() { return this.ball; }

  place(p: THREE.Vector3) { this.home.copy(p); this.group.position.copy(p); }
  /** Size the projection, its emitter and the Tera shell to the Pokémon. */
  private applySize() {
    const k = this.h / 1.2, b = Math.max(0.45, k);
    this.card.scale.setScalar(Math.max(0.42, k * 1.08));
    for (const g of this.ghosts) g.scale.copy(this.card.scale);
    this.beam.scale.setScalar(b); this.beam.position.y = PLATFORM_Y + 0.95 * b;
    this.base.scale.setScalar(Math.max(0.6, k * 1.15));
    this.crystal.scale.set(0.9 * b, 1.15 * b, 0.6 * b); this.crystal.position.y = this.cy;
  }
  /** Where the projection is right now (follows rushes). */
  center(out = new THREE.Vector3()) { return out.copy(this.card.position).add(this.group.position); }

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
    const dex = hasModel(artId) ? artId : 0;
    if (this.body && this.bodyDex !== dex) { this.body.dispose(); this.body = null; this.bodyDex = 0; }
    this.h = this.body ? this.body.height : monSize(artId); this.applySize();
    this.card.visible = !this.body; this.beam.visible = !this.body; this.base.visible = !this.body;
    if (this.body) { this.body.reset(); this.body.root.rotation.x = 0; this.bodyIn = instant ? 1 : 0; }
    else if (dex) {
      void loadMonModel(dex, monSize(dex)).then(m => {
        if (token !== this.loadToken || !this.present || this.dissolving) { for (const mat of m.materials) mat.dispose(); return; }
        this.body = new MonBody(m, 'battle'); this.bodyDex = dex;
        this.h = m.height; this.applySize();
        this.body.root.position.y = PLATFORM_Y;
        this.group.add(this.body.root);
        // The emitter disc and beam belong to the projection; a 3D Pokémon stands on its own shadow.
        this.card.visible = false; this.beam.visible = false; this.base.visible = false;
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
  /** Out of its ball and fully revealed (the projection, or the model once it has grown in). */
  get settled() { return this.present && this.ballT >= 1 && this.revealT >= 1 && (!this.body || this.bodyIn >= 0.99); }
  /** Footprint radius, for shots that frame the Pokémon whole. */
  get footprint() { return this.body ? this.body.radius : this.h * 0.4; }
  hide() { this.group.visible = false; this.present = false; this.dashT = 1; this.ballT = 1; this.ball.visible = false; for (const g of this.ghosts) g.visible = false; }

  /**
   * `camera` is the real camera (world space, for `lookAt`); `localCam` is its position in stage space (for
   * aiming in stage coordinates); `foeWorld` is the opponent's centre in world space (the head follows it).
   */
  update(dt: number, t: number, camera: THREE.Camera, localCam: THREE.Vector3, reduced: boolean, foeWorld: THREE.Vector3) {
    if (!this.group.visible) { for (const g of this.ghosts) g.visible = false; return; }
    this.uniforms.uTime.value = t;
    // Poké Ball throw: an arc with backspin, then it pops open in a flash and the Pokémon comes out.
    if (this.ballT < 1) {
      this.ballT = Math.min(1, this.ballT + dt / BALL_FLIGHT);
      const u = this.ballT, land = tmp.copy(this.home).setY(PLATFORM_Y + Math.min(0.4, this.h * 0.5));
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
    this.group.position.set(tmp.x + sx + dodge * sideSign * 0.7, Math.sin(this.hop * Math.PI) * 0.18 * Math.min(1, this.h / 0.8) + (k > 0 && k < 1 ? Math.sin(k * Math.PI) * 0.25 : 0), tmp.z + dodge * sideSign * -0.7);
    this.card.position.y = this.cy + Math.sin(t * 1.6 + this.side * 2) * 0.03;
    // Face the camera around Y only, like a projection would.
    this.card.lookAt(camera.position.x, this.card.getWorldPosition(tmp2).y, camera.position.z);
    if (spin) this.card.rotateY(spin);

    if (this.body) {
      // Grow out of the send-out flash, then face the foe (turned a little toward the camera, as in the games).
      this.bodyIn = Math.min(1, this.bodyIn + dt / (reduced ? 0.15 : 0.4));
      const u = this.bodyIn, s = u >= 1 ? 1 : 1 + 2.7 * Math.pow(u - 1, 3) + 1.7 * Math.pow(u - 1, 2);
      this.body.root.scale.setScalar(Math.max(0.001, s));
      tmp2.lerpVectors(this.foe, localCam, this.side === 0 ? 0.3 : 0.4);
      const want = Math.atan2(tmp2.x - this.group.position.x, tmp2.z - this.group.position.z);
      this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * (1 - Math.exp(-10 * dt));
      this.body.root.rotation.y = this.yaw + spin;
      // Procedural faint for models without a collapse clip: tip over sideways and settle.
      const tp = this.topple > 0 ? smooth(this.topple) : 0;
      this.body.root.rotation.z = tp * 1.35 * (this.side === 0 ? 1 : -1);
      this.body.root.position.y = PLATFORM_Y - tp * 0.08;
      if (!this.dissolving) this.body.setOpacity(this.uniforms.uAlpha.value);
      // The head follows the opponent.
      this.body.lookAt(this.dissolving || this.asleep ? null : foeWorld);
      this.body.update(dt);
    }

    // Afterimages trail the rush (the projection only).
    const moving = this.dashT < 1 && !reduced && !this.body;
    this.trail.unshift(this.center(this.trail.pop()!));
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
  static N = 36;
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
        void main() { vI = aI; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = mix(72.0, 10.0, aI) * uSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vI;
        void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * pow(1.0 - vI, 1.6); gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.62 + vI * 0.38) * 2.2 * a, 1.0); }`,
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
  private prev = new THREE.Vector3();
  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    this.prev.copy(this.head);
    const p = this.t;
    this.head.lerpVectors(this.from, this.to, p); this.head.y += Math.sin(p * Math.PI) * this.arc;
    // Several trail points per frame, spaced along the path: a fast orb covers ~0.1 m a frame, and one
    // point per frame left a row of dots instead of a tail.
    const steps = THREE.MathUtils.clamp(Math.ceil(this.prev.distanceTo(this.head) / 0.035), 1, Orb.N - 1);
    this.pos.copyWithin(steps * 3, 0, (Orb.N - steps) * 3);
    for (let k = 0; k < steps; k++) {
      const u = 1 - k / steps;
      this.pos[k * 3] = this.prev.x + (this.head.x - this.prev.x) * u;
      this.pos[k * 3 + 1] = this.prev.y + (this.head.y - this.prev.y) * u;
      this.pos[k * 3 + 2] = this.prev.z + (this.head.z - this.prev.z) * u;
    }
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
  private flashes: Flashes;
  /** Hazards and screens that stay on the field until the battle removes them. */
  readonly persist: FieldPersist;
  /** Weather that keeps falling until it ends (rain, sand, snow, harsh sun motes) and its spawn budget. */
  private weather: string | null = null;
  private weatherAcc = 0;
  /** Stage time until the current move animation has landed (the HUD steps aside until then). */
  private fxUntil = 0;
  /** Lightning ribbons, light flares, the wave, ground cracks and a smoke field (see makeFx). */
  private fx: ReturnType<BattleStage['makeFx']>;
  /** The camera's position in stage space, refreshed every update (equal to world space for the main stage). */
  private localCam = new THREE.Vector3();
  private foeWorld = new THREE.Vector3();
  /** World size of one stage unit: 1 for the arena, about 0.2 for the plaza's miniature. */
  readonly scale: number;
  /** A secondary stage (the plaza's miniature): no hit-stop and no camera, screen or zoom impulses. */
  readonly lite: boolean;
  private jobs: { at: number; fn: () => void }[] = [];
  private time = 0;
  private impactAt: [number, number] = [0, 0];
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

  constructor(private camera: THREE.Camera, private reduced: () => boolean, opts: { scale?: number; lite?: boolean } = {}) {
    this.scale = opts.scale ?? 1;
    this.lite = !!opts.lite;
    this.flashes = new Flashes(3, this.scale);
    this.fx = this.makeFx();
    this.holos = [new Hologram(0), new Hologram(1)];
    this.holos.forEach((h, i) => { h.place(ARENA.mon[i]); h.foe.copy(ARENA.mon[1 - i]); this.group.add(h.ballMesh); h.onOpen = s => this.ballOpened(s); });
    for (const h of this.holos) { this.group.add(h.group); for (const g of h.ghosts) this.group.add(g); }
    for (const o of this.orbs) this.group.add(o.mesh);
    for (const b of this.beams) this.group.add(b.mesh);
    this.group.add(this.particles.mesh, this.rings.group, this.slashes.group, this.debris.group, this.flashes.group);
    this.persist = new FieldPersist(() => [this.holos[0].height, this.holos[1].height], this.reduced);
    this.group.add(this.persist.group);
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
  private home(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, this.holos[side].cy, m.z); }
  /** Effect scale for a side: effects were tuned on 1.2-unit bodies; they shrink with smaller ones, a little less. */
  private fk(side: 0 | 1) { return THREE.MathUtils.clamp(0.3 + 0.7 * this.holos[side].height / 1.2, 0.5, 1.1); }
  /**
   * The particle field with sizes, speeds, swirl radii and heights scaled by k: effects sized to the
   * Pokémon they come from or land on.
   */
  private px(k: number): ScaledParticles {
    const P = this.particles;
    const sc = <T extends ParticleOpts>(o: T): T => ({ ...o, size: (o.size ?? 0.06) * k, sizeEnd: o.sizeEnd === undefined ? undefined : o.sizeEnd * k });
    return {
      emit: (p, v, o) => P.emit(p, v, sc(o)),
      emitter: (dur, rate, spawn) => P.emitter(dur, rate, spawn),
      burst: (at, n, speed, o) => P.burst(at, n, speed * k, sc(o)),
      swirl: (at, dur, o) => P.swirl(at, dur, { ...sc(o), radius: (o.radius ?? 0.7) * k, height: (o.height ?? 1.4) * k }),
      stream: (a, b, dur, o) => P.stream(a, b, dur, sc(o)),
      lightning: (a, b, dur, color, jitter = 0.28, density = 70) => P.lightning(a, b, dur, color, jitter * k, density),
    };
  }
  private foot(side: 0 | 1, out = new THREE.Vector3()) { const m = ARENA.mon[side]; return out.set(m.x, ARENA.floorY + 0.03, m.z); }
  private center(side: 0 | 1, out = new THREE.Vector3()) { return this.holos[side].center(out); }
  private orb() { return this.orbs.find(o => !o.busy) ?? this.orbs[0]; }
  private light(at: THREE.Vector3, color: string, peak = 8, dur = 0.45, follow: (() => THREE.Vector3) | null = null) { if (!this.reduced() && this.lightAmt > 0) this.flashes.fire(at, color, peak * this.lightAmt, dur, follow); }
  private ballistic(from: THREE.Vector3, to: THREE.Vector3, T: number, out = new THREE.Vector3()) { return out.subVectors(to, from).divideScalar(T).setY((to.y - from.y) / T + 4.9 * T); }
  private kickScreen(strength: number, color: string, flash = 0) {
    if (this.lite) return;
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
    this.morph.revert(side); // transform (ditto)
    // The battle's first send-outs (nobody on the field yet): both Pokémon are presented together.
    if (!instant && !this.holos[0].present && !this.holos[1].present) this.cam.openingStart();
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
    const f = this.foot(side), k = this.fk(side), P = this.px(k);
    P.burst(this.home(side).setY(ARENA.floorY + Math.min(0.4, this.holos[side].height * 0.5)), 50, 2.6, { color: '#ffffff', size: 0.07, ttl: 0.5, drag: 3 });
    P.burst(f, 40, 2.2, { color: tint, size: 0.06, ttl: 0.9, rise: 1.2, drag: 2 });
    this.rings.fire(f, tint, { flat: true, s0: 0.2 * k, s1: 1.4 * k, dur: 0.6 });
    this.light(this.home(side), '#ffffff', 14, 0.5);
  }
  /** The last Pokémon standing celebrates. */
  victory(side: 0 | 1) { this.holos[side].celebrate(); }
  // transform (ditto): Transform and Imposter morph a side into another species; transform.ts does the work.
  private morph = new TransformFx(this.group, () => this.reduced());
  transform(side: 0 | 1, artId: number, name: string, tint: string, instant: boolean, keep: { status?: string | null; tera?: TypeName | null } = {}) {
    const h = this.holos[side];
    this.morph.start(side, h, () => {
      void h.show(artId, name, tint, true);
      h.status(keep.status ? STATUS_HEX[keep.status] ?? null : null, keep.status === 'slp');
      if (keep.tera) h.tera(TYPE_HEX[keep.tera]);
    }, instant);
  }
  untransform(side: 0 | 1) { this.morph.revert(side); }
  // end transform (ditto)

  move(side: 0 | 1, move: string, type: TypeName, category: 'Physical' | 'Special' | 'Status', target: 0 | 1 | null) {
    const r = recipeFor(move, type, category);
    const color = r.color ?? TYPE_HEX[type];
    // Reduce flashing: dimmer light flares, lightning without strobing re-strike flashes.
    this.fx.flares.cap = this.calm ? 0.4 : 1; this.fx.bolts.calm = this.calm;
    const tgt: 0 | 1 = target === null || target === side ? (1 - side) as 0 | 1 : target;
    const selfMove = r.kind === 'self';
    const delay = impactDelay(r);
    // Wind-up first (the attacker's anticipation), then the effect; the damage line waits for both.
    const lead = windup(r);
    if (!selfMove && r.kind !== 'hazard' && r.kind !== 'field') this.impactAt[tgt] = this.time + lead + delay;
    // The health bars clear the view for the attack and come back as it lands, so the HP drop is seen.
    this.fxUntil = Math.max(this.fxUntil, this.time + lead + delay + (selfMove ? 0.35 : 0.1));
    const style = r.kind === 'dash' ? 'dash'
      : (r.kind === 'rain' && r.debris !== 'coin') || r.kind === 'quake' || r.kind === 'field' || r.kind === 'hazard' || r.kind === 'wave' ? 'field'
        : selfMove ? 'self' : 'projectile';
    const big = (r.kind === 'dash' && !!r.big) || (moveInfo(move)?.power ?? 0) >= 110;
    if (!this.reduced()) this.cam.attack(side, style, lead + delay, tgt, big);
    // Contact moves strike when the rush connects; everything else releases as the effect starts.
    this.holos[side].attack(r.kind === 'dash' ? 'contact' : selfMove ? 'self' : 'ranged', r.kind === 'dash' ? lead + delay : Math.max(0.25, lead));
    if (lead > 0 && r.kind !== 'dash' && !selfMove && !this.reduced()) this.charge(side, tgt, r, color, lead);
    if (lead > 0) this.later(lead, () => this.play(r, side, tgt, color, type)); else this.play(r, side, tgt, color, type);
  }

  /** Where ranged moves leave the attacker: chest height, a little toward the target. */
  private castPoint(s: 0 | 1, t: 0 | 1, out = new THREE.Vector3()) {
    const c = this.center(s, out), k = this.fk(s);
    const dir = tmp3.copy(this.home(t)).sub(this.home(s)).setY(0).normalize();
    return c.addScaledVector(dir, 0.32 * k).setY(c.y + 0.12 * k);
  }
  /** Anticipation: energy in the move's colour gathers at the cast point while the attacker winds up. */
  private charge(s: 0 | 1, t: 0 | 1, r: Recipe, color: string, dur: number) {
    const k = this.fk(s), P = this.px(k);
    const at = this.castPoint(s, t, new THREE.Vector3());
    if (r.kind === 'bolt' && !r.sky) {
      // Electricity crackles over the body before the bolt leaves it.
      const c = this.center(s);
      for (let i = 0; i < 3; i++) this.later(i * dur * 0.28, () => {
        const a = tmp.copy(c).add(tmp2.randomDirection().multiplyScalar(0.3 * k)), b = tmp3.copy(c).add(tmp2.randomDirection().multiplyScalar(0.34 * k));
        this.fx.bolts.fire(a, b, '#ffe45a', { dur: 0.16, jitter: 0.07 * k, width: 0.035 * k, restrike: 0.04 });
      });
      P.emitter(dur * 0.9, 90, () => P.emit(tmp.copy(c).add(tmp2.randomDirection().multiplyScalar(0.35 * k)), tmp2.randomDirection().multiplyScalar(1.2), { color: '#fff6b0', size: 0.03, sizeEnd: 0.01, ttl: 0.18 }));
    }
    P.emitter(dur * 0.9, 150, () => {
      const p = tmp.copy(at).add(tmp2.randomDirection().multiplyScalar((0.55 + Math.random() * 0.35) * k));
      P.emit(p, ZERO3, { color, size: 0.05, sizeEnd: 0.11, ttl: 0.34, drag: 1.2, home: { x: at.x, y: at.y, z: at.z, k: 6 } });
    });
    this.rings.fire(at, color, { s0: 0.9 * k, s1: 0.08 * k, dur: dur * 0.9 });
    this.later(dur * 0.55, () => P.burst(at, 10, 0.5, { color: '#ffffff', size: 0.1, sizeEnd: 0.02, ttl: 0.3, drag: 3 }));
    this.light(at, color, 7, dur + 0.15);
  }

  /** The smoke field (normal blending: shadowy wisps, dust, steam) with sizes and speeds scaled like px(k). */
  private sm(k: number): ScaledParticles {
    const S = this.fx.smoke;
    S.density = this.particles.density;
    const sc = <T extends ParticleOpts>(o: T): T => ({ ...o, size: (o.size ?? 0.06) * k, sizeEnd: o.sizeEnd === undefined ? undefined : o.sizeEnd * k });
    return {
      emit: (p, v, o) => S.emit(p, v, sc(o)),
      emitter: (dur, rate, spawn) => S.emitter(dur, rate, spawn),
      burst: (at, n, speed, o) => S.burst(at, n, speed * k, sc(o)),
      swirl: (at, dur, o) => S.swirl(at, dur, { ...sc(o), radius: (o.radius ?? 0.7) * k, height: (o.height ?? 1.4) * k }),
      stream: (a, b, dur, o) => S.stream(a, b, dur, sc(o)),
      lightning: (a, b, dur, color, jitter = 0.28, density = 70) => S.lightning(a, b, dur, color, jitter * k, density),
    };
  }
  /** Builds the pooled effects added with the move library; they ride on the particle field's update and clear. */
  private makeFx() {
    const smoke = new Particles({ smoke: true, max: 900 });
    smoke.mat.uniforms.uScale = this.particles.mat.uniforms.uScale; // follows setPixelScale
    const bolts = new Bolts(24); bolts.scale = this.scale;
    const fx = { smoke, bolts, flares: new Flares(6, () => this.camera), wave: new Wave(), cracks: new Cracks(3) };
    for (const part of [smoke, fx.bolts, fx.flares, fx.wave, fx.cracks]) this.particles.attach(part);
    this.group.add(smoke.mesh, fx.bolts.group, fx.flares.group, fx.wave.mesh, fx.wave.warm, fx.cracks.group);
    // The orb and beam pools are hidden while idle too: warm their composer variant on the first frame as well.
    this.group.add(warmTwin(this.orbs[0].mesh), warmTwin(this.beams[0].mesh));
    return fx;
  }
  /** Screen-plane axes of the camera right now (for shapes that must read on screen: the Fire Blast burst). */
  private screenAxes() {
    const q = this.camera.quaternion;
    return { right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q), back: new THREE.Vector3(0, 0, 1).applyQuaternion(q) };
  }
  /** Horizontal unit vector from one side's Pokémon toward the other's. */
  private across(s: 0 | 1, t: 0 | 1) { return new THREE.Vector3().subVectors(ARENA.mon[t], ARENA.mon[s]).setY(0).normalize(); }

  private play(r: Recipe, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    switch (r.kind) {
      case 'dash': this.playDash(r, s, t, color, type); break;
      case 'orb': if (r.moon) this.moonOrb(r, s, t, color, type); else if (r.tri) this.triOrbs(s, t); else this.playOrb(r, s, t, color, type); break;
      case 'stream': this.playStream(r, s, t, color, type); break;
      case 'wave': this.playWave(r, s, t, type); break;
      case 'beam': this.playBeam(r, s, t, color, type); break;
      case 'bolt': this.playBolt(r, s, t); break;
      case 'rings': if (r.lift) this.psychicLift(t, color, type); else this.playRings(r, s, t, color, type); break;
      case 'swirl': this.playSwirl(r, s, t, color); break;
      case 'rain': this.playRain(r, s, t, color, type); break;
      case 'quake': this.snd('quake', null); this.quakeAt(t, color, 1, this.home(s)); break;
      case 'erupt': if (r.style === 'stones') this.stoneEdge(t, type); else if (r.style === 'column') this.earthPower(t, type); else this.ruination(t, color, type); break;
      case 'flash': this.playFlash(r, s, t, color, type); break;
      case 'swap': this.playSwap(s, t); break;
      case 'chain': this.playChain(s, t, color, type); break;
      case 'self': this.selfFx(r.effect, s, color); break;
      case 'hazard': this.playHazard(r, s, t); break;
      case 'field': this.playField(r, color); break;
    }
  }

  /* ---------------- physical rushes */
  private playDash(r: Of<'dash'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), PA = this.px(kA), A = this.home(s), B = this.home(t);
    this.holos[s].dash(B, { fast: r.fast, spin: r.impact === 'spin', vanish: r.vanish });
    this.snd('dash', s);
    const delay = impactDelay(r);
    if (r.aura === 'blaze') {
      // Brave Bird: the user charges wrapped in blue-white flames that stream off its body.
      const fv = new THREE.Vector3();
      PA.emitter(delay + 0.05, 300, () => {
        const c = this.center(s, tmp).add(tmp2.randomDirection().multiplyScalar(0.32 * kA));
        PA.emit(c, tmp2.randomDirection().multiplyScalar(0.45).setY(0.7), { color: Math.random() < 0.3 ? '#ffffff' : Math.random() < 0.5 ? AURA_HEX.blaze : '#6fb4ff', size: 0.25, sizeEnd: 0.04, ttl: 0.3, drag: 1, alpha: 0.75 });
      });
      this.fx.flares.fire(A, '#9fd4ff', { core: '#ffffff', s0: 0.6 * kA, s1: 1.3 * kA, dur: delay + 0.05, rays: 10, sharp: 6, spin: 5, hold: 0.75, fadeIn: 0.15, peak: 0.55, follow: () => this.center(s, fv) });
      this.light(A, '#a8dcff', 12, delay + 0.25, () => this.center(s, fv));
    } else if (r.aura && r.aura !== 'none') {
      const ac = AURA_HEX[r.aura];
      PA.emitter(delay + 0.05, 160, () => {
        const c = this.center(s, tmp);
        PA.emit(c.add(tmp2.randomDirection().multiplyScalar(0.35 * kA)), tmp2.randomDirection().multiplyScalar(0.4), { color: ac, size: r.aura === 'electric' ? 0.04 : 0.09, sizeEnd: 0.02, ttl: 0.35, shape: r.aura === 'stars' ? Shape.Star : Shape.Glow, spin: 6 });
      });
      if (r.aura === 'electric') this.later(delay * 0.5, () => this.fx.bolts.fire(this.center(s), B, ac, { dur: 0.16, jitter: 0.14 * kA, width: 0.045 * kA }));
    }
    if (r.vanish) this.speedLines(s, t, delay);
    this.later(delay, () => this.contact(r, t, color, type));
    if (r.knock) this.later(delay + 0.03, () => this.knockItem(s, t));
    if (r.drain) this.later(delay + 0.2, () => { this.snd('heal', s, 0.7); this.px((kA + this.fk(t)) / 2).stream(this.home(t), this.home(s), 0.45, { color: '#7dffb0', size: 0.05, rate: 140, speed: 3.2, spread: 0.2 }); this.later(0.5, () => this.holos[s].heal()); });
  }
  /** Blink-fast rush: the user blurs into speed lines and a white afterglow along its path (Extreme Speed). */
  private speedLines(s: 0 | 1, t: 0 | 1, delay: number) {
    const kA = this.fk(s), A = this.home(s), B = this.home(t), dir = this.across(s, t), side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < 9; i++) this.later(delay * (0.04 + 0.85 * i / 9), () => {
      const off = side.clone().multiplyScalar((Math.random() - 0.5) * 0.8 * kA).setY((Math.random() - 0.35) * 0.7 * kA);
      this.fx.bolts.fire(A.clone().add(off).addScaledVector(dir, -0.35), B.clone().add(off).addScaledVector(dir, -0.45 * kA), '#e4ecff', { dur: 0.17, jitter: 0, width: 0.011 + 0.01 * Math.random(), taper: 0.9, grow: 0.07 });
    });
    const glow = Math.min(0.55, this.holos[s].height * 0.5);
    this.particles.emitter(delay, 150, () => this.particles.emit(this.center(s, tmp).add(tmp2.randomDirection().multiplyScalar(0.1 * kA)), ZERO3, { color: '#eef4ff', size: glow, sizeEnd: 0.03, ttl: 0.2, alpha: 0.35 }));
  }
  /** Knock Off: the target's held item is swatted away, tumbling off the field with a glint. */
  private knockItem(s: 0 | 1, t: 0 | 1) {
    const kB = this.fk(t), PB = this.px(kB), from = this.center(t), dir = this.across(s, t);
    const to = from.clone().addScaledVector(dir, 0.9 * kB).addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), (Math.random() < 0.5 ? -1 : 1) * 0.8 * kB).setY(ARENA.floorY + 0.1);
    const o = this.orb();
    o.fire(from, to, '#ffe9a8', { dur: 0.6, arc: 0.9 * kB, size: 0.6 * kB }, () => { PB.burst(to, 12, 1.2, { color: '#fff3c4', shape: Shape.Star, size: 0.08, ttl: 0.5, spin: 4 }); this.snd('coins', t, 0.4); });
    PB.emitter(0.55, 60, () => PB.emit(o.head, tmp2.randomDirection().multiplyScalar(0.2), { color: '#fff1b8', shape: Shape.Star, size: 0.07, sizeEnd: 0.02, ttl: 0.35, spin: 5 }));
    this.fx.flares.fire(from, '#fff0c0', { s0: 0.1, s1: 0.7 * kB, dur: 0.25, rays: 4, sharp: 20, peak: 0.9 });
  }

  /** Physical contact: the hit itself, flavoured by impact style and aura, sized to the target. */
  private contact(r: Of<'dash'>, t: 0 | 1, color: string, type?: TypeName) {
    const B = this.center(t), k = this.fk(t), P = this.px(k);
    const big = !!r.big;
    this.snd(r.impact === 'slash' || r.impact === 'spin' ? 'slash' : r.impact === 'bite' ? 'bite' : r.impact === 'quake' ? 'meteorHit' : 'punch', t, big ? 1.2 : 1);
    if (r.aura === 'fire' || r.aura === 'blaze') this.snd('fire', t, 0.5); else if (r.aura === 'water') this.snd('water', t, 0.5); else if (r.aura === 'electric') this.snd('zap', t, 0.6);
    switch (r.impact) {
      case 'slash': this.slashes.fire(B, color, big ? 3 : 2, (big ? 1 : 0.8) * k); break;
      case 'bite': this.slashes.fire(B, color, 2, 0.6 * k); break;
      case 'slap':
        // A dark, open-handed swat: one wide sweep, a smack ring and a puff of shadow.
        this.slashes.fire(B, '#6a3fb0', 1, 1.15 * k); this.slashes.fire(B, '#c9a8ff', 1, 0.75 * k);
        this.rings.fire(B, '#d9c8ff', { s0: 0.1 * k, s1: 0.95 * k, dur: 0.24 });
        this.sm(k).burst(B, 18, 1.3, { color: '#170b22', size: 0.24, sizeEnd: 0.46, ttl: 0.6, drag: 3, alpha: 0.75 });
        this.kickScreen(0.3, '#ffffff');
        break;
      case 'punch': this.rings.fire(B, '#ffffff', { s0: 0.1 * k, s1: (big ? 1.3 : 0.9) * k, dur: 0.3 }); this.rings.fire(B, color, { s0: 0.1 * k, s1: (big ? 1.7 : 1.2) * k, dur: 0.42, delay: 0.04 }); break;
      case 'spin': this.rings.fire(this.foot(t), color, { flat: true, s0: 0.2 * k, s1: 1.4 * k, dur: 0.4 }); this.slashes.fire(B, color, 2, 0.7 * k); break;
      case 'quake': this.quakeAt(t, color, big ? 0.8 : 0.5); break;
      case 'flurry':
        for (let i = 0; i < 5; i++) this.later(i * 0.075, () => {
          if (i) this.snd('punch', t, 0.6);
          const at = tmp.copy(B).add(tmp2.set((Math.random() - 0.5) * 0.6 * k, (Math.random() - 0.5) * 0.5 * k, 0.1 * k)).clone();
          this.rings.fire(at, i % 2 ? '#ffffff' : color, { s0: 0.05 * k, s1: 0.55 * k, dur: 0.22 });
          P.burst(at, 8, 2, { color, size: 0.05, ttl: 0.35 });
        });
        break;
      default: break;
    }
    if (r.aura === 'water') P.burst(B, 40, 3, { color: '#7fc1ff', size: 0.06, ttl: 0.8, gravity: 7, rise: 0.6 });
    if (r.aura === 'fire') P.burst(B, 34, 2.4, { color: '#ff8a2a', size: 0.1, sizeEnd: 0.03, ttl: 0.6, rise: 0.8 });
    if (r.aura === 'blaze') {
      P.burst(B, 46, 2.8, { color: '#bfe6ff', size: 0.14, sizeEnd: 0.03, ttl: 0.6, rise: 0.5, drag: 1.5 });
      this.fx.flares.fire(B, '#a8dcff', { core: '#ffffff', s0: 0.3 * k, s1: 1.8 * k, dur: 0.35, rays: 10, sharp: 8, peak: 0.9 });
    }
    if (r.aura === 'electric') this.fx.bolts.fire(B.clone().add(tmp2.set(-0.4 * k, 0.5 * k, 0)), B.clone().add(tmp2.set(0.4 * k, -0.4 * k, 0)), '#fff5b0', { dur: 0.2, jitter: 0.12 * k, width: 0.05 * k, branches: 1 });
    if (r.aura === 'ice') for (let i = 0; i < 6; i++) this.debris.throw('shard', B, tmp.randomDirection().multiplyScalar(2 * k).setY(2.5 * k), 0.06 * k, { ttl: 0.9 });
    if (r.aura === 'stars') P.burst(B, 24, 2.2, { color: '#ffc4ea', shape: Shape.Star, size: 0.12, ttl: 0.7, spin: 4 });
    // Play Rough: the classic brawl cloud of dust the two tumble around in.
    if (r.aura === 'stars' && r.impact === 'flurry') this.sm(k).burst(B, 16, 1, { color: '#ffe0ef', size: 0.3, sizeEnd: 0.55, ttl: 0.75, drag: 2.5, alpha: 0.4 });
    if (r.aura === 'ghost') P.burst(B, 26, 1.6, { color: '#9a6bff', size: 0.1, sizeEnd: 0.02, ttl: 0.8, rise: 1 });
    if (r.aura === 'bug') P.burst(B, 20, 2.2, { color: AURA_HEX.bug, size: 0.06, sizeEnd: 0.01, ttl: 0.45, drag: 2 });
    if (r.vanish) {
      this.fx.flares.fire(B, '#e8f0ff', { s0: 0.2 * k, s1: 1.3 * k, dur: 0.28, rays: 6, sharp: 18, peak: 0.9 });
      this.rings.fire(B, '#ffffff', { s0: 0.1 * k, s1: 1.2 * k, dur: 0.25 });
    }
    this.impactBurst(B, color, big ? 1.1 : 0.7, type, k);
  }

  /* ---------------- projectiles */
  private playOrb(r: Of<'orb'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PM = this.px(kM), PB = this.px(kB);
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t);
    const n = r.count ?? 1, size = r.size ?? 1;
    for (let i = 0; i < n; i++) this.later(i * 0.09, () => {
      const to = n > 1 ? B.clone().add(tmp2.set((Math.random() - 0.5) * 0.4 * kB, (Math.random() - 0.5) * 0.3 * kB, 0)) : B.clone();
      if (r.shards) {
        this.snd('slash', s, 0.6);
        this.debris.throw('shard', A.clone(), this.ballistic(A, to, 0.5), 0.09 * kM, { ttl: 0.5, groundY: -5 });
        this.later(0.5, () => this.impactBurst(to, color, 0.6, type, kB));
        return;
      }
      const o = this.orb();
      this.snd('orb', s, n > 1 ? 0.5 : 1);
      // A dark orb only borrows the Orb's flight path; its look is the shell and smoke below.
      o.fire(A, to, r.seeds ? '#9cff6a' : color, { dur: 0.55, arc: (r.arc ?? 0.3) * kM, size: r.dark ? 0.001 : size * kM }, () => {
        this.snd('orbHit', t, n > 1 ? 0.5 : 1);
        this.impactBurst(to, color, Math.min(1.4, 0.5 + size * 0.4), type, kB);
        if (r.splash) PB.burst(to, 30, 2.5, { color, size: 0.08, ttl: 0.8, gravity: 6, rise: 0.8 });
        if (r.star) this.rings.fire(to, color, { s0: 0.2 * kB, s1: 1.2 * kB, dur: 0.45 });
        if (r.dark) {
          this.sm(kB).burst(to, 20, 1.6, { color: '#120818', size: 0.24, sizeEnd: 0.5, ttl: 0.7, drag: 2.5, alpha: 0.8 });
          this.rings.fire(to, '#8a4dff', { s0: 0.15 * kB, s1: 1.4 * kB, dur: 0.45 });
        }
        if (r.glow) {
          this.rings.fire(to, '#bfe2ff', { s0: 0.15 * kB, s1: 1.3 * kB, dur: 0.4 });
          this.fx.flares.fire(to, color, { core: '#ffffff', s0: 0.3 * kB, s1: 1.6 * kB, dur: 0.3, rays: 8, sharp: 10, peak: 0.8 });
        }
      });
      if (i === 0) this.light(A, color, 8, 0.6, () => o.head);
      const trail = r.seeds ? '#9cff6a' : r.dark ? '#6a35c0' : color, ts = Math.min(0.2, 0.08 + size * 0.05) * (r.dark ? 0.6 : 1);
      PM.emitter(0.52, r.dark ? 50 : n > 1 ? 70 : 150, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.22), { color: trail, size: ts, sizeEnd: 0.015, ttl: 0.32, drag: 2.5 }));
      if (r.star) PM.emitter(0.55, 70, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.3), { color, shape: Shape.Star, size: 0.09, ttl: 0.5, spin: 3 }));
      if (r.dark) {
        // Shadow Ball: a black core inside a purple shell, shedding black wisps.
        const SM = this.sm(1), D = 0.72 * kM * size / 1.7;
        this.fx.flares.fire(A, '#8f4dff', { core: '#d9bcff', mode: 2, s0: D * 0.5, s1: D, dur: 0.56, hold: 0.92, fadeIn: 0.12, follow: () => o.head });
        // One core puff per frame, moving with the orb so the core stays solid instead of smearing into a tail.
        const last = A.clone(), vel = new THREE.Vector3();
        this.particles.ticker(0.55, (_u, dt) => {
          if (dt > 0) vel.subVectors(o.head, last).divideScalar(dt);
          last.copy(o.head);
          SM.emit(o.head, vel, { color: '#040108', size: D * 0.44, sizeEnd: D * 0.4, ttl: 0.12, alpha: 0.95 });
        });
        SM.emitter(0.55, 90, () => SM.emit(tmp.copy(o.head).add(tmp2.randomDirection().multiplyScalar(0.06 * kM)), tmp2.randomDirection().multiplyScalar(0.3).setY(0.15), { color: '#150822', size: 0.08 * kM, sizeEnd: 0.26 * kM, ttl: 0.5, drag: 2, alpha: 0.65 }));
      }
      if (r.glow) PM.emitter(0.55, 90, () => PM.emit(tmp.copy(o.head).add(tmp2.randomDirection().multiplyScalar(0.1 * kM)), tmp2.randomDirection().multiplyScalar(0.25), { color: '#9fd0ff', size: 0.16, sizeEnd: 0.04, ttl: 0.25, alpha: 0.6 }));
    });
    if (r.drain) this.later(impactDelay(r) + 0.15, () => { PM.stream(B, this.home(s), 0.45, { color: '#ff9bd2', size: 0.05, rate: 140, speed: 3.2, spread: 0.2 }); this.later(0.5, () => this.holos[s].heal()); });
  }
  /** Moonblast: a pink moon rises over the user, drinks in light, then fires its orb. */
  private moonOrb(r: Of<'orb'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PA = this.px(kA), A = this.home(s), B = this.home(t);
    const moon = A.clone().addScaledVector(this.across(s, t), 0.3 * kA).setY(A.y + 0.55 * kA + 0.3);
    this.snd('beamCharge', s, 0.7);
    this.fx.flares.fire(moon, '#ff5fb8', { core: '#ff9ad2', mode: 1, s0: 0.05, s1: 0.75 * kA, dur: 0.6, hold: 0.62, fadeIn: 0.3, peak: 0.85 });
    this.fx.flares.fire(moon, '#ff7ac8', { s0: 0.5 * kA, s1: 1.5 * kA, dur: 0.6, rays: 14, sharp: 22, spin: 0.5, hold: 0.55, fadeIn: 0.4, peak: 0.22 });
    PA.emitter(0.36, 140, () => {
      const p = tmp.copy(moon).add(tmp2.randomDirection().multiplyScalar(0.9 * kA));
      PA.emit(p, ZERO3, { color: Math.random() < 0.5 ? '#ffd6f0' : '#ffffff', shape: Shape.Star, size: 0.06, sizeEnd: 0.02, ttl: 0.32, spin: 4, home: { x: moon.x, y: moon.y, z: moon.z, k: 7 } });
    });
    this.light(moon, '#ff9fd8', 9, 0.8);
    this.later(0.38, () => {
      const o = this.orb(), PM = this.px(kM);
      this.snd('orb', s);
      o.fire(moon, B, color, { dur: 0.44, arc: 0.1 * kM, size: (r.size ?? 2) * kM }, () => {
        this.snd('orbHit', t);
        this.impactBurst(B, color, 1.2, type, kB);
        this.rings.fire(B, '#ffd1ee', { s0: 0.2 * kB, s1: 1.3 * kB, dur: 0.45 });
        this.fx.flares.fire(B, '#ff9fd8', { core: '#ffffff', s0: 0.3 * kB, s1: 1.7 * kB, dur: 0.35, rays: 8, sharp: 10, peak: 0.85 });
      });
      PM.emitter(0.42, 150, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.22), { color, size: 0.18, sizeEnd: 0.015, ttl: 0.32, drag: 2.5 }));
      PM.emitter(0.42, 70, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.3), { color: '#ffe0f4', shape: Shape.Star, size: 0.09, ttl: 0.5, spin: 3 }));
      this.light(moon, color, 8, 0.6, () => o.head);
    });
  }
  /** Tri Attack: fire, ice and electric orbs fly in a triangle and each bursts in its own element. */
  private triOrbs(s: 0 | 1, t: 0 | 1) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PM = this.px(kM);
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t), { right, up } = this.screenAxes();
    const cols = ['#ff5a2a', '#5fd2ff', '#ffe03a'], types: TypeName[] = ['Fire', 'Ice', 'Electric'];
    this.snd('orb', s);
    this.rings.fire(A, '#ffffff', { s0: 0.1 * kA, s1: 0.5 * kA, dur: 0.25 });
    for (let i = 0; i < 3; i++) {
      const ang = Math.PI / 2 + i * Math.PI * 2 / 3;
      const off = right.clone().multiplyScalar(Math.cos(ang) * 0.32 * kA).addScaledVector(up, Math.sin(ang) * 0.32 * kA);
      const from = A.clone().add(off), to = B.clone().addScaledVector(off, 0.55 * kB / kA);
      const o = this.orb();
      o.fire(from, to, cols[i], { dur: 0.6, arc: 0.12 * kM, size: kM }, () => {
        this.snd(i === 0 ? 'fire' : i === 1 ? 'orbHit' : 'zap', t, 0.6);
        this.impactBurst(to, cols[i], 0.6, types[i], kB);
      });
      PM.emitter(0.58, 110, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.2), { color: cols[i], size: 0.12, sizeEnd: 0.015, ttl: 0.3, drag: 2.5 }));
      if (i === 0) this.light(A, '#ffffff', 8, 0.6, () => o.head);
    }
  }

  private playStream(r: Of<'stream'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PM = this.px(kM);
    const A = r.reverse ? this.home(s) : this.castPoint(s, t, new THREE.Vector3()), B = this.home(t);
    const from = r.reverse ? B : A, to = r.reverse ? A : B;
    const look = r.shape === 'fire' ? { color: '#ff7a22', size: 0.1, sizeEnd: 0.34, shape: Shape.Glow, spread: 0.1 }
      : r.shape === 'water' ? { color: '#6fb6ff', size: 0.08, sizeEnd: 0.16, shape: Shape.Glow, spread: 0.06 }
        : r.shape === 'leaf' ? { color: '#7dff8a', size: 0.08, sizeEnd: 0.05, shape: Shape.Leaf, spread: 0.18, spin: 9 }
          : { color, size: 0.08, sizeEnd: 0.12, shape: Shape.Glow, spread: 0.1 };
    if (r.swirlSelf) this.px(kA).swirl(this.home(s), 0.6, { color: '#ffb347', radius: 0.6, height: 1.6, rate: 160, size: 0.07, ttl: 0.7 });
    this.later(r.swirlSelf ? 0.2 : 0, () => {
      this.snd(r.shape === 'fire' ? 'fire' : r.shape === 'leaf' ? 'leaves' : 'water', s);
      if (r.blast) {
        // Fire Blast: a roaring fireball flies at the target (it bursts into a five-armed flame on impact).
        const o = this.orb();
        o.fire(A, B, '#ff7a22', { dur: impactDelay(r) - 0.02, arc: 0.12 * kM, size: 2.4 * kM }, () => { /* fireBlast() */ });
        PM.emitter(impactDelay(r) - 0.04, 260, () => PM.emit(tmp.copy(o.head).add(tmp2.randomDirection().multiplyScalar(0.06 * kM)), tmp2.randomDirection().multiplyScalar(0.35), { color: Math.random() < 0.3 ? '#fff0a0' : '#ff6a1f', size: 0.2, sizeEnd: 0.04, ttl: 0.28, drag: 2 }));
        this.light(A, '#ff7a22', 10, 0.6, () => o.head);
      } else if (r.twin) {
        // Hydro Pump: two high-pressure jets side by side, white at the core, converging on the target.
        const d = this.across(s, t), side = new THREE.Vector3(-d.z, 0, d.x);
        for (const sg of [-1, 1]) {
          const f = A.clone().addScaledVector(side, sg * 0.11 * kA), e = B.clone().addScaledVector(side, sg * 0.04 * kB);
          this.fx.bolts.fire(f, e, '#3f8dff', { core: '#eaf6ff', dur: 0.75, jitter: 0.012, width: 0.07 * kM, taper: 0.1, restrike: 0.04, grow: impactDelay(r) - 0.06 });
          PM.stream(f, e, 0.62, { color: '#4f9dff', size: 0.08, sizeEnd: 0.2, rate: 220, speed: 8, spread: 0.04 });
        }
      } else {
        PM.stream(from, to, 0.6, { ...look, rate: r.big ? 460 : 300, speed: r.reverse ? 3.6 : 6, arc: r.arc, ttl: 0.6 });
        if (r.shape === 'fire') PM.stream(from, to, 0.6, { color: '#fff2a8', size: 0.06, sizeEnd: 0.16, rate: 140, speed: 6.5, spread: 0.05 });
        if (r.shape === 'water') PM.stream(from, to, 0.6, { color: '#e8f6ff', size: 0.04, sizeEnd: 0.08, rate: 160, speed: 7, spread: 0.03 });
      }
      if (r.steam) {
        // Scald: steam boils off along the hot jet.
        const SM = this.sm(kM);
        SM.emitter(0.75, 90, u => {
          const q = Math.random() * Math.min(1, 0.25 + u * 1.4);
          SM.emit(tmp.lerpVectors(from, to, q).add(tmp2.randomDirection().multiplyScalar(0.08 * kM)), tmp2.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3), { color: '#f2f6fb', size: 0.16, sizeEnd: 0.45, ttl: 0.9, drag: 1.2, alpha: 0.5 });
        });
      }
      if (r.rings) for (let i = 0; i < 3; i++) this.rings.fire(from, look.color, { to, s0: 0.25 * kM, s1: 0.7 * kM, dur: 0.5, delay: i * 0.12 });
      this.light(from, look.color, 10, 0.8);
      this.later(0.35, () => this.light(to, look.color, 12, 0.6));
    });
    if (!r.reverse) this.later(impactDelay(r), () => {
      if (r.blast) this.fireBlast(t); else this.impactBurst(B, look.color, r.big ? 1.2 : 0.8, type, kB);
      if (r.steam) this.sm(kB).burst(B, 16, 0.9, { color: '#eef4fa', size: 0.2, sizeEnd: 0.55, ttl: 1.0, drag: 2, rise: 0.6, alpha: 0.4 });
    });
    else this.later(0.75, () => this.holos[s].heal());
  }
  /** Fire Blast's signature: flame bursting out in five arms over the target. */
  private fireBlast(t: 0 | 1) {
    const k = this.fk(t), P = this.particles, { right, up, back } = this.screenAxes();
    // Head, both arms (slightly raised) and both legs, laid out on the screen plane.
    const arms = [90, 10, 170, 238, 302].map(d => { const a = d * Math.PI / 180; return right.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)); });
    const L = 0.75 * k, origin = this.center(t).addScaledVector(back, 0.3 * k);
    this.snd('fire', t, 1.2);
    // Five flame strokes shoot out of the hit (crisp ribbons with a white-hot core)...
    for (const arm of arms) this.fx.bolts.fire(origin, tmp.copy(origin).addScaledVector(arm, L), '#ff4a10', { core: '#ffc860', dur: 0.55, jitter: 0.05 * k, width: 0.16 * k, taper: 0.5, restrike: 0.05, grow: 0.1 });
    // ...wrapped in licking flames along each arm.
    P.emitter(0.38, 700, u => {
      const i = Math.floor(Math.random() * 5), reach = L * Math.min(1, 0.25 + u * 4), d = L * 0.08 + Math.random() * (reach - L * 0.08);
      const p = tmp.copy(origin).addScaledVector(arms[i], d).add(tmp2.randomDirection().multiplyScalar(0.03 * k));
      const c = Math.random();
      P.emit(p, tmp2.copy(arms[i]).multiplyScalar(0.25 * k).addScaledVector(up, 0.35 * k), { color: c < 0.2 ? '#ffc04a' : c < 0.65 ? '#ff5a14' : '#d8300a', size: 0.17 * k * (1 - 0.4 * d / L), sizeEnd: 0.07 * k, ttl: 0.24 + Math.random() * 0.14 });
    });
    this.px(k).burst(origin, 14, 1.2, { color: '#ffc04a', size: 0.08, sizeEnd: 0.015, ttl: 0.9, gravity: -2, drag: 1.6 });
    this.light(origin, '#ff6a1f', 9, 0.6);
    this.shake = Math.max(this.shake, 0.5);
    this.kickScreen(0.35, '#ff9a4a', 0.06);
  }

  /** Surf / Sludge Wave: a wave rises behind the user and sweeps across the field over the target. */
  private playWave(r: Of<'wave'>, s: 0 | 1, t: 0 | 1, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PM = this.px(kM);
    const sludge = r.shape === 'sludge', dir = this.across(s, t), fb = this.foot(t);
    const start = this.foot(s).addScaledVector(dir, -0.7);
    const H = Math.max(1.0, 1.3 * Math.max(this.holos[s].height, this.holos[t].height) + 0.25);
    const hit = impactDelay(r);
    const look = sludge ? { deep: '#3a0f5c', mid: '#8a3fd1', foam: '#e2b8ff', spray: '#cf8cff' } : { deep: '#0e3f9e', mid: '#3d9bff', foam: '#eaf7ff', spray: '#d8f0ff' };
    const wave = this.fx.wave, crest = new THREE.Vector3(), lit = new THREE.Vector3();
    wave.fire(start, fb, { width: 2.5 * Math.max(0.85, kM), height: H, deep: look.deep, mid: look.mid, foam: look.foam, dur: 1.35, rise: 0.3, hitAt: hit });
    this.snd('water', s, 1.1);
    PM.emitter(1.1, 260, u => {
      if (u > 0.85) return;
      wave.crest(0.1 + Math.random() * 0.8, crest);
      PM.emit(crest, tmp2.copy(dir).multiplyScalar(1.6 + Math.random()).add(tmp.randomDirection().multiplyScalar(0.6)).setY(0.6 + Math.random() * 1.2), { color: look.spray, size: 0.08, sizeEnd: 0.02, ttl: 0.6, gravity: 5, alpha: 0.8 });
    });
    if (sludge) PM.emitter(1.0, 60, () => { wave.crest(0.15 + Math.random() * 0.7, crest); PM.emit(crest.setY(ARENA.floorY + (crest.y - ARENA.floorY) * (0.3 + Math.random() * 0.6)), tmp2.set(0, 0.4, 0), { color: '#d9a2ff', shape: Shape.Ring, size: 0.1, sizeEnd: 0.14, ttl: 0.5 }); });
    // Fine mist thrown off the crest.
    PM.emitter(0.9, 70, () => { wave.crest(0.1 + Math.random() * 0.8, crest); PM.emit(crest, tmp2.copy(dir).multiplyScalar(0.6).setY(0.35), { color: look.foam, size: 0.2, sizeEnd: 0.45, ttl: 0.5, drag: 1.5, alpha: 0.12 }); });
    this.light(start.clone().setY(H * 0.6), look.mid, 9, 1.3, () => wave.crest(0.5, lit));
    this.later(hit, () => {
      const B = this.home(t);
      this.snd('water', t, 1);
      this.impactBurst(B, look.mid, 1.2, sludge ? 'Poison' : type, kB);
      this.px(kB).burst(B, 50, 3.4, { color: look.spray, size: 0.08, ttl: 0.9, gravity: 7, rise: 0.8 });
      this.shake = Math.max(this.shake, 0.45);
    });
  }

  private playBeam(r: Of<'beam'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2;
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t);
    this.rings.fire(A, color, { s0: 1.1 * kA, s1: 0.1 * kA, dur: 0.22 });
    this.snd('beamCharge', s);
    this.later(0.12, () => {
      this.snd('beam', s);
      this.beams[s].fire(A, B, color, 0.75, (r.width ?? 0.12) * kM);
      this.fx.flares.fire(A, color, { core: '#ffffff', s0: 0.2 * kA, s1: 0.8 * kA, dur: 0.6, rays: 6, sharp: 14, spin: 2, hold: 0.7, peak: 0.6 });
      this.light(A, color, 10, 0.8); this.light(B, color, 14, 0.8);
      this.kickScreen(0.25, color, 0.05);
      if (type === 'Ice') {
        // Ice crystals freeze out of the air along the beam.
        const PM = this.px(kM);
        PM.emitter(0.55, 110, () => PM.emit(tmp.lerpVectors(A, B, Math.random()).add(tmp2.randomDirection().multiplyScalar(0.07 * kM)), tmp2.randomDirection().multiplyScalar(0.15), { color: '#dff8ff', shape: Shape.Flake, size: 0.08, sizeEnd: 0.05, ttl: 0.55, spin: 2 }));
      }
    });
    this.later(impactDelay(r), () => {
      this.impactBurst(B, color, 1, type, kB);
      if (r.shards) for (let i = 0; i < 7; i++) this.debris.throw('shard', B, tmp.randomDirection().multiplyScalar(2.2 * kB).setY((2 + Math.random() * 2) * kB), 0.07 * kB, { ttl: 1 });
    });
  }

  private playBolt(r: Of<'bolt'>, s: 0 | 1, t: 0 | 1) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2;
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t), delay = impactDelay(r), bolts = this.fx.bolts;
    if (r.sky) {
      // Thunderclap: a split-second strike out of the sky onto the target.
      const sky = B.clone().add(tmp2.set(0.25, 4.8, -0.7));
      this.light(B.clone().setY(3.2), '#fff4b0', 8, 0.3);
      this.later(delay - 0.07, () => {
        bolts.fire(sky, B, '#fff3a0', { dur: 0.32, jitter: 0.55, width: 0.12 * kB, taper: 0.2, restrike: 0.05, branches: 3, grow: 0.07 });
        bolts.fire(sky.clone().add(tmp2.set(-0.3, 0, 0.2)), B, '#ffe45a', { dur: 0.22, jitter: 0.45, width: 0.06 * kB, delay: 0.05, grow: 0.05 });
      });
      this.snd('zap', t, 1);
    } else if (r.small) {
      // Thunder Wave: a thin jolt, then static crackling over the target.
      bolts.fire(A, B, '#fff5b0', { dur: 0.24, jitter: 0.1 * kM, width: 0.035 * kM, grow: delay * 0.8 });
      for (let i = 0; i < 4; i++) this.later(delay + i * 0.09, () => {
        const c = this.home(t);
        bolts.fire(c.clone().add(tmp2.randomDirection().multiplyScalar(0.35 * kB)), c.clone().add(tmp2.randomDirection().multiplyScalar(0.4 * kB)), '#ffe45a', { dur: 0.14, jitter: 0.08 * kB, width: 0.03 * kB });
      });
      this.snd('zap', t, 0.6);
    } else {
      // Thunderbolt / Volt Switch: jagged bolts leave the user's body and arc onto the target.
      const fv = new THREE.Vector3(), src = () => this.castPoint(s, t, fv);
      bolts.fire(A, B, '#fff3a0', { dur: 0.5, jitter: 0.26 * kM, arc: 0.08, width: 0.055 * kM, restrike: 0.055, branches: 2, grow: delay - 0.02, follow: src });
      bolts.fire(A, B, '#ffe45a', { dur: 0.42, jitter: 0.22 * kM, arc: 0.16, bow: 0.12, width: 0.032 * kM, restrike: 0.07, grow: delay, delay: 0.03, follow: src });
      if (!r.uturn) bolts.fire(A, B, '#ffe45a', { dur: 0.38, jitter: 0.22 * kM, arc: 0.12, bow: -0.14, width: 0.03 * kM, restrike: 0.07, grow: delay, delay: 0.05, follow: src });
      this.snd('zap', s, 0.9);
    }
    this.later(delay, () => {
      this.light(B, '#ffe45a', 15, 0.45);
      this.fx.flares.fire(B, '#ffe45a', { core: '#ffffff', s0: 0.3 * kB, s1: (r.small ? 0.8 : 1.3) * kB, dur: 0.26, rays: 8, sharp: 14, peak: r.small ? 0.4 : 0.6 });
      this.kickScreen(0.2, '#fff4b0', r.small ? 0.04 : 0.12);
      this.impactBurst(B, '#ffe45a', r.small ? 0.5 : 0.9, 'Electric', kB);
    });
  }

  private playRings(r: Of<'rings'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2;
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t);
    if (r.travel) for (let i = 0; i < 4; i++) this.rings.fire(A, color, { to: B, s0: 0.2 * kM, s1: 0.95 * kM, dur: 0.55, delay: i * 0.08 });
    else if (r.both) for (const x of [s, t] as const) { const k = this.fk(x); for (let i = 0; i < 2; i++) this.rings.fire(this.home(x), color, { s0: 0.1 * k, s1: 1.1 * k, dur: 0.5, delay: i * 0.12 }); }
    else for (let i = 0; i < 3; i++) this.rings.fire(B, color, { s0: 1.4 * kB, s1: 0.2 * kB, dur: 0.4, delay: i * 0.1 });
    this.snd('rings', r.travel ? s : t);
    if (r.distort) { this.later(0.15, () => this.holos[t].distort(1)); this.kickScreen(0.35, color, 0.05); }
    if (r.travel && type === 'Dark') {
      // Dark Pulse: shadow churns along the rings.
      const SM = this.sm(kM);
      SM.emitter(0.5, 60, u => SM.emit(tmp.lerpVectors(A, B, Math.min(1, u * 1.1)).add(tmp2.randomDirection().multiplyScalar(0.25 * kM)), tmp2.randomDirection().multiplyScalar(0.2), { color: '#1a0d26', size: 0.18, sizeEnd: 0.4, ttl: 0.6, drag: 2, alpha: 0.5 }));
    }
    this.light(r.travel ? A : B, color, 9, 0.7);
    if (r.travel) this.later(impactDelay(r), () => this.impactBurst(B, color, 0.7, type, kB));
  }
  /** Psychic: the target is caught in pink distortion, lifted and twisted, then dropped. */
  private psychicLift(t: 0 | 1, color: string, type: TypeName) {
    const kB = this.fk(t), PB = this.px(kB), h = this.holos[t], B = this.home(t), hit = 0.55;
    this.snd('rings', t);
    for (let i = 0; i < 4; i++) this.rings.fire(B, i % 2 ? '#ffc2f0' : color, { s0: 1.5 * kB, s1: 0.25 * kB, dur: 0.38, delay: i * 0.11 });
    PB.swirl(B, 0.75, { color: '#ff8ae0', size: 0.09, sizeEnd: 0.03, radius: 0.6, height: 1.4, rate: 160, w: 7, ttl: 0.6, inward: true });
    PB.emitter(0.7, 50, () => PB.emit(tmp.copy(B).add(tmp2.randomDirection().multiplyScalar(0.45 * kB)), ZERO3, { color: '#ff5ec4', size: 0.45, sizeEnd: 0.7, ttl: 0.4, alpha: 0.18 }));
    this.fx.flares.fire(B, '#ff5e9c', { core: '#ffd1ef', s0: 0.6 * kB, s1: 1.6 * kB, dur: 0.85, rays: 0, sharp: 1, hold: 0.6, fadeIn: 0.3, peak: 0.35 });
    h.pulse('#ff7ad9', 0.6);
    this.later(0.15, () => h.distort(1));
    if (!this.reduced()) {
      const lift = 0.3 * kB;
      this.particles.ticker(0.95, u => {
        // Up over the first third, twisting; dropped as the hit lands (u = 0.58).
        const up = smooth(Math.min(1, u / 0.3)) * (u < 0.58 ? 1 : 1 - smooth(Math.min(1, (u - 0.58) / 0.12)));
        h.group.position.y += lift * up;
        h.group.rotation.set(Math.sin(u * 17) * 0.1 * up, Math.sin(u * 11) * 0.45 * up, Math.sin(u * 13 + 1) * 0.14 * up);
        if (u >= 1) h.group.rotation.set(0, 0, 0);
      });
    }
    this.light(B, color, 9, 0.9);
    this.kickScreen(0.35, color, 0.05);
    this.later(hit, () => { this.impactBurst(B, color, 0.9, type, kB); this.shake = Math.max(this.shake, 0.35); });
  }

  private playSwirl(r: Of<'swirl'>, s: 0 | 1, t: 0 | 1, color: string) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PB = this.px(kB), PM = this.px(kM);
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t);
    this.snd(r.shape === 'wind' ? 'wind' : r.shape === 'spore' ? 'status' : r.shape === 'wisp' ? 'orb' : r.shape === 'fire' ? 'fire' : 'leaves', t);
    if (r.shape === 'leaf') {
      PM.stream(A, B, 0.7, { color: '#7dff8a', size: 0.1, sizeEnd: 0.07, shape: Shape.Leaf, spin: 10, rate: 220, speed: 4.5, spread: 0.3 });
      this.later(0.45, () => PB.swirl(B, 0.5, { color: '#a8ff7a', shape: Shape.Leaf, size: 0.09, radius: 0.6, height: 1.6, rate: 200, w: 7, spin: 8, ttl: 0.6 }));
    } else if (r.shape === 'wind') {
      PB.swirl(B, 1.0, { color: '#e6efff', size: 0.05, sizeEnd: 0.02, radius: 0.45, height: 2.6, rate: 360, w: 10, ttl: 0.7 });
      this.rings.fire(this.foot(t), '#e6efff', { flat: true, s0: 0.3 * kB, s1: 1.6 * kB, dur: 0.8 });
      this.later(0.3, () => this.holos[t].distort(0.6));
    } else if (r.shape === 'petal') {
      PB.swirl(B, 0.7, { color: '#ff9bd2', shape: Shape.Leaf, size: 0.1, radius: 0.7, height: 1.2, rate: 220, w: 6, spin: 6, ttl: 0.7, inward: true });
      this.later(0.35, () => this.slashes.fire(B, '#ffd1ea', 2, 0.6 * kB));
    } else if (r.shape === 'fire') {
      // A vortex of flame around the target (Magma Storm, Fire Spin).
      PB.swirl(B, 1.0, { color: '#ff7a22', size: 0.12, sizeEnd: 0.04, radius: 0.55, height: 2.2, rate: 320, w: 9, ttl: 0.8 });
      PB.swirl(B, 1.0, { color: '#ffd36a', size: 0.06, sizeEnd: 0.02, radius: 0.4, height: 1.8, rate: 160, w: 11, ttl: 0.7 });
      this.rings.fire(this.foot(t), '#ff7a22', { flat: true, s0: 0.3 * kB, s1: 1.5 * kB, dur: 0.8 });
    } else if (r.shape === 'spore') {
      // A cloud of powder drifts down over the target and settles into it (pale for Spore, yellow for Stun Spore).
      const c = r.color ?? '#d9dc9c', SB = this.sm(kB);
      PB.emitter(0.9, 150, () => {
        const p = tmp.copy(B).add(tmp2.set((Math.random() - 0.5) * 1.2 * kB, (0.4 + Math.random() * 0.7) * kB, (Math.random() - 0.5) * 1.0 * kB));
        PB.emit(p, tmp2.set((Math.random() - 0.5) * 0.2, -0.35 - Math.random() * 0.3, (Math.random() - 0.5) * 0.2), { color: c, size: 0.045, sizeEnd: 0.06, ttl: 1.1, orbit: { cx: p.x + 0.1, cz: p.z, w: 2.4 }, alpha: 0.9 });
      });
      PB.swirl(B, 0.9, { color: c, size: 0.04, sizeEnd: 0.06, radius: 0.8, height: 0.6, rate: 90, w: 1.5, ttl: 1.1, inward: true });
      SB.emitter(0.6, 18, () => SB.emit(tmp.copy(B).add(tmp2.randomDirection().multiplyScalar(0.4 * kB)), tmp2.set(0, -0.1, 0), { color: c, size: 0.35, sizeEnd: 0.6, ttl: 1.0, alpha: 0.2 }));
    } else {
      // Will-O-Wisp: sinister blue-violet flames bob over to the target.
      for (let i = 0; i < 3; i++) this.later(i * 0.1, () => {
        const to = B.clone().add(tmp2.set((i - 1) * 0.3 * kB, 0, 0));
        const o = this.orb();
        o.fire(A, to, '#6f8dff', { dur: 0.6, arc: (0.5 + i * 0.15) * kM, size: 0.8 * kM }, () => PB.burst(to, 14, 1.4, { color: '#7fa0ff', size: 0.07, ttl: 0.6, rise: 1 }));
        PM.emitter(0.58, 70, () => PM.emit(o.head, tmp2.set((Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2), { color: Math.random() < 0.5 ? '#8a6bff' : '#5fb0ff', size: 0.12, sizeEnd: 0.02, ttl: 0.3 }));
      });
    }
    this.light(B, color, 8, 0.9);
  }

  private playRain(r: Of<'rain'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kB = this.fk(t), PB = this.px(kB), B = this.home(t), n = r.count ?? 5;
    if (r.debris === 'coin') {
      this.snd('coins', t);
      PB.emitter(0.8, 70, () => {
        const p = tmp.set(B.x + (Math.random() - 0.5) * 1.4 * kB, B.y + 1.5 + Math.random() * 0.8, B.z + (Math.random() - 0.5) * 1.0 * kB);
        PB.emit(p, tmp2.set(0, -2.2, 0), { color: '#ffd04a', shape: Shape.Coin, size: 0.14, sizeEnd: 0.13, ttl: 1.1, gravity: 2.2, spin: 12 });
      });
      this.later(0.55, () => { this.impactBurst(B, '#ffd04a', 1, type, kB); this.light(B, '#ffd04a', 14, 0.8); });
      return;
    }
    const launch = !!r.launch, t0 = launch ? 0.3 : 0, fall = launch ? 0.56 : 0.72;
    if (launch) {
      // Draco Meteor: a glowing comet shoots up from the user first.
      const kA = this.fk(s), PA = this.px(kA), A = this.home(s), top = A.clone().setY(A.y + 2.6);
      const o = this.orb();
      this.snd('orb', s, 0.9);
      o.fire(A, top, '#ffb36b', { dur: 0.3, arc: 0, size: 3 * kA }, () => {
        PA.burst(top, 24, 2.2, { color: '#ffcf8a', size: 0.1, ttl: 0.5, drag: 2 });
        this.fx.flares.fire(top, '#c79bff', { core: '#ffe6c0', s0: 0.3, s1: 1.4, dur: 0.35, rays: 8, sharp: 12, peak: 0.9 });
      });
      this.fx.flares.fire(A, '#ffb36b', { core: '#fff3d8', s0: 0.5, s1: 0.6, dur: 0.3, rays: 0, sharp: 1, hold: 0.8, peak: 0.8, follow: () => o.head });
      PA.emitter(0.3, 240, () => PA.emit(tmp.copy(o.head).add(tmp2.randomDirection().multiplyScalar(0.05)), tmp2.randomDirection().multiplyScalar(0.3), { color: Math.random() < 0.5 ? '#ffb36b' : '#c79bff', size: 0.24, sizeEnd: 0.03, ttl: 0.4, drag: 2 }));
      this.light(A, '#ffb36b', 10, 0.5, () => o.head);
    }
    const kind: DebrisKind = r.debris === 'hammer' ? 'meteor' : r.debris;
    const scale = (r.debris === 'hammer' ? 0.6 : r.debris === 'meteor' ? 0.32 : r.debris === 'salt' ? 0.08 : 0.18) * kB;
    const heavy = r.debris === 'meteor' || r.debris === 'hammer';
    for (let i = 0; i < n; i++) this.later(t0 + i * (r.debris === 'salt' ? 0.04 : 0.12), () => {
      if (r.debris !== 'salt' || i === 0) this.snd('meteor', t, heavy ? 1 : 0.5);
      const land = this.foot(t).add(tmp2.set((Math.random() - 0.5) * (n > 1 ? 1.1 : 0) * kB, 0, (Math.random() - 0.5) * (n > 1 ? 0.8 : 0) * kB));
      // From the sky behind the target, so nothing falls past the lens (lower for Draco Meteor, so it streaks through the frame).
      const start = land.clone().add(launch ? tmp2.set(0.4 + Math.random() * 0.6, 3.1 + Math.random() * 0.5, -1.1 - Math.random() * 0.6) : tmp2.set(0.5 + Math.random() * 0.6, 4.8 + Math.random(), -2.6 - Math.random()));
      const trail = heavy ? '#c79bff' : r.debris === 'rock' ? '#e8d29a' : r.debris === 'shard' ? '#d8f4ff' : null;
      this.debris.throw(kind, start, this.ballistic(start, land, fall), scale, {
        ttl: 2,
        onFly: trail ? p => { for (let j = 0; j < 2; j++) this.particles.emit(p, tmp2.randomDirection().multiplyScalar(0.25), { color: j && launch ? '#ffb36b' : trail, size: launch ? 0.22 * kB : Math.min(0.16, scale * 0.5), sizeEnd: 0.01, ttl: 0.4 }); } : undefined,
        onLand: p => {
          this.snd(r.debris === 'salt' ? 'hazard' : 'meteorHit', t, r.debris === 'meteor' ? 0.8 : r.debris === 'hammer' ? 1.2 : 0.5);
          const at = p.clone();
          PB.burst(at.setY(ARENA.floorY + 0.05), r.debris === 'salt' ? 6 : 26, 2.6, { color: r.debris === 'meteor' ? '#b48cff' : r.debris === 'shard' ? '#e3f7ff' : '#e8d29a', size: 0.07, ttl: 0.7, gravity: 4, rise: 0.8 });
          if (r.debris !== 'salt') this.rings.fire(at.setY(ARENA.floorY + 0.03), color, { flat: true, s0: 0.1 * kB, s1: (r.debris === 'hammer' ? 2.6 : 1) * kB, dur: 0.5 });
          if (r.debris === 'meteor') this.sm(kB).burst(at.setY(ARENA.floorY + 0.1), 6, 0.9, { color: '#2a1840', size: 0.25, sizeEnd: 0.5, ttl: 0.8, drag: 2, rise: 0.5, alpha: 0.5 });
          if (heavy) { this.light(at.setY(0.5), color, 16, 0.5); this.shake = Math.max(this.shake, r.debris === 'hammer' ? 1 : 0.45); }
        },
      });
    });
    if (heavy) this.light(B.clone().setY(3), color, 6, 1.2);
    if (r.debris === 'hammer') this.later(0.75, () => this.quakeAt(t, color, 0.9));
  }

  /** The ground at a side shakes: a shockwave across the field, fissures, spikes and dust at the target. */
  private quakeAt(t: 0 | 1, color: string, power: number, from?: THREE.Vector3) {
    const k = this.fk(t), P = this.px(k), f = this.foot(t);
    const origin = from ? from.clone().setY(ARENA.floorY + 0.03) : f.clone();
    // From the attacker the shockwave crosses the field; one anchored on the target (Body Press) is sized to it.
    const ks = from ? 1 : k;
    this.rings.fire(origin, color, { flat: true, s0: 0.3 * ks, s1: 4.5 * power * ks, dur: 0.9 });
    this.rings.fire(origin, '#ffffff', { flat: true, s0: 0.2 * ks, s1: 3.2 * power * ks, dur: 0.7, delay: 0.08 });
    const n = Math.round(4 + power * 5);
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const at = new THREE.Vector3().lerpVectors(origin, f, from ? u : 1).add(new THREE.Vector3((Math.random() - 0.5) * (from ? 0.5 : 1.3 * k), 0, (Math.random() - 0.5) * (from ? 0.5 : 1.0 * k)));
      this.debris.erupt(at, (0.14 + Math.random() * 0.12 * power) * (from ? THREE.MathUtils.lerp(1, k, u) : k), from ? u * 0.3 : Math.random() * 0.15);
    }
    this.fx.cracks.fire(f, '#ffb05a', { radius: 0.95 * k + 0.3 * power, dur: 1.1, grow: 0.25, delay: from ? 0.28 : 0.03 });
    this.later(from ? 0.3 : 0.05, () => {
      this.shake = Math.max(this.shake, 0.6 + 0.4 * power);
      P.burst(f.clone().setY(ARENA.floorY + 0.05), 40, 2.4, { color: '#e8d29a', size: 0.07, ttl: 0.8, gravity: 5, rise: 0.9 });
      this.sm(k).burst(f.clone().setY(ARENA.floorY + 0.1), 10, 1.4, { color: '#a08a66', size: 0.22, sizeEnd: 0.5, ttl: 0.9, drag: 2.5, rise: 0.25, alpha: 0.35 });
      this.light(f.clone().setY(ARENA.floorY + 0.4), color, 10, 0.6);
    });
  }

  /** Stone Edge: sharp stone pillars burst out of the ground around and under the target. */
  private stoneEdge(t: 0 | 1, type: TypeName) {
    const k = this.fk(t), P = this.px(k), f = this.foot(t), B = this.home(t), hit = 0.45, h = this.holos[t].height;
    this.snd('quake', t, 0.6);
    this.fx.cracks.fire(f, '#d9c08a', { radius: 0.8 * k, dur: 1.0, grow: 0.3 });
    P.emitter(0.3, 60, () => P.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 1.2 * k, 0.02, (Math.random() - 0.5) * 1.2 * k)), tmp2.set(0, 0.8 + Math.random(), 0), { color: '#d9c08a', size: 0.05, ttl: 0.4, gravity: 4 }));
    const n = 9, q = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const centre = i === n - 1;
      const ang = (i / (n - 1)) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const rad = centre ? 0.05 * k : (i % 2 ? 0.62 + Math.random() * 0.18 : 0.42 + Math.random() * 0.12) * Math.max(0.6, k);
      const base = new THREE.Vector3(f.x + Math.cos(ang) * rad, ARENA.floorY - 0.02, f.z + Math.sin(ang) * rad);
      const height = centre ? Math.max(0.42, h * 1.15) : (i % 2 ? 0.45 + Math.random() * 0.3 : 0.7 + Math.random() * 0.35) * Math.max(0.42, h);
      // Lean each spire in toward the target so the points converge on it.
      const lean = centre ? 0.05 : (i % 2 ? 0.18 : 0.3) + Math.random() * 0.14;
      const axis = new THREE.Vector3(f.z - base.z, 0, -(f.x - base.x)); if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0); axis.normalize();
      const rot = new THREE.Euler().setFromQuaternion(q.setFromAxisAngle(axis, lean).multiply(spinQ.setFromAxisAngle(Y, Math.random() * 6.28)));
      const at = centre ? hit - 0.05 : hit - 0.17 + i * 0.022;
      this.debris.drive('pillar', height / 2, 0.95, (life, p, r) => {
        p.copy(base); r.copy(rot);
        const up = life < 0.1 ? 1 - Math.pow(1 - life / 0.1, 3) : 1;                    // punch out of the floor
        const sink = life > 0.62 ? smooth(Math.min(1, (life - 0.62) / 0.33)) : 0;       // crumble back down
        return up * (1 - sink);
      }, at);
      this.later(at + 0.03, () => {
        P.burst(tmp.copy(base).setY(ARENA.floorY + 0.05), 10, 1.6, { color: '#d9c08a', size: 0.06, ttl: 0.6, gravity: 5, rise: 0.8 });
        for (let j = 0; j < 2; j++) this.debris.throw('rock', base.clone().setY(ARENA.floorY + 0.1), tmp.randomDirection().multiplyScalar(1.4 * k).setY((1.5 + Math.random()) * k), 0.035 * k, { ttl: 0.9 });
        if (i % 2 === 0) this.snd('meteorHit', t, 0.45);
      });
    }
    this.later(hit, () => {
      this.sm(k).burst(f.clone().setY(ARENA.floorY + 0.08), 8, 1.1, { color: '#8c7a5c', size: 0.18, sizeEnd: 0.36, ttl: 0.7, drag: 2.5, rise: 0.2, alpha: 0.3 });
      this.light(B, '#e8d29a', 9, 0.45);
      this.shake = Math.max(this.shake, 0.55);
      this.impactBurst(B, '#e8d29a', 1, type, k);
    });
  }
  /** Earth Power: the ground under the target cracks and glows, then erupts in a column of energy. */
  private earthPower(t: 0 | 1, type: TypeName) {
    const k = this.fk(t), P = this.px(k), f = this.foot(t), B = this.home(t), hit = 0.5, glow = '#ffb347';
    this.snd('quake', t, 0.7);
    this.fx.cracks.fire(f, glow, { radius: 1.1 * k + 0.1, dur: 1.25, grow: 0.42 });
    this.light(f.clone().setY(ARENA.floorY + 0.15), glow, 7, hit + 0.1);
    this.shake = Math.max(this.shake, 0.15);
    P.emitter(hit, 70, () => P.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 1.1 * k, 0.02, (Math.random() - 0.5) * 1.1 * k)), tmp2.set(0, 0.6 + Math.random() * 0.8, 0), { color: Math.random() < 0.5 ? '#ffd37a' : '#ff9a3a', size: 0.04, sizeEnd: 0.01, ttl: 0.5, gravity: 1.5 }));
    this.later(hit, () => {
      this.snd('meteorHit', t, 1);
      this.beams[t].fire(f, f.clone().setY(ARENA.floorY + Math.max(1.5, this.holos[t].height * 2.6)), '#ff8a2a', 0.6, 0.17 * k, 0.18, { white: 0.6, gain: 0.9 });
      P.emitter(0.45, 200, () => P.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 0.6 * k, 0, (Math.random() - 0.5) * 0.6 * k)), tmp2.set((Math.random() - 0.5) * 0.6, 3 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6), { color: Math.random() < 0.3 ? '#ffe2a0' : Math.random() < 0.5 ? glow : '#ff7a2a', size: 0.08, sizeEnd: 0.02, ttl: 0.55, drag: 1 }));
      for (let i = 0; i < 7; i++) this.debris.throw('rock', f.clone().setY(ARENA.floorY + 0.1), tmp.set((Math.random() - 0.5) * 1.6 * k, (3 + Math.random() * 2) * k, (Math.random() - 0.5) * 1.6 * k), (0.04 + Math.random() * 0.04) * k, { ttl: 1.3 });
      this.rings.fire(f, glow, { flat: true, s0: 0.2 * k, s1: 1.6 * k, dur: 0.5 });
      this.sm(k).burst(f.clone().setY(ARENA.floorY + 0.08), 8, 1.2, { color: '#6a5034', size: 0.18, sizeEnd: 0.38, ttl: 0.7, drag: 2.5, rise: 0.2, alpha: 0.35 });
      this.light(B, glow, 12, 0.6);
      this.shake = Math.max(this.shake, 0.6);
      this.kickScreen(0.3, glow, 0.03);
      this.impactBurst(B, glow, 1, type, k);
    });
  }
  /** Ruination: ominous dark-red energy gathers over the target and collapses onto it. */
  private ruination(t: 0 | 1, color: string, type: TypeName) {
    const k = this.fk(t), P = this.px(k), SM = this.sm(k), B = this.home(t), f = this.foot(t), hit = 0.62, h = this.holos[t].height;
    const core = B.clone().setY(B.y + 0.55 * h + 0.45 * k);
    this.snd('debuff', t, 1);
    // A black mass with a red rim swells above the target, drawing in red sparks...
    SM.emitter(hit - 0.08, 110, () => SM.emit(tmp.copy(core).add(tmp2.randomDirection().multiplyScalar((0.6 + Math.random() * 0.4) * k)), ZERO3, { color: '#160309', size: 0.34, sizeEnd: 0.18, ttl: 0.42, alpha: 0.8, home: { x: core.x, y: core.y, z: core.z, k: 5 } }));
    SM.emitter(hit - 0.05, 70, u => SM.emit(tmp.copy(core).add(tmp2.randomDirection().multiplyScalar(0.05 * k)), ZERO3, { color: '#0a0204', size: 0.3 + 0.25 * u, sizeEnd: 0.4 + 0.25 * u, ttl: 0.16, alpha: 0.95 }));
    P.emitter(hit - 0.05, 120, () => P.emit(tmp.copy(core).add(tmp2.randomDirection().multiplyScalar(0.9 * k)), ZERO3, { color: Math.random() < 0.6 ? color : '#ff8a5a', size: 0.05, sizeEnd: 0.02, ttl: 0.3, home: { x: core.x, y: core.y, z: core.z, k: 8 } }));
    for (let i = 0; i < 3; i++) this.rings.fire(core, color, { s0: 1.5 * k, s1: 0.1 * k, dur: 0.35, delay: i * 0.13 });
    this.fx.flares.fire(core, '#ff1a2a', { core: '#ff6a5a', s0: 0.2 * k, s1: 1.4 * k, dur: hit, rays: 0, sharp: 1, hold: 0.85, fadeIn: 0.4, peak: 0.45 });
    this.light(core, color, 9, hit + 0.2);
    this.holos[t].distort(0.6);
    // ...then it slams down onto the target.
    this.later(hit - 0.1, () => this.orb().fire(core, B, color, { dur: 0.1, arc: 0, size: 1.6 * k }, () => { /* the impact below */ }));
    this.later(hit, () => {
      this.snd('meteorHit', t, 1.1);
      this.fx.cracks.fire(f, '#ff2030', { radius: 1.0 * k, dur: 1.0, grow: 0.2 });
      SM.burst(B, 26, 2.2, { color: '#12030a', size: 0.3, sizeEnd: 0.65, ttl: 0.8, drag: 2.5, alpha: 0.8 });
      P.burst(B, 40, 3, { color: '#ff3040', size: 0.07, sizeEnd: 0.01, ttl: 0.5, drag: 2.5 });
      this.rings.fire(f, color, { flat: true, s0: 0.2 * k, s1: 2.2 * k, dur: 0.6 });
      this.rings.fire(B, '#ff6a5a', { s0: 0.2 * k, s1: 1.5 * k, dur: 0.4 });
      this.light(B, color, 20, 0.6);
      this.shake = Math.max(this.shake, 0.7);
      this.kickScreen(0.4, color, 0.08);
      this.impactBurst(B, color, 1.1, type, k);
    });
  }

  /** Dazzling Gleam: a radial burst of pink-white light from the user that washes over the target. */
  private playFlash(r: Of<'flash'>, s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), PA = this.px(kA), A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t), hit = impactDelay(r);
    const reach = A.distanceTo(B);
    this.snd('beam', s, 0.8);
    this.fx.flares.fire(A, color, { core: '#ffffff', s0: 0.3 * kA, s1: 1.35 * reach, dur: 0.55, rays: r.rays ?? 12, sharp: 18, spin: 1.2, hold: 0.4, fadeIn: 0.05, peak: 0.75 });
    this.fx.flares.fire(A, '#ffffff', { s0: 0.2 * kA, s1: 1.1 * kA, dur: 0.3, rays: 0, sharp: 1, peak: 0.7 });
    // Sparkles fly out in every direction; the target is in the way.
    PA.burst(A, 60, 4.2, { color: '#ffd6f2', shape: Shape.Star, size: 0.1, sizeEnd: 0.03, ttl: 0.6, drag: 1.5, spin: 5 });
    PA.burst(A, 40, 2.4, { color, size: 0.08, sizeEnd: 0.01, ttl: 0.5, drag: 2 });
    for (let i = 0; i < 3; i++) this.rings.fire(A, i ? color : '#ffffff', { s0: 0.2 * kA, s1: (0.9 + i * 0.35) * kA, dur: 0.32, delay: i * 0.05 });
    this.light(A, color, 14, 0.6);
    this.kickScreen(0.25, '#ffe6f6', 0.06);
    this.later(hit, () => {
      this.fx.flares.fire(B, color, { core: '#ffffff', s0: 0.3 * kB, s1: 1.5 * kB, dur: 0.35, rays: 8, sharp: 14, peak: 0.7 });
      this.px(kB).burst(B, 30, 2.2, { color: '#ffe0f4', shape: Shape.Star, size: 0.09, sizeEnd: 0.03, ttl: 0.6, drag: 2, spin: 5 });
      this.impactBurst(B, color, 0.9, type, kB);
    });
  }
  /** Trick / Switcheroo: the two held items fly past each other and change hands. */
  private playSwap(s: 0 | 1, t: 0 | 1) {
    const kA = this.fk(s), kB = this.fk(t), kM = (kA + kB) / 2, PM = this.px(kM);
    const A = this.castPoint(s, t, new THREE.Vector3()), B = this.castPoint(t, s, new THREE.Vector3());
    this.snd('rings', s, 0.8);
    const items: [THREE.Vector3, THREE.Vector3, string, number][] = [[A, B, '#ffe08a', 0.75], [B, A, '#9fe8ff', 0.15]];
    for (const [from, to, c, arc] of items) {
      const o = this.orb();
      o.fire(from, to, c, { dur: 0.6, arc: arc * kM, size: 1.4 * kM }, () => { PM.burst(to, 16, 1.4, { color: c, shape: Shape.Star, size: 0.1, ttl: 0.5, spin: 4 }); this.rings.fire(to, c, { s0: 0.1 * kM, s1: 0.6 * kM, dur: 0.3 }); });
      this.fx.flares.fire(from, c, { core: '#ffffff', s0: 0.25 * kM, s1: 0.32 * kM, dur: 0.6, rays: 4, sharp: 20, spin: 3, hold: 0.85, peak: 0.8, follow: () => o.head });
      PM.emitter(0.58, 90, () => PM.emit(o.head, tmp2.randomDirection().multiplyScalar(0.2), { color: c, shape: Shape.Star, size: 0.08, sizeEnd: 0.02, ttl: 0.45, spin: 5 }));
    }
    for (const x of [s, t] as const) this.rings.fire(this.foot(x), '#ffffff', { flat: true, s0: 0.1 * this.fk(x), s1: 0.7 * this.fk(x), dur: 0.4 });
    this.later(0.6, () => { this.snd('coins', t, 0.5); this.holos[s].pulse('#ffe08a', 0.4); this.holos[t].pulse('#9fe8ff', 0.4); });
  }
  /** Malignant Chain: a toxic chain coils up around the target, squeezes, then bursts into poison. */
  private playChain(s: 0 | 1, t: 0 | 1, color: string, type: TypeName) {
    const kA = this.fk(s), kB = this.fk(t), PB = this.px(kB), A = this.castPoint(s, t, new THREE.Vector3()), B = this.home(t), f = this.foot(t), hit = 0.55;
    const h = this.holos[t].height;
    this.snd('hazard', t, 0.8);
    this.px((kA + kB) / 2).stream(A, B, 0.22, { color, size: 0.07, sizeEnd: 0.12, rate: 240, speed: 9, spread: 0.06 });
    const N = 22, turns = 1.6, R = Math.max(0.2, 0.42 * kB), H = Math.max(0.3, h * 0.95);
    const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), tg = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const s0 = i / (N - 1);
      this.debris.drive('link', 0.13 * kB, 1.05, (life, p, rot) => {
        const grow = Math.min(1, life / 0.4);                                                    // winds up from the floor
        if (s0 > grow) return 0;
        const squeeze = life > hit - 0.06 ? 1 - 0.3 * smooth(Math.min(1, (life - hit + 0.06) / 0.08)) : 1;
        const out = life > hit + 0.12 ? smooth(Math.min(1, (life - hit - 0.12) / 0.3)) : 0;     // then bursts apart
        const a = s0 * turns * Math.PI * 2 + life * 2.5, rr = R * squeeze * (1 + out * 1.8);
        p.set(f.x + Math.cos(a) * rr, f.y + 0.08 + s0 * H + out * 0.2, f.z + Math.sin(a) * rr);
        // Links follow the helix; every other one turns 90 degrees, like a real chain.
        q.setFromUnitVectors(Y, tg.set(-Math.sin(a), H / (turns * Math.PI * 2 * rr), Math.cos(a)).normalize());
        if (i % 2) q.multiply(q2.setFromAxisAngle(Y, Math.PI / 2));
        rot.setFromQuaternion(q);
        return (1 - out) * Math.min(1, (grow - s0) * 8 + 0.2);
      });
    }
    PB.emitter(hit, 50, () => PB.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * R * 2, Math.random() * H, (Math.random() - 0.5) * R * 2)), tmp2.set(0, 0.4, 0), { color: '#d68cff', shape: Shape.Ring, size: 0.06, sizeEnd: 0.1, ttl: 0.5 }));
    this.light(B, color, 8, hit + 0.3);
    this.later(hit, () => {
      this.snd('meteorHit', t, 0.7);
      this.impactBurst(B, color, 1, type, kB);
      this.sm(kB).burst(B, 16, 1.4, { color: '#3a0f52', size: 0.25, sizeEnd: 0.5, ttl: 0.8, drag: 2.5, alpha: 0.6 });
      this.holos[t].pulse(color, 0.6);
    });
  }

  private playHazard(r: Of<'hazard'>, s: 0 | 1, t: 0 | 1) {
    const kB = this.fk(t), PB = this.px(kB), A = this.castPoint(s, t, new THREE.Vector3()), f = this.foot(t);
    this.snd('hazard', t);
    if (r.debris === 'rock') { this.stealthRock(A, t); return; }
    for (let i = 0; i < 5; i++) this.later(i * 0.07, () => {
      const land = f.clone().add(tmp2.set((Math.random() - 0.5) * 1.6 * kB, 0, (Math.random() - 0.5) * 1.1 * kB));
      if (r.debris === 'toxic') { const o = this.orb(); o.fire(A, land, '#b55bd6', { dur: 0.6, arc: 1.2, size: 0.5 * kB }, () => PB.burst(land, 10, 1.2, { color: '#c77dff', size: 0.06, ttl: 0.7, gravity: 3 })); return; }
      this.debris.throw('spike', A.clone(), this.ballistic(A, land, 0.6), 0.08 * kB, { ttl: 1.6, onLand: p => PB.burst(p.clone().setY(ARENA.floorY + 0.05), 8, 1.2, { color: '#e8d29a', size: 0.05, ttl: 0.5, gravity: 3 }) });
    });
  }
  /** Stealth Rock: pointed stones are flung over and hover in a slow ring around the target's side. */
  private stealthRock(A: THREE.Vector3, t: 0 | 1) {
    const kB = this.fk(t), PB = this.px(kB), f = this.foot(t), h = this.holos[t].height, n = 6, fly = 0.55, ttl = 2.2;
    for (let i = 0; i < n; i++) {
      const ang0 = (i / n) * Math.PI * 2 + Math.random() * 0.3, rad = (0.62 + Math.random() * 0.25) * Math.max(0.65, kB);
      const hy = ARENA.floorY + (0.35 + Math.random() * 0.5) * Math.max(0.5, h);
      const from = A.clone(), spin0 = Math.random() * 6, bob = Math.random() * 6, tilt = (Math.random() - 0.5) * 0.5, delay = i * 0.05;
      this.debris.drive('stone', (0.15 + Math.random() * 0.05) * Math.max(0.8, kB), ttl, (life, p, rot) => {
        const a = ang0 + life * 0.7, hx = f.x + Math.cos(a) * rad, hz = f.z + Math.sin(a) * rad, y = hy + Math.sin(life * 3 + bob) * 0.05;
        if (life < fly) {
          const u = life / fly, e = 1 - (1 - u) * (1 - u);
          p.set(from.x + (hx - from.x) * e, from.y + (y - from.y) * e + Math.sin(u * Math.PI) * 0.9, from.z + (hz - from.z) * e);
        } else p.set(hx, y, hz);
        rot.set(tilt, spin0 + life * 1.5, tilt * 0.5);
        return Math.min(1, life / 0.08) * (life > ttl - 0.3 ? Math.max(0, (ttl - life) / 0.3) : 1);
      }, delay);
      this.later(delay + fly, () => PB.burst(tmp.set(f.x + Math.cos(ang0 + fly * 0.7) * rad, hy, f.z + Math.sin(ang0 + fly * 0.7) * rad), 6, 0.8, { color: '#e8d29a', size: 0.04, ttl: 0.4, drag: 2 }));
    }
    this.later(fly, () => { this.snd('hazard', t, 0.7); this.light(f.clone().setY(ARENA.floorY + 0.6), '#e8d29a', 6, 0.6); });
  }

  private playField(r: Of<'field'>, color: string) {
    const P = this.particles;
    if (r.snow) {
      // Chilly Reception: snow starts falling across the whole field.
      this.snd('wind', null, 0.5);
      P.emitter(1.5, 240, () => {
        const p = tmp.set(-3.2 + Math.random() * 6.4, 2.4 + Math.random() * 0.8, -3.2 + Math.random() * 6);
        P.emit(p, tmp2.set(0.15 + Math.random() * 0.1, -0.75 - Math.random() * 0.35, 0.05), { color: Math.random() < 0.3 ? color : '#ffffff', shape: Shape.Flake, size: 0.05 + Math.random() * 0.04, ttl: 2.4, spin: 1.5, orbit: { cx: p.x + 0.12, cz: p.z, w: 1.8 + Math.random() } });
      });
      const SM = this.sm(1);
      SM.emitter(1.2, 20, () => SM.emit(tmp.set(-2.5 + Math.random() * 5, ARENA.floorY + 0.15, -2.5 + Math.random() * 5), tmp2.set(0.1, 0.02, 0), { color: '#e6f4ff', size: 0.8, sizeEnd: 1.3, ttl: 1.6, alpha: 0.12 }));
      this.rings.fire(new THREE.Vector3(0, ARENA.floorY + 0.03, 0), '#cfefff', { flat: true, s0: 0.5, s1: 3.6, dur: 1.2 });
      return;
    }
    this.snd('wind', null);
    P.emitter(0.9, 260, () => {
      const p = tmp.set(-4 + Math.random() * 0.5, ARENA.floorY + Math.random() * 2, -2.5 + Math.random() * 5);
      P.emit(p, tmp2.set(7 + Math.random() * 2, (Math.random() - 0.5) * 0.4, -1 + Math.random() * 0.5), { color, size: 0.05, sizeEnd: 0.02, ttl: 1.2 });
    });
    this.rings.fire(new THREE.Vector3(0, ARENA.floorY + 0.03, 0), color, { flat: true, s0: 0.5, s1: 4, dur: 0.9 });
  }

  /* ---------------- self moves */
  private selfFx(effect: SelfEffect, s: 0 | 1, color: string) {
    const A = this.home(s), f = this.foot(s), k = this.fk(s), P = this.px(k), h = this.holos[s], H = h.height;
    const top = f.clone().setY(ARENA.floorY + H);
    this.snd(effect === 'heal' || effect === 'revive' || effect === 'sun' || effect === 'roost' || effect === 'wish' ? 'heal' : effect === 'protect' || effect === 'screen' ? 'shield' : effect === 'curse' || effect === 'plot' ? 'debuff' : effect === 'sleep' ? 'status' : effect === 'sub' || effect === 'transform' ? 'rings' : effect === 'drum' ? 'punch' : 'buff', s);
    switch (effect) {
      case 'buff': P.swirl(A, 0.8, { color, size: 0.06, radius: 0.65, height: 1.8, rate: 150, w: 5, ttl: 0.8 }); this.rings.fire(f, color, { flat: true, s0: 1.4 * k, s1: 0.2 * k, dur: 0.6 }); this.later(0.6, () => h.pulse(color)); break;
      case 'blades': this.swordsDance(s); break;
      case 'gear': this.shiftGear(s); break;
      case 'dragon':
        // Dragon Dance: a mystic aura of red and blue flame twisting up around the body.
        P.emitter(1.0, 230, () => {
          const red = Math.random() < 0.5, a = Math.random() * Math.PI * 2, rr = (0.22 + Math.random() * 0.22) * k;
          P.emit(tmp.set(f.x + Math.cos(a) * rr, f.y + Math.random() * H * 0.45, f.z + Math.sin(a) * rr), tmp2.set(0, (1.3 + Math.random()) * Math.max(0.7, H), 0), { color: red ? '#ff3355' : '#3a66ff', size: 0.26, sizeEnd: 0.04, ttl: 0.5, alpha: 0.55, orbit: { cx: f.x, cz: f.z, w: red ? 5 : -5 } });
        });
        P.swirl(A, 1.0, { color: '#ffe0ec', size: 0.04, sizeEnd: 0.01, radius: 0.5, height: 2.0, rate: 50, w: 7, ttl: 0.7 });
        this.rings.fire(f, '#b28bff', { flat: true, s0: 0.3 * k, s1: 1.5 * k, dur: 0.8 });
        this.later(0.35, () => h.pulse('#ff3b5c', 0.5)); this.later(0.7, () => h.pulse('#3d6bff', 0.6));
        this.light(A, '#b28bff', 10, 1.1);
        break;
      case 'quiver': {
        // Quiver Dance: iridescent butterfly scales flutter up and glitter around the dancer.
        const cols = ['#9dffd6', '#ffd1f5', '#a8d8ff', '#fff3a8', '#d6b8ff'];
        P.emitter(1.0, 130, () => {
          const a = Math.random() * Math.PI * 2, rr = (0.35 + Math.random() * 0.4) * k;
          P.emit(tmp.set(f.x + Math.cos(a) * rr, f.y + Math.random() * H * 1.1, f.z + Math.sin(a) * rr), tmp2.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3), { color: cols[Math.floor(Math.random() * cols.length)], shape: Math.random() < 0.5 ? Shape.Star : Shape.Glow, size: 0.07, sizeEnd: 0.02, ttl: 0.9, spin: 6, orbit: { cx: f.x, cz: f.z, w: 2.5 } });
        });
        P.swirl(A, 1.0, { color: '#e8fff6', shape: Shape.Leaf, size: 0.1, sizeEnd: 0.06, radius: 0.55, height: 1.6, rate: 40, w: 3, spin: 8, ttl: 1, alpha: 0.6 });
        this.later(0.75, () => h.pulse('#c8ffe8', 0.6));
        this.light(A, '#bfffe6', 8, 1);
        break;
      }
      case 'iron':
        // Iron Defense: a metallic sheen sweeps up the body, glinting as it passes.
        for (let i = 0; i < 2; i++) this.rings.fire(f.clone().setY(ARENA.floorY + 0.05), i ? '#ffffff' : '#bcd0ff', { flat: true, to: top.clone().setY(ARENA.floorY + H * 1.05), s0: 0.55 * k, s1: 0.4 * k, dur: 0.55, delay: i * 0.18 });
        for (let i = 0; i < 6; i++) this.later(0.1 + i * 0.08, () => P.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 0.5 * k, H * (0.15 + 0.14 * i), (Math.random() - 0.5) * 0.5 * k)), ZERO3, { color: '#ffffff', shape: Shape.Star, size: 0.22, ttl: 0.25, spin: 3 }));
        this.later(0.25, () => h.pulse('#dfe8ff', 0.75)); this.later(0.55, () => h.pulse('#ffffff', 0.5));
        this.light(A, '#dfe8ff', 10, 0.8);
        break;
      case 'calm': {
        // Calm Mind: calm blue rings spread slowly from the head, one after another.
        const head = top.clone().setY(ARENA.floorY + H * 0.9);
        for (let i = 0; i < 4; i++) this.rings.fire(head, i % 2 ? '#bfe4ff' : '#6fb8ff', { flat: true, s0: 0.15 * k, s1: 1.2 * k, dur: 0.9, delay: i * 0.2 });
        for (let i = 0; i < 2; i++) this.rings.fire(head, '#9fd2ff', { s0: 0.1 * k, s1: 0.8 * k, dur: 0.8, delay: 0.1 + i * 0.35 });
        P.emitter(1.0, 40, () => P.emit(tmp.copy(A).add(tmp2.randomDirection().multiplyScalar(0.5 * k)), tmp2.set(0, 0.25, 0), { color: '#9fd2ff', size: 0.05, sizeEnd: 0.02, ttl: 0.9, alpha: 0.8 }));
        this.fx.flares.fire(head, '#6fb8ff', { core: '#dff1ff', s0: 0.2 * k, s1: 0.7 * k, dur: 1.0, rays: 0, sharp: 1, hold: 0.6, fadeIn: 0.3, peak: 0.45 });
        this.later(0.8, () => h.pulse('#7fc4ff', 0.5));
        break;
      }
      case 'plot': {
        // Nasty Plot: a dark, scheming aura wells up around the user, then a sly glint.
        const SM = this.sm(k);
        SM.emitter(0.9, 70, () => {
          const a = Math.random() * Math.PI * 2, rr = (0.3 + Math.random() * 0.3) * k;
          SM.emit(tmp.set(f.x + Math.cos(a) * rr, f.y + Math.random() * H * 0.8, f.z + Math.sin(a) * rr), tmp2.set(0, 0.5, 0), { color: '#1b0b26', size: 0.22, sizeEnd: 0.45, ttl: 0.8, drag: 1, alpha: 0.6, orbit: { cx: f.x, cz: f.z, w: -2 } });
        });
        P.swirl(A, 0.9, { color: '#9a4dff', size: 0.07, sizeEnd: 0.02, radius: 0.55, height: 1.5, rate: 110, w: -4, ttl: 0.8 });
        const eye = top.clone().setY(ARENA.floorY + H * 0.85);
        this.later(0.6, () => { this.fx.flares.fire(eye, '#ff4a6a', { core: '#ffffff', s0: 0.05, s1: 0.4 * k, dur: 0.35, rays: 4, sharp: 24, peak: 0.9 }); h.pulse('#7a2cc8', 0.6); });
        this.light(A, '#7a2cc8', 7, 1);
        break;
      }
      case 'bulk':
        // Bulk Up: a red power aura flares around the body as it tenses.
        P.emitter(0.8, 170, () => {
          const a = Math.random() * Math.PI * 2, rr = (0.28 + Math.random() * 0.22) * k;
          P.emit(tmp.set(f.x + Math.cos(a) * rr, f.y + Math.random() * H * 0.7, f.z + Math.sin(a) * rr), tmp2.set(0, 1.3 + Math.random() * 0.8, 0), { color: Math.random() < 0.3 ? '#ffd0a0' : '#ff4a2a', size: 0.17, sizeEnd: 0.03, ttl: 0.45, alpha: 0.8 });
        });
        for (let i = 0; i < 2; i++) this.later(0.15 + i * 0.3, () => { this.rings.fire(f, '#ff5a3a', { flat: true, s0: 0.2 * k, s1: 1.3 * k, dur: 0.4 }); this.shake = Math.max(this.shake, 0.2); });
        this.later(0.6, () => h.pulse('#ff4a2a', 0.8));
        this.light(A, '#ff4a2a', 10, 0.9);
        break;
      case 'tidy':
        // Tidy Up: dust is swept away in a neat spiral, leaving everything sparkling.
        P.swirl(f.clone().setY(ARENA.floorY + 0.12), 0.7, { color: '#e8eef8', size: 0.05, sizeEnd: 0.02, radius: 0.8, height: 0.3, rate: 160, w: 9, ttl: 0.5, inward: true });
        this.sm(k).burst(f.clone().setY(ARENA.floorY + 0.1), 8, 1.4, { color: '#b8ae9a', size: 0.18, sizeEnd: 0.4, ttl: 0.6, drag: 3, alpha: 0.3 });
        for (let i = 0; i < 7; i++) this.later(0.3 + i * 0.07, () => P.emit(tmp.copy(A).add(tmp2.randomDirection().multiplyScalar(0.45 * k)), ZERO3, { color: '#ffffff', shape: Shape.Star, size: 0.2, ttl: 0.3, spin: 4 }));
        this.later(0.65, () => h.pulse('#e8f6ff', 0.5));
        break;
      case 'sun':
        // Morning Sun: a warm shaft of sunlight falls on the user from above; motes drift down inside it.
        this.beams[s].fire(f.clone().setY(ARENA.floorY + 5.5), f, '#ffb347', 1.3, 0.18 * k + 0.05, 0.25, { white: 0.3, gain: 0.7 });
        this.fx.flares.fire(f.clone().setY(ARENA.floorY + H + 0.9), '#ffb347', { core: '#ffd98a', mode: 1, s0: 0.1, s1: 0.5 * k + 0.1, dur: 1.3, hold: 0.65, fadeIn: 0.25, peak: 0.7 });
        P.emitter(1.1, 80, () => P.emit(tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 0.6 * k, H + 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6 * k)), tmp2.set(0, -0.9, 0), { color: Math.random() < 0.5 ? '#fff1b8' : '#ffc94a', size: 0.05, sizeEnd: 0.02, ttl: 1.2 }));
        this.rings.fire(f, '#ffd27a', { flat: true, s0: 0.2 * k, s1: 1.0 * k, dur: 1.0 });
        this.light(A, '#ffc25a', 8, 1.4);
        this.later(0.6, () => h.heal());
        break;
      case 'roost':
        // Roost: white feathers drift down around the user as it rests.
        P.emitter(0.9, 34, () => {
          const p = tmp.copy(f).add(tmp2.set((Math.random() - 0.5) * 1.0 * k, H + 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 1.0 * k));
          P.emit(p, tmp2.set((Math.random() - 0.5) * 0.2, -0.45 - Math.random() * 0.2, (Math.random() - 0.5) * 0.2), { color: '#ffffff', shape: Shape.Feather, size: 0.16, sizeEnd: 0.14, ttl: 1.5, spin: Math.random() < 0.5 ? -2.5 : 2.5, orbit: { cx: p.x + 0.08, cz: p.z, w: 3 } });
        });
        P.swirl(A, 0.9, { color: '#9dffc4', shape: Shape.Star, size: 0.08, radius: 0.6, height: 1.4, rate: 50, w: 2, ttl: 1, spin: 3 });
        this.later(0.6, () => h.heal());
        this.light(A, '#e8fff2', 8, 1);
        break;
      case 'wish': {
        // Wish: a bright star rises from the user into the sky; the wish comes true next turn.
        // The star first shines just above the head, then climbs away into the sky.
        const from = top.clone().setY(ARENA.floorY + H + 0.12 * k), sky = from.clone().setY(from.y + 2.4), o = this.orb(), star = from.clone();
        this.fx.flares.fire(from, '#ffe680', { core: '#ffffff', s0: 0.05, s1: 0.75 * k, dur: 1.25, rays: 4, sharp: 14, spin: 1.5, hold: 0.85, fadeIn: 0.2, follow: () => star });
        P.emitter(0.3, 70, () => P.emit(tmp.copy(from).add(tmp2.randomDirection().multiplyScalar(0.5 * k)), ZERO3, { color: '#fff6c0', shape: Shape.Star, size: 0.06, sizeEnd: 0.02, ttl: 0.3, spin: 4, home: { x: from.x, y: from.y, z: from.z, k: 7 } }));
        this.later(0.35, () => {
          o.fire(from, sky, '#fff1a0', { dur: 0.9, arc: 0, size: 1.6 * k }, () => this.fx.flares.fire(sky, '#fff1a0', { core: '#ffffff', s0: 0.1, s1: 1.0, dur: 0.5, rays: 4, sharp: 18 }));
          P.emitter(0.88, 110, () => { star.copy(o.head); P.emit(o.head, tmp2.randomDirection().multiplyScalar(0.25), { color: Math.random() < 0.5 ? '#fff6c0' : '#ffe08a', shape: Shape.Star, size: 0.09, sizeEnd: 0.02, ttl: 0.7, spin: 4 }); });
        });
        this.light(from, '#fff1a0', 9, 1.2, () => star);
        break;
      }
      case 'heal': P.swirl(A, 0.9, { color: '#9dffc4', shape: Shape.Star, size: 0.1, radius: 0.7, height: 1.6, rate: 90, w: 2, ttl: 1, spin: 3 }); this.later(0.5, () => h.heal()); this.light(A, '#7dffb0', 8, 1); break;
      case 'protect': this.shields[s].fire(color === TYPE_HEX.Poison ? '#c77dff' : '#7ff9ff', 1.3); this.light(A, '#7ff9ff', 8, 0.6); break;
      case 'screen': this.walls[s].fire(color, 1.5); this.light(A, color, 6, 0.8); break;
      case 'sleep': for (let i = 0; i < 3; i++) this.rings.fire(A.clone().add(tmp2.set(0.2 * k, 0.6 * k, 0)), '#bcd0ff', { to: A.clone().add(tmp2.set((0.5 + i * 0.1) * k, 1.2 * k, 0)), s0: 0.05 * k, s1: 0.25 * k, dur: 0.9, delay: i * 0.25 }); break;
      case 'sub': P.burst(A, 50, 2, { color: '#ffffff', size: 0.08, ttl: 0.6 }); h.distort(1); h.pulse('#ffffff', 0.9); break;
      case 'transform': h.distort(1); this.rings.fire(A, '#d6a6ff', { s0: 0.1 * k, s1: 1.5 * k, dur: 0.6 }); P.burst(A, 40, 1.8, { color: '#d6a6ff', size: 0.07, ttl: 0.8 }); break;
      case 'revive': this.beams[s].fire(f, f.clone().setY(6), '#fff6c0', 1.3, 0.4 * k); P.swirl(A, 1.1, { color: '#fff6c0', shape: Shape.Star, size: 0.1, radius: 0.6, height: 2.5, rate: 100, w: 3, ttl: 1.1 }); this.light(A, '#fff6c0', 14, 1.2); break;
      case 'curse': P.swirl(A, 1, { color: '#8a6bd1', size: 0.1, sizeEnd: 0.02, radius: 0.7, height: 1.2, rate: 120, w: -3, ttl: 1, inward: true }); this.later(0.6, () => h.distort(0.8)); break;
      case 'drum': for (let i = 0; i < 3; i++) this.later(i * 0.2, () => { this.rings.fire(A, '#ff6a6a', { s0: 0.2 * k, s1: 1.2 * k, dur: 0.3 }); this.shake = Math.max(this.shake, 0.25); }); this.later(0.65, () => h.pulse('#ff4d6d', 0.9)); break;
    }
  }
  /** Swords Dance: swords circle the user, then two of them cross above its head with a flash. */
  private swordsDance(s: 0 | 1) {
    const k = this.fk(s), f = this.foot(s), h = this.holos[s], H = h.height;
    const R = Math.max(0.3, 0.6 * k), cy = ARENA.floorY + H * 0.55, sc = 0.62 * k;
    const cam = this.localCam, yaw = Math.atan2(cam.x - f.x, cam.z - f.z);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const crossAt = 0.62, crossY = ARENA.floorY + H + 0.3 * sc + 0.1;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2, crosser = i < 2, roll = i === 0 ? 0.62 : -0.62;
      const sx = f.x + Math.cos(a0 + crossAt * 7) * R, sz = f.z + Math.sin(a0 + crossAt * 7) * R;
      this.debris.drive('sword', sc, 1.2, (life, p, rot) => {
        if (!crosser || life < crossAt) {
          // Circling the user, blades up.
          const a = a0 + life * 7;
          p.set(f.x + Math.cos(a) * R, cy + Math.sin(life * 6 + i) * 0.05, f.z + Math.sin(a) * R);
          rot.set(0, -a, 0);
          return Math.min(1, life / 0.12) * (!crosser && life > crossAt ? Math.max(0, 1 - (life - crossAt) / 0.15) : 1);
        }
        // Two swords rise and cross in an X above the head, facing the camera; mid-blades meet.
        const e = 1 - Math.pow(1 - Math.min(1, (life - crossAt) / 0.16), 3), rr = roll * e, off = Math.sin(rr) * 0.45 * sc;
        const cx = f.x + right.x * off, cz = f.z + right.z * off;
        p.set(sx + (cx - sx) * e, cy + (crossY - Math.cos(rr) * 0.45 * sc - cy) * e, sz + (cz - sz) * e);
        rot.set(0, yaw, rr);
        return life > 0.95 ? Math.max(0, 1 - (life - 0.95) / 0.25) : 1;
      });
    }
    this.later(crossAt + 0.16, () => {
      const at = new THREE.Vector3(f.x, crossY, f.z);
      this.fx.flares.fire(at, '#dfe9ff', { core: '#ffffff', s0: 0.2 * k, s1: 1.2 * k, dur: 0.4, rays: 8, sharp: 16 });
      this.slashes.fire(at, '#ffffff', 2, 0.6 * k);
      this.snd('slash', s, 0.8);
      h.pulse('#ffffff', 0.7);
    });
    this.px(k).swirl(this.home(s), 0.7, { color: '#e8f0ff', shape: Shape.Star, size: 0.08, radius: 0.7, height: 0.6, rate: 50, w: 7, ttl: 0.6, spin: 5 });
    this.light(this.home(s), '#dfe9ff', 9, 1.1);
  }
  /** Shift Gear: two steel gears appear beside the user and grind against each other. */
  private shiftGear(s: 0 | 1) {
    const k = this.fk(s), P = this.px(k), A = this.home(s), f = this.foot(s), h = this.holos[s];
    const cam = this.localCam, yaw = Math.atan2(cam.x - A.x, cam.z - A.z);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const g = 0.5 * k, pitch = 0.87 * g, toCam = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const c1 = A.clone().addScaledVector(right, -0.32 * k).addScaledVector(toCam, 0.45 * k).setY(A.y + 0.22 * k);
    const c2 = c1.clone().addScaledVector(right, pitch * 0.8).setY(c1.y - pitch * 0.6);
    const contact = c1.clone().lerp(c2, 0.5);
    for (const [c, dirn, ph] of [[c1, 1, 0], [c2, -1, Math.PI / 10]] as const) {
      this.debris.drive('gear', g, 1.15, (life, p, rot) => {
        p.copy(c);
        rot.set(0, yaw, ph + dirn * life * 5);
        return Math.min(1, life / 0.15) * (life > 0.9 ? Math.max(0, 1 - (life - 0.9) / 0.25) : 1);
      });
    }
    P.emitter(0.8, 60, () => P.emit(contact, tmp2.randomDirection().multiplyScalar(1.5), { color: '#fff1c4', size: 0.03, sizeEnd: 0.01, ttl: 0.25, gravity: 4 }));
    this.rings.fire(f, '#cfd7e6', { flat: true, s0: 0.3 * k, s1: 1.3 * k, dur: 0.6, delay: 0.2 });
    this.later(0.85, () => h.pulse('#cfd7e6', 0.6));
    this.light(A, '#cfd7e6', 8, 1);
  }

  private impactBurst(at: THREE.Vector3, color: string, power: number, type?: TypeName, k = 1) {
    const P = this.px(k);
    P.burst(at, Math.round(20 + 30 * power), 2 + power * 1.8, { color, size: 0.06 + 0.03 * power, sizeEnd: 0.01, ttl: 0.55, drag: 2.5 });
    P.burst(at, 10, 1.2, { color: '#ffffff', shape: Shape.Star, size: 0.12 * power, ttl: 0.25, spin: 4 });
    this.light(at, color, 5 + power * 5, 0.4);
    if (type) this.elementBurst(at, type, power, k);
  }

  /** What each element leaves behind where it lands: embers, spray, sparks, leaves, shards, bubbles... */
  private elementBurst(at: THREE.Vector3, type: TypeName, power: number, k = 1) {
    const P = this.px(k), n = (x: number) => Math.round(x * (0.6 + 0.6 * power));
    const dir = () => tmp2.randomDirection();
    switch (type) {
      case 'Fire':
        P.burst(at, n(14), 0.9, { color: '#ff6a1f', size: 0.3, sizeEnd: 0.06, ttl: 0.45, drag: 3 });
        P.burst(at, n(26), 1.5, { color: '#ffc04a', size: 0.08, sizeEnd: 0.015, ttl: 1.0, gravity: -2.2, drag: 1.6 });
        break;
      case 'Water':
        P.burst(at, n(36), 3.2, { color: '#9ad6ff', size: 0.07, sizeEnd: 0.03, ttl: 0.9, gravity: 8, rise: 0.7 });
        this.rings.fire(at, '#cfeeff', { s0: 0.2 * k, s1: 1.1 * k, dur: 0.4 });
        break;
      case 'Electric':
        for (let i = 0; i < 3; i++) this.fx.bolts.fire(at, tmp.copy(at).addScaledVector(dir(), (0.7 + 0.3 * power) * k), '#fff4a0', { dur: 0.14, jitter: 0.1 * k, width: 0.035 * k });
        P.burst(at, n(20), 4, { color: '#fff8c8', size: 0.035, sizeEnd: 0.01, ttl: 0.3, drag: 4 });
        break;
      case 'Grass':
        P.burst(at, n(24), 2.2, { color: '#8cff7a', shape: Shape.Leaf, size: 0.12, sizeEnd: 0.08, ttl: 1, spin: 8, gravity: 2, drag: 2, rise: 0.6 });
        break;
      case 'Ice':
        for (let i = 0; i < n(6); i++) this.debris.throw('shard', at, tmp.copy(dir()).multiplyScalar(2 * k).setY((1.5 + Math.random() * 1.5) * k), 0.05 * k, { ttl: 0.9 });
        P.burst(at, n(22), 2, { color: '#e8fbff', shape: Shape.Flake, size: 0.08, ttl: 0.8, gravity: 1.5, drag: 2, spin: 3 });
        break;
      case 'Poison':
        P.burst(at, n(18), 1, { color: '#c46bff', size: 0.05, sizeEnd: 0.16, ttl: 1.1, gravity: -1.3, drag: 2 });
        P.burst(at, n(14), 2.6, { color: '#a8ff6a', size: 0.05, sizeEnd: 0.02, ttl: 0.7, gravity: 7, rise: 0.5 });
        break;
      case 'Ghost':
        P.burst(at, n(20), 0.9, { color: '#9a6bff', size: 0.16, sizeEnd: 0.02, ttl: 1.1, gravity: -1.4, drag: 1.2 });
        this.rings.fire(at, '#6b3fd6', { s0: 0.1 * k, s1: 1.2 * k, dur: 0.5 });
        break;
      case 'Psychic':
        this.rings.fire(at, '#ff7ad9', { s0: 0.1 * k, s1: 1.5 * k, dur: 0.5 });
        this.rings.fire(at, '#ffc2f0', { s0: 0.1 * k, s1: 0.9 * k, dur: 0.4, delay: 0.08 });
        P.burst(at, n(14), 1.6, { color: '#ff8ae0', shape: Shape.Ring, size: 0.16, ttl: 0.6, drag: 2 });
        break;
      case 'Fairy':
        P.burst(at, n(24), 2, { color: '#ffc4ea', shape: Shape.Star, size: 0.12, ttl: 0.9, spin: 4, drag: 2, rise: 0.3 });
        break;
      case 'Dragon':
        P.burst(at, n(26), 3, { color: '#8f6bff', size: 0.08, sizeEnd: 0.01, ttl: 0.6, drag: 2.5 });
        this.rings.fire(at, '#7a4dff', { s0: 0.2 * k, s1: 1.4 * k, dur: 0.45 });
        this.slashes.fire(at, '#c9b2ff', 1, 0.6 * k);
        break;
      case 'Dark':
        P.burst(at, n(16), 1.1, { color: '#7a5aa6', size: 0.22, sizeEnd: 0.05, ttl: 0.8, drag: 2.5, rise: 0.4 });
        this.slashes.fire(at, '#b9a3e0', 1, 0.55 * k);
        break;
      case 'Steel':
        P.burst(at, n(28), 4.6, { color: '#f4f8ff', size: 0.035, sizeEnd: 0.008, ttl: 0.5, gravity: 9 });
        P.burst(at, 4, 0.4, { color: '#ffffff', shape: Shape.Star, size: 0.3, ttl: 0.18, spin: 2 });
        break;
      case 'Rock':
        for (let i = 0; i < n(5); i++) this.debris.throw('rock', at, tmp.copy(dir()).multiplyScalar(1.8 * k).setY((1.5 + Math.random() * 1.5) * k), 0.06 * k, { ttl: 1.1 });
        P.burst(at, n(16), 1.5, { color: '#d9c08a', size: 0.12, sizeEnd: 0.04, ttl: 0.8, gravity: 2, drag: 2 });
        break;
      case 'Ground':
        P.burst(at, n(24), 1.7, { color: '#c9a66b', size: 0.17, sizeEnd: 0.06, ttl: 0.9, gravity: 1.5, drag: 2.5, rise: 0.3 });
        break;
      case 'Fighting':
        P.burst(at, n(10), 0.9, { color: '#ffb36b', shape: Shape.Star, size: 0.28, ttl: 0.25, spin: 6 });
        this.rings.fire(at, '#ffffff', { s0: 0.1 * k, s1: 1 * k, dur: 0.25 });
        break;
      case 'Flying':
        P.burst(at, n(20), 3.6, { color: '#eef6ff', size: 0.05, sizeEnd: 0.01, ttl: 0.45, drag: 3 });
        P.burst(at, n(8), 1.4, { color: '#ffffff', shape: Shape.Feather, size: 0.12, ttl: 1, spin: 5, gravity: 1.2, drag: 2 });
        break;
      case 'Bug':
        P.burst(at, n(24), 2.4, { color: '#c6e35a', size: 0.06, sizeEnd: 0.01, ttl: 0.6, drag: 2.5 });
        break;
      default:
        P.burst(at, n(12), 2, { color: '#ffffff', size: 0.07, ttl: 0.4, drag: 3 });
    }
  }

  hit(side: 0 | 1, lost: number, crit: boolean, effect: 'super' | 'resist' | 'immune' | 'normal', color: string) {
    const play = () => {
      const h = this.holos[side];
      if (effect === 'immune') { h.dodge(); this.snd('miss', side); return; }
      const strength = Math.min(1, lost * 1.6 + (crit ? 0.3 : 0) + (effect === 'super' ? 0.3 : 0));
      h.hit(strength, effect === 'super' ? color : crit ? '#ffffff' : '#ff4d6d');
      this.px(this.fk(side)).burst(this.center(side), Math.round(12 + strength * 30), 1.4 + strength * 2, { color: effect === 'super' ? color : '#ffd1dc', size: 0.06, ttl: 0.5, drag: 2 });
      const heavy = crit || effect === 'super' || lost > 0.45;
      this.snd(heavy || lost > 0.3 ? 'hitBig' : 'hit', side, effect === 'resist' ? 0.6 : 1);
      if (crit) this.snd('crit', side); else if (effect === 'super') this.snd('super', side); else if (effect === 'resist') this.snd('resist', side);
      if (heavy) {
        this.shake = Math.max(this.shake, 0.4 + strength * 0.6); this.onImpact?.(color);
        // Impact frames: a brief hit-stop on crits and super-effective hits only.
        if (!this.reduced() && !this.lite) { this.freeze = crit ? 0.09 : effect === 'super' ? 0.06 : 0; this.fovPunch = Math.max(this.fovPunch, 2 + strength * 4); }
        this.kickScreen(0.3 + strength * 0.35, crit ? '#ffffff' : color, crit ? 0.08 : 0.04);
      }
    };
    const wait = this.impactAt[side] - this.time;
    if (wait > 0.02) this.later(wait, play); else play();
  }
  heal(side: 0 | 1) {
    this.holos[side].heal();
    this.snd('heal', side, 0.6);
    this.px(this.fk(side)).swirl(this.home(side), 0.6, { color: '#7dffb0', shape: Shape.Star, size: 0.08, radius: 0.6, height: 1.4, rate: 70, w: 2, ttl: 0.8, spin: 3 });
  }
  miss(side: 0 | 1) { const wait = this.impactAt[side] - this.time; this.later(Math.max(0, wait - 0.12), () => { this.holos[side].dodge(); this.snd('miss', side); }); }
  faint(side: 0 | 1) {
    const wait = Math.max(0, this.impactAt[side] - this.time);
    this.later(wait, () => {
      this.holos[side].faint();
      this.morph.revert(side); // transform (ditto)
      this.snd('faint', side);
      this.px(this.fk(side)).burst(this.center(side), 60, 1.4, { color: '#cfd6ff', size: 0.06, ttl: 1.4, rise: 1.2, drag: 1.5 });
      if (!this.reduced()) this.cam.faint(side);
    });
  }
  tera(side: 0 | 1, type: TypeName, instant = false) {
    const c = TYPE_HEX[type];
    this.holos[side].tera(c);
    if (instant) return;
    this.snd('tera', side);
    const A = this.home(side), k = this.fk(side);
    this.px(k).burst(A, 90, 3.2, { color: c, shape: Shape.Star, size: 0.12, ttl: 1, drag: 2.5, spin: 5 });
    this.rings.fire(A, c, { s0: 0.2 * k, s1: 2.2 * k, dur: 0.7 });
    this.rings.fire(this.foot(side), c, { flat: true, s0: 0.2 * k, s1: 2.6 * k, dur: 0.9 });
    this.light(A, c, 22, 1.2);
    this.shake = Math.max(this.shake, 0.5); this.onImpact?.(c);
    this.kickScreen(0.6, c, 0.12);
    if (!this.reduced()) this.cam.tera(side);
  }
  status(side: 0 | 1, s: string | null) { this.holos[side].status(s ? STATUS_HEX[s] ?? null : null, s === 'slp'); if (s) this.snd('status', side); }
  boost(side: 0 | 1, up: boolean) {
    this.snd(up ? 'buff' : 'debuff', side, 0.7);
    const h = this.holos[side].height;
    const at = this.home(side).setY(ARENA.floorY + (up ? h * 0.25 : h * 1.2));
    this.px(this.fk(side)).burst(at, 26, 1.2, { color: up ? '#7fe9ff' : '#ff7a7a', size: 0.06, ttl: 0.8, rise: up ? 1.4 : -1.4, drag: 1 });
  }
  /** True while a move animation plays (until its impact). */
  get attacking() { return this.time < this.fxUntil; }
  /** Head and feet of a side's active Pokemon in world space; false while nobody stands there. */
  monBounds(side: 0 | 1, head: THREE.Vector3, foot: THREE.Vector3): boolean {
    const h = this.holos[side];
    if (!h.present) return false;
    const m = ARENA.mon[side];
    head.set(m.x, ARENA.floorY + h.height * 1.02 + 0.04, m.z); foot.set(m.x, ARENA.floorY, m.z);
    this.group.localToWorld(head); this.group.localToWorld(foot);
    return true;
  }

  /** A side's lasting conditions (simulator names to layer counts). */
  setSideField(side: 0 | 1, layers: SideLayers, instant: boolean) { this.persist.set(side, layers, instant); }
  setWeather(w: string | null) { this.weather = w; }

  clear() {
    this.persist.clear(); this.weather = null; this.fxUntil = 0;
    for (const h of this.holos) h.hide();
    this.morph.clear(); // transform (ditto)
    for (const o of this.orbs) o.stop();
    this.particles.clear(); this.rings.clear(); this.debris.clear(); this.flashes.clear();
    this.jobs.length = 0; this.cam.reset(); this.impactAt = [0, 0];
  }
  /**
   * Compile every effect's shaders now (pooled meshes are hidden until first use, and the renderer only
   * compiles what is visible), so no move stalls a frame compiling the first time it is played.
   */
  prewarm(compile: (o: THREE.Object3D) => Promise<unknown>) {
    const hidden: THREE.Object3D[] = [];
    this.group.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const done = compile(this.group);
    for (const o of hidden) o.visible = false;
    return done;
  }
  /** Point sprites are sized in pixels: a miniature multiplies the render's pixel scale by its own scale. */
  setPixelScale(s: number) { const k = s * this.scale; for (const o of this.orbs) o.mat.uniforms.uScale.value = k; this.particles.mat.uniforms.uScale.value = k; }

  update(dt: number) {
    // Hit-stop: a few frames of near-freeze sell heavy impacts.
    if (this.freeze > 0) { this.freeze -= dt; dt *= 0.06; }
    this.time += dt;
    for (let i = this.jobs.length - 1; i >= 0; i--) if (this.jobs[i].at <= this.time) { const j = this.jobs[i]; this.jobs.splice(i, 1); j.fn(); }
    const reduced = this.reduced();
    // Billboards and aiming need the camera in stage space (the plaza's miniature is a scaled, moved group).
    this.group.updateWorldMatrix(true, false);
    this.localCam.copy(this.camera.position); this.group.worldToLocal(this.localCam);
    for (const h of this.holos) h.update(dt, this.time, this.camera, this.localCam, reduced, this.group.localToWorld(this.holos[1 - h.side].center(this.foeWorld)));
    this.morph.update(dt); // transform (ditto)
    // Shields and screens fit the Pokémon behind them; the camera frames each one at its size.
    for (const s of [0, 1] as const) {
      const h = this.holos[s], k = Math.max(0.42, h.height / 1.2);
      this.shields[s].mesh.position.y = h.cy; this.shields[s].mesh.scale.setScalar(k);
      this.walls[s].mesh.position.y = h.cy; this.walls[s].mesh.scale.setScalar(k);
    }
    this.cam.setHeights(this.holos[0].height, this.holos[1].height);
    this.cam.setFrame((this.camera as THREE.PerspectiveCamera).aspect ?? 16 / 9, this.holos[0].footprint, this.holos[1].footprint);
    if (this.cam.isOpening && this.holos[0].settled && this.holos[1].settled) this.cam.openingEnd();
    for (const o of this.orbs) o.update(dt);
    this.persist.update(dt);
    this.weatherFall(dt);
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

  /** Lasting weather: a steady trickle of particles across the field while it is up. */
  private weatherFall(dt: number) {
    const w = this.weather;
    if (!w || this.lite) { this.weatherAcc = 0; return; }
    const reduced = this.reduced();
    const rate = (w === 'RainDance' || w === 'PrimordialSea' ? 110 : w === 'Sandstorm' ? 70 : w === 'Snow' || w === 'Snowscape' || w === 'Hail' ? 45 : w === 'SunnyDay' || w === 'DesolateLand' ? 10 : 0) * (reduced ? 0.4 : 1);
    this.weatherAcc = Math.min(8, this.weatherAcc + rate * dt);
    const P = this.particles;
    while (this.weatherAcc >= 1) {
      this.weatherAcc -= 1;
      const x = -3.4 + Math.random() * 6.8, z = -3.2 + Math.random() * 6.2;
      if (w === 'RainDance' || w === 'PrimordialSea') P.emit(tmp.set(x, 2.8 + Math.random() * 0.6, z), tmp2.set(0.4, -7.5, 0.1), { color: '#9fc8ff', size: 0.03, sizeEnd: 0.02, ttl: 0.42, alpha: 0.55 });
      else if (w === 'Sandstorm') P.emit(tmp.set(-3.8, ARENA.floorY + Math.random() * 1.8, z), tmp2.set(4.5 + Math.random() * 2, (Math.random() - 0.5) * 0.4, -0.6), { color: Math.random() < 0.5 ? '#d9b77a' : '#b89359', size: 0.04, sizeEnd: 0.025, ttl: 1.6, alpha: 0.6 });
      else if (w === 'SunnyDay' || w === 'DesolateLand') P.emit(tmp.set(x, ARENA.floorY + 0.2 + Math.random() * 1.6, z), tmp2.set(0, 0.25, 0), { color: '#ffd77a', size: 0.04, sizeEnd: 0.01, ttl: 2.2, alpha: 0.5 });
      else P.emit(tmp.set(x, 2.6 + Math.random() * 0.6, z), tmp2.set(0.12, -0.7 - Math.random() * 0.3, 0.05), { color: '#ffffff', shape: Shape.Flake, size: 0.045, ttl: 3.4, spin: 1.5 });
    }
  }

  dispose() {
    this.persist.dispose();
    this.morph.dispose(); // transform (ditto)
    for (const h of this.holos) h.dispose();
    for (const o of this.orbs) { o.mesh.geometry.dispose(); o.mat.dispose(); }
    this.particles.dispose(); this.rings.dispose(); this.slashes.dispose(); this.debris.dispose();
    for (const b of this.beams) b.dispose();
    for (const b of [...this.shields, ...this.walls]) b.dispose();
    for (const p of texCache.values()) void p.then(t => t.dispose());
    texCache.clear();
  }
}
