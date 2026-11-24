import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression guard for the partner select that clipped its tiles and button and could not scroll on short windows
// (verified in a browser at 1366x480, 910x438, 740x360: the panel stays inside the viewport and scrolls).
const css = readFileSync(new URL('../src/styles/screens.css', import.meta.url), 'utf8');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(';');

describe('partner select layout', () => {
  it('lets the panel row shrink so the panel never leaves the screen', () => {
    expect(rule('.shop')).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  });
  it('scrolls the panel vertically instead of hiding what does not fit', () => {
    const p = rule('.shop__panel');
    expect(p).toMatch(/overflow-y:\s*auto/);
    expect(p).toMatch(/max-height:\s*100%/);
    expect(p).not.toMatch(/overflow:\s*hidden/);
  });
  it('keeps the tile grid and the confirm button inside the panel width', () => {
    expect(rule('.shop__grid')).toMatch(/minmax\(0, 1fr\)/);
    expect(rule('.shop__actions .btn')).toMatch(/white-space:\s*normal/);
  });
});
