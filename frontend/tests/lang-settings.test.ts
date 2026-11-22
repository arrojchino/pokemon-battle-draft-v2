/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A small browser for settings.ts and i18n/index.ts: location, storage, matchMedia, navigator and <html>. */
function browser(store: Map<string, string>, languages: string[]) {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() { /* none */ }, removeEventListener() { /* none */ } }));
  vi.stubGlobal('navigator', { language: languages[0], languages });
  vi.stubGlobal('document', { documentElement: { lang: '' } });
}
/** Fresh module instances, like a page reload. */
async function load() {
  vi.resetModules();
  const s = await import('../src/app/settings.js');
  const i = await import('../src/i18n/index.js');
  return { ...s, ...i };
}

describe('language setting', () => {
  let store: Map<string, string>;
  afterEach(() => { vi.unstubAllGlobals(); });

  describe('with a Spanish browser', () => {
    beforeEach(() => { store = new Map(); browser(store, ['es-MX', 'en-US']); });
    it('starts in the browser language and sets <html lang>', async () => {
      const { settings, t } = await load();
      expect(settings.get().lang).toBe('es');
      expect(t('common.back')).toBe('Volver');
      expect(document.documentElement.lang).toBe('es');
    });
    it('switches with no reload and persists the choice', async () => {
      const a = await load();
      let changes = 0;
      a.onLangChange(() => { changes++; });
      a.settings.set({ lang: 'en' });
      expect(changes).toBe(1);
      expect(a.t('common.back')).toBe('Back');
      expect(document.documentElement.lang).toBe('en');
      expect(JSON.parse(store.get('pab-settings') ?? '{}')).toMatchObject({ lang: 'en' });
      const b = await load();
      expect(b.settings.get().lang).toBe('en');
    });
  });

  describe('with a browser in a language the game lacks', () => {
    beforeEach(() => { store = new Map(); browser(store, ['ja-JP']); });
    it('falls back to English and ignores an unknown saved language', async () => {
      store.set('pab-settings', JSON.stringify({ lang: 'xx' }));
      const { settings } = await load();
      expect(settings.get().lang).toBe('en');
    });
  });
});
