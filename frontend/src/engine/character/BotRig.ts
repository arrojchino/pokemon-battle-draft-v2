import * as THREE from 'three';
import type { Character, Emote } from '../../characters/roster.js';
import type { BotInstance } from './loadBot.js';
import { SmoothVec3, dampFactor, smoothDamp } from '../math.js';

type Morph = 'Angry' | 'Surprised' | 'Sad';
type Reaction = { clip: string; hold?: number; speed?: number; face?: Partial<Record<Morph, number>> };

/** Emotes mapped onto the model's own authored clips, plus a facial morph for punctuation. */
const REACTIONS: Record<Exclude<Emote, 'idle'>, Reaction> = {
  greet: { clip: 'Wave' },
  nod: { clip: 'Yes' },
  bow: { clip: 'Yes', speed: 0.7 },
  thumbs: { clip: 'ThumbsUp' },
  excited: { clip: 'Jump', face: { Surprised: 0.6 } },
  surprised: { clip: 'No', speed: 1.3, face: { Surprised: 1 } },
  thinking: { clip: 'No', speed: 0.6, face: { Angry: 0.4 } },
  sad: { clip: 'No', speed: 0.8, face: { Sad: 1 } },
  punch: { clip: 'Punch', face: { Angry: 1 } },
  victory: { clip: 'Dance', hold: 3.2 },
  twirl: { clip: 'Dance', hold: 2.2 },
  faceplant: { clip: 'Death', hold: 2.6, face: { Sad: 1 } },
};

/**
 * Animator for one bot: authored clips cross-faded through an AnimationMixer (idle loops, reactions
 * play once and fall back to idle), a head that tracks a look target on top of the animation, facial
 * morphs, placement springs and a springy pop when appearing. No allocations per frame.
 */
export class BotRig {
  readonly root = new THREE.Group();
  readonly pos = new SmoothVec3();
  readonly height: number;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction;
  private idle: THREE.AnimationAction;
  private reaction: { r: Reaction; t: number; dur: number } | null = null;
  private queued: Emote | null = null;
  private morph: Record<Morph, number> = { Angry: 0, Surprised: 0, Sad: 0 };
  private morphTarget: Record<Morph, number> = { Angry: 0, Surprised: 0, Sad: 0 };
  private lookLocal = new THREE.Vector3(0, 1, 3);
  private headYaw = 0; private headPitch = 0;
  private headBase = new THREE.Quaternion(); private tmpQ = new THREE.Quaternion(); private tmpE = new THREE.Euler();
  private invRoot = new THREE.Matrix4();
  private appear = 0; private appearTarget = 0; private appearV = { v: 0 };
  facing = 0; facingTarget = 0; private facingV = { v: 0 };
  hovered = false; focused = false;
  reducedMotion = false;

