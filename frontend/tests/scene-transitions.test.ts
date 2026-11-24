import { describe, expect, it } from 'vitest';
import { SceneTransitionManager, CUT_OUT, CUT_IN, TRAVEL_OUT, TRAVEL_IN, HOLD_MAX, type EnvId } from '../src/engine/scenes/SceneTransitionManager.js';

type L = { mode: string; focus?: string };
const envOf = (l: L): EnvId => (l.mode === 'intro' ? 'intro' : l.mode === 'hub' || l.mode === 'select' ? 'town' : 'stadium');

function rig(opts: { instant?: boolean; ready?: (id: EnvId) => boolean } = {}) {
  const applied: Array<{ l: L; modeChanged: boolean; envChanged: boolean }> = [];
  const m = new SceneTransitionManager<L>({
    mode: l => l.mode, env: envOf,
    apply: (l, modeChanged, envChanged) => applied.push({ l, modeChanged, envChanged }),
    ready: opts.ready ?? (() => true),
    instant: () => !!opts.instant,
  });
  const run = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) m.step(1 / 60); };
  return { m, applied, run };
}

describe('SceneTransitionManager', () => {
  it('applies the first layout at once', () => {
    const { m, applied } = rig();
    m.request({ mode: 'intro' });
    expect(applied).toHaveLength(1);
    expect(applied[0].envChanged).toBe(true);
    expect(m.fade).toBe(0);
  });

  it('a choice made during the dip is the one that lands (partner select race)', () => {
    const { m, applied, run } = rig();
    m.request({ mode: 'hub' });
    m.request({ mode: 'select', focus: 'thwackey' }); // mode change: a cut starts
    m.step(0.05);
    m.request({ mode: 'select', focus: 'lugia' }); // picked while it is still dark-ish
    run(CUT_OUT + CUT_IN + 0.2);
    const last = applied.at(-1)!.l;
    expect(last).toEqual({ mode: 'select', focus: 'lugia' });
    expect(applied.some(a => a.l.focus === 'thwackey')).toBe(false);
    expect(m.fade).toBe(0);
  });

  it('inside one mode a request applies at once', () => {
    const { m, applied } = rig();
    m.request({ mode: 'select', focus: 'a' });
    m.request({ mode: 'select', focus: 'b' });
    expect(applied.at(-1)!.l.focus).toBe('b');
    expect(m.busy).toBe(false);
  });

  it('a change of environment is a slow travel that waits for the new place in the dark', () => {
    let ready = false;
    const { m, applied, run } = rig({ ready: id => id !== 'stadium' || ready });
    m.request({ mode: 'hub' });
    m.request({ mode: 'duo' });
    run(TRAVEL_OUT + 0.05);
    expect(applied.at(-1)!.l.mode).toBe('duo');
    expect(applied.at(-1)!.envChanged).toBe(true);
    run(2);
    expect(m.fade).toBe(1); // still holding: the stadium is not ready
    ready = true;
    run(TRAVEL_IN + 0.1);
    expect(m.fade).toBe(0);
  });

  it('never holds in the dark longer than HOLD_MAX', () => {
    const { m, run } = rig({ ready: () => false });
    m.request({ mode: 'hub' });
    m.request({ mode: 'arena' });
    run(TRAVEL_OUT + HOLD_MAX + TRAVEL_IN + 0.3);
    expect(m.fade).toBe(0);
  });

  it('reduced motion applies every change at once', () => {
    const { m, applied } = rig({ instant: true });
    m.request({ mode: 'hub' });
    m.request({ mode: 'duo' });
    expect(applied.map(a => a.l.mode)).toEqual(['hub', 'duo']);
    expect(m.fade).toBe(0);
  });

  it('a travel requested during a cut still travels', () => {
    const { m, applied, run } = rig();
    m.request({ mode: 'hub' });
    m.request({ mode: 'select', focus: 'x' }); // same env: a cut
    m.step(0.05);
    m.request({ mode: 'arena' }); // now leaving the town
    run(TRAVEL_OUT + TRAVEL_IN + 0.3);
    expect(applied.at(-1)!.l.mode).toBe('arena');
    expect(applied.at(-1)!.envChanged).toBe(true);
    expect(m.env).toBe('stadium');
  });
});
