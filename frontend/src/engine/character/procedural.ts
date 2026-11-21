import * as THREE from 'three';

/**
 * Procedural animation layered on any rigged Pokémon model, driven by bone names (the 3DS-era rigs use
 * `Hips/Spine/Head/LArm/Tail1`, the Switch-era ones `waist/spine_01/head/left_arm_01/tail_01`, exports
 * may add index prefixes or suffixes). It keeps every model alive whatever its source:
 * - static rigs (no clips) get their arms lowered out of the bind T-pose, breathing, a head that turns
 *   toward what it looks at, tails that sway in a travelling wave, ears and feelers with lagging sway,
 *   and body lean and jaw for attacks and hits;
 * - animated rigs keep their authored clips and only get the head look-at and lean added on top.
 * All offsets are rotations about the character's own up and side axes, expressed in each bone's parent
 * space, so they work whatever the rig's local bone axes are.
 */

type Role = 'spine' | 'neck' | 'head' | 'jaw' | 'tail' | 'ear' | 'sway' | 'arm';
type PBone = { bone: THREE.Bone; pre: THREE.Quaternion; applied: boolean; up: THREE.Vector3; side: THREE.Vector3; role: Role; index: number; count: number; phase: number };

const smoothstep01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function cleanNames(bones: THREE.Bone[]): string[] {
  const raw = bones.map(b => b.name.toLowerCase());
  // Sketchfab-style exports append a running index to every bone (`waist_129`); strip it only then,
  // because Switch-era rigs also use numbered names of their own (`spine_01`, `left_arm_02`).
  const indexed = raw.filter(n => /_\d+$/.test(n)).length > raw.length * 0.9;
  return raw.map(n => {
    let s = n.replace(/^\d+_/, '');
    if (indexed) s = s.replace(/_\d+$/, '');
    return s;
  });
}

function classify(n: string): { role: Role; side: -1 | 0 | 1 } | null {
  const side = /^(l|left_)(?=[a-z])/.test(n) && !/^(leg|lower)/.test(n) ? 1 : /^(r|right_)(?=[a-z])/.test(n) && !/^(root|rib)/.test(n) ? -1 : 0;
  if (/^(hips|waist|pelvis)$/.test(n)) return null;
  if (/^spine(_?\d+)?$/.test(n) || /^chest$/.test(n)) return { role: 'spine', side: 0 };
  if (/^neck(_?\d+)?$/.test(n)) return { role: 'neck', side: 0 };
  if (/^head$/.test(n)) return { role: 'head', side: 0 };
  if (/^(jaw\d?|lower_jaw)$/.test(n)) return { role: 'jaw', side: 0 };
  if (/^tail(_?[a-z]?\d*)$/.test(n)) return { role: 'tail', side: 0 };
  if (/^(l|r|left_|right_)?ear(_?[a-z]?\d*)$/.test(n)) return { role: 'ear', side };
  if (/^(l|r)arm$/.test(n) || /^(left|right)_arm(_01)?$/.test(n)) return { role: 'arm', side };
  if (/(feeler|hair|antenna|ribbon|leaf|wing)/.test(n) && !/(eyelid|eyebrow|_end$)/.test(n)) return { role: 'sway', side };
  return null;
}

export type ProcOptions = { animated: boolean };

export class ProceduralRig {
  private bones: PBone[] = [];
  private time = Math.random() * 20;
  private lookYaw = 0; private lookPitch = 0;
  private wantYaw = 0; private wantPitch = 0;
  private lean = 0; private leanV = 0; private leanTarget = 0;
  private jaw = 0; private jawTarget = 0;
  private impulse: { t: number; dur: number; curve: (u: number) => number; jaw: number } | null = null;
  private invRoot = new THREE.Matrix4();
  private headPos = new THREE.Vector3();
  readonly hasRig: boolean;
  /** 0 = off (reduced motion keeps only the head look). */
  intensity = 1;
  /** Asleep: head droops, breathing slows and deepens. */
  drowsy = false;
  private drowse = 0;

