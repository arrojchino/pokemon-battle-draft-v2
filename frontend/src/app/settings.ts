import { useSyncExternalStore } from 'react';
import { isCharacterId, type CharacterId } from '@shared';
import type { EffectsLevel, QualityPref, RenderScale } from '../engine/quality.js';
import { DEFAULT_CHARACTER } from '../characters/roster.js';

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
  /* Audio: sound effects only, the game has no music */
  volume: number;
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

const DISPLAY_DEFAULTS = {
  quality: 'auto', renderScale: 'auto', effects: 'full', performance: false, perf: false,
  motion: 'system', camera: 'cinematic', uiScale: 1, highContrast: false, calm: false, volume: 0.8, muted: false,
} satisfies Partial<Settings>;

const pick = <T,>(values: readonly T[], v: unknown, fallback: T): T => values.find(x => x === v) ?? fallback;

function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>; } catch { /* ignore */ }
  const d = DISPLAY_DEFAULTS;
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
    volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : d.volume,
    muted: query.has('mute') || s.muted === true,
    partner: isCharacterId(s.partner) ? s.partner : DEFAULT_CHARACTER,
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
