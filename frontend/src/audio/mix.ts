/**
 * Mixing rules for the AudioManager, kept free of Web Audio so they can be unit tested: categories,
 * cue routing, volume defaults, gain math, playback profiles, cry policy, throttling and ducking.
 *
 * Gain chain per category: master x category volume x CATEGORY_TRIM x profile level (x ducking), then a
 * gentle compressor and a limiter on the master bus. Volumes are linear amplitude (50% = -6 dB). The trims
 * calibrate each category's 100% so the default volumes give a balanced mix (measured with OfflineAudioContext
 * renders: see the audio QA notes in sound.ts).
 */
export type Category = 'music' | 'cries' | 'ui' | 'battle';
export const CATEGORIES: readonly Category[] = ['music', 'cries', 'ui', 'battle'];
export type Profile = 'menu' | 'plaza' | 'battle' | 'watch';
export const PROFILES: readonly Profile[] = ['menu', 'plaza', 'battle', 'watch'];

export type Cue =
  // UI
  | 'hover' | 'click' | 'confirm' | 'back' | 'toggle' | 'error' | 'join' | 'tick' | 'tickUrgent' | 'notify'
  // Plaza, NPCs, chat and transitions
  | 'step' | 'prompt' | 'dialogOpen' | 'dialogMove' | 'dialogSelect' | 'dialogClose' | 'npcGreet'
  | 'chatSend' | 'chatIn' | 'joinLobby' | 'watchStart' | 'plazaReturn' | 'introSwell'
  // Match flow
  | 'coinFlip' | 'coinLand' | 'tossWin' | 'tossLose' | 'deal' | 'pick'
  // Battle
  | 'switchIn' | 'dash' | 'punch' | 'slash' | 'bite' | 'fire' | 'water' | 'zap' | 'beamCharge' | 'beam'
  | 'orb' | 'orbHit' | 'rings' | 'wind' | 'leaves' | 'quake' | 'meteor' | 'meteorHit' | 'coins' | 'heal' | 'shield'
  | 'buff' | 'debuff' | 'hazard' | 'status' | 'hit' | 'hitBig' | 'crit' | 'super' | 'resist' | 'miss' | 'faint' | 'tera'
  | 'stamp' | 'ko' | 'win' | 'lose';

const UI_CUES = ['hover', 'click', 'confirm', 'back', 'toggle', 'error', 'join', 'tick', 'tickUrgent', 'notify', 'prompt', 'dialogOpen', 'dialogMove', 'dialogSelect',
  'dialogClose', 'npcGreet', 'chatSend', 'chatIn', 'joinLobby', 'watchStart', 'plazaReturn', 'tossWin', 'tossLose', 'deal', 'pick'] as const;
const BATTLE_CUES = ['coinFlip', 'coinLand', 'switchIn', 'dash', 'punch', 'slash', 'bite', 'fire', 'water', 'zap', 'beamCharge', 'beam', 'orb', 'orbHit', 'rings', 'wind',
  'leaves', 'quake', 'meteor', 'meteorHit', 'coins', 'heal', 'shield', 'buff', 'debuff', 'hazard', 'status', 'hit', 'hitBig', 'crit', 'super', 'resist', 'miss', 'faint',
  'tera', 'stamp', 'ko', 'win', 'lose'] as const;

/** Which volume slider each cue answers to. Footsteps are world foley, with the effects; the intro swell is music. */
export const CUE_CATEGORY: Record<Cue, Category> = {
  ...Object.fromEntries(UI_CUES.map(c => [c, 'ui'])),
  ...Object.fromEntries(BATTLE_CUES.map(c => [c, 'battle'])),
  step: 'battle', introSwell: 'music',
} as Record<Cue, Category>;
/**
 * Per-cue level inside its category. Footsteps moved from the old environment bed to the effects, which sit
 * higher and pass a saturator; this keeps them where they were (offline render: -36.5 dB peak, -55.5 LUFS in the
 * plaza at the default volumes) instead of getting louder.
 */
export const CUE_TRIM: Partial<Record<Cue, number>> = { step: 0.5 };
export const ALL_CUES = Object.keys(CUE_CATEGORY) as Cue[];

export type AudioMix = { master: number; music: number; cries: number; ui: number; battle: number; muted: boolean };
/** Starting volumes: quiet music, cries clearly below the effects, nothing at full scale. */
export const AUDIO_DEFAULTS: Readonly<AudioMix> = { master: 0.7, music: 0.3, cries: 0.15, ui: 0.35, battle: 0.45, muted: false };

