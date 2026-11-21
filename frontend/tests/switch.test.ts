import { describe, it, expect } from 'vitest';
import { switchLocked, type BattleRequest, type RequestPokemon } from '../src/battle/model.js';

const mon = (ident: string, condition: string, active = false): RequestPokemon => ({ ident, details: ident.slice(4), condition, active, moves: [] });
const request = (activeCondition: string, extra: Partial<BattleRequest> = {}, trapped = false): BattleRequest => ({
  side: { name: 'B', id: 'p2', pokemon: [mon('p2: Great Tusk', activeCondition, true), mon('p2: Gholdengo', '315/315'), mon('p2: Kingambit', '0 fnt')] },
  active: [{ moves: [{ move: 'Headlong Rush', id: 'headlongrush' }], trapped }],
  ...extra,
});

describe('switching', () => {
  it('lets a sleeping (or otherwise statused) active Pokémon switch out', () => {
    for (const status of ['slp', 'par', 'brn', 'frz', 'psn', 'tox']) {
      const req = request(`250/359 ${status}`);
      expect(switchLocked(req.side.pokemon[1], req)).toBe(false);
    }
  });

  it('locks the active Pokémon, fainted ones, and switches while trapped', () => {
    const req = request('250/359 slp');
    expect(switchLocked(req.side.pokemon[0], req)).toBe(true);
    expect(switchLocked(req.side.pokemon[2], req)).toBe(true);
    const trapped = request('250/359', {}, true);
    expect(switchLocked(trapped.side.pokemon[1], trapped)).toBe(true);
  });

  it('ignores traps when a replacement is forced', () => {
    const forced = request('0 fnt', { forceSwitch: [true] }, true);
    expect(switchLocked(forced.side.pokemon[1], forced)).toBe(false);
  });
});
