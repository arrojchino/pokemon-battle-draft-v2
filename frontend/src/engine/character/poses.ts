import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { Emote, IdleStyle } from '../../characters/roster.js';
import { smoothstep } from '../math.js';

/**
 * Pose library in VRM 1.0 normalized-bone space (character faces +Z, T-pose = all zeros).
 * Conventions verified against rendered output:
 *   upperArm z: left −, right + lowers the arm;  x −: swings the arm forward.
 *   lowerArm y: left −, right + bends the forearm forward; lowerArm z: left +, right − raises the forearm.
 *   head/neck/spine x +: pitch down; y +: turn toward her left (+X).
 * VRM 0.x models are mirrored (x and z negated) by the rig, so poses are authored once.
 */
export type Euler3 = [number, number, number];
export type Pose = Partial<Record<VRMHumanBoneName, Euler3>>;

export const ANIMATED_BONES: VRMHumanBoneName[] = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal', 'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
];

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'] as const;

/** Curl both hands: 0 = open, 1 = loose fist. Thumbs fold a little less. */
export function hands(curl: number, left = curl, right = curl): Pose {
  const p: Pose = {};
  for (const f of FINGERS) {
    const k = f === 'Index' ? 0.85 : f === 'Little' ? 1.1 : 1;
    p[`left${f}Proximal`] = [0, 0, -0.55 * left * k]; p[`left${f}Intermediate`] = [0, 0, -0.85 * left * k]; p[`left${f}Distal`] = [0, 0, -0.6 * left * k];
    p[`right${f}Proximal`] = [0, 0, 0.55 * right * k]; p[`right${f}Intermediate`] = [0, 0, 0.85 * right * k]; p[`right${f}Distal`] = [0, 0, 0.6 * right * k];
  }
  // VRM 1.0 thumb chain is Metacarpal → Proximal → Distal (three-vrm maps VRM 0.x names onto it).
  p.leftThumbMetacarpal = [0, -0.25 * left, 0.1]; p.leftThumbProximal = [0, -0.3 * left, 0]; p.leftThumbDistal = [0, -0.35 * left, 0];
  p.rightThumbMetacarpal = [0, 0.25 * right, -0.1]; p.rightThumbProximal = [0, 0.3 * right, 0]; p.rightThumbDistal = [0, 0.35 * right, 0];
  return p;
}

const merge = (...poses: Pose[]): Pose => Object.assign({}, ...poses);

/** Relaxed standing base shared by everyone. */
const BASE: Pose = merge(hands(0.35), {
  spine: [0.02, 0, 0], chest: [-0.02, 0, 0], neck: [0.03, 0, 0], head: [0.02, 0, 0],
  leftUpperArm: [-0.05, 0, -1.2], rightUpperArm: [-0.05, 0, 1.2],
  leftLowerArm: [0, -0.28, 0], rightLowerArm: [0, 0.28, 0],
  leftHand: [0, 0, -0.08], rightHand: [0, 0, 0.08],
  leftUpperLeg: [0, 0, 0.035], rightUpperLeg: [0, 0, -0.035],
});

/** Personality idles. Each is a full-body silhouette the rig breathes and sways on top of. */
export const IDLE_POSES: Record<IdleStyle, Pose> = {
  // Hands loosely clasped in front, elbows soft: warm and open.
  clasped: merge(BASE, hands(0.45), {
    // Upper-arm twist (y) swings the bent forearm inward so the hands meet in front.
    leftUpperArm: [-0.22, -0.6, -1.2], rightUpperArm: [-0.22, 0.6, 1.2],
    leftLowerArm: [0, -1.3, 0], rightLowerArm: [0, 1.3, 0],
    leftHand: [0, -0.25, 0.1], rightHand: [0, 0.25, -0.1],
    head: [0.04, 0, 0],
  }),
  // Right hand on hip, weight on the left leg: confident.
  hipHand: merge(BASE, {
    rightUpperArm: [0.22, -0.15, 0.82], rightLowerArm: [0, 1.75, 0.1], rightHand: [0, 0.2, 0.35],
    leftUpperArm: [-0.06, 0, -1.22],
    hips: [0, 0, -0.03], spine: [0.02, 0, 0.03], leftUpperLeg: [0, 0, 0.02], rightUpperLeg: [-0.06, 0, -0.07], rightLowerLeg: [0.12, 0, 0],
  }, hands(0.2, 0.3, 0.55)),
  // Hands folded behind the back, chest open, chin a touch high: poised.
  behindBack: merge(BASE, hands(0.4), {
    leftUpperArm: [0.3, 0.6, -1.22], rightUpperArm: [0.3, -0.6, 1.22],
    leftLowerArm: [0, 1.2, 0], rightLowerArm: [0, -1.2, 0],
    chest: [-0.06, 0, 0], head: [-0.03, 0, 0],
  }),
};

