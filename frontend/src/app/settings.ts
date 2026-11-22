import { useSyncExternalStore } from 'react';
import { CHARACTER_IDS, isCharacterId, type CharacterId } from '@shared';
import type { EffectsLevel, QualityPref, RenderScale } from '../engine/quality.js';
import { AUDIO_DEFAULTS, mixFromSettings } from '../audio/mix.js';

export type MotionPref = 'system' | 'reduced' | 'full';
export type CameraStyle = 'cinematic' | 'steady';
export type Settings = {
  /* Graphics */
  quality: QualityPref;
  renderScale: RenderScale;
  effects: EffectsLevel;
  /** One switch for weak devices: overrides quality, render scale and effects (see displayOf). */
  performance: boolean;
  /** Frame-time and GPU diagnostics overlay. */
  perf: boolean;
  /* Camera and motion */
  motion: MotionPref;
  camera: CameraStyle;
  /* Interface and accessibility */
  uiScale: number;
  highContrast: boolean;
  /** Reduce flashing: no lightning, screen flashes or flicker. */
  calm: boolean;
  /* Audio, each 0..1: `volume` is the master; then one volume per category (see audio/mix.ts) and mute */
  volume: number;
  musicVolume: number;
  ambienceVolume: number;
  criesVolume: number;
  uiVolume: number;
  battleVolume: number;
  muted: boolean;
  /* Identity and room preferences */
  partner: CharacterId;
  name: string;
  showdownName: string;
  format: string;
  battleMode: 'app' | 'showdown';
};

export const UI_SCALES = [0.9, 1, 1.1, 1.25] as const;
const KEY = 'pab-settings';
const query = new URLSearchParams(location.search);

/** Audio defaults (master 70%, music 30%, environment 25%, cries 15%, interface 35%, battle 45%). */
export const AUDIO_SETTINGS_DEFAULTS = {
  volume: AUDIO_DEFAULTS.master, musicVolume: AUDIO_DEFAULTS.music, ambienceVolume: AUDIO_DEFAULTS.ambience,
  criesVolume: AUDIO_DEFAULTS.cries, uiVolume: AUDIO_DEFAULTS.ui, battleVolume: AUDIO_DEFAULTS.battle, muted: false,
} satisfies Partial<Settings>;

const DISPLAY_DEFAULTS = {
  quality: 'auto', renderScale: 'auto', effects: 'full', performance: false, perf: false,
  motion: 'system', camera: 'cinematic', uiScale: 1, highContrast: false, calm: false, ...AUDIO_SETTINGS_DEFAULTS,
} satisfies Partial<Settings>;

const pick = <T,>(values: readonly T[], v: unknown, fallback: T): T => values.find(x => x === v) ?? fallback;

/** No partner saved yet: a first visit. It starts with a random partner and opens on the partner choice. */
export let firstVisit = false;

function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>; } catch { /* ignore */ }
  firstVisit = !isCharacterId(s.partner);
  const d = DISPLAY_DEFAULTS;
  const a = mixFromSettings(s);
  return {
    quality: pick(['auto', 'low', 'medium', 'high'] as const, query.get('quality') ?? s.quality, d.quality),
    renderScale: pick(['auto', 0.5, 0.75, 1] as const, s.renderScale, d.renderScale),
    effects: pick(['full', 'reduced', 'minimal'] as const, s.effects, d.effects),
    performance: s.performance === true,
    perf: query.has('perf') || s.perf === true,
    motion: pick(['system', 'reduced', 'full'] as const, s.motion, d.motion),
    camera: pick(['cinematic', 'steady'] as const, s.camera, d.camera),
    uiScale: pick(UI_SCALES, s.uiScale, d.uiScale),
    highContrast: s.highContrast === true,
    calm: s.calm === true,
    volume: a.master, musicVolume: a.music, ambienceVolume: a.ambience, criesVolume: a.cries, uiVolume: a.ui, battleVolume: a.battle,
    muted: query.has('mute') || a.muted,
    partner: isCharacterId(s.partner) ? s.partner : CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)],
    name: typeof s.name === 'string' ? s.name.slice(0, 24) : '',
    showdownName: typeof s.showdownName === 'string' ? s.showdownName.slice(0, 18) : '',
    format: typeof s.format === 'string' ? s.format : 'gen9customgame',
    battleMode: s.battleMode === 'showdown' ? 'showdown' : 'app',
  };
}

let state = load();
const listeners = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } listeners.forEach(l => l()); };
export const settings = {
  get: () => state,
  set(patch: Partial<Settings>) { state = { ...state, ...patch }; save(); },
  /** Restores every display, audio and accessibility option; name, partner and room preferences stay. */
  reset() { state = { ...state, ...DISPLAY_DEFAULTS }; save(); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export const useSettings = () => useSyncExternalStore(settings.subscribe, settings.get);

/** What the renderer actually uses: performance mode trades quality, resolution and effects for frame rate. */
export function displayOf(s: Settings): { quality: QualityPref; renderScale: RenderScale; effects: EffectsLevel } {
  return s.performance ? { quality: 'low', renderScale: 0.75, effects: 'reduced' } : { quality: s.quality, renderScale: s.renderScale, effects: s.effects };
}

const mq = matchMedia('(prefers-reduced-motion: reduce)');
export function useReducedMotion(): boolean {
  const s = useSettings();
  const sys = useSyncExternalStore(cb => { mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); }, () => mq.matches);
  return s.motion === 'reduced' || (s.motion === 'system' && sys);
}
