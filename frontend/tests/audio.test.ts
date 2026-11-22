import { describe, expect, it } from 'vitest';
import {
  ALL_CUES, AUDIO_DEFAULTS, CATEGORIES, CATEGORY_TRIM, CRY_POLICY, CUE_CATEGORY, CUE_TRIM, MAX_VOICES, PROFILES, PROFILE_MIX, REVERB_SEND,
  categoryGain, gainToDb, mixFromSettings, type AudioMix,
} from '../src/audio/mix.js';
import { CRY, measure, processCry, softClip } from '../src/audio/analysis.js';

const SR = 48000;
const sine = (hz: number, amp: number, sec: number, sr = SR) => {
  const x = new Float32Array(Math.round(sr * sec));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return x;
};
/** Seeded noise so the tests are repeatable. */
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('audio mix math', () => {
  it('routes every cue to a category, including the new plaza and dialog cues', () => {
    for (const c of ALL_CUES) expect(CATEGORIES).toContain(CUE_CATEGORY[c]);
    for (const c of ['step', 'prompt', 'dialogOpen', 'dialogMove', 'dialogSelect', 'dialogClose', 'npcGreet', 'chatSend', 'chatIn', 'joinLobby', 'watchStart', 'plazaReturn', 'introSwell', 'notify'] as const) expect(ALL_CUES).toContain(c);
    // Footsteps play with the effects now that there is no environment bed, trimmed to stay quiet.
    expect(CUE_CATEGORY.step).toBe('battle');
    expect(CUE_TRIM.step).toBeLessThan(1);
    expect(CUE_CATEGORY.introSwell).toBe('music');
    expect(CUE_CATEGORY.hitBig).toBe('battle');
    expect(CUE_CATEGORY.hover).toBe('ui');
  });

  it('starts from the suggested defaults', () => {
    expect(AUDIO_DEFAULTS).toEqual({ master: 0.7, music: 0.3, cries: 0.15, ui: 0.35, battle: 0.45, muted: false });
  });

  it('has no environment category anywhere in the mix', () => {
    expect(CATEGORIES).toEqual(['music', 'cries', 'ui', 'battle']);
    for (const table of [CATEGORY_TRIM, MAX_VOICES, REVERB_SEND, ...Object.values(PROFILE_MIX)]) expect(Object.keys(table)).not.toContain('ambience');
    expect(Object.values(CUE_CATEGORY)).not.toContain('ambience');
  });

  it('multiplies master, category volume, trim and profile level', () => {
    const m = AUDIO_DEFAULTS;
    for (const p of PROFILES) for (const c of CATEGORIES) {
      expect(categoryGain(m, c, p)).toBeCloseTo(m.master * m[c] * CATEGORY_TRIM[c] * PROFILE_MIX[p][c], 10);
    }
    // Halving the master lowers every category by 6 dB.
    const half = { ...m, master: m.master / 2 };
    expect(gainToDb(categoryGain(half, 'battle', 'battle')) - gainToDb(categoryGain(m, 'battle', 'battle'))).toBeCloseTo(-6.02, 1);
  });

  it('silences everything when muted or at zero, and clamps out-of-range volumes', () => {
    for (const c of CATEGORIES) expect(categoryGain({ ...AUDIO_DEFAULTS, muted: true }, c, 'plaza')).toBe(0);
    expect(categoryGain({ ...AUDIO_DEFAULTS, master: 0 }, 'ui', 'menu')).toBe(0);
    expect(categoryGain({ ...AUDIO_DEFAULTS, cries: 0 }, 'cries', 'battle')).toBe(0);
    const wild: AudioMix = { master: 7, music: -1, cries: 2, ui: Number.NaN, battle: 1, muted: false };
    expect(categoryGain(wild, 'music', 'plaza')).toBe(0);
    expect(categoryGain(wild, 'ui', 'plaza')).toBe(0);
    expect(categoryGain(wild, 'cries', 'battle')).toBeCloseTo(1 * 1 * CATEGORY_TRIM.cries * PROFILE_MIX.battle.cries, 10);
  });

  it('keeps cries quiet in menus, occasional in the plaza and normal in battle', () => {
    const g = (p: (typeof PROFILES)[number]) => categoryGain(AUDIO_DEFAULTS, 'cries', p);
    expect(g('menu')).toBeLessThan(g('plaza'));
    expect(g('plaza')).toBeLessThan(g('battle'));
    expect(CRY_POLICY.menu.gap).toBeGreaterThan(CRY_POLICY.plaza.gap);
    expect(CRY_POLICY.plaza.gap).toBeGreaterThan(CRY_POLICY.battle.gap);
    expect(CRY_POLICY.menu.cooldown).toBeGreaterThan(CRY_POLICY.battle.cooldown);
  });

  it('reads saved settings with defaults for missing or invalid fields', () => {
    expect(mixFromSettings({})).toEqual(AUDIO_DEFAULTS);
    // A save from before the environment sound was removed: its volume is ignored, nothing else changes.
    expect(mixFromSettings({ ambienceVolume: 0.9 } as Record<string, unknown>)).toEqual(AUDIO_DEFAULTS);
    expect(mixFromSettings({ volume: 0.8, muted: true })).toEqual({ ...AUDIO_DEFAULTS, master: 0.8, muted: true });
    expect(mixFromSettings({ musicVolume: 1.5, criesVolume: -2, uiVolume: 'loud', battleVolume: 0.6 }))
      .toEqual({ ...AUDIO_DEFAULTS, music: 1, cries: 0, battle: 0.6 });
  });
});

