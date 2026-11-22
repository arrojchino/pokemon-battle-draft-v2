// The plaza's Pokémon Center presenter: a friendly receptionist / tournament host NPC.
//
// Model: VRoid Studio sample "β Ver AvatarSample_4" (Victoria Rubin) by pixiv Inc., CC0
// (https://vroid.pixiv.help/hc/en-us/articles/360014900233), recoloured into a Pokémon Center uniform by
// `tools/pack_presenter.py`; the nurse cap and headset are modelled in `accessories.ts`.
//
// Everything moves procedurally on the VRM normalized humanoid: layered idle (breathing, weight shifts,
// glances, blinks, small fidgets), two-bone IK arms for the gestures, IK legs with planted feet that step
// while she turns, eyes that lead the head, and viseme talking. Every layer blends through smooth weights,
// so calls can interrupt each other at any moment without pops. Timings are randomised; nothing loops.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MToonMaterial, VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { Lipsync, VISEMES } from './lipsync.js';
import { buildHeadset, buildNurseCap, hairHeightField } from './accessories.js';
import {
  bump, clamp, damp, drift, flipQ, flipV, lerp, makeLimb, quatFromEuler, rand, smooth, solveLimb, spring, wrapAngle,
  type Limb, type Vec3,
} from './rig.js';

export type PresenterGesture = 'present' | 'nod' | 'point';
export interface PresenterOptions {
  reducedMotion?: boolean;
  /** Override the asset URL (default `${BASE_URL}npc/presenter.vrm`). */
  url?: string;
  /** Presenter headset microphone (default true). */
  headset?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}

/** Overall height in world metres (top of the cap). */
const TARGET_HEIGHT = 1.67;

// ------------------------------------------------------------------ authored poses (body space, left side)
type ArmGoalDef = { wrist: Vec3; pole: Vec3; along: Vec3; normal: Vec3; twist?: number };
const ARM: Record<'relaxed' | 'clasp' | 'wave' | 'present' | 'point' | 'beat' | 'chest', ArmGoalDef> = {
  relaxed: { wrist: [0.232, 0.995, 0.05], pole: [0.35, 0.05, -1], along: [0.06, -1, 0.18], normal: [-1, 0.05, -0.15], twist: 0.5 },
  clasp: { wrist: [0.05, 1.085, 0.168], pole: [1, -0.15, -0.55], along: [-0.78, -0.42, 0.12], normal: [0.05, -0.3, -1], twist: 0.6 },
  wave: { wrist: [0.305, 1.47, 0.13], pole: [0.55, -1, -0.2], along: [0.12, 1, 0.08], normal: [0.02, 0.05, 1], twist: 0.7 },
  present: { wrist: [0.335, 1.11, 0.215], pole: [0.6, -1, -0.45], along: [0.52, 0.12, 0.85], normal: [-0.05, 1, 0.08], twist: 0.75 },
  point: { wrist: [0.355, 1.29, 0.245], pole: [0.45, -1, -0.35], along: [0.66, -0.12, 0.74], normal: [-0.35, -0.94, 0.0], twist: 0.6 },
  beat: { wrist: [0.205, 1.1, 0.2], pole: [0.75, -0.6, -0.5], along: [0.3, 0.3, 0.9], normal: [-0.35, 0.8, 0.2], twist: 0.65 },
  chest: { wrist: [0.06, 1.25, 0.15], pole: [0.9, -0.5, -0.4], along: [-0.55, 0.65, 0.2], normal: [-0.15, 0.15, -1], twist: 0.6 },
};

// finger curls (left hand, XYZ Euler; the right hand mirrors)
type Shape = Record<string, Vec3>;
const F = (p: number, i: number, d: number, spread = 0): [Vec3, Vec3, Vec3] => [[0, spread, -p], [0, 0, -i], [0, 0, -d]];
function shape(idx: [Vec3, Vec3, Vec3], mid: [Vec3, Vec3, Vec3], ring: [Vec3, Vec3, Vec3], lit: [Vec3, Vec3, Vec3], th: [Vec3, Vec3, Vec3]): Shape {
  const s: Shape = {};
  const put = (n: string, segs: string[], v: [Vec3, Vec3, Vec3]) => segs.forEach((g, k) => { s[n + g] = v[k]; });
  put('Index', ['Proximal', 'Intermediate', 'Distal'], idx);
  put('Middle', ['Proximal', 'Intermediate', 'Distal'], mid);
  put('Ring', ['Proximal', 'Intermediate', 'Distal'], ring);
  put('Little', ['Proximal', 'Intermediate', 'Distal'], lit);
  put('Thumb', ['Metacarpal', 'Proximal', 'Distal'], th);
  return s;
}
const HAND: Record<'relaxed' | 'open' | 'point' | 'clasp' | 'wave', Shape> = {
  relaxed: shape(F(0.22, 0.34, 0.22, 0.03), F(0.3, 0.42, 0.26), F(0.36, 0.46, 0.28, -0.04), F(0.42, 0.48, 0.28, -0.09), [[0.1, -0.18, -0.06], [0, -0.12, -0.12], [0, -0.1, -0.1]]),
  open: shape(F(0.06, 0.08, 0.05, 0.06), F(0.07, 0.08, 0.05), F(0.09, 0.1, 0.06, -0.06), F(0.12, 0.1, 0.06, -0.14), [[0.05, -0.02, 0.1], [0, 0.02, 0], [0, 0, 0]]),
  wave: shape(F(0.04, 0.06, 0.04, 0.08), F(0.05, 0.06, 0.04), F(0.07, 0.08, 0.05, -0.08), F(0.1, 0.08, 0.05, -0.17), [[0.05, -0.02, 0.12], [0, 0.03, 0], [0, 0, 0]]),
  point: shape(F(0.0, 0.02, 0.02, 0.02), F(1.2, 1.45, 0.9), F(1.25, 1.45, 0.9, -0.04), F(1.3, 1.4, 0.9, -0.1), [[0.25, -0.45, -0.3], [0, -0.45, -0.25], [0, -0.35, -0.2]]),
  clasp: shape(F(0.45, 0.55, 0.3, 0.02), F(0.5, 0.58, 0.32), F(0.55, 0.6, 0.32, -0.03), F(0.6, 0.6, 0.32, -0.06), [[0.15, -0.3, -0.1], [0, -0.2, -0.15], [0, -0.15, -0.1]]),
};
const FINGER_KEYS = Object.keys(HAND.relaxed);