  constructor(private root: THREE.Object3D, private opts: ProcOptions) {
    let skeleton: THREE.Skeleton | null = null;
    root.traverse(o => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh && (!skeleton || s.skeleton.bones.length > skeleton.bones.length)) skeleton = s.skeleton; });
    this.hasRig = !!skeleton;
    if (!skeleton) return;
    const bones = (skeleton as THREE.Skeleton).bones;
    const names = cleanNames(bones);
    root.updateMatrixWorld(true);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const found: Array<{ bone: THREE.Bone; role: Role; side: number; depth: number }> = [];
    bones.forEach((b, i) => {
      const c = classify(names[i]);
      if (!c) return;
      let depth = 0; for (let p = b.parent; p; p = p.parent) depth++;
      found.push({ bone: b, role: c.role, side: c.side, depth });
    });
    // Static rigs stand in their bind pose: lower arms that stick out sideways (T or A pose).
    if (!opts.animated) for (const f of found.filter(x => x.role === 'arm')) this.fixArm(f.bone, rootQ);
    const byRole = (r: Role) => found.filter(f => f.role === r).sort((a, b) => a.depth - b.depth);
    const add = (f: { bone: THREE.Bone; role: Role; side: number }, index: number, count: number) => {
      const parentQ = (f.bone.parent ?? root).getWorldQuaternion(new THREE.Quaternion());
      const toParent = parentQ.premultiply(rootQ).invert();
      this.bones.push({
        bone: f.bone, pre: new THREE.Quaternion(), applied: false, role: f.role, index, count,
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(toParent).normalize(),
        side: new THREE.Vector3(1, 0, 0).applyQuaternion(toParent).normalize(),
        phase: Math.random() * Math.PI * 2 + f.side * 0.7,
      });
    };
    for (const r of ['spine', 'neck', 'head', 'jaw', 'tail', 'ear', 'sway'] as Role[]) {
      const list = byRole(r);
      // One head and jaw only (the outermost); spines and necks as chains; tails as one ordered chain.
      const use = r === 'head' || r === 'jaw' ? list.slice(0, 1) : list.slice(0, r === 'sway' ? 16 : 10);
      use.forEach((f, i) => add(f, i, use.length));
    }
  }

  private fixArm(bone: THREE.Bone, rootQ: THREE.Quaternion) {
    const child = bone.children.find(c => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
    if (!child) return;
    const a = bone.getWorldPosition(new THREE.Vector3()).applyQuaternion(rootQ);
    const b = child.getWorldPosition(new THREE.Vector3()).applyQuaternion(rootQ);
    const dir = b.sub(a).normalize();
    if (Math.abs(dir.y) > 0.6 || dir.lengthSq() < 0.5) return; // already hanging (or degenerate)
    const target = new THREE.Vector3(dir.x * 0.45, -0.85, Math.max(dir.z, 0) * 0.4 + 0.18).normalize();
    const angle = Math.min(dir.angleTo(target), 1.05);
    const axis = new THREE.Vector3().crossVectors(dir, target);
    if (axis.lengthSq() < 1e-6) return;
    axis.normalize();
    const parentQ = (bone.parent ?? this.root).getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ);
    const axisP = axis.applyQuaternion(parentQ.clone().invert());
    const q = new THREE.Quaternion().setFromAxisAngle(axisP, angle).multiply(bone.quaternion);
    bone.quaternion.copy(q);
  }

  /** Where the Pokémon looks (world space), or null to face forward. */
  lookAt(world: THREE.Vector3 | null) {
    if (!world) { this.wantYaw = 0; this.wantPitch = 0; return; }
    this.root.updateWorldMatrix(true, false);
    this.invRoot.copy(this.root.matrixWorld).invert();
    tmpV.copy(world).applyMatrix4(this.invRoot);
    const h = this.headPos;
    const dx = tmpV.x - h.x, dz = tmpV.z - h.z;
    this.wantYaw = THREE.MathUtils.clamp(Math.atan2(dx, Math.max(0.05, dz)), -0.6, 0.6);
    this.wantPitch = THREE.MathUtils.clamp(Math.atan2(tmpV.y - h.y, Math.hypot(dx, dz)) * 0.6, -0.25, 0.3);
  }

  /** A short body motion: wind-up and strike, recoil from a hit, a cheer. */
  pulse(kind: 'attack' | 'hit' | 'cheer' | 'roar', at = 0.3) {
    const bell = (u: number) => Math.sin(Math.PI * Math.min(1, u));
    if (kind === 'attack') {
      // Wind back until 70% of the way to the strike, snap forward to peak at `at`, then recover.
      const dur = at + 0.4, w = (at * 0.7) / dur, s = at / dur;
      this.impulse = { t: 0, dur, jaw: 0.6, curve: u => (u < w ? -0.6 * Math.sin((u / w) * Math.PI * 0.5) : u < s ? -0.6 + 1.6 * smoothstep01((u - w) / (s - w)) : 1 - smoothstep01((u - s) / (1 - s))) };
    }
    else if (kind === 'hit') this.impulse = { t: 0, dur: 0.45, jaw: 0.3, curve: u => -1 * bell(u) * (1 - u * 0.3) };
    else if (kind === 'roar') this.impulse = { t: 0, dur: 0.9, jaw: 1, curve: u => -0.35 * bell(u) };
    else this.impulse = { t: 0, dur: 0.7, jaw: 0.5, curve: u => -0.4 * bell(u) };
  }

  /**
   * Undo last frame's offsets. Call before the animation mixer runs: bones the mixer drives get their
   * clip pose anyway, and bones it does not drive go back to their own pose instead of accumulating.
   */
  undo() {
    for (const b of this.bones) if (b.applied) { b.bone.quaternion.copy(b.pre); b.applied = false; }
  }

  update(dt: number) {
    if (!this.hasRig) return;
    this.time += dt;
    const t = this.time, k = this.intensity;
    if (this.impulse) {
      this.impulse.t += dt;
      const u = this.impulse.t / this.impulse.dur;
      this.leanTarget = u >= 1 ? 0 : this.impulse.curve(u);
      this.jawTarget = u >= 1 ? 0 : this.impulse.jaw * Math.sin(Math.PI * Math.min(1, u));
      if (u >= 1) this.impulse = null;
    }
    // Springy lean (a little overshoot reads as weight).
    const a = (this.leanTarget - this.lean) * 160 - this.leanV * 18;
    this.leanV += a * dt; this.lean += this.leanV * dt;
    this.jaw += (this.jawTarget - this.jaw) * Math.min(1, dt * 14);
    this.lookYaw += (this.wantYaw - this.lookYaw) * Math.min(1, dt * 4);
    this.lookPitch += (this.wantPitch - this.lookPitch) * Math.min(1, dt * 4);
    this.drowse += ((this.drowsy ? 1 : 0) - this.drowse) * Math.min(1, dt * 2);
    const breathe = Math.sin(t * (2.2 - this.drowse * 1.2)) * (0.022 + this.drowse * 0.02) * k;
    const animated = this.opts.animated;

    for (const b of this.bones) {
      let yaw = 0, pitch = 0;
      switch (b.role) {
        case 'spine': pitch = (animated ? 0 : breathe) + this.lean * 0.16 * k / Math.max(1, b.count); break;
        case 'neck': yaw = this.lookYaw * 0.35 / Math.max(1, b.count); pitch = -this.lookPitch * 0.3 / Math.max(1, b.count) + this.lean * 0.08 * k; break;
        case 'head': yaw = this.lookYaw * 0.65 * (1 - this.drowse) + (animated ? 0 : Math.sin(t * 0.7 + b.phase) * 0.04 * k); pitch = -this.lookPitch * 0.7 * (1 - this.drowse) + (animated ? 0 : breathe * 0.6) + this.lean * 0.1 * k + this.drowse * 0.35; break;
        case 'jaw': if (!animated) pitch = this.jaw * 0.35; break;
        case 'tail': if (!animated) { const amp = (0.06 + 0.1 * (b.index / Math.max(1, b.count - 1))) * k; yaw = Math.sin(t * 1.8 - b.index * 0.7) * amp; pitch = Math.sin(t * 1.1 - b.index * 0.5) * amp * 0.3; } break;
        case 'ear': if (!animated) { pitch = Math.sin(t * 1.6 + b.phase) * 0.05 * k + Math.max(0, -this.leanV) * 0.01; yaw = Math.sin(t * 0.9 + b.phase) * 0.04 * k; } break;
        case 'sway': if (!animated) { pitch = Math.sin(t * 1.4 + b.phase + b.index * 0.4) * 0.06 * k; yaw = Math.sin(t * 0.8 + b.phase) * 0.03 * k; } break;
        default: break;
      }
      if (yaw === 0 && pitch === 0) continue;
      b.pre.copy(b.bone.quaternion); b.applied = true;
      tmpQ.setFromAxisAngle(b.up, yaw);
      tmpQ2.setFromAxisAngle(b.side, pitch);
      b.bone.quaternion.premultiply(tmpQ2).premultiply(tmpQ);
    }
    // Remember where the head is (model space) for the next look-at.
    const head = this.bones.find(b => b.role === 'head');
    if (head) { head.bone.getWorldPosition(tmpV2); this.root.updateWorldMatrix(true, false); this.invRoot.copy(this.root.matrixWorld).invert(); this.headPos.copy(tmpV2.applyMatrix4(this.invRoot)); }
  }
}