  constructor(readonly bot: BotInstance, readonly character: Character) {
    this.root.add(bot.scene);
    this.height = bot.height;
    this.mixer = new THREE.AnimationMixer(bot.scene);
    for (const c of bot.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.idle = this.actions.get('Idle')!;
    this.idle.play();
    this.current = this.idle;
    this.mixer.update(0);
    if (bot.head) this.headBase.copy(bot.head.quaternion);
    this.mixer.addEventListener('finished', () => this.finishReaction());
  }

  setPaint(hex: string) { this.bot.paint.color.set(hex); }

  play(e: Emote) {
    if (e === 'idle') { if (this.reaction) this.finishReaction(); return; }
    if (this.reaction && this.reaction.t < 0.35) { this.queued = e; return; }
    if (this.reducedMotion && (e === 'twirl' || e === 'victory')) e = 'thumbs';
    const r = REACTIONS[e];
    const a = this.actions.get(r.clip);
    if (!a) return;
    a.reset();
    a.setLoop(r.hold ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = r.speed ?? 1;
    a.enabled = true; a.setEffectiveWeight(1);
    this.current.crossFadeTo(a, 0.2, false);
    a.play();
    this.current = a;
    this.reaction = { r, t: 0, dur: r.hold ?? a.getClip().duration / (r.speed ?? 1) };
    this.morphTarget = { Angry: 0, Surprised: 0, Sad: 0, ...r.face };
  }

  private finishReaction() {
    if (!this.reaction) return;
    this.reaction = null;
    this.morphTarget = { Angry: 0, Surprised: 0, Sad: 0 };
    this.idle.reset(); this.idle.enabled = true; this.idle.setEffectiveWeight(1); this.idle.play();
    this.current.crossFadeTo(this.idle, 0.35, false);
    this.current = this.idle;
    if (this.queued) { const q = this.queued; this.queued = null; this.play(q); }
  }

  setVisible(v: boolean, instant = false) {
    this.appearTarget = v ? 1 : 0;
    if (instant) this.appear = this.appearTarget;
    if (v) this.root.visible = true;
  }
  get isShown() { return this.appearTarget > 0; }

  place(x: number, z: number, facing: number, instant = false) {
    this.pos.target.set(x, 0, z); this.facingTarget = facing;
    if (instant) { this.pos.snap(); this.facing = facing; this.facingV.v = 0; this.root.position.copy(this.pos.value); this.root.rotation.y = facing; }
  }

  lookAt(world: THREE.Vector3) {
    this.root.updateMatrixWorld();
    this.invRoot.copy(this.root.matrixWorld).invert();
    this.lookLocal.copy(world).applyMatrix4(this.invRoot);
  }

  update(dt: number) {
    // Pop in with a little overshoot; shrink away and stop updating when hidden.
    this.appear = smoothDamp(this.appear, this.appearTarget, this.appearV, this.appearTarget ? 0.12 : 0.08, dt);
    if (this.appearTarget === 0 && this.appear < 0.02) { this.root.visible = false; this.appear = 0; }
    if (!this.root.visible) return;
    const hover = this.hovered ? 1.04 : 1;
    this.root.scale.setScalar(Math.max(0.001, this.appear) * hover);

    this.pos.update(0.45, dt);
    this.root.position.copy(this.pos.value);
    this.facing = smoothDamp(this.facing, this.facingTarget, this.facingV, 0.35, dt);
    this.root.rotation.y = this.facing;

    if (this.reaction) {
      this.reaction.t += dt;
      if (this.reaction.r.hold && this.reaction.t >= this.reaction.dur) this.finishReaction();
    }
    // Undo last frame's look offset first, so bones the clip does not animate never accumulate it.
    if (this.bot.head) this.bot.head.quaternion.copy(this.headBase);
    this.mixer.update(dt);
    if (this.bot.head) this.headBase.copy(this.bot.head.quaternion);

    // Head tracking layered on top of the clip (skipped during big full-body reactions).
    const head = this.bot.head;
    if (head) {
      const free = !this.reaction || this.reaction.r.clip === 'Yes' || this.reaction.r.clip === 'Wave' || this.reaction.r.clip === 'ThumbsUp';
      const y0 = this.height * 0.82;
      const dx = this.lookLocal.x, dy = this.lookLocal.y - y0, dz = this.lookLocal.z;
      const yaw = free ? THREE.MathUtils.clamp(Math.atan2(dx, Math.max(0.2, dz)), -0.7, 0.7) : 0;
      const pitch = free ? THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.35, 0.35) : 0;
      this.headYaw += (yaw - this.headYaw) * dampFactor(5, dt);
      this.headPitch += (pitch - this.headPitch) * dampFactor(5, dt);
      this.tmpQ.setFromEuler(this.tmpE.set(this.headPitch, this.headYaw, 0));
      head.quaternion.multiply(this.tmpQ);
    }

    // Facial morphs.
    const face = this.bot.face;
    if (face?.morphTargetInfluences && face.morphTargetDictionary) {
      for (const k of ['Angry', 'Surprised', 'Sad'] as Morph[]) {
        this.morph[k] += (this.morphTarget[k] - this.morph[k]) * dampFactor(8, dt);
        const i = face.morphTargetDictionary[k];
        if (i !== undefined) face.morphTargetInfluences[i] = this.morph[k];
      }
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    this.bot.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
  }
}
