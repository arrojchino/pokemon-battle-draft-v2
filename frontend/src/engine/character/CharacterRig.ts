import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Character, Emote } from '../../characters/roster.js';
import { ANIMATED_BONES, GESTURES, IDLE_POSES, type ExpressionKey, type GestureSample } from './poses.js';
import { SmoothVec3, dampFactor, rand, smoothDamp, wobble } from '../math.js';

type BoneState = { node: THREE.Object3D; rest: THREE.Quaternion; target: THREE.Quaternion; stiffness: number };

const EXPRESSIONS: ExpressionKey[] = ['happy', 'relaxed', 'surprised', 'sad', 'angry', 'aa', 'oh', 'ih', 'blink'];

/** Bones further from the root follow with more lag: arms/hands overshoot less, feel heavier. */
const stiffnessFor = (b: VRMHumanBoneName) =>
  /Hand|Thumb|Index|Middle|Ring|Little/.test(b) ? 14 : /LowerArm/.test(b) ? 10 : /UpperArm|Shoulder/.test(b) ? 8.5 : /head|neck/.test(b) ? 9 : 7;

/**
 * Procedural animator for one VRM. Layers, bottom to top:
 *   personality idle pose → breathing + weight shift + micro-motion → blended gesture → look-at (neck/head)
 * Rotations are damped per bone toward their targets (frame-rate independent), which gives natural
 * follow-through and seamless transitions without authored blend trees. No allocations per frame.
 */
export class CharacterRig {
  readonly root = new THREE.Group();
  readonly lookTarget = new THREE.Object3D();
  readonly pos: SmoothVec3;
  readonly character: Character;
  private bones = new Map<VRMHumanBoneName, BoneState>();
  private mirror: boolean;
  private hips: THREE.Object3D | null;
  private hipsRest = new THREE.Vector3();
  private exprNames = new Map<ExpressionKey, string>();
  private exprCur = new Map<ExpressionKey, number>();
  private time = 0;
  private seed: number;

  // State
  private emote: Emote = 'idle';
  private gestureT = 0;
  private gestureW = 0;
  private sample: GestureSample = { pose: {}, expr: {}, hipsY: 0, hipsYaw: 0, lookWeight: 1 };
  private queued: Emote | null = null;
  facing = 0; facingTarget = 0; private facingV = { v: 0 };
  private nextBlink = 2; private blinkT = -1; private doubleBlink = false;
  private headYaw = 0; private headPitch = 0;
  private hoverAmt = 0; hovered = false;
  private focusAmt = 0; focused = false;
  private appear = 1; private appearTarget = 1;
  private shiftPhase = 0;
  private headWorld = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private invRoot = new THREE.Matrix4();
  active = true;
  reducedMotion = false;
  readonly height: number;

