import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattleModel, type BattleFx } from '../src/battle/model.js';
import { FieldPersist } from '../src/engine/battle/persist.js';

// Hazards, screens and weather are battle state: they stay on the stage until the simulator ends them.
const lines = [
  '|switch|p1a: Garchomp|Garchomp, L50, M|100/100',
  '|switch|p2a: Skarmory|Skarmory, L50, F|100/100',
  '|move|p2a: Skarmory|Spikes|p1a: Garchomp',
  '|-sidestart|p1: Ana|Spikes',
  '|move|p2a: Skarmory|Spikes|p1a: Garchomp',
  '|-sidestart|p1: Ana|Spikes',
  '|move|p2a: Skarmory|Spikes|p1a: Garchomp',
  '|-sidestart|p1: Ana|Spikes',
  '|move|p2a: Skarmory|Spikes|p1a: Garchomp',
  '|-sidestart|p1: Ana|Spikes',
  '|-sidestart|p1: Ana|move: Stealth Rock',
  '|-sidestart|p2: Beto|Reflect',
  '|-weather|Sandstorm',
  '|-weather|Sandstorm|[upkeep]',
  '|-sideend|p2: Beto|Reflect',
  '|-sideend|p1: Ana|Spikes|[from] move: Rapid Spin|[of] p1a: Garchomp',
];

const fieldFx = (fx: BattleFx[]) => fx.filter(f => f.kind === 'sideField' || f.kind === 'weather');

describe('lasting field conditions', () => {
  beforeEach(() => { (globalThis as unknown as { window: unknown }).window ??= globalThis; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('tracks Spikes layers (capped at 3), keeps them until removed, and reports each change', () => {
    const m = new BattleModel(0);
    const out: BattleFx[] = [];
    for (const l of lines) out.push(...fieldFx(m.apply(l)));
    const spikes = out.filter(f => f.kind === 'sideField' && f.side === 0).map(f => (f as Extract<BattleFx, { kind: 'sideField' }>).layers.Spikes ?? 0);
    expect(spikes).toEqual([1, 2, 3, 3, 3, 0]); // 4th layer capped; Stealth Rock keeps 3; Rapid Spin clears
    expect(m.state.sides[0].layers).toEqual({ 'Stealth Rock': 1 });
    expect(m.state.sides[1].layers).toEqual({});
    // Upkeep lines do not restart the weather.
    expect(out.filter(f => f.kind === 'weather')).toEqual([{ kind: 'weather', weather: 'Sandstorm' }]);
  });

  it('puts hazards, screens and weather back at once after a reconnect', async () => {
    const { BattleController } = await import('../src/battle/controller.js');
    const seen: string[] = [];
    const c = new BattleController({ mySide: 0, send: () => {}, onFx: (f, instant) => {
      if (f.kind === 'sideField') seen.push(`side ${f.side} ${JSON.stringify(f.layers)}${instant ? ' instant' : ''}`);
      if (f.kind === 'weather') seen.push(`weather ${f.weather}${instant ? ' instant' : ''}`);
    } });
    c.ingest(1, lines.slice(0, 13), true, null);
    c.dispose();
    expect(seen).toContain('side 0 {"Spikes":3,"Stealth Rock":1} instant');
    expect(seen).toContain('side 1 {"Reflect":1} instant');
    expect(seen).toContain('weather Sandstorm instant');
  });

  it('the stage keeps props while the condition lasts and fades them out when it ends', () => {
    let reduced = false;
    const p = new FieldPersist(() => [1.2, 0.8], () => reduced);
    p.set(1, { Spikes: 2, 'Stealth Rock': 1 }, false);
    p.update(0.1);
    expect(p.shown(1, 'spikes')).toBe(false); // waits for the throw to land
    for (let i = 0; i < 40; i++) p.update(0.1);
    expect(p.shown(1, 'spikes') && p.shown(1, 'rock')).toBe(true);
    // Twenty seconds (many turns) later they are still there.
    for (let i = 0; i < 200; i++) p.update(0.1);
    expect(p.shown(1, 'spikes') && p.shown(1, 'rock')).toBe(true);
    expect(p.shown(0, 'spikes')).toBe(false);
    // Rapid Spin / Defog: gone after a short fade.
    p.set(1, { 'Stealth Rock': 1 }, false);
    for (let i = 0; i < 10; i++) p.update(0.1);
    expect(p.shown(1, 'spikes')).toBe(false);
    expect(p.shown(1, 'rock')).toBe(true);
    // A reconnect shows them at once; the end of the battle clears everything.
    p.set(0, { Reflect: 1, 'Sticky Web': 1 }, true);
    expect(p.shown(0, 'reflect') && p.shown(0, 'web')).toBe(true);
    reduced = true; p.update(0.016);
    p.clear();
    expect(p.shown(0, 'reflect') || p.shown(1, 'rock')).toBe(false);
    p.dispose();
  });
});
