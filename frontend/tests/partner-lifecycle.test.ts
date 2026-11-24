/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_IDS } from '@shared';

/**
 * The partner lifecycle in settings.ts: the first visit deals a random partner and keeps it, a confirmed choice
 * survives a reload, and two tabs of the same browser never put back each other's stale partner.
 */
type StorageHandler = (e: { key: string | null; newValue: string | null }) => void;
function browser(store: Map<string, string>, handlers: StorageHandler[]) {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() { /* none */ }, removeEventListener() { /* none */ } }));
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('window', { addEventListener: (type: string, fn: StorageHandler) => { if (type === 'storage') handlers.push(fn); } });
}
/** A page load: fresh module instances over the same storage. */
async function page() {
  vi.resetModules();
  return import('../src/app/settings.js');
}
const saved = (store: Map<string, string>) => JSON.parse(store.get('pab-settings') ?? '{}') as { partner?: string; volume?: number };

describe('partner lifecycle (settings)', () => {
  let store: Map<string, string>;
  let handlers: StorageHandler[];
  beforeEach(() => { store = new Map(); handlers = []; browser(store, handlers); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('deals a valid random partner on a first visit and saves it at once', async () => {
    const a = await page();
    expect(a.firstVisit).toBe(true);
    expect(CHARACTER_IDS).toContain(a.settings.get().partner);
    expect(saved(store).partner).toBe(a.settings.get().partner);
  });

  it('a reload after a first visit keeps the dealt partner and is no longer a first visit', async () => {
    const a = await page();
    const dealt = a.settings.get().partner;
    const b = await page();
    expect(b.firstVisit).toBe(false);
    expect(b.settings.get().partner).toBe(dealt);
  });

  it('every partner can be chosen, and the choice survives a reload', async () => {
    for (const id of CHARACTER_IDS) {
      const a = await page();
      a.settings.set({ partner: id });
      const b = await page();
      expect(b.settings.get().partner).toBe(id);
    }
  });

  it('an invalid stored partner falls back to a valid one instead of breaking the page', async () => {
    store.set('pab-settings', JSON.stringify({ partner: 'missingno', volume: 0.4 }));
    const a = await page();
    expect(CHARACTER_IDS).toContain(a.settings.get().partner);
    expect(a.settings.get().volume).toBe(0.4);
  });

  it('a second tab that changes another setting never restores its stale partner', async () => {
    store.set('pab-settings', JSON.stringify({ partner: 'greninja' }));
    const tabA = await page();
    const handlerA = handlers.at(-1)!;
    const tabB = await page();
    tabB.settings.set({ partner: 'lugia' });
    // The browser tells tab A about tab B's write.
    handlerA({ key: 'pab-settings', newValue: store.get('pab-settings')! });
    expect(tabA.settings.get().partner).toBe('lugia');
    tabA.settings.set({ volume: 0.2 });
    expect(saved(store).partner).toBe('lugia');
    expect(saved(store).volume).toBe(0.2);
  });

  it('subscribers hear a partner change from another tab', async () => {
    store.set('pab-settings', JSON.stringify({ partner: 'greninja' }));
    const tabA = await page();
    const handlerA = handlers.at(-1)!;
    let heard = 0;
    tabA.settings.subscribe(() => { heard++; });
    handlerA({ key: 'pab-settings', newValue: JSON.stringify({ partner: 'mewtwo' }) });
    store.set('pab-settings', JSON.stringify({ partner: 'mewtwo' }));
    handlerA({ key: 'pab-settings', newValue: store.get('pab-settings')! });
    expect(heard).toBeGreaterThan(0);
    expect(tabA.settings.get().partner).toBe('mewtwo');
  });
});