/**
 * Linear gain of each category at 100%, calibrated by offline renders through the full mix at the default
 * volumes (`?audiotest`, `__sound.renderBeds/renderCue/renderCry`): music beds about -33 LUFS integrated in the
 * menus and the plaza and a little lower in battle, cries about -23 LUFS momentary, big hits a few LU under
 * that, interface clicks clearly audible but well below both.
 */
export const CATEGORY_TRIM: Record<Category, number> = { music: 4.5, cries: 3.2, ui: 3.2, battle: 1 };

/** Level of each category per profile (multiplies the player's volumes). */
export const PROFILE_MIX: Record<Profile, Record<Category, number>> = {
  menu: { music: 0.8, cries: 0.5, ui: 1, battle: 1 },
  plaza: { music: 0.75, cries: 0.7, ui: 1, battle: 1 },
  battle: { music: 0.45, cries: 1, ui: 0.85, battle: 1 },
  watch: { music: 0.4, cries: 0.9, ui: 0.9, battle: 0.9 },
};

/**
 * Cries per profile: `gap` is the minimum time between any two cries, `cooldown` the minimum time before the
 * same species cries again, `voices` how many may overlap (a new one beyond that is skipped).
 */
export const CRY_POLICY: Record<Profile, { gap: number; cooldown: number; voices: number }> = {
  menu: { gap: 4, cooldown: 12, voices: 1 },
  plaza: { gap: 2.5, cooldown: 8, voices: 1 },
  battle: { gap: 0.6, cooldown: 2, voices: 2 },
  watch: { gap: 0.8, cooldown: 2.5, voices: 2 },
};

export const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/** Final linear gain of a category (before ducking and the master dynamics). */
export function categoryGain(mix: AudioMix, cat: Category, profile: Profile): number {
  if (mix.muted) return 0;
  return clamp01(mix.master, 0) * clamp01(mix[cat], 0) * CATEGORY_TRIM[cat] * PROFILE_MIX[profile][cat];
}
export const gainToDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/**
 * Saved settings fields to a mix (each clamped to 0..1, defaults when missing or invalid). Settings saved before
 * the environment sound was removed still carry `ambienceVolume`; it is simply not read.
 */
export function mixFromSettings(s: { volume?: unknown; musicVolume?: unknown; criesVolume?: unknown; uiVolume?: unknown; battleVolume?: unknown; muted?: unknown }): AudioMix {
  const d = AUDIO_DEFAULTS;
  return {
    master: clamp01(s.volume, d.master), music: clamp01(s.musicVolume, d.music),
    cries: clamp01(s.criesVolume, d.cries), ui: clamp01(s.uiVolume, d.ui), battle: clamp01(s.battleVolume, d.battle), muted: s.muted === true,
  };
}

/** Minimum spacing between two plays of the same cue, seconds (repeats inside it are dropped). */
export const CUE_GAP: Partial<Record<Cue, number>> = {
  hover: 0.09, dialogMove: 0.06, step: 0.08, tick: 0.12, tickUrgent: 0.2, toggle: 0.05, click: 0.05, chatIn: 0.9, chatSend: 0.25, notify: 0.8,
  prompt: 0.5, npcGreet: 1.5, joinLobby: 1, watchStart: 1, plazaReturn: 1, introSwell: 4, coins: 0.08, stamp: 0.15, win: 2, lose: 2, ko: 0.5,
};
export const DEFAULT_GAP = 0.035;
/** Within this window a repeated cue plays progressively softer (multi-hits, quick menus). */
export const REPEAT_WINDOW = 0.35;
export const REPEAT_FALLOFF = 0.8;

/** Voices per category at once; extra cues are skipped unless they are in PRIORITY. */
export const MAX_VOICES: Record<Category, number> = { ui: 4, battle: 9, music: 2, cries: 2 };
export const PRIORITY: ReadonlySet<Cue> = new Set<Cue>(['ko', 'win', 'lose', 'faint', 'error', 'confirm', 'introSwell']);

/** Cues that briefly lower the music (dB) while they ring out. Cries duck it too (see CRY_DUCK). */
export const DUCK: Partial<Record<Cue, number>> = {
  hitBig: -3, ko: -5, meteorHit: -3, quake: -3, faint: -3, tera: -3, win: -7, lose: -7, introSwell: -9, joinLobby: -3, watchStart: -3,
};
export const CRY_DUCK = { music: -4 };

/** Reverb send per category (post fader), so tails follow the volume sliders. */
export const REVERB_SEND: Record<Category, number> = { music: 0.16, cries: 0.14, ui: 0.06, battle: 0.2 };
