import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineDuration, startText } from '../src/battle/model.js';

const SETUP = [
  '|player|p1|Ana|', '|player|p2|Dani|', '|start',
  '|switch|p1a: Great Tusk|Great Tusk, L100|371/371', '|switch|p2a: Ursaluna|Ursaluna, L100|100/100', '|turn|1',
];
const MOVE = '|move|p1a: Great Tusk|Headlong Rush|p2a: Ursaluna';
const TURN = [MOVE, '|-supereffective|p2a: Ursaluna', '|-damage|p2a: Ursaluna|40/100', '|-start|p1a: Great Tusk|protosynthesisatk', '|-start|p1a: Great Tusk|Encore'];

describe('battle messages', () => {
  beforeEach(() => { (globalThis as unknown as { window: unknown }).window ??= globalThis; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('words effects the way the games do', () => {
    expect(startText('Great Tusk', 'protosynthesisatk')).toBe("Protosynthesis raised Great Tusk's Attack!");
    expect(startText('Iron Hands', 'quarkdrivespe')).toBe("Quark Drive raised Iron Hands's Speed!");
    expect(startText('Gengar', 'move: Taunt')).toBe('Gengar fell for the taunt!');
    expect(startText('Gengar', 'perish2')).toBe("Gengar's perish count fell to 2.");
  });

  it('keeps a move on its animation timing and gives the messages time to be read on the next pause', async () => {
    const { BattleController, readTime } = await import('../src/battle/controller.js');
    const c = new BattleController({ mySide: 0, send: () => {}, speed: () => 1 });
    c.ingest(1, SETUP, true, null);
    const pauses: { at: number; caption: string[] }[] = [];
    let last = '';
    c.subscribe(() => {
      const s = c.getSnapshot(), key = s.caption.map(e => e.id).join(',') + '|' + s.busy;
      if (s.busy && key !== last) { last = key; pauses.push({ at: Date.now(), caption: s.caption.map(e => e.text) }); }
    });
    const t0 = Date.now();
    c.ingest(1, TURN, false, null);
    await vi.runAllTimersAsync();

    // 1) The move: its own message, held exactly as long as the animation needs to reach the hit.
    expect(pauses[0].caption).toEqual(['Great Tusk used Headlong Rush!']);
    const moveHold = lineDuration(MOVE);
    expect(pauses[1].at - t0).toBe(moveHold);
    // 2) The damage: the move's line and "super effective" together, until both have had time to be read.
    expect(pauses[1].caption).toEqual(['Great Tusk used Headlong Rush!', "It's super effective!"]);
    const need = readTime([{ id: 0, kind: 'move', text: 'Great Tusk used Headlong Rush!' }, { id: 0, kind: 'good', text: "It's super effective!" }]);
    expect(pauses[2].at - pauses[1].at).toBe(Math.max(700, need - moveHold));
    // 3) Then the box clears for the next message instead of stacking forever.
    expect(pauses[2].caption).toEqual(["Protosynthesis raised Great Tusk's Attack!"]);
    expect(pauses[3].caption).toEqual(['Great Tusk must do an encore!']);
    c.dispose();
  });

  it('reads asides quickly and long lines longer, within bounds', async () => {
    const { readTime } = await import('../src/battle/controller.js');
    const e = (text: string) => ({ id: 0, kind: 'info' as const, text });
    expect(readTime([e("[Great Tusk's Protosynthesis]")])).toBeLessThan(readTime([e("Great Tusk's attack missed and it kept going!")]));
    expect(readTime([e('Hit 3 times!')])).toBeLessThan(900);
    expect(readTime([e("[Great Tusk's Protosynthesis]")])).toBeLessThanOrEqual(1100);
    expect(readTime([e('x'.repeat(400))])).toBe(2300);
  });
});
