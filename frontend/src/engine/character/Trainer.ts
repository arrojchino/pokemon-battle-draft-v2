// A human trainer for the plaza: the presenter's VRoid model (CC0) recoloured per player and animated
// procedurally on its humanoid bones.
//
// Sharing: the VRM is downloaded and parsed once (`trainerAsset.ts`); every Trainer builds its own bones from
// the baked hierarchy and draws the shared geometries with its own few tinted materials. Bone matrices go into
// a pooled texture, so no texture or geometry is created per instance. Draws per trainer: body, outline,
// face, face overlays (eyelines, brows, highlights), plus one shadow draw for the body: 5.
//
// Motion (body space: the VRM 1.0 frame, face +z, left +x, model metres; see `npc/rig.ts`):
//  * gait clock: cadence rises with speed (stride = speed / cadence), duty factor drops toward a jog;
//    stance feet are planted in the world (they cannot skate), swing feet fly to a predicted landing spot
//    ahead of the hips, with heel strike, roll and toe-off;
//  * the pelvis height comes from what the planted legs can reach (natural bob, lowest in double support),
//    plus sway over the stance foot, pelvic rotation and drop, counter-rotating chest, arm swing, forward
//    lean, a stabilised head and gaze;
//  * stopping: the swinging foot lands beside the other one, then settle steps square the stance; turning in
//    place steps the feet as the body comes round, upper body and head leading;
//  * idle: breathing, weight shifts, glances with eyes leading, blinks, light hair and skirt secondary motion;
//  * wave and cheer are one-shot IK arm layers blended over whatever the legs do.
import * as THREE from 'three';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  bump, clamp, damp, drift, flipQ, flipV, lerp, makeLimb, quatFromEuler, rand, smooth, solveLimb, spring, wrapAngle,
  type Limb, type Vec3,
} from '../npc/rig.js';
import { loadTrainerAsset, takeBoneSlot, type BonePool, type ExprName, type TrainerAsset } from './trainerAsset.js';
import { trainerDepthMaterial, trainerMaterial, trainerUniforms, type TrainerUniforms } from './trainerMaterial.js';

export type TrainerLook = { outfit: string; accent: string; hair?: string; /** Sporty cap (default true). */ cap?: boolean };

/** World height of a trainer (the game is built at about 1.7 metres per unit). */
const TARGET_HEIGHT = 0.98;

const HAIR_PALETTE = ['#3b2a22', '#5c3b2a', '#1d1c26', '#a8693c', '#d9b16a', '#8e3b30', '#4a5f9c', '#c9ccd8'];

// ------------------------------------------------------------------ hand shapes (left hand, XYZ Euler)
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
const HAND = {
  relaxed: shape(F(0.25, 0.38, 0.24, 0.03), F(0.32, 0.45, 0.28), F(0.38, 0.5, 0.3, -0.04), F(0.45, 0.52, 0.3, -0.09), [[0.1, -0.18, -0.06], [0, -0.14, -0.12], [0, -0.1, -0.1]]),
  open: shape(F(0.04, 0.06, 0.04, 0.08), F(0.05, 0.06, 0.04), F(0.07, 0.08, 0.05, -0.08), F(0.1, 0.08, 0.05, -0.17), [[0.05, -0.02, 0.12], [0, 0.03, 0], [0, 0, 0]]),
  fist: shape(F(1.35, 1.55, 0.95, 0.02), F(1.4, 1.6, 0.95), F(1.45, 1.6, 0.95, -0.03), F(1.5, 1.55, 0.95, -0.06), [[0.35, -0.55, -0.45], [0, -0.6, -0.4], [0, -0.45, -0.3]]),
};
const FINGER_KEYS = Object.keys(HAND.relaxed);

// ------------------------------------------------------------------ gesture arm goals (body space, left numbers)
type V3 = [number, number, number];
type ArmGoal = { wrist: V3; pole: V3; along: V3; normal: V3; twist: number };
const WAVE: ArmGoal = { wrist: [0.3, 1.47, 0.13], pole: [0.55, -1, -0.2], along: [0.12, 1, 0.08], normal: [0.02, 0.05, 1], twist: 0.7 };
const PUMP_UP: ArmGoal = { wrist: [0.24, 1.5, 0.1], pole: [0.6, -0.9, -0.5], along: [-0.05, 1, 0.12], normal: [-0.75, 0.1, -0.6], twist: 0.6 };
const PUMP_DOWN: ArmGoal = { wrist: [0.2, 1.24, 0.21], pole: [0.55, -1, -0.65], along: [-0.1, 1, 0.3], normal: [-0.8, 0, -0.55], twist: 0.6 };

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];
const EYES = ['leftEye', 'rightEye'] as const;

interface Foot {
  x: number; z: number; yaw: number;          // world ground point under the ankle and heading
  planted: boolean; settle: boolean;
  fx: number; fz: number; fyaw: number;       // swing start
  tx: number; tz: number; tyaw: number;       // swing target
  t: number; dur: number;                      // settle step clock
  lift: number;                                // 0..1 swing height share
  pitch: number;                               // + toes up, - heel up (rad)
  h: number;                                   // lift height (model metres)
}
const newFoot = (): Foot => ({ x: 0, z: 0, yaw: 0, planted: true, settle: false, fx: 0, fz: 0, fyaw: 0, tx: 0, tz: 0, tyaw: 0, t: 0, dur: 0.3, lift: 0, pitch: 0, h: 0 });

interface Layer { t: number; dur: number; w: number; on: boolean }

// scratch (no per-frame allocation)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _ident = new THREE.Matrix4();
const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const smin = (a: number, b: number, k: number) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); };

export class Trainer {
  readonly root = new THREE.Group();
  readonly height: number;

  /** Download once (shared), then build an instance. */
  static async load(look: TrainerLook, opts: { reducedMotion?: boolean } = {}): Promise<Trainer> {
    const asset = await loadTrainerAsset();
    return new Trainer(asset, look, opts);
  }
  /** Preload the shared model (idempotent). */
  static async prefetch(): Promise<void> { await loadTrainerAsset(); }

  private readonly a: TrainerAsset;
  private readonly model = new THREE.Group();
  private readonly s: number;                     // model metres -> world units
  private readonly bones: THREE.Bone[];
  private readonly skeleton: THREE.Skeleton;
  private readonly pool: BonePool; private readonly slot: number;
  private readonly body: THREE.SkinnedMesh; private readonly outline: THREE.SkinnedMesh; private readonly face: THREE.SkinnedMesh;
  private readonly u: TrainerUniforms;
  private readonly mats: THREE.Material[];
  private readonly hb: Partial<Record<VRMHumanBoneName, THREE.Bone>> = {};
  private readonly R: (n: VRMHumanBoneName) => THREE.Vector3;
  private readonly limbs: Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', Limb>;
  private readonly hipsRest = new THREE.Vector3();
  private readonly ucRest = new THREE.Vector3();
  private readonly headRest = new THREE.Vector3();
  private readonly ankleH: number; private readonly legLen: number; private readonly heel = 0.055; private readonly toe: number;
  private readonly fingerBones: Record<Side, (THREE.Bone | undefined)[]>;
  private readonly hairW: number[];
  private reduced: boolean;
  private cap = true;
  private camDist2 = 0;

