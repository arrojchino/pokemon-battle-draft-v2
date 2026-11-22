import * as THREE from 'three';
import type { Character, Emote } from '../../characters/roster.js';
import { pokemonArt } from '../../assets.js';
import { SmoothVec3, dampFactor, easeInOutCubic, smoothDamp } from '../math.js';
import { MonBody, type MonModel } from './monModel.js';

/** Top of the stage platform: partners stand on it. */
export const FLOOR_Y = 0.205;

type Off = { x: number; y: number; z: number; rx: number; ry: number; rz: number; sy: number };
type Motion = { dur: number; clip?: readonly string[]; f: (u: number, o: Off) => void };

const hop = (u: number, n: number, h: number) => h * Math.abs(Math.sin(u * Math.PI * n));
const bell = (u: number) => Math.sin(u * Math.PI);

/**
 * Each reaction: a short procedural body motion (works for every model, animated or not) and, for models
 * with Scarlet/Violet clips, the matching authored action. When a clip plays, the procedural part is
 * scaled down so the two never fight.
 */
const MOTIONS: Record<Exclude<Emote, 'idle'>, Motion> = {
  greet: { dur: 0.9, clip: ['notice01', 'glad01'], f: (u, o) => { o.y = hop(u, 2, 0.12); o.rz = Math.sin(u * Math.PI * 2) * 0.07; } },
  nod: { dur: 0.5, f: (u, o) => { o.sy = 1 - 0.05 * bell(u); o.rx = 0.12 * bell(u); } },
  bow: { dur: 0.9, f: (u, o) => { o.rx = 0.3 * bell(u); o.sy = 1 - 0.04 * bell(u); } },
  thumbs: { dur: 0.7, clip: ['glad01'], f: (u, o) => { o.y = hop(u, 1, 0.2); o.sy = 1 + 0.06 * Math.sin(u * Math.PI * 2); } },
  excited: { dur: 1.0, clip: ['glad01', 'roar01'], f: (u, o) => { o.y = hop(u, 3, 0.14); o.rz = Math.sin(u * Math.PI * 3) * 0.05; } },
  surprised: { dur: 0.6, clip: ['notice01'], f: (u, o) => { o.z = -0.16 * bell(u); o.y = 0.1 * bell(u); o.x = Math.sin(u * 60) * 0.025 * (1 - u); } },
  thinking: { dur: 1.4, clip: ['defaultidle02', 'defaultidle01'], f: (u, o) => { o.rz = Math.sin(u * Math.PI * 2) * 0.12; } },
  sad: { dur: 1.4, clip: ['damage02', 'damage01'], f: (u, o) => { o.y = -0.05 * bell(u); o.sy = 1 - 0.08 * bell(u); o.rx = 0.22 * bell(u); } },
  punch: { dur: 0.55, clip: ['attack01', 'rangeattack01'], f: (u, o) => { o.z = 0.3 * (u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7); o.rx = -0.12 * bell(u); } },
  victory: { dur: 1.4, clip: ['glad01', 'roar01'], f: (u, o) => { o.ry = easeInOutCubic(u) * Math.PI * 2; o.y = hop(u, 2, 0.2); } },
  twirl: { dur: 1.0, clip: ['glad01'], f: (u, o) => { o.ry = easeInOutCubic(u) * Math.PI * 2; } },
  faceplant: { dur: 2.0, clip: ['down01_start', 'damage02', 'damage01'], f: (u, o) => { const k = u < 0.2 ? u / 0.2 : u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25; o.rx = 1.0 * easeInOutCubic(k); o.y = -0.03 * k; } },
};