export type GestureSample = { pose: Pose; expr: Partial<Record<ExpressionKey, number>>; hipsY: number; hipsYaw: number; lookWeight: number };
export type ExpressionKey = 'happy' | 'relaxed' | 'surprised' | 'sad' | 'angry' | 'aa' | 'oh' | 'ih' | 'blink';

export type Gesture = {
  duration: number;
  /** Fade in / out seconds for blending over the idle. */
  attack: number; release: number;
  sample(t: number, out: GestureSample): void;
};

const osc = (t: number, hz: number) => Math.sin(t * Math.PI * 2 * hz);
const bump = (t: number, a: number, b: number) => smoothstep(a, a + (b - a) * 0.35, t) * (1 - smoothstep(b - (b - a) * 0.35, b, t));
/** Short mouth flutter so greetings read as speech. */
const talk = (t: number, from: number, to: number) => {
  const env = bump(t, from, to);
  return { aa: env * (0.35 + 0.3 * Math.max(0, osc(t, 5.3))), oh: env * 0.25 * Math.max(0, osc(t + 0.11, 3.7)), ih: env * 0.2 * Math.max(0, osc(t + 0.23, 4.4)) };
};

export const GESTURES: Record<Exclude<Emote, 'idle'>, Gesture> = {
  greet: {
    duration: 2.4, attack: 0.35, release: 0.5,
    sample(t, o) {
      const w = osc(t, 1.6) * 0.32;
      o.pose = merge(hands(0.1, 0.35, 0.05), {
        rightUpperArm: [-0.25, -0.3, -0.25], rightLowerArm: [0, 0.35, -1.25 + w], rightHand: [0, 0, w * 0.4],
        head: [0.02, -0.06, 0.12], neck: [0, -0.04, 0.04], spine: [0, 0, 0.04],
      });
      o.expr = { happy: 0.9, ...talk(t, 0.3, 1.5) };
      o.lookWeight = 1;
    },
  },
  nod: {
    duration: 1.1, attack: 0.15, release: 0.3,
    sample(t, o) {
      const n = bump(t, 0.05, 0.55) * 0.18 + bump(t, 0.5, 0.95) * 0.08;
      o.pose = { head: [0.04 + n, 0, 0.04], neck: [n * 0.4, 0, 0] };
      o.expr = { happy: 0.45 };
      o.lookWeight = 1;
    },
  },
  excited: {
    duration: 2.2, attack: 0.2, release: 0.55,
    sample(t, o) {
      const b = Math.abs(osc(t, 2.2)) * bump(t, 0, 1.8);
      o.pose = merge(hands(0.95), {
        leftUpperArm: [-0.55, 0.2, -0.75], rightUpperArm: [-0.55, -0.2, 0.75],
        leftLowerArm: [0, -1.9, 0.2 + b * 0.2], rightLowerArm: [0, 1.9, -0.2 - b * 0.2],
        leftHand: [0, 0, -0.2], rightHand: [0, 0, 0.2],
        spine: [-0.06, 0, 0], head: [-0.06, 0, 0],
      });
      o.hipsY = b * 0.045;
      o.expr = { happy: 1, aa: 0.25 };
      o.lookWeight = 0.6;
    },
  },
  surprised: {
    duration: 1.8, attack: 0.1, release: 0.6,
    sample(t, o) {
      const k = 1 - smoothstep(0.9, 1.8, t) * 0.4;
      o.pose = merge(hands(0.1), {
        leftUpperArm: [-0.75, 0.1, -0.95 * k], rightUpperArm: [-0.75, -0.1, 0.95 * k],
        leftLowerArm: [0, -1.55, 0], rightLowerArm: [0, 1.55, 0],
        spine: [-0.1, 0, 0], chest: [-0.05, 0, 0], head: [-0.1, 0, 0],
      });
      o.expr = { surprised: 1, oh: 0.3 };
      o.lookWeight = 0.4;
    },
  },
  thinking: {
    duration: 2.6, attack: 0.4, release: 0.6,
    sample(t, o) {
      o.pose = merge(hands(0.6, 0.5, 0.75), {
        rightUpperArm: [-0.55, 0.15, 1.2], rightLowerArm: [0, 2.25, 0], rightHand: [0.3, 0, 0.35],
        leftUpperArm: [-0.45, 0.1, -1.2], leftLowerArm: [0, -1.4, 0],
        head: [0.08, 0.05 * osc(t, 0.3), 0.14], neck: [0, 0, 0.05],
      });
      o.expr = { relaxed: 0.15, ih: 0.1 };
      o.lookWeight = 0.3;
    },
  },
  victory: {
    duration: 2.8, attack: 0.3, release: 0.6,
    sample(t, o) {
      const pump = bump(t, 0.25, 0.75) * 0.25;
      o.pose = merge(hands(0.2, 0.3, 0.95), {
        rightUpperArm: [-0.15, 0, -1.25 - pump], rightLowerArm: [0, 0.3, -0.25],
        leftUpperArm: [0.22, 0.15, -0.82], leftLowerArm: [0, -1.75, -0.1], leftHand: [0, -0.2, -0.35],
        spine: [-0.05, 0, -0.04], head: [-0.06, 0, -0.06],
      });
      o.hipsY = bump(t, 0.15, 0.7) * 0.05;
      o.expr = { happy: 1, aa: 0.35 * bump(t, 0.2, 1.4) };
      o.lookWeight = 0.7;
    },
  },
  sad: {
    duration: 2.4, attack: 0.5, release: 0.8,
    sample(_t, o) {
      o.pose = merge(hands(0.25), {
        head: [0.3, 0, 0.05], neck: [0.12, 0, 0], spine: [0.08, 0, 0], chest: [0.05, 0, 0],
        leftShoulder: [0, 0, -0.06], rightShoulder: [0, 0, 0.06],
        leftUpperArm: [0.02, 0, -1.3], rightUpperArm: [0.02, 0, 1.3],
      });
      o.expr = { sad: 0.85 };
      o.lookWeight = 0.15;
    },
  },
  bow: {
    duration: 2.3, attack: 0.25, release: 0.7,
    sample(t, o) {
      const b = bump(t, 0.05, 1.7);
      o.pose = merge(hands(0.4), {
        spine: [0.32 * b, 0, 0], chest: [0.12 * b, 0, 0], head: [0.25 * b, 0, 0],
        rightUpperArm: [-0.5 * b, -0.3 * b, 1.0], rightLowerArm: [0, 1.2 * b + 0.3, 0],
        leftUpperArm: [0.3 + 0.2 * b, 0, -1.15 + 0.3 * b], leftLowerArm: [0, -0.3, 0],
      });
      o.expr = { relaxed: 0.6 * b, happy: 0.3 * (1 - b) };
      o.lookWeight = 1 - b;
    },
  },
  twirl: {
    duration: 2.2, attack: 0.2, release: 0.5,
    sample(t, o) {
      const s = smoothstep(0.1, 1.15, t);
      o.hipsYaw = s * Math.PI * 2;
      o.pose = merge(hands(0.15), {
        leftUpperArm: [-0.1, 0, -0.55], rightUpperArm: [-0.1, 0, 0.55],
        leftLowerArm: [0, -0.4, 0.3], rightLowerArm: [0, 0.4, -0.3],
        head: [-0.08, 0, 0.1],
      });
      o.hipsY = bump(t, 0.2, 1.2) * 0.03;
      o.expr = { happy: 0.95, aa: 0.2 * bump(t, 1.1, 2.0) };
      o.lookWeight = smoothstep(1.1, 1.6, t);
    },
  },
};
