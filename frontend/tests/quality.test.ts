import { describe, expect, it } from 'vitest';
import { AdaptiveQuality } from '../src/engine/quality.js';

describe('adaptive quality', () => {
  const run = (q: AdaptiveQuality, ms: number, frames: number) => { let changed = false; for (let i = 0; i < frames; i++) changed = q.push(ms, ms / 1000) || changed; return changed; };

  it('lowers the render scale under sustained slow frames', () => {
    const q = new AdaptiveQuality(() => true, () => true);
    expect(run(q, 30, 100)).toBe(true);
    expect(q.scale).toBeLessThan(1);
  });

  it('ignores a known spike while muted, so entering the plaza never costs a tier or resolution', () => {
    let downs = 0;
    const q = new AdaptiveQuality(() => { downs++; return true; }, () => true);
    q.mute(6);
    // About 4 s of terrible frames (a hitch), all inside the muted window.
    expect(run(q, 40, 100)).toBe(false);
    expect(q.scale).toBe(1);
    expect(downs).toBe(0);
    // The samples still show in the diagnostics.
    expect(q.stats().p95).toBeGreaterThan(30);
    // After the window it adapts again.
    run(q, 16, 200);
    expect(run(q, 30, 200)).toBe(true);
  });
});