// leg stance (body space): ankle positions and toe-out yaw
const STANCE = { left: { pos: [0.046, 0.1437, -0.016] as Vec3, yaw: 0.13 }, right: { pos: [-0.044, 0.1437, -0.036] as Vec3, yaw: -0.08 } };

const AXIAL: VRMHumanBoneName[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'];
type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];

type LayerKind = 'greet' | 'present' | 'point' | 'nod' | 'beat' | 'clasp' | 'stretch';
interface Layer { kind: LayerKind; t: number; dur: number; side: Side; fade: number; fadeFrom: number; w: number; seed: number }

interface Foot { anchor: THREE.Vector3; yaw: number; stepping: boolean; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; fromYaw: number; toYaw: number; lift: number }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const vec = (v: Vec3, out = new THREE.Vector3()) => out.set(v[0], v[1], v[2]);

export class Presenter {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly vrm: VRM;
  /** Bytes downloaded for the model (for QA readouts). */
  bytes = 0;

  private readonly yawPivot = new THREE.Group();
  private readonly scale: number;
  private readonly flip: boolean;
  private readonly nb = new Map<VRMHumanBoneName, THREE.Object3D>();
  private readonly rest = new Map<VRMHumanBoneName, THREE.Vector3>();
  private readonly target = new Map<VRMHumanBoneName, THREE.Quaternion>();
  private readonly limbs: Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', Limb>;
  private readonly ucRest = new THREE.Vector3();
  private readonly hipsRest = new THREE.Vector3();
  private readonly headRest = new THREE.Vector3();
  private readonly lipsync = new Lipsync();
  private readonly eyeTarget = new THREE.Object3D();
  private readonly props: THREE.Object3D[] = [];
  private reduced: boolean;

  // state
  private time = 0;
  private started = false;
  private lastRootPos = new THREE.Vector3();
  private attentive = false; private attW = 0;
  private talking = false; private talkW = 0;
  private layers: Layer[] = [];
  private lookPoint: THREE.Vector3 | null = null;
  private glance = new THREE.Vector3(0, 1.5, 3); private glanceNext = 1.5; private microNext = 0.8; private micro = new THREE.Vector3();
  private headYaw = 0; private headPitch = 0; private headYawV = { v: 0 }; private headPitchV = { v: 0 };
  private eyeWorld = new THREE.Vector3(); private eyeInit = false;
  private bodyYaw = 0; private bodyYawV = { v: 0 }; private yawGoal = 0; private yawWanted = 0; private turning = false; private offAxisFor = 0;
  private feet: Record<Side, Foot>;
  private lastStep: Side = 'right';
  private weight = 0; private weightV = { v: 0 }; private weightGoal = 0.6; private weightNext = 5;
  private fidgetNext = 12;
  private beatNext = 1.2; private beatSide: Side = 'right';
  private blinkNext = 2; private blinkT = -1; private blinkDouble = false;
  private breath = 0; private breathRate = 0.23;
  private expr = { happy: 0, relaxed: 0.2, blink: 0 };
  private hipsPos = new THREE.Vector3();
  private smoothing = 30;

