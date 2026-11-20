import type { CharacterId } from '@shared';
import { assetUrl } from '../assets.js';

export type IdleStyle = 'clasped' | 'hipHand' | 'behindBack';
export type Emote = 'idle' | 'greet' | 'excited' | 'surprised' | 'victory' | 'sad' | 'thinking' | 'bow' | 'twirl' | 'nod';

export type Personality = {
  idle: IdleStyle;
  /** Amplitude multiplier for sway and breathing. */
  energy: number;
  /** Playback speed multiplier for idle motion. */
  tempo: number;
  /** Resting head tilt (radians, + = toward her left shoulder). */
  headTilt: number;
  /** Baseline smile weight. */
  smile: number;
  /** Seconds between blinks (min, max). */
  blink: [number, number];
  /** Which emote each game moment triggers. */
  on: { select: Emote; hover: Emote; tossWin: Emote; tossLose: Emote; gameWin: Emote; gameLose: Emote; seriesWin: Emote };
};

export type Character = {
  id: CharacterId;
  name: string;
  nameJp: string;
  age: number;
  title: string;
  tagline: string;
  bio: string;
  traits: string[];
  draftStyle: { label: string; value: number }[];
  accent: string;
  accent2: string;
  model: string;
  portrait: string;
  personality: Personality;
  credit: { model: string; author: string; license: string; url: string };
};

/**
 * Three partners, each built on a permissively licensed VRM model (see ASSETS.md). Names, ages and
 * personalities are original to this project. All partners are adults.
 */
export const ROSTER: Character[] = [
  {
    id: 'rei',
    name: 'Rei Amatsuka',
    nameJp: '天塚 レイ',
    age: 25,
    title: 'Tera Systems Engineer',
    tagline: 'Calculated. Then calculated again.',
    bio: 'Rei tunes the arena\'s Tera relays by day and reads opponents like telemetry by night. Quiet, exact and quietly competitive, she trusts momentum and fast pivots over brute force.',
    traits: ['Analytical', 'Composed', 'Dry humor'],
    draftStyle: [{ label: 'Tempo', value: 0.9 }, { label: 'Risk', value: 0.45 }, { label: 'Synergy', value: 0.75 }],
    accent: '#3ee6ff', accent2: '#7a5cff',
    model: assetUrl('models/rei.vrm'),
    portrait: assetUrl('portraits/rei.webp'),
    personality: {
      idle: 'hipHand', energy: 0.8, tempo: 0.95, headTilt: -0.03, smile: 0.08, blink: [2.8, 6.0],
      on: { select: 'nod', hover: 'nod', tossWin: 'excited', tossLose: 'thinking', gameWin: 'victory', gameLose: 'sad', seriesWin: 'victory' },
    },
    credit: { model: 'Vita (VRoid Studio sample)', author: 'VRoid Project / pixiv Inc.', license: 'CC0 1.0', url: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569' },
  },
  {
    id: 'kanade',
    name: 'Kanade Shiomi',
    nameJp: '汐見 かなで',
    age: 27,
    title: 'League Strategist',
    tagline: 'Every team has a story. Let\'s write a good one.',
    bio: 'A former league analyst who coaches rookies on weekends. Kanade is warm, patient and annoyingly good at reading the toss winner\'s nerves. She favors bulky cores and long games.',
    traits: ['Warm', 'Patient', 'Perceptive'],
    draftStyle: [{ label: 'Tempo', value: 0.5 }, { label: 'Risk', value: 0.3 }, { label: 'Synergy', value: 0.95 }],
    accent: '#ffb35c', accent2: '#ff6f91',
    model: assetUrl('models/kanade.vrm'),
    portrait: assetUrl('portraits/kanade.webp'),
    personality: {
      idle: 'clasped', energy: 1.0, tempo: 0.85, headTilt: 0.07, smile: 0.32, blink: [2.2, 5.0],
      on: { select: 'greet', hover: 'greet', tossWin: 'excited', tossLose: 'surprised', gameWin: 'victory', gameLose: 'sad', seriesWin: 'victory' },
    },
    credit: { model: 'VRM1_Constraint_Twist_Sample', author: 'pixiv Inc.', license: 'VRM Public License 1.0 (commercial use by corporations allowed, credit not required)', url: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample' },
  },
  {
    id: 'mirei',
    name: 'Mirei Kurogane',
    nameJp: '黒鉄 ミレイ',
    age: 29,
    title: 'Night Archivist',
    tagline: 'Fate is a coin. I simply know which way it leans.',
    bio: 'Curator of the shrine\'s midnight archive and an unapologetic showoff. Mirei treats every series as theatre, loves setup sweepers and never misses a chance for a dramatic bow.',
    traits: ['Theatrical', 'Mischievous', 'Elegant'],
    draftStyle: [{ label: 'Tempo', value: 0.65 }, { label: 'Risk', value: 0.95 }, { label: 'Synergy', value: 0.55 }],
    accent: '#ff3d6e', accent2: '#9b5cff',
    model: assetUrl('models/mirei.vrm'),
    portrait: assetUrl('portraits/mirei.webp'),
    personality: {
      idle: 'behindBack', energy: 0.9, tempo: 0.75, headTilt: -0.06, smile: 0.18, blink: [3.0, 7.0],
      on: { select: 'bow', hover: 'nod', tossWin: 'twirl', tossLose: 'thinking', gameWin: 'twirl', gameLose: 'sad', seriesWin: 'twirl' },
    },
    credit: { model: 'Darkness Shibu (VRoid Studio sample)', author: 'VRoid Project / pixiv Inc.', license: 'CC0 1.0', url: 'https://vroid.pixiv.help/hc/en-us/articles/4402614652569' },
  },
];

export const characterById = (id: CharacterId | null | undefined) => ROSTER.find(c => c.id === id) ?? null;
export const DEFAULT_CHARACTER: CharacterId = 'rei';