describe('audio analysis', () => {
  it('measures peak, RMS and BS.1770 loudness of a sine', () => {
    const lv = measure([sine(997, 0.1, 1)], SR);
    expect(lv.peakDb).toBeCloseTo(-20, 1);
    expect(lv.rmsDb).toBeCloseTo(-23.0, 1);
    // A 997 Hz sine at -20 dBFS in one channel reads about -23 LUFS (K-weighting adds ~0.7 dB at 1 kHz).
    expect(lv.lufs).toBeGreaterThan(-23.5);
    expect(lv.lufs).toBeLessThan(-21.5);
    expect(lv.dur).toBeGreaterThan(0.95);
    expect(lv.hf).toBeLessThan(0.01);
    expect(measure([sine(6000, 0.1, 0.5)], SR).hf).toBeGreaterThan(0.6);
  });

  it('soft-clips smoothly below the ceiling', () => {
    expect(softClip(0.3, 0.7)).toBe(0.3);
    expect(softClip(5, 0.7)).toBeLessThanOrEqual(0.7);
    expect(softClip(-5, 0.7)).toBeGreaterThanOrEqual(-0.7);
    expect(softClip(0.85, 0.7)).toBeLessThan(0.7);
    expect(softClip(0.6, 0.7)).toBeGreaterThan(softClip(0.55, 0.7));
  });

  it('normalizes a screeching cry and a quiet one to the same loudness, under the ceiling', () => {
    const r = rng(3);
    // Loud and harsh: a bright saw-like buzz at full scale with noise, 3.2 s long, starting after 150 ms of silence.
    const harsh = new Float32Array(Math.round(SR * 3.35));
    for (let i = Math.round(SR * 0.15); i < harsh.length; i++) harsh[i] = 0.75 * (((i * 2900) / SR) % 1 * 2 - 1) + 0.25 * (r() * 2 - 1);
    // Quiet and dull: a low hum at -24 dBFS.
    const quiet = sine(320, 0.06, 0.9);
    const a = processCry(harsh, SR), b = processCry(quiet, SR);
    expect(a.stats.before.peak).toBeGreaterThan(0.9);
    expect(a.stats.shelfDb).toBeLessThan(-3);
    expect(b.stats.shelfDb).toBe(0);
    for (const x of [a, b]) {
      expect(x.stats.after.peak).toBeLessThan(CRY.ceiling);
      expect(Math.abs(x.stats.after.lufs - CRY.target)).toBeLessThan(1.5);
      expect(x.stats.after.hf).toBeLessThan(x.stats.before.hf + 0.01);
    }
    // Harsh one: capped at maxSec with the leading silence trimmed; quiet one raised.
    expect(a.out.length).toBe(Math.round(SR * CRY.maxSec));
    expect(a.stats.capped).toBe(true);
    expect(a.stats.trimmed).toBeGreaterThan(0.13);
    expect(Math.abs(a.out[a.out.length - 1])).toBeLessThan(1e-3);
    expect(b.stats.gain).toBeGreaterThan(3);
    expect(Math.abs(a.stats.after.lufs - b.stats.after.lufs)).toBeLessThan(2);
  });
});