  // root kinematics
  private px = 0; private pz = 0; private face0 = 0; private placed = false;
  private lastX = 0; private lastZ = 0;
  private vx = 0; private vz = 0; private vFwd = 0; private aFwd = 0;
  private yaw = 0; private yawV = { v: 0 };
  private speedCmd = 0; private sp = 0;
  // gait
  private feet: [Foot, Foot] = [newFoot(), newFoot()];
  private phase = 0; private gaitOn = false; private freq = 1; private duty = 0.6; private span = 0;
  private walkW = 0; private jogW = 0; private lastSettle = 1;
  private hipsY = 0; private hipsYPrev = 0; private hipsVy = 0;
  // idle
  private time = 0; private breath = Math.random() * TAU; private weight = 0; private weightV = { v: 0 }; private weightGoal = 0.5; private weightNext = 3;
  private glanceYaw = 0; private glancePitch = -0.04; private glanceNext = 2;
  private lookP: THREE.Vector3 | null = null; private readonly lookStore = new THREE.Vector3();
  private headYaw = 0; private headPitch = 0; private headYawV = { v: 0 }; private headPitchV = { v: 0 };
  private eyeYaw = 0; private eyePitch = 0;
  private blinkNext = 2; private blinkT = -1;
  private exHappy = 0; private exRelaxed = 0.1; private exAa = 0;
  // gestures
  private waveL: Layer = { t: 0, dur: 1.9, w: 0, on: false };
  private cheerL: Layer = { t: 0, dur: 1.75, w: 0, on: false };
  // secondary
  private hp = 0; private hpV = 0; private hr = 0; private hrV = 0;
  // pose scratch
  private readonly hipsPos = new THREE.Vector3();
  private readonly qHips = new THREE.Quaternion();
  private readonly arm = {
    left: { sh: new THREE.Quaternion(), up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion() },
    right: { sh: new THREE.Quaternion(), up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion() },
  };
  private readonly ik = { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), hand: new THREE.Quaternion() };
  private readonly goal = { target: new THREE.Vector3(), pole: new THREE.Vector3(), along: new THREE.Vector3(), normal: new THREE.Vector3(), twistShare: 0.6 };
  private readonly legQ = { up: new THREE.Quaternion(), lo: new THREE.Quaternion(), ft: new THREE.Quaternion() };
  private fingerSig = -1;

  /** Average cost of `update` in ms (for QA). */
  static stats = { ms: 0, n: 0 };
  /** Camera distances (world units) beyond which the outline shell is skipped and the hair LOD kicks in. */
  static lodOutline = 3.5;
  static lodFar = 7;

  private constructor(asset: TrainerAsset, look: TrainerLook, opts: { reducedMotion?: boolean }) {
    this.a = asset;
    this.reduced = !!opts.reducedMotion;
    this.root.name = 'Trainer';
    this.s = TARGET_HEIGHT / asset.rawHeight;
    this.height = asset.rawHeight * this.s;
    this.model.scale.setScalar(this.s);
    this.model.rotation.y = Math.PI;               // VRM 0.x faces -z
    this.model.position.y = -asset.floor * this.s;
    this.root.add(this.model);

    // bones from the baked hierarchy
    this.bones = asset.bones.map(b => { const o = new THREE.Bone(); o.name = b.name; o.position.copy(b.pos); return o; });
    asset.bones.forEach((b, i) => (b.parent < 0 ? this.model : this.bones[b.parent]).add(this.bones[i]));
    for (const [n, i] of Object.entries(asset.human) as [VRMHumanBoneName, number][]) this.hb[n] = this.bones[i];
    this.skeleton = new THREE.Skeleton(this.bones, asset.boneInverses);
    const { pool, slot } = takeBoneSlot(this.bones.length);
    this.pool = pool; this.slot = slot;
    this.skeleton.boneMatrices = pool.data.subarray(slot * pool.stride * 16, (slot * pool.stride + this.bones.length) * 16);
    this.skeleton.boneTexture = pool.tex;

    // materials + meshes
    this.u = trainerUniforms(asset);
    this.u.boneOffset.value = slot * pool.stride;
    const mBody = trainerMaterial(asset, this.u, 'body'), mOut = trainerMaterial(asset, this.u, 'outline');
    const mFace = trainerMaterial(asset, this.u, 'face'), mFaceA = trainerMaterial(asset, this.u, 'faceAlpha');
    const mDepth = trainerDepthMaterial(asset, this.u);
    this.mats = [mBody, mOut, mFace, mFaceA, mDepth];
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name: string) => {
      const m = new THREE.SkinnedMesh(geo, mat as THREE.Material);
      m.name = name;
      m.bind(this.skeleton, _ident);
      m.boundingSphere = asset.sphere;
      m.castShadow = false; m.receiveShadow = false;
      this.model.add(m);
      return m;
    };
    this.body = mk(asset.bodyCapGeo, mBody, 'TrainerBody');
    this.body.castShadow = true;
    this.body.customDepthMaterial = mDepth;
    this.body.onBeforeShadow = (_r, _o, _c, _sc, geo) => { geo.setDrawRange(0, (geo.userData.shadowCount as number | undefined) ?? Infinity); };
    this.body.onAfterShadow = (_r, _o, _c, _sc, geo) => { geo.setDrawRange(0, Infinity); };
    this.outline = mk(asset.outlineCapGeo, mOut, 'TrainerOutline');
    // distance LOD (one frame late, no API needed): far trainers drop the outline shell and the shadow
    this.body.onBeforeRender = (_r, _s, cam, geo) => {
      const e = cam.matrixWorld.elements;
      const dx = e[12] - this.root.position.x, dz = e[14] - this.root.position.z;
      this.camDist2 = dx * dx + dz * dz;
      if (this.camDist2 > Trainer.lodFar * Trainer.lodFar) geo.setDrawRange(0, (geo.userData.farCount as number | undefined) ?? Infinity);
    };
    this.body.onAfterRender = (_r, _s, _c, geo) => { geo.setDrawRange(0, Infinity); };
    this.outline.renderOrder = 0;
    this.face = mk(asset.faceGeo, [mFace, mFaceA], 'TrainerFace');
    this.face.morphTargetInfluences = new Array(asset.morphCount).fill(0);

    // rig measurements (body space)
    const zero = new THREE.Vector3();
    this.R = (n: VRMHumanBoneName) => asset.rest[n] ?? zero;
    const R = this.R;
    this.hipsRest.copy(R('hips'));
    this.ucRest.copy(R('hips')).add(R('spine')).add(R('chest')).add(R('upperChest'));
    this.headRest.copy(this.ucRest).add(R('neck')).add(R('head'));
    const arm = (s: Side) => makeLimb(R(`${s}UpperArm`), R(`${s}LowerArm`), R(`${s}Hand`), new THREE.Vector3(0, 0, 1),
      R(`${s}MiddleProximal`).lengthSq() > 0 ? R(`${s}MiddleProximal`) : new THREE.Vector3(s === 'left' ? 1 : -1, 0, 0), new THREE.Vector3(0, -1, 0));
    const leg = (s: Side) => makeLimb(R(`${s}UpperLeg`), R(`${s}LowerLeg`), R(`${s}Foot`), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
    this.limbs = { leftArm: arm('left'), rightArm: arm('right'), leftLeg: leg('left'), rightLeg: leg('right') };
    this.ankleH = R('hips').y + R('leftUpperLeg').y + R('leftLowerLeg').y + R('leftFoot').y - asset.floor;
    this.legLen = this.limbs.leftLeg.L1 + this.limbs.leftLeg.L2;
    this.toe = Math.max(0.06, R('leftToes').z);
    this.fingerBones = {
      left: FINGER_KEYS.map(k => this.hb[`left${k}` as VRMHumanBoneName]),
      right: FINGER_KEYS.map(k => this.hb[`right${k}` as VRMHumanBoneName]),
    };
    // hair chains: long back strands swing most, bangs barely
    this.hairW = asset.hairChains.map(c => {
      const p = flipV(_v1.copy(asset.bones[c[0]].pos));
      const back = smooth((-p.z + 0.02) / 0.09), len = c.length;
      return clamp(0.12 + 0.88 * back, 0, 1) * clamp(len / 5, 0.4, 1);
    });

    this.hipsPos.copy(this.hipsRest);
    this.hipsY = this.hipsRest.y;
    this.blinkNext = rand(0.8, 3);
    this.weightNext = rand(2, 6);
    this.glanceNext = rand(1, 3);
    this.setLook(look);
    this.update(0);
  }

  // ---------------------------------------------------------------- public API
  place(x: number, z: number, face: number): void {
    this.px = x; this.pz = z; this.face0 = face;
    this.root.position.x = x; this.root.position.z = z;
    if (!this.placed) { this.placed = true; this.lastX = x; this.lastZ = z; this.yaw = face; this.root.rotation.y = face; this.resetFeet(); }
  }

  move(speed: number): void { this.speedCmd = Math.max(0, speed); }

  wave(): void { this.start(this.waveL, this.reduced ? 2.2 : 1.9); }
  cheer(): void { this.start(this.cheerL, this.reduced ? 2.0 : 1.75); }

  setLook(look: TrainerLook): void {
    const u = this.u;
    u.tintOutfit.value.set(look.outfit);
    u.tintAccent.value.set(look.accent);
    let hash = 0;
    for (const ch of look.outfit + look.accent) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    u.tintHair.value.set(look.hair ?? HAIR_PALETTE[hash % HAIR_PALETTE.length]);
    // tights: the outfit colour pushed deep and slightly desaturated
    u.tintLegs.value.set(look.outfit).lerp(_c.set('#14151f'), 0.72);
    this.cap = look.cap !== false;
    const geo = this.cap ? this.a.bodyCapGeo : this.a.bodyGeo;
    this.body.geometry = geo;
    this.outline.geometry = this.cap ? this.a.outlineCapGeo : this.a.outlineGeo;
  }

  lookAt(p: THREE.Vector3 | null): void {
    if (!p) { this.lookP = null; this.glanceNext = Math.min(this.glanceNext, 0.8); return; }
    this.lookP = this.lookStore.copy(p);
  }

  setFade(a: number): void {
    a = clamp(a, 0, 1);
    this.u.uFade.value = a;
    this.model.visible = a > 0.02;
  }

  setReducedMotion(on: boolean): void { this.reduced = on; }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.skeleton.boneTexture = null;               // shared pool: never dispose it here
    this.pool.give(this.slot);
    this.pool.data.fill(0, this.slot * this.pool.stride * 16, (this.slot + 1) * this.pool.stride * 16);
  }

  // ---------------------------------------------------------------- frame
  update(dt: number): void {
    const t0 = performance.now();
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    // the outline shell is under a pixel wide beyond a few units: draw it only for close shots
    this.outline.visible = this.camDist2 < Trainer.lodOutline * Trainer.lodOutline && this.u.uFade.value > 0.98;
    this.body.castShadow = this.camDist2 < 22 * 22;
    this.kinematics(dt);
    this.gait(dt);
    this.compose(dt);
    this.faceUpdate(dt);
    if (dt > 0) {
      const ms = performance.now() - t0;
      Trainer.stats.ms += ms; Trainer.stats.n++;
    }
  }

  // ---------------------------------------------------------------- root motion
  private kinematics(dt: number) {
    if (!this.placed) { this.placed = true; this.resetFeet(); }
    const dx = this.px - this.lastX, dz = this.pz - this.lastZ;
    this.lastX = this.px; this.lastZ = this.pz;
    if (dx * dx + dz * dz > 0.6 * 0.6) { this.yaw = this.face0; this.yawV.v = 0; this.resetFeet(); this.vx = this.vz = 0; return this.applyYaw(); }
    if (dt > 0) {
      const k = damp(14, dt);
      this.vx += (dx / dt - this.vx) * k; this.vz += (dz / dt - this.vz) * k;
    }
    // speed: the game's number, eased
    this.sp += (this.speedCmd - this.sp) * damp(this.speedCmd > this.sp ? 7 : 9, dt);
    if (this.sp < 1e-3) this.sp = 0;
    const vf = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    if (dt > 0) { this.aFwd += ((vf - this.vFwd) / dt - this.aFwd) * damp(6, dt); }
    this.vFwd = vf;
    // facing: a critically damped turn, quicker on the move
    const target = this.yaw + wrapAngle(this.face0 - this.yaw);
    const moving = this.sp > 0.15;
    const om = (moving ? 11 : 7.5) * (this.reduced ? 0.75 : 1);
    this.yaw = spring(this.yaw, target, this.yawV, om, dt, moving ? 7 : 5);
    // the hips cannot twist far past the planted feet, so the feet set the pace of a sharp turn
    const f0 = this.feet[0], f1 = this.feet[1];
    const p0 = f0.planted && !f0.settle, p1 = f1.planted && !f1.settle;
    let ref = NaN;
    if (p0 && p1) { const a0 = f0.yaw - 0.1, a1 = f1.yaw + 0.1; ref = a0 + wrapAngle(a1 - a0) * 0.5; }
    else if (p0) ref = f0.yaw - 0.1;
    else if (p1) ref = f1.yaw + 0.1;
    if (!Number.isNaN(ref)) {
      const d = wrapAngle(this.yaw - ref);
      const lim = this.gaitOn ? 1.05 : 0.95;
      if (Math.abs(d) > lim) { this.yaw -= d - Math.sign(d) * lim; this.yawV.v *= 0.6; }
    }
    this.applyYaw();
  }
  private applyYaw() { this.root.rotation.y = this.yaw; }

  // ---------------------------------------------------------------- feet
  private resetFeet() {
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k];
      this.stanceSpot(k, this.yaw, 0, _v1);
      f.x = _v1.x; f.z = _v1.z; f.yaw = this.yaw + (k === 0 ? 0.12 : -0.12);
      f.planted = true; f.settle = false; f.lift = 0; f.pitch = 0; f.h = 0;
    }
    this.gaitOn = false;
  }

  /** World ground spot for foot k beside the root at heading `yaw`, `fwd` model metres ahead. */
  private stanceSpot(k: number, yaw: number, fwd: number, out: THREE.Vector3, rx = this.px, rz = this.pz, width = 0.056) {
    const side = k === 0 ? 1 : -1;
    const lx = side * width * this.s, lz = fwd * this.s + (k === 0 ? 0.004 : -0.01) * this.s;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return out.set(rx + lx * c + lz * s, 0, rz - lx * s + lz * c);
  }

  private footError(k: number): number {
    const f = this.feet[k];
    const ref = this.yaw + clamp(wrapAngle(this.face0 - this.yaw), -0.75, 0.75);   // where a step would aim
    const want = this.stanceSpot(k, ref, 0, _v2);
    const dPos = Math.hypot(want.x - f.x, want.z - f.z) / (0.06 * this.s);
    const dYaw = Math.abs(wrapAngle(f.yaw - (ref + (k === 0 ? 0.12 : -0.12)))) / 0.42;
    return Math.max(dPos, dYaw);
  }

  private gait(dt: number) {
    const s = this.s;
    const vm = this.sp / s;                                  // model metres per second
    const jog = smooth((vm - 2.85) / 0.6);
    // cadence (steps per second) and duty factor; the cycle frequency is half the cadence
    const cWalk = 1.15 + 0.52 * vm, cJog = 2.45 + 0.12 * vm;
    let f = lerp(cWalk, cJog, jog) / 2;
    const D = clamp(lerp(0.63 - 0.04 * vm, 0.38, jog), 0.36, 0.64);
    const spanMax = (1.08 + 0.12 * jog) * this.legLen;
    f = Math.max(f, (vm * D) / spanMax, 0.55);
    const wantMove = this.speedCmd > 0.02 || this.sp > 0.06;

    if (!this.gaitOn && wantMove) {
      // start: the foot that is more behind (or mid settle step) lifts first
      let lead = 0;
      const st0 = this.feet[0], st1 = this.feet[1];
      if (st0.settle || st1.settle) lead = st0.settle ? 0 : 1;
      else {
        const c = Math.cos(this.face0), sn = Math.sin(this.face0);
        const z0 = (st0.x - this.px) * sn + (st0.z - this.pz) * c, z1 = (st1.x - this.px) * sn + (st1.z - this.pz) * c;
        lead = z0 < z1 - 0.005 ? 0 : z1 < z0 - 0.005 ? 1 : this.lastSettle === 0 ? 1 : 0;
      }
      const lf = this.feet[lead];
      const prog = lf.settle ? clamp(lf.t / lf.dur, 0, 0.9) : 0;
      this.phase = frac(D + (1 - D) * prog - lead * 0.5);
      for (const ft of this.feet) { if (ft !== lf && ft.settle) { ft.settle = false; ft.planted = true; ft.x = ft.tx; ft.z = ft.tz; ft.yaw = ft.tyaw; ft.lift = 0; } }
      if (!lf.planted) { lf.settle = false; } else { lf.fx = lf.x; lf.fz = lf.z; lf.fyaw = lf.yaw; lf.planted = false; }
      this.gaitOn = true;
    }

    if (this.gaitOn) {
      this.freq = lerp(this.freq, f, damp(6, dt)); this.duty = D;
      this.span = (vm * D) / this.freq;
      this.phase = frac(this.phase + this.freq * dt);
      const stopping = !wantMove;
      for (let k = 0; k < 2; k++) {
        const ft = this.feet[k];
        const p = frac(this.phase + k * 0.5);
        const inSwing = p >= D;
        if (inSwing && ft.planted) {
          if (stopping) continue;                            // stay down: the stop is underway
          ft.planted = false; ft.fx = ft.x; ft.fz = ft.z; ft.fyaw = ft.yaw;
        }
        if (!ft.planted) {
          const u = inSwing ? (p - D) / (1 - D) : 1;
          // predicted landing: where the hips will be, half a stance ahead (or beside the other foot to stop)
          const tau = (1 - (inSwing ? p : 1)) / this.freq;
          const py = this.yaw + clamp(wrapAngle(this.face0 - this.yaw) * Math.min(1, tau * 7), -0.8, 0.8);
          const ahead = stopping ? 0 : this.span * 0.5 - 0.01;
          this.stanceSpot(k, py, ahead, _v3, this.px + this.vx * tau, this.pz + this.vz * tau, lerp(0.056, 0.045, this.walkW));
          ft.tx = _v3.x; ft.tz = _v3.z; ft.tyaw = py + (k === 0 ? 0.1 : -0.1) * (1 - 0.5 * this.jogW);
          // jogging feet kick up behind first and travel forward late
          const kick = 0.18 * this.jogW;
          const e = smooth(clamp(((u - kick) / (1 - kick)) * 1.08 - 0.02, 0, 1));
          ft.x = lerp(ft.fx, ft.tx, e); ft.z = lerp(ft.fz, ft.tz, e);
          ft.yaw = ft.fyaw + wrapAngle(ft.tyaw - ft.fyaw) * e;
          // lift: rises fast after toe-off, glides down onto the heel
          ft.lift = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8 - 0.3 * this.jogW)), 1.1);
          const hMax = lerp(0.055 + 0.012 * vm, 0.2, this.jogW) * (0.5 + 0.5 * this.walkW);
          ft.h = hMax * ft.lift;
          // pitch: heel up at toe-off, toes up before the heel strike
          ft.pitch = lerp(-0.62, 0.28, smooth(u * 1.4)) * this.walkW;
          if (!inSwing) { ft.planted = true; ft.x = ft.tx; ft.z = ft.tz; ft.yaw = ft.tyaw; ft.lift = 0; ft.h = 0; }
        } else {
          // stance: heel strike rolls flat, then the heel rises toward toe-off
          const u = p / D;
          const strike = 0.28 * (1 - smooth(u / 0.18));
          const roll = -0.62 * smooth((u - 0.62) / 0.38);
          ft.pitch = (strike + roll) * this.walkW * (1 - 0.6 * this.jogW) + (this.jogW * -0.25 * smooth((u - 0.4) / 0.6));
          ft.h = 0; ft.lift = 0;
        }
      }
      if (stopping && this.feet[0].planted && this.feet[1].planted) this.gaitOn = false;
    } else {
      // standing: settle steps square the stance and follow a turn in place
      for (let k = 0; k < 2; k++) {
        const ft = this.feet[k];
        ft.pitch *= 1 - damp(10, dt);
        if (!ft.settle) continue;
        ft.t += dt;
        const u = clamp(ft.t / ft.dur, 0, 1), e = smooth(u);
        ft.x = lerp(ft.fx, ft.tx, e); ft.z = lerp(ft.fz, ft.tz, e);
        ft.yaw = ft.fyaw + wrapAngle(ft.tyaw - ft.fyaw) * e;
        ft.lift = Math.sin(Math.PI * u);
        ft.h = (this.reduced ? 0.022 : 0.034) * ft.lift;
        ft.pitch = -0.18 * Math.sin(Math.PI * u);
        if (u >= 1) { ft.settle = false; ft.planted = true; ft.lift = 0; ft.h = 0; }
      }
      const busy = this.feet[0].settle || this.feet[1].settle;
      if (!busy) {
        const e0 = this.footError(0), e1 = this.footError(1);
        const turning = Math.abs(this.yawV.v) > 0.25 || Math.abs(wrapAngle(this.face0 - this.yaw)) > 0.3;
        const th = turning ? 1 : 0.65;
        if (Math.max(e0, e1) > th) {
          const other = this.lastSettle === 0 ? 1 : 0;
          const k = (other === 0 ? e0 : e1) > th * 0.55 ? other : e0 > e1 ? 0 : 1;
          const ft = this.feet[k];
          // aim the step at where the body is heading (the turn target), not only where it is now
          const ahead = wrapAngle(this.face0 - this.yaw);
          const py = this.yaw + clamp(ahead, -0.75, 0.75);
          this.stanceSpot(k, py, 0, _v3);
          ft.fx = ft.x; ft.fz = ft.z; ft.fyaw = ft.yaw;
          ft.tx = _v3.x; ft.tz = _v3.z; ft.tyaw = py + (k === 0 ? 0.12 : -0.12);
          ft.settle = true; ft.planted = false; ft.t = 0; ft.dur = (this.reduced ? 0.38 : 0.27) * (turning ? 1 : 1.15);
          this.lastSettle = k;
        }
      }
    }
    // gait weights
    const moving = this.gaitOn ? 1 : 0;
    this.walkW += (moving * clamp(vm / 0.9, 0.35, 1) - this.walkW) * damp(this.gaitOn ? 5 : 3.5, dt);
    this.jogW += (jog - this.jogW) * damp(4, dt);
  }

  // ---------------------------------------------------------------- pose
  private compose(dt: number) {
    const A = this.reduced ? 0.5 : 1;
    const t = this.time, w = this.walkW, jw = this.jogW;
    const ph = this.phase * TAU;
    const D = this.duty;
    const vm = this.sp / this.s;

    // ---- idle timers
    this.breath += dt * TAU * (0.24 + 0.1 * w) * (1 + 0.12 * drift(t * 0.3, 3));
    const b = Math.sin(this.breath);
    if ((this.weightNext -= dt) <= 0) {
      this.weightGoal = (this.weightGoal > 0 ? -1 : 1) * rand(0.4, 1);
      this.weightNext = rand(5, 11) * (this.reduced ? 1.5 : 1);
    }
    this.weight = spring(this.weight, this.weightGoal * (1 - w), this.weightV, this.reduced ? 1.3 : 1.8, dt);
    const wt = this.weight * A;
    if (!this.lookP && (this.glanceNext -= dt) <= 0) {
      const r = Math.random();
      const prev = this.glanceYaw;
      if (r < 0.5) { this.glanceYaw = rand(-0.2, 0.2); this.glancePitch = rand(-0.08, 0.04); }
      else if (r < 0.85) { this.glanceYaw = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, this.reduced ? 0.45 : 0.75); this.glancePitch = rand(-0.1, 0.06); }
      else { this.glanceYaw = rand(-0.25, 0.25); this.glancePitch = rand(-0.3, -0.18); }
      if (w > 0.3) { this.glanceYaw *= 0.4; this.glancePitch = -0.06 + this.glancePitch * 0.3; }
      if (Math.abs(this.glanceYaw - prev) > 0.4 && Math.random() < 0.6 && this.blinkT < 0) this.blinkNext = Math.min(this.blinkNext, 0.04);
      this.glanceNext = rand(1.8, 5) * (this.reduced ? 1.5 : 1);
    }

    // ---- gait signals
    const cyc = Math.cos(ph);                               // +1 at left heel strike
    const midL = ph - TAU * (D * 0.5);                      // 0 at left mid-stance
    const swayS = Math.sin(midL + Math.PI / 2);             // +1 left mid-stance, -1 right
    const lead = clamp(wrapAngle(this.face0 - this.yaw), -0.8, 0.8);
    const yawRate = this.yawV.v;
    const accel = clamp(this.aFwd / this.s, -6, 6);

    // ---- hips position
    const hp = this.hipsPos;
    const crouch = (0.008 + 0.012 * clamp(vm / 2.5, 0, 1)) * w + 0.028 * jw;
    const bobWalk = 0.012 * Math.cos(2 * midL) * w * (1 - jw);
    const bobJog = 0.03 * Math.cos(2 * midL + Math.PI) * jw;
    let dip = 0;
    if (this.cheerL.w > 0) dip = 0.03 * bump(this.cheerL.t, 0.95, 1.6, 0.12, 0.35) * this.cheerL.w * (1 - w);
    hp.set(
      0.022 * swayS * w * (1 - 0.5 * jw) + 0.024 * wt,
      this.hipsRest.y - crouch + bobWalk + bobJog - 0.004 * Math.abs(wt) - 0.002 * b * A - dip,
      this.hipsRest.z + 0.01 * w + 0.02 * jw,
    );
    // ankles first (body space), then the pelvis may not rise above what the planted legs can reach
    for (let k = 0; k < 2; k++) this.ankleBody(k, k === 0 ? _v4 : _v5);
    const lmax = this.legLen * 0.992;
    let y = hp.y;
    for (let k = 0; k < 2; k++) {
      const ft = this.feet[k];
      const an = k === 0 ? _v4 : _v5;
      const hipJ = _v1.set(hp.x + (k === 0 ? 1 : -1) * Math.abs(this.R('leftUpperLeg').x), 0, hp.z);
      const dxz = Math.hypot(hipJ.x - an.x, hipJ.z - an.z);
      const reach = an.y - this.R('leftUpperLeg').y + Math.sqrt(Math.max(0, lmax * lmax - dxz * dxz));
      const share = ft.planted || ft.settle ? 1 - ft.lift : 1 - ft.lift;
      if (share > 0.05) y = smin(y, lerp(y + 0.05, reach, share), 0.012);
    }
    this.hipsYPrev = this.hipsY; this.hipsY = y; hp.y = y;
    if (dt > 0) this.hipsVy += ((this.hipsY - this.hipsYPrev) / dt - this.hipsVy) * damp(20, dt);

    // ---- axial rotations (YXZ Euler, accumulated)
    let hx = 0.03 * jw, hy = -0.085 * cyc * w * (1 + 0.4 * jw), hz = 0.045 * swayS * w * (1 - 0.4 * jw) + 0.035 * wt;
    hz += clamp(-yawRate * this.sp * 0.06, -0.08, 0.08);           // lean into turns
    hy += 0.02 * wt;
    const lean = (0.03 + 0.03 * clamp(vm / 2.5, 0, 1)) * w + 0.09 * jw + clamp(accel * 0.012, -0.05, 0.06);
    let sx = lean * 0.45 - 0.006 * b * A + 0.004 * drift(t, 1) * A, sy = 0.45 * -hy + 0.008 * drift(t * 0.8, 2) * A, sz = -0.55 * hz;
    let cx = lean * 0.4 - 0.012 * b * A, cy = 0.06 * cyc * w * (1 + 0.5 * jw) + 0.12 * lead, cz = -0.25 * hz + 0.012 * drift(t * 0.7, 4) * A;
    let ux = lean * 0.15 - 0.01 * b * A, uy = 0.04 * cyc * w + 0.08 * lead, uz = 0;
    // cheer: chest up, a touch back
    if (this.cheerL.w > 0) { const k = this.cheerL.w; cx -= 0.05 * k; ux -= 0.03 * k; uy -= 0.08 * k; }
    if (this.waveL.w > 0) { const k = this.waveL.w; uy += 0.06 * k; cz += 0.02 * k; }
    // head: gaze (springs), stabilised against everything below it
    this.updateLook(dt, lead, w);
    const sumYaw = hy + sy + cy + uy, sumPitch = hx + sx + cx + ux, sumRoll = hz + sz + cz + uz;
    const ny = (this.headYaw - sumYaw * 0.9) * 0.4, nx = (-this.headPitch - sumPitch * 0.85) * 0.4 + 0.02;
    const gy = (this.headYaw - sumYaw * 0.9) * 0.6, gx = (-this.headPitch - sumPitch * 0.85) * 0.6 - 0.01 + 0.006 * b * A;
    let gz = -sumRoll * 0.8 - this.headYaw * 0.04 + 0.01 * drift(t * 0.9, 6) * A;
    let gxx = gx;
    if (this.waveL.w > 0) gz += 0.07 * this.waveL.w * A;
    if (this.cheerL.w > 0) gxx -= 0.08 * this.cheerL.w * bump(this.cheerL.t, 0.2, 1.5, 0.2, 0.3);

    this.setAxial('hips', hx, hy, hz);
    this.setAxial('spine', sx, sy, sz);
    this.setAxial('chest', cx, cy, cz);
    this.setAxial('upperChest', ux, uy, uz);
    this.setAxial('neck', nx, ny, -sumRoll * 0.15);
    this.setAxial('head', gxx, gy, gz);
    quatFromEuler(this.qHips, hx, hy, hz, 'YXZ');

    // ---- arms: locomotion / idle swing (FK), then gesture layers (IK)
    const swingA = (0.42 * clamp(vm / 2.4, 0.3, 1) * w * (1 - jw) + 0.66 * jw) * (this.reduced ? 0.8 : 1);
    for (const side of SIDES) {
      const sg = side === 'left' ? 1 : -1;
      const q = this.arm[side];
      // left arm forward when the right leg is: -cos at left heel strike
      const sw = -sg * Math.cos(ph - 0.25) * swingA + 0.025 * drift(t * 0.8, side === 'left' ? 12 : 13) * A * (1 - w);
      const down = 1.17 + 0.02 * b * A - 0.06 * jw - 0.04 * w + (side === 'left' ? 0.03 : -0.03) * wt;
      quatFromEuler(q.sh, 0, sg * 0.05 * sw, sg * (-0.03 + 0.016 * b * A + 0.02 * jw), 'XYZ');
      // swing about the body's x after lowering the arm (z): q = Rx(-sw) * Rz(-down)
      quatFromEuler(_q1, 0, 0, -sg * down, 'XYZ');
      quatFromEuler(_q2, -sw, sg * 0.06, 0, 'XYZ');
      q.up.multiplyQuaternions(_q2, _q1);
      const bend = 0.24 + 0.22 * Math.max(0, sw) * w + 1.25 * jw + 0.04 * b * A;
      quatFromEuler(q.lo, 0, -sg * bend, 0, 'XYZ');
      quatFromEuler(q.hand, 0.05, -sg * 0.08, -sg * (0.12 + 0.1 * jw), 'XYZ');
    }
    let fingerOpen = 0, fingerFist = 0.35 * jw;
    // wave (right hand)
    if (this.waveL.w > 0.0005) {
      const l = this.waveL, u = l.t;
      const wT = Math.max(0, u - 0.3);
      const osc = Math.sin(wT * TAU * (this.reduced ? 1.6 : 2.2)) * smooth(wT / 0.25) * A;
      this.solveArm('right', WAVE, 0.045 * osc, -0.012 * Math.abs(osc), 0.32 * osc);
      this.blendArm('right', l.w);
      fingerOpen = l.w;
    }
    // cheer: raise the fist, two pumps, then a hard pull down to the chest
    if (this.cheerL.w > 0.0005) {
      const l = this.cheerL, u = l.t;
      const pump = u < 0.3 ? 0 : u < 0.95 ? 0.5 - 0.5 * Math.cos((u - 0.3) * TAU * 1.55) : 0;
      const pull = smooth((u - 0.95) / 0.16);
      this.solveArmLerp('right', PUMP_UP, PUMP_DOWN, Math.max(pump * 0.85, pull));
      this.blendArm('right', l.w);
      fingerFist = Math.max(fingerFist, l.w);
    }
    this.writeArms();
    this.writeFingers(fingerOpen, fingerFist);

    // ---- legs
    for (let k = 0; k < 2; k++) this.solveLeg(k, k === 0 ? _v4 : _v5);

    // ---- hips position onto the bone
    const hips = this.hb.hips;
    if (hips) hips.position.copy(flipV(_v1.copy(hp)));

    // ---- secondary: hair and skirt
    this.secondary(dt, w, jw, yawRate);
  }

  private setAxial(n: VRMHumanBoneName, x: number, y: number, z: number) {
    const bone = this.hb[n];
    if (!bone) return;
    flipQ(quatFromEuler(bone.quaternion, x, y, z, 'YXZ'));
  }

  /** Ankle position of foot k in body space (model metres), from its ground point, lift and roll. */
  private ankleBody(k: number, out: THREE.Vector3) {
    const ft = this.feet[k];
    const s = this.s;
    const dx = ft.x - this.px, dz = ft.z - this.pz;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const bx = (dx * c - dz * sn) / s, bz = (dx * sn + dz * c) / s;
    const fy = ft.yaw - this.yaw;
    const p = ft.pitch, ha = this.ankleH;
    let fwd: number, up: number;
    if (p >= 0) { fwd = -this.heel + this.heel * Math.cos(p) - ha * Math.sin(p); up = this.heel * Math.sin(p) + ha * Math.cos(p); }
    else { fwd = this.toe - this.toe * Math.cos(p) - ha * Math.sin(p); up = -this.toe * Math.sin(p) + ha * Math.cos(p); }
    return out.set(bx + Math.sin(fy) * fwd, this.a.floor + up + ft.h, bz + Math.cos(fy) * fwd);
  }

  private solveLeg(k: number, ankle: THREE.Vector3) {
    const side: Side = k === 0 ? 'left' : 'right';
    const ft = this.feet[k];
    const limb = this.limbs[k === 0 ? 'leftLeg' : 'rightLeg'];
    const inv = _q3.copy(this.qHips).invert();
    const g = this.goal;
    g.target.copy(ankle).sub(this.hipsPos).applyQuaternion(inv);
    const fy = ft.yaw - this.yaw;
    g.pole.set(Math.sin(fy) * 0.9 + (k === 0 ? 0.14 : -0.14), 0, Math.cos(fy)).applyQuaternion(inv);
    const p = ft.pitch;
    g.along.set(Math.sin(fy) * Math.cos(p), Math.sin(p), Math.cos(fy) * Math.cos(p)).applyQuaternion(inv);
    g.normal.set(Math.sin(fy) * Math.sin(p), -Math.cos(p), Math.cos(fy) * Math.sin(p)).applyQuaternion(inv);
    g.twistShare = 0;
    const L = this.legQ;
    solveLimb(limb, g, L.up, L.lo, L.ft);
    this.putBone(`${side}UpperLeg`, L.up);
    this.putBone(`${side}LowerLeg`, L.lo);
    this.putBone(`${side}Foot`, L.ft);
    // toes stay on the ground while the heel rises
    const toes = this.hb[`${side}Toes`];
    if (toes) flipQ(quatFromEuler(toes.quaternion, Math.min(0, p) * 0.9, 0, 0, 'XYZ'));
  }

  private putBone(n: VRMHumanBoneName, q: THREE.Quaternion) {
    const bone = this.hb[n];
    if (bone) flipQ(bone.quaternion.copy(q));
  }

  // ---------------------------------------------------------------- arms
  private solveArm(side: Side, def: ArmGoal, dx = 0, dy = 0, alongX = 0) {
    const sg = side === 'left' ? 1 : -1;
    const g = this.goal, sh = this.arm[side].sh;
    const inv = _q3.copy(sh).invert();
    const shRest = this.R(`${side}Shoulder`);
    g.target.set((def.wrist[0] + dx) * sg, def.wrist[1] + dy, def.wrist[2]).sub(this.ucRest).sub(shRest).applyQuaternion(inv);
    g.pole.set(def.pole[0] * sg, def.pole[1], def.pole[2]).normalize().applyQuaternion(inv);
    g.along.set((def.along[0] + alongX) * sg, def.along[1], def.along[2]).normalize().applyQuaternion(inv);
    g.normal.set(def.normal[0] * sg, def.normal[1], def.normal[2]).normalize().applyQuaternion(inv);
    g.twistShare = def.twist;
    solveLimb(this.limbs[side === 'left' ? 'leftArm' : 'rightArm'], g, this.ik.up, this.ik.lo, this.ik.hand);
  }

  private solveArmLerp(side: Side, a: ArmGoal, b: ArmGoal, k: number) {
    const tmp = this.tmpGoal;
    for (let i = 0; i < 3; i++) {
      tmp.wrist[i] = lerp(a.wrist[i], b.wrist[i], k);
      tmp.pole[i] = lerp(a.pole[i], b.pole[i], k);
      tmp.along[i] = lerp(a.along[i], b.along[i], k);
      tmp.normal[i] = lerp(a.normal[i], b.normal[i], k);
    }
    tmp.twist = lerp(a.twist, b.twist, k);
    this.solveArm(side, tmp);
  }
  private readonly tmpGoal: ArmGoal = { wrist: [0, 0, 0], pole: [0, 0, 0], along: [0, 0, 0], normal: [0, 0, 0], twist: 0.6 };

  private blendArm(side: Side, w: number) {
    const q = this.arm[side];
    w = clamp(w, 0, 1);
    q.up.slerp(this.ik.up, w); q.lo.slerp(this.ik.lo, w); q.hand.slerp(this.ik.hand, w);
  }

  private writeArms() {
    for (const side of SIDES) {
      const q = this.arm[side];
      this.putBone(`${side}Shoulder`, q.sh);
      this.putBone(`${side}UpperArm`, q.up);
      this.putBone(`${side}LowerArm`, q.lo);
      this.putBone(`${side}Hand`, q.hand);
    }
  }

  private writeFingers(open: number, fist: number) {
    const sig = Math.round(open * 200) * 1000 + Math.round(fist * 200);
    if (sig === this.fingerSig) return;
    this.fingerSig = sig;
    for (const side of SIDES) {
      const sg = side === 'left' ? 1 : -1;
      const o = side === 'right' ? open : 0;
      const fi = side === 'right' ? fist : Math.min(fist, 0.35);
      const bones = this.fingerBones[side];
      for (let i = 0; i < FINGER_KEYS.length; i++) {
        const bone = bones[i];
        if (!bone) continue;
        const key = FINGER_KEYS[i];
        const r = HAND.relaxed[key], op = HAND.open[key], fs = HAND.fist[key];
        const x = lerp(lerp(r[0], op[0], o), fs[0], fi), y = lerp(lerp(r[1], op[1], o), fs[1], fi), z = lerp(lerp(r[2], op[2], o), fs[2], fi);
        flipQ(quatFromEuler(bone.quaternion, x, sg * y, sg * z, 'XYZ'));
      }
    }
  }

  // ---------------------------------------------------------------- head, eyes, face
  private updateLook(dt: number, lead: number, w: number) {
    let yaw: number, pitch: number;
    if (this.lookP) {
      // world point -> body space
      const s = this.s, c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      const dx = this.lookP.x - this.px, dz = this.lookP.z - this.pz;
      const bx = (dx * c - dz * sn) / s, bz = (dx * sn + dz * c) / s;
      const by = (this.lookP.y - this.root.position.y) / s + this.a.floor;
      const hx = bx - this.headRest.x, hy = by - (this.headRest.y + 0.06), hz = bz - this.headRest.z;
      yaw = Math.atan2(hx, hz); pitch = Math.atan2(hy, Math.hypot(hx, hz));
    } else {
      yaw = this.glanceYaw + lead * 0.6; pitch = this.glancePitch - 0.05 * w;
    }
    yaw = clamp(yaw, -1.1, 1.1); pitch = clamp(pitch, -0.5, 0.35);
    const om = (this.lookP ? 5.5 : 3.4) * (this.reduced ? 0.75 : 1);
    this.headYaw = spring(this.headYaw, yaw, this.headYawV, om, dt, 3);
    this.headPitch = spring(this.headPitch, pitch, this.headPitchV, om, dt, 2);
    // eyes lead the head
    const k = damp(22, dt);
    this.eyeYaw += (clamp(yaw - this.headYaw, -0.35, 0.35) - this.eyeYaw) * k;
    this.eyePitch += (clamp(pitch - this.headPitch, -0.2, 0.2) - this.eyePitch) * k;
    for (const n of EYES) {
      const bone = this.hb[n];
      if (bone) flipQ(quatFromEuler(bone.quaternion, -this.eyePitch * 0.55, this.eyeYaw * 0.55, 0, 'YXZ'));
    }
  }

  private faceUpdate(dt: number) {
    // blinks: close 70 ms, hold 30 ms, open 110 ms
    let blink = 0;
    if (this.blinkT < 0 && (this.blinkNext -= dt) <= 0) this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const bt = this.blinkT;
      blink = bt < 0.07 ? bt / 0.07 : bt < 0.1 ? 1 : 1 - (bt - 0.1) / 0.11;
      if (bt > 0.21) { this.blinkT = -1; this.blinkNext = Math.random() < 0.12 ? 0.12 : rand(2, 5.5); }
    }
    // layers
    this.tickLayer(this.waveL, dt);
    this.tickLayer(this.cheerL, dt);
    const happyT = Math.max(0.85 * bump(this.waveL.t, 0.05, this.waveL.dur, 0.3, 0.5) * (this.waveL.on ? 1 : 0), 1.0 * this.cheerL.w);
    const aaT = 0.45 * this.cheerL.w * bump(this.cheerL.t, 0.9, 1.5, 0.08, 0.3);
    this.exHappy += (happyT - this.exHappy) * damp(9, dt);
    this.exAa += (aaT - this.exAa) * damp(12, dt);
    this.exRelaxed += ((0.16 + 0.08 * this.walkW) * (1 - this.exHappy) - this.exRelaxed) * damp(4, dt);
    const inf = this.face.morphTargetInfluences!;
    inf.fill(0);
    this.addExpr(inf, 'blink', clamp(blink, 0, 1) * (1 - clamp(this.exHappy * 1.4, 0, 1)));
    this.addExpr(inf, 'happy', this.exHappy);
    this.addExpr(inf, 'relaxed', this.exRelaxed);
    this.addExpr(inf, 'aa', this.exAa);
  }

  private addExpr(inf: number[], n: ExprName, v: number) {
    if (v <= 0) return;
    const binds = this.a.expr[n];
    for (let i = 0; i < binds.length; i++) { const b = binds[i]; inf[b.index] = Math.min(1, inf[b.index] + b.weight * v); }
  }

  private tickLayer(l: Layer, dt: number) {
    if (!l.on) { l.w = 0; return; }
    l.t += dt;
    l.w = smooth(l.t / 0.32) * (1 - smooth((l.t - (l.dur - 0.42)) / 0.42));
    if (l.t >= l.dur) { l.on = false; l.w = 0; }
  }

  private start(l: Layer, dur: number) {
    // restart smoothly from the current weight (the envelope picks up where it is)
    l.dur = dur;
    l.t = l.on ? Math.min(l.t, 0.32 * l.w) : 0;
    l.on = true;
    const other = l === this.waveL ? this.cheerL : this.waveL;
    if (other.on && other.t < other.dur - 0.42) other.t = other.dur - 0.42;   // fade the other one out
  }

  // ---------------------------------------------------------------- secondary motion
  private secondary(dt: number, w: number, jw: number, yawRate: number) {
    if (dt <= 0) return;
    const vm = this.sp / this.s;
    const tgtP = 0.1 * clamp(vm / 2.5, 0, 1) * w + 0.22 * jw + clamp(this.aFwd / this.s * 0.025, -0.08, 0.12);
    const tgtR = clamp(-yawRate * this.sp * 0.25, -0.25, 0.25);
    const om = 7.5, z = 0.28;
    const n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.hpV += (om * om * (tgtP - this.hp) - 2 * z * om * this.hpV - this.hipsVy * 9) * h;
      this.hrV += (om * om * (tgtR - this.hr) - 2 * z * om * this.hrV) * h;
      this.hp += this.hpV * h; this.hr += this.hrV * h;
    }
    this.hp = clamp(this.hp, -0.12, 0.6); this.hr = clamp(this.hr, -0.35, 0.35);
    const chains = this.a.hairChains;
    for (let c = 0; c < chains.length; c++) {
      const k = this.hairW[c];
      const ch = chains[c];
      for (let j = 0; j < ch.length; j++) {
        const f = j === 0 ? k : k * 0.45;
        flipQ(quatFromEuler(this.bones[ch[j]].quaternion, this.hp * f, 0, this.hr * f, 'XYZ'));
      }
    }
    // skirt sides flare a little with the stride and bounce with the hips
    for (const i of this.a.skirtSides) {
      const bone = this.bones[i];
      const left = bone.name.includes('_L_');
      const flare = (0.06 * w + 0.12 * jw) + 0.15 * clamp(this.hp, 0, 0.4);
      flipQ(quatFromEuler(bone.quaternion, 0.08 * this.hp, 0, (left ? 1 : -1) * flare, 'XYZ'));
    }
  }
}
const _c = new THREE.Color();