let shadowTex: THREE.Texture | null = null;
function contactShadow(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.55, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin('anonymous');

/**
 * A partner Pokémon on the field: its 3D model (or, when the model cannot load, its official artwork
 * standing as a card), placement springs, a contact shadow, a Poké Ball send-out flash when it appears,
 * idle breathing, reactions, and a gentle turn toward whatever it is looking at.
 */
export class MonRig {
  readonly root = new THREE.Group();
  readonly pos = new SmoothVec3();
  readonly height: number;
  private pivot = new THREE.Group();
  private body: MonBody | null;
  private card: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private burst: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private burstT = 1;
  private motion: { m: Motion; t: number; k: number } | null = null;
  private upTimer = 0;
  private lookWorld = new THREE.Vector3();
  private off: Off = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sy: 1 };
  private appear = 0; private appearTarget = 0; private appearV = { v: 0 };
  private yaw = 0; private yawTarget = 0;
  private lookLocal = new THREE.Vector3(0, 1, 3);
  private invRoot = new THREE.Matrix4();
  private clock = Math.random() * 10;
  facing = 0; facingTarget = 0; private facingV = { v: 0 };
  hovered = false; focused = false;
  private strideSpeed = 0; private strideClip = false;
  reducedMotion = false;

  constructor(model: MonModel | null, readonly character: Character) {
    this.pivot.position.y = FLOOR_Y;
    this.root.add(this.pivot);
    if (model) {
      this.body = new MonBody(model);
      this.pivot.add(this.body.root);
      this.height = this.body.height;
    } else {
      // Fallback: the official artwork as a standing card that turns to the camera.
      this.body = null;
      this.height = 1.3;
      const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false });
      this.card = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat);
      this.card.position.y = 0.66;
      this.pivot.add(this.card);
      texLoader.loadAsync(pokemonArt(character.dex)).then(t => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; }).catch(() => { /* stays invisible */ });
    }
    const r = Math.max(0.35, Math.min(0.9, (model?.radius ?? 0.45) * 0.9));
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2), new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, opacity: 0.8 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = FLOOR_Y + 0.004; this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
    this.burst = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.burst.position.y = FLOOR_Y + this.height * 0.5; this.burst.visible = false;
    this.root.add(this.burst);
  }

  play(e: Emote) {
    if (e === 'idle') { this.motion = null; return; }
    if (this.reducedMotion && (e === 'twirl' || e === 'victory' || e === 'faceplant')) e = 'thumbs';
    const m = MOTIONS[e];
    const b = this.body;
    // A collapse holds on the floor for a beat, then the model gets back up with its own clip.
    const down = e === 'faceplant' && !!b?.has(['down01_start']);
    const clipDur = m.clip && b?.animated ? b.act(down ? ['down01_start'] : m.clip, { hold: down }) : 0;
    if (down) { window.clearTimeout(this.upTimer); this.upTimer = window.setTimeout(() => { b!.act(['down01_end']); }, 1500); }
    // Body language on top for every model: a cheer, a flinch, a lunge.
    if (b) {
      if (e === 'excited' || e === 'victory' || e === 'thumbs' || e === 'greet' || e === 'twirl') b.pulse('cheer');
      else if (e === 'surprised' || e === 'sad') b.pulse('hit');
      else if (e === 'punch') b.pulse('attack', 0.3);
    }
    // With an authored clip the procedural motion is a light accent (a spin stays a full spin; a collapse
    // is all clip).
    this.motion = { m, t: 0, k: clipDur ? (e === 'victory' || e === 'twirl' ? 1 : down ? 0 : 0.3) : 1 };
  }

  setVisible(v: boolean, instant = false) {
    const wasHidden = this.appearTarget === 0;
    this.appearTarget = v ? 1 : 0;
    if (instant) this.appear = this.appearTarget;
    if (v) {
      this.root.visible = true;
      // Poké Ball send-out: a white flash the Pokémon pops out of.
      if (wasHidden && !instant && !this.reducedMotion) { this.burstT = 0; this.appear = 0; }
    }
  }
  get isShown() { return this.appearTarget > 0; }

  place(x: number, z: number, facing: number, instant = false) {
    this.pos.target.set(x, 0, z); this.facingTarget = facing;
    if (instant) { this.pos.snap(); this.facing = facing; this.facingV.v = 0; this.root.position.copy(this.pos.value); this.root.rotation.y = facing; }
  }

  /** See-through (plaza: when it stands between the camera and the player's own partner). 1 is solid. */
  setFade(a: number) {
    this.body?.setOpacity(a);
    if (this.card) { this.card.material.opacity = a; this.card.material.transparent = true; }
  }
  /** Plaza locomotion: walk or run loops matched to the ground speed (units per second); idle when still. */
  stride(speed: number, walk: number, run: number) {
    const kind = speed < 0.1 ? null : speed > (walk + run) * 0.5 ? 'run' : 'walk';
    const rate = kind === 'run' ? THREE.MathUtils.clamp(speed / run, 0.75, 1.35) : kind === 'walk' ? THREE.MathUtils.clamp(speed / walk, 0.6, 1.35) : 1;
    this.strideSpeed = kind ? speed : 0;
    this.strideClip = this.body ? this.body.gaitTo(kind, rate) : false;
  }

  lookAt(world: THREE.Vector3) {
    this.lookWorld.copy(world);
    this.root.updateMatrixWorld();
    this.invRoot.copy(this.root.matrixWorld).invert();
    this.lookLocal.copy(world).applyMatrix4(this.invRoot);
    const yaw = Math.atan2(this.lookLocal.x, Math.max(0.2, this.lookLocal.z));
    // A model turns a little toward its target; the artwork card turns fully to stay readable.
    // The body turns a little; the head (procedural look-at) does the rest.
    this.yawTarget = this.card ? Math.atan2(this.lookLocal.x, this.lookLocal.z) : THREE.MathUtils.clamp(yaw, -0.3, 0.3);
  }

  update(dt: number) {
    this.appear = smoothDamp(this.appear, this.appearTarget, this.appearV, this.appearTarget ? 0.11 : 0.07, dt);
    if (this.appearTarget === 0 && this.appear < 0.02) { this.root.visible = false; this.appear = 0; }
    if (!this.root.visible) return;
    this.clock += dt;
    this.pos.update(0.45, dt);
    this.root.position.copy(this.pos.value);
    this.facing = smoothDamp(this.facing, this.facingTarget, this.facingV, 0.35, dt);
    this.root.rotation.y = this.facing;

    const o = this.off; o.x = o.y = o.z = o.rx = o.ry = o.rz = 0; o.sy = 1;
    if (this.motion) {
      this.motion.t += dt;
      const u = Math.min(1, this.motion.t / this.motion.m.dur);
      this.motion.m.f(u, o);
      const k = this.motion.k * (this.reducedMotion ? 0.35 : 1);
      o.x *= k; o.y *= k; o.z *= k; o.rx *= k; o.rz *= k; o.sy = 1 + (o.sy - 1) * k;
      if (this.reducedMotion) o.ry = 0;
      if (u >= 1) this.motion = null;
    }
    // Breathing for models without their own idle loop.
    if (!this.body?.animated && !this.reducedMotion) { o.sy *= 1 + Math.sin(this.clock * 2.1) * 0.012; o.y += Math.sin(this.clock * 1.3) * 0.008; }
    // Without a walk clip (and for artwork cards) the partner hops along instead.
    if (this.strideSpeed > 0 && !this.strideClip && !this.reducedMotion) {
      const ph = this.clock * (7 + this.strideSpeed * 2);
      o.y += Math.abs(Math.sin(ph)) * 0.06; o.rz += Math.sin(ph) * 0.05;
    }

    this.yaw += (this.yawTarget - this.yaw) * dampFactor(this.card ? 8 : 3, dt);
    const s = Math.max(0.001, this.appear) * (this.hovered ? 1.04 : 1);
    this.pivot.position.set(o.x, FLOOR_Y + o.y, o.z);
    this.pivot.rotation.set(o.rx, this.yaw + o.ry, o.rz);
    this.pivot.scale.set(s, s * o.sy, s);
    this.shadow.scale.setScalar(Math.max(0.001, this.appear) * (1 - Math.min(0.5, o.y * 1.5)));
    if (this.body) { this.body.lookAt(this.lookWorld); this.body.update(dt); }

    if (this.burstT < 1) {
      this.burstT = Math.min(1, this.burstT + dt / 0.45);
      const b = this.burstT;
      this.burst.visible = b < 1;
      this.burst.scale.setScalar(0.2 + b * 1.6);
      this.burst.material.opacity = (1 - b) * (1 - b) * 0.9;
    }
  }

  dispose() {
    window.clearTimeout(this.upTimer);
    this.root.removeFromParent();
    this.body?.dispose();
    if (this.card) { this.card.geometry.dispose(); this.card.material.map?.dispose(); this.card.material.dispose(); }
    this.shadow.geometry.dispose(); this.shadow.material.dispose();
    this.burst.geometry.dispose(); this.burst.material.dispose();
  }
}
