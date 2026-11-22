/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** settings.ts reads location, localStorage and matchMedia when it loads: give it a small browser. */
function browser(store: Map<string, string>) {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() { /* none */ }, removeEventListener() { /* none */ } }));
}
/** A fresh module instance, like a page reload. */
async function load() {
  vi.resetModules();
  return import('../src/app/settings.js');
}

describe('audio settings', () => {
  let store: Map<string, string>;
  beforeEach(() => { store = new Map(); browser(store); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses the audio defaults on a first visit', async () => {
    const { settings } = await load();
    const s = settings.get();
    expect([s.volume, s.musicVolume, s.ambienceVolume, s.criesVolume, s.uiVolume, s.battleVolume, s.muted]).toEqual([0.7, 0.3, 0.25, 0.15, 0.35, 0.45, false]);
  });

  it('persists every volume and mute in pab-settings across a reload', async () => {
    const a = await load();
    a.settings.set({ volume: 0.55, musicVolume: 0.1, ambienceVolume: 0.4, criesVolume: 0.05, uiVolume: 0.6, battleVolume: 0.9, muted: true });
    const saved = JSON.parse(store.get('pab-settings') ?? '{}');
    expect(saved).toMatchObject({ volume: 0.55, musicVolume: 0.1, ambienceVolume: 0.4, criesVolume: 0.05, uiVolume: 0.6, battleVolume: 0.9, muted: true });
    const b = await load();
    expect(b.settings.get()).toMatchObject({ volume: 0.55, musicVolume: 0.1, ambienceVolume: 0.4, criesVolume: 0.05, uiVolume: 0.6, battleVolume: 0.9, muted: true });
  });

  it('keeps an older save (master and mute only), fills new volumes with defaults and clamps bad values', async () => {
    store.set('pab-settings', JSON.stringify({ partner: 'greninja', name: 'Ash', volume: 0.5, muted: false, musicVolume: 3, criesVolume: 'x' }));
    const { settings, firstVisit } = await load();
    const s = settings.get();
    expect(firstVisit).toBe(false);
    expect(s.partner).toBe('greninja');
    expect(s.name).toBe('Ash');
    expect(s.volume).toBe(0.5);
    expect(s.musicVolume).toBe(1);
    expect(s.criesVolume).toBe(0.15);
    expect(s.uiVolume).toBe(0.35);
  });

  it('reset restores the audio defaults but keeps the partner and name', async () => {
    store.set('pab-settings', JSON.stringify({ partner: 'lugia', name: 'Kris', volume: 0.2, battleVolume: 1, muted: true }));
    const { settings } = await load();
    settings.reset();
    const s = settings.get();
    expect(s).toMatchObject({ partner: 'lugia', name: 'Kris', volume: 0.7, battleVolume: 0.45, muted: false });
  });
});
