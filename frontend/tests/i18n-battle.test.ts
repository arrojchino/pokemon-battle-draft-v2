import { describe, expect, it } from 'vitest';
import { inBox, readTime } from '../src/battle/controller.js';
import type { LogEntry } from '../src/battle/model.js';

/** Message box rules follow the message key, so a Spanish line is classified like its English twin. */
describe('battle log rules by key', () => {
  const es = (text: string, key: LogEntry['key']): LogEntry => ({ id: 1, kind: 'info', text, key });
  it('keeps bare HP lines out of the box in any language', () => {
    expect(inBox(es('El Garchomp rival perdió el 40 % de su salud.', 'model.lostHealth'))).toBe(false);
    expect(inBox(es('¡Es superefectivo!', 'model.superEffective'))).toBe(true);
    expect(inBox({ id: 2, kind: 'info', text: 'Garchomp lost 40% of its health.' })).toBe(false);
  });
  it('reads asides quickly in any language', () => {
    const aside = readTime([es('[Intimidate de Gyarados]', 'model.ability')]);
    const line = readTime([es('[Intimidate de Gyarados]', 'model.used')]);
    expect(aside).toBeLessThan(line);
  });
});
