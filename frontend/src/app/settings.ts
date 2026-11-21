import { useSyncExternalStore } from 'react';
import { isCharacterId, type CharacterId } from '@shared';
import type { QualityPref } from '../engine/quality.js';
import { DEFAULT_CHARACTER } from '../characters/roster.js';

export type MotionPref = 'system' | 'reduced' | 'full';
export type Settings = {
  quality: QualityPref;
  motion: MotionPref;
  perf: boolean;
  partner: CharacterId;
  name: string;
  showdownName: string;
  format: string;
  battleMode: 'app' | 'showdown';
  /** Audio: master and music levels 0..1, plus a mute switch. */
  volume: number;
  music: number;
  muted: boolean;
};

const KEY = 'pab-settings';
const query = new URLSearchParams(location.search);

function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>; } catch { /* ignore */ }
  const q = query.get('quality');
  return {
    quality: (['auto', 'low', 'medium', 'high'] as const).find(v => v === (q ?? s.quality)) ?? 'auto',
    motion: (['system', 'reduced', 'full'] as const).find(v => v === s.motion) ?? 'system',
    perf: query.has('perf') || s.perf === true,
    partner: isCharacterId(s.partner) ? s.partner : DEFAULT_CHARACTER,
    name: typeof s.name === 'string' ? s.name.slice(0, 24) : '',
    showdownName: typeof s.showdownName === 'string' ? s.showdownName.slice(0, 18) : '',
    format: typeof s.format === 'string' ? s.format : 'gen9customgame',
    battleMode: s.battleMode === 'showdown' ? 'showdown' : 'app',
    volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.8,
    music: typeof s.music === 'number' ? Math.min(1, Math.max(0, s.music)) : 0.5,
    muted: query.has('mute') || s.muted === true,
  };
}

let state = load();
const listeners = new Set<() => void>();
export const settings = {
  get: () => state,
  set(patch: Partial<Settings>) {
    state = { ...state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach(l => l());
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export const useSettings = () => useSyncExternalStore(settings.subscribe, settings.get);

const mq = matchMedia('(prefers-reduced-motion: reduce)');
export function useReducedMotion(): boolean {
  const s = useSettings();
  const sys = useSyncExternalStore(cb => { mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); }, () => mq.matches);
  return s.motion === 'reduced' || (s.motion === 'system' && sys);
}