  static async load(opts: PresenterOptions = {}): Promise<Presenter> {
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const url = opts.url ?? `${import.meta.env.BASE_URL}npc/presenter.vrm`;
    let bytes = 0;
    const gltf = await loader.loadAsync(url, ev => { bytes = ev.loaded; opts.onProgress?.(ev.loaded, ev.total); });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`Presenter: ${url} is not a VRM`);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    const p = new Presenter(vrm, opts);
    p.bytes = bytes;
    return p;
  }

  private constructor(vrm: VRM, opts: PresenterOptions) {
    this.vrm = vrm;
    this.reduced = !!opts.reducedMotion;
    this.flip = vrm.meta.metaVersion === '0';
    this.root.name = 'Presenter';
    this.root.add(this.yawPivot);
    this.yawPivot.add(vrm.scene);
    this.root.add(this.eyeTarget);

    // bones + rest offsets (body space)
    const names = Object.keys(vrm.humanoid.humanBones) as VRMHumanBoneName[];
    for (const n of names) {
      const node = vrm.humanoid.getNormalizedBoneNode(n);
      if (!node) continue;
      this.nb.set(n, node);
      const r = node.position.clone();
      if (this.flip) flipV(r);
      this.rest.set(n, r);
      this.target.set(n, new THREE.Quaternion());
    }
    const R = (n: VRMHumanBoneName) => this.rest.get(n) ?? new THREE.Vector3();
    this.hipsRest.copy(R('hips'));
    this.ucRest.copy(R('hips')).add(R('spine')).add(R('chest')).add(R('upperChest'));
    this.headRest.copy(this.ucRest).add(R('neck')).add(R('head'));
    const arm = (s: Side) => makeLimb(R(`${s}UpperArm`), R(`${s}LowerArm`), R(`${s}Hand`), new THREE.Vector3(0, 0, 1),
      R(`${s}MiddleProximal`).lengthSq() > 0 ? R(`${s}MiddleProximal`) : new THREE.Vector3(s === 'left' ? 1 : -1, 0, 0), new THREE.Vector3(0, -1, 0));
    const leg = (s: Side) => makeLimb(R(`${s}UpperLeg`), R(`${s}LowerLeg`), R(`${s}Foot`), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
    this.limbs = { leftArm: arm('left'), rightArm: arm('right'), leftLeg: leg('left'), rightLeg: leg('right') };

    // materials: Pokémon Center look + render flags
    this.recolour();
    vrm.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
    });

    // props on the head bone (raw bone: it is the one the skin follows)
    const head = vrm.humanoid.getRawBoneNode('head');
    if (head) {
      const acc = new THREE.Group(); acc.name = 'PresenterProps';
      if (this.flip) acc.rotation.y = Math.PI;
      const hairMeshes: THREE.Mesh[] = [];
      vrm.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (mats.some(x => /HAIR/i.test(x.name) && !/HairBack/i.test(x.name))) hairMeshes.push(m);
      });
      const headLocal = this.headRest.clone();
      const field = hairHeightField(hairMeshes, this.flip ? flipV(headLocal.clone()) : headLocal, this.flip);
      const cap = buildNurseCap(field);
      acc.add(cap);
      if (opts.headset !== false) acc.add(buildHeadset({ side: 1 }));
      acc.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
      head.add(acc);
      this.props.push(acc);
    }

    // scale to the target height (measured on the bind pose incl. the cap)
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const raw = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
    this.scale = TARGET_HEIGHT / raw;
    this.yawPivot.scale.setScalar(this.scale);
    this.height = raw * this.scale;

    // look-at: the eyes follow a helper object we steer
    vrm.lookAt && (vrm.lookAt.target = this.eyeTarget, vrm.lookAt.autoUpdate = true);
    this.feet = {
      left: this.newFoot('left'),
      right: this.newFoot('right'),
    };
    this.lipsync.setRate(this.reduced ? 0.85 : 1);
    this.blinkNext = rand(1, 3);
    this.weightNext = rand(4, 8);
    this.fidgetNext = rand(10, 18);
    this.breath = Math.random() * Math.PI * 2;
    this.hipsPos.copy(this.hipsRest);
    this.update(0);
  }

  // ---------------------------------------------------------------- public API
  /** Head and eyes track a world point (clamped to natural ranges); null returns to ambient looking around. */
  lookAt(target: THREE.Vector3 | null): void {
    if (!target) { if (this.lookPoint) this.glanceNext = Math.min(this.glanceNext, 0.6); this.lookPoint = null; return; }
    (this.lookPoint ??= new THREE.Vector3()).copy(target);
  }

  /** Turn the body on the spot to face a world (x, z) point; the feet step through the turn. */
  turnToward(x: number, z: number): void {
    this.root.updateWorldMatrix(true, false);
    _v1.set(x, 0, z);
    const inv = _q1.copy(this.root.getWorldQuaternion(_q2)).invert();
    const rp = this.root.getWorldPosition(_v2);
    _v1.sub(rp).applyQuaternion(inv);
    if (_v1.x * _v1.x + _v1.z * _v1.z < 1e-4) return;
    this.yawWanted = this.bodyYaw + wrapAngle(Math.atan2(_v1.x, _v1.z) - this.bodyYaw);
  }

  /** Friendly wave with the right hand, a small bow and a happy face (~1.9 s). */
  greet(): void { this.startLayer('greet', this.reduced ? 2.3 : 1.9, 'right'); }

  /** Visemes cycle naturally and small hand beats accompany the words while `on`. */
  talk(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (on) { this.lipsync.start(); this.beatNext = rand(0.6, 1.4); } else this.lipsync.stop();
  }

  /** 'present' offers an open palm to the side (her left by default), 'nod' agrees, 'point' points to the side. */
  gesture(kind: PresenterGesture, side: Side = 'left'): void {
    if (kind === 'nod') this.startLayer('nod', this.reduced ? 1.25 : 1.0, side);
    else if (kind === 'present') this.startLayer('present', this.reduced ? 2.6 : 2.3, side);
    else this.startLayer('point', this.reduced ? 2.4 : 2.1, side);
  }

  /** A player is near: she straightens up and folds her hands, attention on them. */
  setAttentive(on: boolean): void { this.attentive = on; }

  setReducedMotion(on: boolean): void { this.reduced = on; this.lipsync.setRate(on ? 0.85 : 1); }

  /** True while a greet / gesture is playing. */
  get busy(): boolean { return this.layers.some(l => l.kind !== 'beat' && l.kind !== 'clasp' && l.kind !== 'stretch' && l.fade < 0); }

  dispose(): void {
    this.root.removeFromParent();
    for (const p of this.props) p.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    VRMUtils.deepDispose(this.vrm.scene);
    this.layers = [];
  }

  // ---------------------------------------------------------------- frame
  update(dt: number): void {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    const A = this.reduced ? 0.55 : 1;

    // springs/teleports: settle the hair/skirt when we are first placed or moved far in one frame
    this.root.updateWorldMatrix(true, false);
    const rp = this.root.getWorldPosition(_v1);
    const teleported = this.started && rp.distanceTo(this.lastRootPos) > 0.6;
    this.lastRootPos.copy(rp);

    this.attW += ((this.attentive ? 1 : 0) - this.attW) * damp(this.reduced ? 2.2 : 3.2, dt);
    this.talkW += ((this.talking ? 1 : 0) - this.talkW) * damp(4, dt);
    this.lipsync.update(dt);
    this.tickLayers(dt);
    this.schedule(dt);
    this.updateTurn(dt);
    this.composePose(dt, A);
    this.updateFace(dt);
    this.updateEyes(dt);

    this.root.updateMatrixWorld(true);
    if (!this.started || teleported) {
      this.vrm.update(0);
      this.vrm.springBoneManager?.reset();
      this.started = true;
    }
    this.vrm.update(dt);
  }

  // ---------------------------------------------------------------- layers
  private startLayer(kind: LayerKind, dur: number, side: Side) {
    const armKinds: LayerKind[] = ['greet', 'present', 'point', 'beat', 'clasp', 'stretch'];
    for (const l of this.layers) {
      const clash = (armKinds.includes(kind) && armKinds.includes(l.kind)) || (kind === l.kind);
      if (clash && l.fade < 0) { l.fade = 0; l.fadeFrom = l.w; }
    }
    this.layers.push({ kind, t: 0, dur, side, fade: -1, fadeFrom: 0, w: 0, seed: Math.random() * 100 });
  }

  private tickLayers(dt: number) {
    for (const l of this.layers) {
      l.t += dt;
      const att = l.kind === 'nod' ? 0.12 : l.kind === 'beat' ? 0.35 : 0.42;
      const rel = l.kind === 'nod' ? 0.2 : 0.5;
      const env = smooth(l.t / att) * (1 - smooth((l.t - (l.dur - rel)) / rel));
      if (l.fade >= 0) { l.fade += dt; l.w = l.fadeFrom * (1 - smooth(l.fade / 0.38)); } else l.w = env;
    }
    this.layers = this.layers.filter(l => (l.fade < 0 ? l.t < l.dur : l.fade < 0.38));
  }

  private schedule(dt: number) {
    const idle = !this.talking && this.layers.length === 0;
    // weight shifts: slow, irregular
    if ((this.weightNext -= dt) <= 0) {
      this.weightGoal = (this.weightGoal > 0 ? -1 : 1) * rand(0.45, 1);
      this.weightNext = rand(6, 13) * (this.attentive ? 1.4 : 1);
    }
    this.weight = spring(this.weight, this.weightGoal, this.weightV, this.reduced ? 1.4 : 1.9, dt);
    // fidgets when nobody needs her
    if (idle && !this.attentive && (this.fidgetNext -= dt) <= 0) {
      if (Math.random() < 0.6) this.startLayer('clasp', rand(3.5, 6), 'left'); else this.startLayer('stretch', this.reduced ? 3.2 : 2.8, 'left');
      this.fidgetNext = rand(11, 22);
    }
    // talk beats
    if (this.talking && (this.beatNext -= dt) <= 0) {
      if (!this.busy) {
        this.beatSide = Math.random() < 0.65 ? (this.beatSide === 'left' ? 'right' : 'left') : this.beatSide;
        this.startLayer('beat', rand(1.2, 1.8) * (this.reduced ? 1.2 : 1), this.beatSide);
      }
      this.beatNext = rand(2.0, 4.2) * (this.reduced ? 1.4 : 1);
    }
    // ambient glances
    if (!this.lookPoint && (this.glanceNext -= dt) <= 0) {
      const r = Math.random();
      let yaw: number, pitch: number;
      if (r < 0.5) { yaw = rand(-0.25, 0.25); pitch = rand(-0.05, 0.06); }
      else if (r < 0.88) { yaw = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, this.reduced ? 0.55 : 0.8); pitch = rand(-0.12, 0.08); }
      else { yaw = rand(-0.3, 0.3); pitch = rand(-0.32, -0.2); }
      const d = 3;
      const prevYaw = Math.atan2(this.glance.x, this.glance.z);
      this.glance.set(Math.sin(yaw) * d, this.headRest.y + Math.tan(pitch) * d, Math.cos(yaw) * d);
      if (Math.abs(yaw - prevYaw) > 0.45 && Math.random() < 0.55) this.blinkSoon();
      this.glanceNext = rand(1.8, 5.2) * (this.reduced ? 1.4 : 1) * (this.attentive ? 1.3 : 1);
    }
    // micro saccades while tracking someone
    if ((this.microNext -= dt) <= 0) {
      this.micro.set(rand(-0.025, 0.025), rand(-0.015, 0.015), 0);
      this.microNext = rand(0.5, 1.8);
    }
    // blinks
    if (this.blinkT < 0 && (this.blinkNext -= dt) <= 0) { this.blinkT = 0; this.blinkDouble = Math.random() < 0.14; }
  }

  private blinkSoon() { if (this.blinkT < 0) this.blinkNext = Math.min(this.blinkNext, 0.05); }

  // ---------------------------------------------------------------- turning + feet
  private newFoot(s: Side): Foot {
    const st = STANCE[s];
    return { anchor: vec(st.pos), yaw: st.yaw, stepping: false, t: 0, dur: 0.3, from: new THREE.Vector3(), to: new THREE.Vector3(), fromYaw: 0, toYaw: 0, lift: 0 };
  }

  private updateTurn(dt: number) {
    // engage a turn when far off, or when moderately off for a while; small offsets are left to the head
    const off = wrapAngle(this.yawWanted - this.bodyYaw);
    this.offAxisFor = Math.abs(off) > 0.1 ? this.offAxisFor + dt : 0;
    if (!this.turning && (Math.abs(off) > 0.32 || this.offAxisFor > 1.1)) this.turning = true;
    if (this.turning) this.yawGoal = this.yawWanted;
    if (this.turning && Math.abs(off) < 0.03 && Math.abs(this.bodyYawV.v) < 0.05) this.turning = false;
    const vmax = this.reduced ? 0.9 : 1.7;
    this.bodyYaw = spring(this.bodyYaw, this.yawGoal, this.bodyYawV, this.reduced ? 3.2 : 4.4, dt, vmax);
    this.yawPivot.rotation.y = this.bodyYaw;

    // feet: anchors live in the root's frame; the one that drifted most from the stance steps
    const predicted = this.bodyYaw + clamp(this.bodyYawV.v * 0.22, -0.5, 0.5);
    let worst: Side | null = null, worstErr = 0;
    for (const s of SIDES) {
      const f = this.feet[s];
      if (f.stepping) {
        f.t += dt;
        const u = clamp(f.t / f.dur, 0, 1), e = smooth(u);
        f.anchor.lerpVectors(f.from, f.to, e);
        f.yaw = lerp(f.fromYaw, f.toYaw, e);
        f.lift = Math.sin(Math.PI * u);
        if (u >= 1) { f.stepping = false; f.lift = 0; }
        continue;
      }
      const err = this.footError(s);
      if (err > worstErr) { worstErr = err; worst = s; }
    }
    const anyStepping = this.feet.left.stepping || this.feet.right.stepping;
    const moving = Math.abs(this.bodyYawV.v) > 0.08;
    const threshold = moving ? 1 : 0.55;           // settle leftovers once she stops
    if (worst && !anyStepping && worstErr > threshold) {
      // alternate feet when both are off
      const s: Side = this.footError(this.lastStep === 'left' ? 'right' : 'left') > threshold * 0.6 ? (this.lastStep === 'left' ? 'right' : 'left') : worst;
      const f = this.feet[s], st = STANCE[s];
      f.from.copy(f.anchor); f.fromYaw = f.yaw;
      f.to.copy(vec(st.pos, _v3)).applyAxisAngle(_v4.set(0, 1, 0), predicted);
      f.toYaw = predicted + st.yaw;
      f.stepping = true; f.t = 0; f.dur = (this.reduced ? 0.42 : 0.32) * (moving ? 1 : 1.15);
      this.lastStep = s;
    }
  }

  /** How far a planted foot is from its stance under the current body yaw (1 = time to step). */
  private footError(s: Side): number {
    const f = this.feet[s], st = STANCE[s];
    const want = vec(st.pos, _v3).applyAxisAngle(_v4.set(0, 1, 0), this.bodyYaw);
    const dPos = Math.hypot(want.x - f.anchor.x, want.z - f.anchor.z) / 0.05;
    const dYaw = Math.abs(wrapAngle(f.yaw - (this.bodyYaw + st.yaw))) / 0.32;
    return Math.max(dPos, dYaw);
  }

  // ---------------------------------------------------------------- pose
  private composePose(dt: number, A: number) {
    const t = this.time;
    const T = this.target;
    const att = smooth(this.attW);
    this.breath += dt * Math.PI * 2 * this.breathRate * (1 + 0.15 * drift(t * 0.3, 7));
    const b = Math.sin(this.breath);
    const w = this.weight;

    // ---- axial (YXZ Euler offsets, summed)
    const ax: Record<string, [number, number, number]> = {
      hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], upperChest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    };
    const add = (n: string, x: number, y: number, z: number, k = 1) => { const a = ax[n]; a[0] += x * k; a[1] += y * k; a[2] += z * k; };
    // stance + attentiveness
    add('spine', lerp(0.03, -0.005, att), 0, 0);
    add('chest', lerp(0.0, -0.035, att), 0, 0);
    add('upperChest', lerp(0.0, -0.015, att), 0, 0);
    add('neck', lerp(0.04, 0.02, att), 0, 0);
    add('head', lerp(-0.02, -0.035, att), 0, lerp(0.03, 0.012, att));
    // breathing
    add('spine', -0.006 * b * A, 0, 0); add('chest', -0.014 * b * A, 0, 0); add('upperChest', -0.01 * b * A, 0, 0); add('head', 0.008 * b * A, 0, 0);
    // weight shift: pelvis drops on the free side, the spine counters, the head stays level
    add('hips', 0, 0.02 * w, 0.045 * w * A);
    add('spine', 0, -0.01 * w, -0.03 * w * A);
    add('chest', 0, -0.01 * w, -0.025 * w * A);
    add('neck', 0, 0, -0.012 * w * A);
    // calm drift
    add('spine', 0.006 * drift(t, 1) * A, 0.012 * drift(t, 2) * A, 0.006 * drift(t, 3) * A);
    add('head', 0.012 * drift(t * 1.3, 4) * A, 0.015 * drift(t * 1.1, 5) * A, 0.012 * drift(t * 0.9, 6) * A);
    // turning: the upper body leads, the hips follow
    const lead = clamp(wrapAngle(this.yawGoal - this.bodyYaw), -0.6, 0.6);
    add('chest', 0, 0.16 * lead, 0); add('upperChest', 0, 0.1 * lead, 0); add('neck', 0, 0.08 * lead, 0);

    // ---- head look (springs on yaw/pitch, distributed neck/head; the chest helps a little)
    this.updateLook(dt);
    add('neck', -this.headPitch * 0.38, this.headYaw * 0.38, 0);
    add('head', -this.headPitch * 0.62, this.headYaw * 0.55, -this.headYaw * 0.04);
    add('upperChest', 0, this.headYaw * 0.07, 0);
    add('chest', 0, this.headYaw * 0.05, 0);

    // ---- talking: small nods on stressed syllables, a slow sway
    if (this.talkW > 0.001) {
      const k = this.talkW * A;
      add('head', 0.035 * this.lipsync.energy * k, 0.02 * drift(t * 1.7, 9) * k, 0.025 * drift(t * 0.8, 10) * k);
      add('neck', 0.015 * this.lipsync.energy * k, 0, 0);
      add('chest', 0, 0.015 * drift(t * 0.6, 11) * k, 0);
    }

    // ---- arms: base (relaxed <-> folded hands), then one-shot layers on top
    const armQ: Record<Side, { up: THREE.Quaternion; lo: THREE.Quaternion; hand: THREE.Quaternion; sh: THREE.Quaternion }> = {
      left: { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion(), sh: new THREE.Quaternion() },
      right: { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion(), sh: new THREE.Quaternion() },
    };
    const fingers: Record<Side, Record<string, [number, number, number]>> = { left: {}, right: {} };
    for (const s of SIDES) {
      const sg = s === 'left' ? 1 : -1;
      // shoulders: breathing lift, pulled back a touch when attentive
      quatFromEuler(armQ[s].sh, 0, sg * lerp(0, 0.05, att), sg * (-0.02 + 0.016 * b * A), 'XYZ');
      this.solveArm(s, ARM.relaxed, armQ[s].sh, armQ[s], 0, t);
      const swing = 0.02 * drift(t * 0.8, s === 'left' ? 12 : 13) * A;
      armQ[s].up.multiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), swing));
      const fs = fingers[s];
      for (const k of FINGER_KEYS) fs[k] = [...HAND.relaxed[k]] as [number, number, number];
      if (att > 0.001) this.blendArm(s, ARM.clasp, armQ[s], att, t, fs, HAND.clasp);
    }

    let happy = 0, relaxedExtra = 0;
    for (const l of this.layers) {
      const lw = l.w;
      if (lw <= 0.0005) continue;
      const u = l.t;
      const sg = l.side === 'left' ? 1 : -1;
      switch (l.kind) {
        case 'greet': {
          // raise, wave ~2.5 times, lower; a small bow at the start and a head tilt toward the hand
          const waveT = Math.max(0, u - 0.32);
          const osc = Math.sin(waveT * Math.PI * 2 * (this.reduced ? 1.7 : 2.3)) * smooth(waveT / 0.25) * A;
          const def = { ...ARM.wave, wrist: [ARM.wave.wrist[0] + 0.045 * osc, ARM.wave.wrist[1] - 0.012 * Math.abs(osc), ARM.wave.wrist[2]] as Vec3,
            along: [ARM.wave.along[0] + 0.32 * osc, ARM.wave.along[1], ARM.wave.along[2]] as Vec3 };
          this.blendArm(l.side, def, armQ[l.side], lw, t, fingers[l.side], HAND.wave);
          const bow = bump(u, 0.02, 0.95, 0.25, 0.4) * A;
          add('spine', 0.045 * bow, 0, 0); add('chest', 0.06 * bow, 0, 0); add('neck', 0.04 * bow, 0, 0); add('head', 0.09 * bow, 0, 0);
          add('head', 0, 0, -sg * 0.075 * lw * A); add('chest', 0, 0, -sg * 0.02 * lw * A); add('upperChest', 0, -sg * 0.05 * lw, 0);
          happy = Math.max(happy, 0.85 * bump(u, 0.05, l.dur, 0.3, 0.55) * (l.fade >= 0 ? lw : 1));
          break;
        }
        case 'present': {
          this.blendArm(l.side, ARM.present, armQ[l.side], lw, t, fingers[l.side], HAND.open);
          const glance = bump(u, 0.2, 1.45, 0.3, 0.4);
          add('upperChest', 0, sg * 0.1 * lw, 0); add('chest', 0, sg * 0.06 * lw, 0);
          add('head', -0.03 * glance * lw, sg * 0.32 * glance * lw * A, sg * 0.04 * lw);
          add('spine', 0.015 * lw, 0, 0);
          relaxedExtra = Math.max(relaxedExtra, 0.2 * lw);
          break;
        }
        case 'point': {
          this.blendArm(l.side, ARM.point, armQ[l.side], lw, t, fingers[l.side], HAND.point);
          const glance = bump(u, 0.15, 1.4, 0.3, 0.4);
          add('upperChest', 0, sg * 0.12 * lw, 0); add('chest', 0, sg * 0.06 * lw, 0);
          add('head', -0.05 * glance * lw, sg * 0.38 * glance * lw * A, 0);
          break;
        }
        case 'nod': {
          const d1 = Math.sin(Math.PI * clamp(u / 0.42, 0, 1)), d2 = Math.sin(Math.PI * clamp((u - 0.42) / 0.38, 0, 1));
          const nod = (0.2 * d1 * d1 + 0.11 * d2 * d2) * A;
          add('head', nod * lw, 0, 0); add('neck', nod * 0.45 * lw, 0, 0);
          happy = Math.max(happy, 0.3 * lw);
          break;
        }
        case 'beat': {
          const lift = 0.5 + 0.5 * Math.sin(u * 2.6 + l.seed);
          const def = { ...ARM.beat, wrist: [ARM.beat.wrist[0], ARM.beat.wrist[1] + 0.03 * lift, ARM.beat.wrist[2]] as Vec3 };
          this.blendArm(l.side, def, armQ[l.side], lw * 0.75 * (this.reduced ? 0.7 : 1), t, fingers[l.side], HAND.open);
          add('head', 0, sg * 0.03 * lw, sg * 0.02 * lw);
          break;
        }
        case 'clasp': {
          for (const s of SIDES) this.blendArm(s, ARM.clasp, armQ[s], lw * (1 - att), t, fingers[s], HAND.clasp);
          add('head', 0.04 * lw, 0, 0.02 * lw);
          break;
        }
        case 'stretch': {
          // a slow, contented breath: shoulders back, chin up, eyes softly closed at the top
          const k = bump(u, 0, l.dur, 0.9, 1.1) * A;
          add('chest', -0.06 * k, 0, 0); add('upperChest', -0.04 * k, 0, 0); add('head', -0.08 * k, 0, 0);
          for (const s of SIDES) {
            const sgn = s === 'left' ? 1 : -1;
            armQ[s].sh.multiply(_q1.setFromEuler(new THREE.Euler(0, sgn * 0.08 * k, sgn * 0.05 * k)));
          }
          relaxedExtra = Math.max(relaxedExtra, 0.25 * k);
          this.expr.blink = Math.max(this.expr.blink, 0.0);
          break;
        }
      }
    }
    this.layerHappy = happy; this.layerRelaxed = relaxedExtra;

    // ---- write axial
    for (const n of AXIAL) {
      const e = ax[n];
      quatFromEuler(T.get(n)!, e[0], e[1], e[2], 'YXZ');
    }
    for (const s of SIDES) {
      T.get(`${s}Shoulder`)?.copy(armQ[s].sh);
      T.get(`${s}UpperArm`)?.copy(armQ[s].up);
      T.get(`${s}LowerArm`)?.copy(armQ[s].lo);
      T.get(`${s}Hand`)?.copy(armQ[s].hand);
      const sg = s === 'left' ? 1 : -1;
      for (const k of FINGER_KEYS) {
        const q = T.get(`${s}${k}` as VRMHumanBoneName);
        const e = fingers[s][k];
        if (q) quatFromEuler(q, e[0], sg * e[1], sg * e[2], 'XYZ');
      }
    }

    // ---- hips position + legs (feet stay planted; the hips sway over them)
    const stepLift = Math.max(this.feet.left.lift, this.feet.right.lift);
    const hipsOff = _v5.set(0.016 * w * A, -0.006 * Math.abs(w) - 0.008 * stepLift - lerp(0.004, 0, att), 0.004 * drift(t * 0.7, 14) * A);
    if (this.feet.left.stepping) hipsOff.x -= 0.012 * this.feet.left.lift;   // weight moves over the standing foot
    if (this.feet.right.stepping) hipsOff.x += 0.012 * this.feet.right.lift;
    this.hipsPos.copy(this.hipsRest).add(hipsOff);
    const qh = T.get('hips')!;
    for (const s of SIDES) this.solveLeg(s, qh);

    // ---- apply to the normalized rig (light smoothing hides any derivative kinks)
    const k = damp(this.smoothing, dt);
    for (const [n, q] of T) {
      const node = this.nb.get(n);
      if (!node) continue;
      _q1.copy(q);
      if (this.flip) flipQ(_q1);
      if (dt === 0) node.quaternion.copy(_q1); else node.quaternion.slerp(_q1, k);
    }
    const hips = this.nb.get('hips');
    if (hips) {
      _v1.copy(this.hipsPos);
      if (this.flip) flipV(_v1);
      if (dt === 0) hips.position.copy(_v1); else hips.position.lerp(_v1, k);
    }
  }
  private layerHappy = 0;
  private layerRelaxed = 0;

  /** IK for one arm from an authored goal (body space, left-side numbers mirrored for the right). */
  private solveArm(s: Side, def: ArmGoalDef, qSh: THREE.Quaternion, out: { up: THREE.Quaternion; lo: THREE.Quaternion; hand: THREE.Quaternion }, _w: number, _t: number) {
    const sg = s === 'left' ? 1 : -1;
    const limb = this.limbs[s === 'left' ? 'leftArm' : 'rightArm'];
    const inv = _q2.copy(qSh).invert();
    const shRest = this.rest.get(`${s}Shoulder`) ?? _v4.set(0, 0, 0);
    // goal in the upper chest frame -> shoulder frame
    const target = _v1.set(def.wrist[0] * sg, def.wrist[1], def.wrist[2]).sub(this.ucRest).sub(shRest).applyQuaternion(inv);
    const pole = _v2.set(def.pole[0] * sg, def.pole[1], def.pole[2]).normalize().applyQuaternion(inv);
    const along = _v3.set(def.along[0] * sg, def.along[1], def.along[2]).normalize().applyQuaternion(inv);
    const normal = this._n.set(def.normal[0] * sg, def.normal[1], def.normal[2]).normalize().applyQuaternion(inv);
    solveLimb(limb, { target, pole, along, normal, twistShare: def.twist ?? 0.6 }, out.up, out.lo, out.hand);
  }
  private _n = new THREE.Vector3();
  private _tmpArm = { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion() };

  private blendArm(s: Side, def: ArmGoalDef, cur: { up: THREE.Quaternion; lo: THREE.Quaternion; hand: THREE.Quaternion; sh: THREE.Quaternion }, w: number, t: number, fingers: Record<string, [number, number, number]>, hand: Shape) {
    if (w <= 0) return;
    w = clamp(w, 0, 1);
    this.solveArm(s, def, cur.sh, this._tmpArm, w, t);
    cur.up.slerp(this._tmpArm.up, w);
    cur.lo.slerp(this._tmpArm.lo, w);
    cur.hand.slerp(this._tmpArm.hand, w);
    for (const k of FINGER_KEYS) {
      const a = fingers[k], b = hand[k];
      a[0] = lerp(a[0], b[0], w); a[1] = lerp(a[1], b[1], w); a[2] = lerp(a[2], b[2], w);
    }
  }

  private solveLeg(s: Side, qHips: THREE.Quaternion) {
    const f = this.feet[s];
    const limb = this.limbs[s === 'left' ? 'leftLeg' : 'rightLeg'];
    const inv = _q2.copy(qHips).invert();
    // planted anchor (root frame) -> body frame
    const ankle = _v1.copy(f.anchor).applyAxisAngle(_v4.set(0, 1, 0), -this.bodyYaw);
    ankle.y += f.lift * (this.reduced ? 0.022 : 0.045);
    const target = ankle.sub(this.hipsPos).applyQuaternion(inv);
    const yaw = f.yaw - this.bodyYaw;
    const pole = _v2.set(Math.sin(yaw) * 0.9 + (s === 'left' ? 0.12 : -0.12), 0, Math.cos(yaw)).applyQuaternion(inv);
    const pitch = -0.35 * f.lift;
    const along = _v3.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(inv);
    const normal = this._n.set(0, -1, 0).applyQuaternion(inv);
    const up = this.target.get(`${s}UpperLeg`), lo = this.target.get(`${s}LowerLeg`), ft = this.target.get(`${s}Foot`);
    if (!up || !lo || !ft) return;
    solveLimb(limb, { target, pole, along, normal, twistShare: 0 }, up, lo, ft);
  }

  // ---------------------------------------------------------------- look + face
  private updateLook(dt: number) {
    // where she wants to look, in body space
    const p = _v1;
    if (this.lookPoint) {
      this.yawPivot.updateWorldMatrix(true, false);
      p.copy(this.lookPoint);
      this.yawPivot.worldToLocal(p);
    } else p.copy(this.glance);
    const hx = p.x - this.headRest.x, hy = p.y - (this.headRest.y + 0.06), hz = p.z - this.headRest.z;
    let yaw = Math.atan2(hx, hz);
    const pitch = clamp(Math.atan2(hy, Math.hypot(hx, hz)), -0.5, 0.35);
    yaw = clamp(yaw, -1.15, 1.15);
    const tracking = !!this.lookPoint;
    const om = (tracking ? 5.5 : 3.2) * (this.reduced ? 0.75 : 1);
    this.headYaw = spring(this.headYaw, yaw, this.headYawV, om, dt, 3);
    this.headPitch = spring(this.headPitch, pitch, this.headPitchV, om, dt, 2);
  }

  private updateEyes(dt: number) {
    // the eyes go first (quick saccade), the head catches up through its spring
    const want = _v2;
    if (this.lookPoint) want.copy(this.lookPoint);
    else { want.copy(this.glance); this.yawPivot.localToWorld(want); }
    if (this.lookPoint) {
      _v3.copy(this.micro).multiplyScalar(this.scale);
      want.add(_v3);
    }
    if (!this.eyeInit) { this.eyeWorld.copy(want); this.eyeInit = true; }
    this.eyeWorld.lerp(want, damp(24, dt));
    this.root.updateWorldMatrix(true, false);
    this.eyeTarget.position.copy(this.eyeWorld);
    this.root.worldToLocal(this.eyeTarget.position);
  }

  private updateFace(dt: number) {
    const em = this.vrm.expressionManager;
    if (!em) return;
    // blink curve: close 70 ms, hold 30 ms, open 110 ms
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const bt = this.blinkT;
      blink = bt < 0.07 ? bt / 0.07 : bt < 0.1 ? 1 : 1 - (bt - 0.1) / 0.11;
      if (bt > 0.21) {
        if (this.blinkDouble) { this.blinkDouble = false; this.blinkT = -1; this.blinkNext = 0.12; }
        else { this.blinkT = -1; this.blinkNext = rand(2.2, 5.8); }
      }
    }
    const happyT = this.layerHappy;
    const relaxedT = (lerp(0.22, 0.34, this.attW) + this.layerRelaxed) * (1 - 0.45 * this.talkW) * (1 - happyT);
    this.expr.happy += (happyT - this.expr.happy) * damp(9, dt);
    this.expr.relaxed += (relaxedT - this.expr.relaxed) * damp(5, dt);
    const eyesBusy = clamp(this.expr.happy * 1.4, 0, 1);
    em.setValue('blink', clamp(blink, 0, 1) * (1 - eyesBusy));
    em.setValue('happy', this.expr.happy);
    em.setValue('relaxed', this.expr.relaxed);
    const mouth = 1 - 0.5 * this.expr.happy;
    for (const v of VISEMES) em.setValue(v, this.lipsync.weights[v] * mouth);
  }

  // ---------------------------------------------------------------- look of the model
  private recolour() {
    const hair = new THREE.Color('#ffb0c4'), hairShade = new THREE.Color('#e57996'), hairGlow = new THREE.Color('#ffd3df');
    const brow = new THREE.Color('#d98a9c');
    this.vrm.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const t = mat as MToonMaterial;
        if (!t.isMToonMaterial) continue;
        const name = t.name;
        if (/Hair_00_HAIR_03/.test(name)) {           // the hair ribbon: Poké Ball red
          t.color.set('#ff4a5f'); t.shadeColorFactor.set('#c22a44'); t.emissive.set('#5a1020');
        } else if (/HAIR/.test(name)) {
          t.color.copy(hair); t.shadeColorFactor.copy(hairShade); t.emissive.copy(hairGlow).multiplyScalar(0.55);
        } else if (/FaceBrow/.test(name)) {
          t.color.copy(brow); t.shadeColorFactor.copy(brow).multiplyScalar(0.85);
        }
        if (t.outlineWidthMode !== 'none' && t.isOutline) t.outlineColorFactor.set('#5a2a3a');
      }
    });
  }
}