  constructor(readonly vrm: VRM, character: Character, seed: number) {
    this.character = character;
    this.seed = seed;
    this.mirror = vrm.meta.metaVersion === '0';
    this.root.add(vrm.scene);
    this.root.add(this.lookTarget);
    this.pos = new SmoothVec3();
    this.hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (this.hips) this.hipsRest.copy(this.hips.position);
    for (const b of ANIMATED_BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(b);
      if (node) this.bones.set(b, { node, rest: node.quaternion.clone(), target: new THREE.Quaternion(), stiffness: stiffnessFor(b) });
    }
    // Map our expression keys onto whatever this model actually ships (VRM0 "Surprised" is a custom clip).
    const available = vrm.expressionManager?.expressions.map(e => e.expressionName) ?? [];
    for (const k of EXPRESSIONS) {
      const hit = available.find(n => n.toLowerCase() === k.toLowerCase());
      if (hit) this.exprNames.set(k, hit);
      this.exprCur.set(k, 0);
    }
    if (vrm.lookAt) { vrm.lookAt.target = this.lookTarget; vrm.lookAt.autoUpdate = true; }
    vrm.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; }
    });
    const box = new THREE.Box3().setFromObject(vrm.scene);
    this.height = box.max.y - box.min.y;
    this.lookTarget.position.set(0, 1.4, 3);
    this.nextBlink = 1 + rand(seed) * 3;
    this.applyPose(0, true);
  }

  /** Play an emote. Repeated idle requests are ignored; a gesture in progress is replaced smoothly. */
  play(e: Emote) {
    if (e === 'idle') { if (this.emote !== 'idle') this.gestureT = Math.max(this.gestureT, GESTURES[this.emote as Exclude<Emote, 'idle'>].duration - GESTURES[this.emote as Exclude<Emote, 'idle'>].release); return; }
    if (this.reducedMotion && (e === 'twirl')) e = 'nod';
    if (this.emote !== 'idle' && this.gestureW > 0.3) { this.queued = e; this.gestureT = Math.max(this.gestureT, GESTURES[this.emote as Exclude<Emote, 'idle'>].duration - GESTURES[this.emote as Exclude<Emote, 'idle'>].release); return; }
    this.emote = e; this.gestureT = 0;
  }
  get currentEmote() { return this.emote; }

  setVisible(v: boolean, instant = false) {
    this.appearTarget = v ? 1 : 0;
    if (instant) this.appear = this.appearTarget;
    if (v) this.root.visible = true;
  }
  get isShown() { return this.appearTarget > 0; }

  place(x: number, z: number, facing: number, instant = false) {
    this.pos.target.set(x, 0, z); this.facingTarget = facing;
    if (instant) { this.pos.snap(); this.facing = facing; this.facingV.v = 0; this.root.position.copy(this.pos.value); this.root.rotation.y = facing; this.vrm.springBoneManager?.reset(); }
  }

  /** World-space point the eyes and head should track. */
  lookAt(world: THREE.Vector3) {
    this.root.updateMatrixWorld();
    this.invRoot.copy(this.root.matrixWorld).invert();
    this.lookTarget.position.copy(world).applyMatrix4(this.invRoot);
  }

  private setBone(b: VRMHumanBoneName, x: number, y: number, z: number) {
    const s = this.bones.get(b); if (!s) return;
    if (this.mirror) { x = -x; z = -z; }
    this.tmpE.set(x, y, z);
    s.target.setFromEuler(this.tmpE).premultiply(s.rest);
  }

  private applyPose(dt: number, snap = false) {
    const P = this.character.personality;
    const idle = IDLE_POSES[P.idle];
    const g = this.sample.pose;
    const w = this.gestureW;
    const t = this.time * P.tempo;
    const e = P.energy * (this.reducedMotion ? 0.5 : 1);
    // Breathing ~0.23 Hz; weight shift every ~9 s; micro-motion from incommensurate sines.
    const breath = Math.sin(t * 1.45 + this.seed) * e;
    this.shiftPhase += dt * 0.11 * P.tempo;
    const shift = Math.sin(this.shiftPhase * Math.PI * 2 + this.seed * 3) * e;
    const mx = wobble(t * 0.35, this.seed) * e, my = wobble(t * 0.27, this.seed + 1) * e;
    const hover = this.hoverAmt, focus = this.focusAmt;

    for (const [b] of this.bones) {
      const a = idle[b] ?? [0, 0, 0];
      const gv = g[b];
      let x = a[0], y = a[1], z = a[2];
      if (gv && w > 0) { x += (gv[0] - x) * w; y += (gv[1] - y) * w; z += (gv[2] - z) * w; }
      const idleW = 1 - w * 0.7;
      switch (b) {
        case 'hips': z += shift * 0.035 * idleW; y += my * 0.03 * idleW; break;
        case 'spine': z -= shift * 0.025 * idleW; x += breath * 0.006 + mx * 0.01; break;
        case 'chest': x -= breath * 0.012; y += my * 0.02 * idleW; break;
        case 'upperChest': x -= breath * 0.01; break;
        case 'neck': x += mx * 0.02 * idleW; break;
        case 'head': x += mx * 0.03 * idleW - hover * 0.03; z += P.headTilt * idleW + hover * 0.08 * Math.sign(P.headTilt || 1); y += my * 0.04 * idleW; break;
        case 'leftShoulder': z += breath * 0.015; break;
        case 'rightShoulder': z -= breath * 0.015; break;
        case 'leftUpperArm': z += breath * 0.012 * idleW - focus * 0.02; break;
        case 'rightUpperArm': z -= breath * 0.012 * idleW - focus * 0.02; break;
        case 'leftUpperLeg': z += Math.max(0, shift) * 0.03 * idleW; break;
        case 'rightUpperLeg': z += Math.min(0, shift) * 0.03 * idleW; break;
        case 'leftLowerLeg': x += Math.max(0, -shift) * 0.08 * idleW; break;
        case 'rightLowerLeg': x += Math.max(0, shift) * 0.08 * idleW; break;
      }
      this.setBone(b, x, y, z);
    }
    // Look-at: split between neck and head, weighted by the gesture's tolerance for it.
    const lw = 1 - w + w * this.sample.lookWeight;
    this.addRotation('neck', this.headPitch * 0.35 * lw, this.headYaw * 0.4 * lw);
    this.addRotation('head', this.headPitch * 0.65 * lw, this.headYaw * 0.6 * lw);
    // Gesture body yaw (twirl) rides on the hips.
    if (this.sample.hipsYaw && w > 0) this.addRotation('hips', 0, this.sample.hipsYaw * Math.min(1, w * 1.5));

    for (const s of this.bones.values()) {
      if (snap) s.node.quaternion.copy(s.target);
      else s.node.quaternion.slerp(s.target, dampFactor(s.stiffness, dt));
    }
    if (this.hips) this.hips.position.set(this.hipsRest.x, this.hipsRest.y + this.sample.hipsY * w + breath * 0.002, this.hipsRest.z);
  }

  private addRotation(b: VRMHumanBoneName, x: number, y: number) {
    const s = this.bones.get(b); if (!s) return;
    this.tmpE.set(this.mirror ? -x : x, y, 0);
    this.tmpQ.setFromEuler(this.tmpE);
    s.target.multiply(this.tmpQ);
  }

  private updateExpressions(dt: number) {
    const em = this.vrm.expressionManager; if (!em) return;
    const P = this.character.personality;
    const w = this.gestureW;
    const smile = Math.max(P.smile * (1 - w), this.hoverAmt * 0.45, this.focusAmt * 0.3);
    // Blink scheduler: random interval per personality, occasional double blink, none mid-surprise.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) { this.blinkT = 0; this.doubleBlink = rand(this.time + this.seed) < 0.18; this.nextBlink = P.blink[0] + rand(this.time * 1.3 + this.seed) * (P.blink[1] - P.blink[0]); }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const d = 0.16;
      blink = this.blinkT < d ? Math.sin((this.blinkT / d) * Math.PI) : 0;
      if (this.blinkT >= d) { if (this.doubleBlink) { this.doubleBlink = false; this.blinkT = -0.08; this.nextBlink = 0.09; } else this.blinkT = -1; }
    }
    for (const k of EXPRESSIONS) {
      const name = this.exprNames.get(k); if (!name) continue;
      let target = (this.sample.expr[k] ?? 0) * w;
      if (k === 'happy') target = Math.max(target, smile);
      if (k === 'blink') target = (this.sample.expr.surprised ?? 0) * w > 0.5 ? 0 : blink;
      const cur = this.exprCur.get(k)!;
      const next = k === 'blink' ? target : cur + (target - cur) * dampFactor(k === 'aa' || k === 'oh' || k === 'ih' ? 22 : 7, dt);
      this.exprCur.set(k, next);
      em.setValue(name, next);
    }
  }

  update(dt: number) {
    // Appear/disappear: quick scale with spring overshoot, then hide fully to skip work.
    this.appear += (this.appearTarget - this.appear) * dampFactor(this.appearTarget ? 7 : 10, dt);
    if (this.appearTarget === 0 && this.appear < 0.02) { this.root.visible = false; this.appear = 0; }
    if (!this.root.visible) return;
    this.time += dt;
    this.root.scale.setScalar(Math.max(0.001, this.appear));

    // Gesture envelope.
    if (this.emote !== 'idle') {
      const G = GESTURES[this.emote];
      this.gestureT += dt;
      const env = Math.min(1, this.gestureT / G.attack) * Math.min(1, Math.max(0, (G.duration - this.gestureT) / G.release));
      this.gestureW = env;
      this.sample.expr = {}; this.sample.hipsY = 0; this.sample.hipsYaw = 0; this.sample.lookWeight = 1;
      G.sample(this.gestureT, this.sample);
      if (this.gestureT >= G.duration) {
        this.emote = 'idle'; this.gestureW = 0; this.sample.pose = {}; this.sample.hipsYaw = 0;
        if (this.queued) { const q = this.queued; this.queued = null; this.play(q); }
      }
    }
    this.hoverAmt += ((this.hovered ? 1 : 0) - this.hoverAmt) * dampFactor(5, dt);
    this.focusAmt += ((this.focused ? 1 : 0) - this.focusAmt) * dampFactor(4, dt);

    // Root motion (placement, facing).
    this.pos.update(0.45, dt);
    this.root.position.copy(this.pos.value);
    this.facing = smoothDamp(this.facing, this.facingTarget, this.facingV, 0.35, dt);
    this.root.rotation.y = this.facing;

    // Head look: yaw/pitch toward lookTarget in root space, clamped to natural limits.
    const head = this.bones.get('head')?.node;
    if (head) {
      head.getWorldPosition(this.headWorld);
      this.tmpV.copy(this.headWorld);
      this.root.worldToLocal(this.tmpV);
      const dx = this.lookTarget.position.x - this.tmpV.x, dy = this.lookTarget.position.y - this.tmpV.y, dz = this.lookTarget.position.z - this.tmpV.z;
      const yaw = THREE.MathUtils.clamp(Math.atan2(dx, Math.max(0.2, dz)), -0.6, 0.6);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.3, 0.35);
      this.headYaw += (yaw - this.headYaw) * dampFactor(4, dt);
      this.headPitch += (pitch - this.headPitch) * dampFactor(4, dt);
    }

    this.applyPose(dt);
    this.updateExpressions(dt);
    this.vrm.update(dt);
  }

  dispose() {
    this.root.removeFromParent();
    this.vrm.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const k in u) if (u[k].value instanceof THREE.Texture) (u[k].value as THREE.Texture).dispose();
        mat.dispose();
      }
    });
  }
}
