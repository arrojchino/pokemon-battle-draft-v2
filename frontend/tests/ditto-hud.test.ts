/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '../src/i18n/core.js';

// Server rendering has no external-store snapshot of its own: read the controller's directly.
vi.mock('react', async importOriginal => { const r = await importOriginal<typeof import('react')>(); return { ...r, useSyncExternalStore: <T>(_s: unknown, get: () => T) => get() }; });

/** The battle HUD names a transformed Pokemon "Ditto (Transformed)" (Spanish "Ditto (Transformado)"). */
const P1 = readFileSync(fileURLToPath(new URL('./fixtures/ditto-p1.sim.txt', import.meta.url)), 'utf8').split('\n').filter(Boolean);

describe('ditto: HUD', () => {
  it('has the label in English and Spanish', () => {
    expect(translate('en', 'ditto.transformed', { mon: 'Ditto' })).toBe('Ditto (Transformed)');
    expect(translate('es', 'ditto.transformed', { mon: 'Ditto' })).toBe('Ditto (Transformado)');
    expect(translate('es', 'ditto.into', { mon: 'Garchomp' })).toBe('Transformado en Garchomp');
  });

  it('shows "Ditto (Transformed)" on the active plate while transformed, and plain names after the revert', async () => {
    // Just enough of a browser for the settings store the HUD's i18n reads (English).
    const g = globalThis as unknown as Record<string, unknown>;
    g.window ??= globalThis;
    g.location ??= { search: '', hash: '', pathname: '/', href: 'http://localhost/' };
    const m = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } });
    g.addEventListener ??= () => {}; g.removeEventListener ??= () => {};
    g.matchMedia ??= () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
    const { BattleController } = await import('../src/battle/controller.js');
    const { BattleArena } = await import('../src/ui/screens/match/BattleArena.js');
    const plate = (lines: string[]) => {
      const c = new BattleController({ mySide: 0, send: () => {} });
      c.ingest(1, lines, true, null);
      const html = renderToStaticMarkup(createElement(BattleArena, { controller: c, mineLabel: 'Ana', theirsLabel: 'Beto', onForfeit: () => {}, finished: false, onContinue: () => {}, iWon: null }));
      c.dispose();
      return [...html.matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)].map(m => m[0]);
    };
    const cut = (pred: (l: string) => boolean) => P1.slice(0, P1.findIndex(pred) + 1);
    const transformed = plate(cut(l => l.startsWith('|turn|1')));
    expect(transformed).toContain('<strong title="Transformed into Garchomp">Ditto (Transformed)</strong>');
    expect(transformed).toContain('<strong>Garchomp</strong>');
    const after = plate(cut(l => l.startsWith('|turn|3')));
    expect(after).toContain('<strong>Mew</strong>');
    expect(after.join()).not.toContain('Transformed');
  });
});
