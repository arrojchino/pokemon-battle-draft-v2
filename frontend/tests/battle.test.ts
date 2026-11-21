/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { BattleModel, parseLine, setFor, type BattleFx } from '../src/battle/model.js';
import { MOVES, moveInfo, POOL } from '../../shared/src/index.js';

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(dir).filter(f => f.endsWith('.log')).map(f => ({ f, side: (f.includes('-p2') ? 1 : 0) as 0 | 1, lines: readFileSync(new URL(f, dir), 'utf8').split('\n') }));

describe('battle model on real simulator logs', () => {
  it('has fixtures from both perspectives', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  for (const { f, side, lines } of fixtures) {
    it(`replays ${f} to a consistent end state`, () => {
      const m = new BattleModel(side);
      const fx: BattleFx[] = [];
      for (const l of lines) fx.push(...m.apply(l));
      const s = m.state;
      expect(s.phase).toBe('ended');
      expect(s.winner).toBeTruthy();
      expect(s.winnerSide === 0 || s.winnerSide === 1).toBe(true);
      // Both sides list all six Pokémon from team preview, each mapped to its drafted set.
      for (const sd of s.sides) {
        expect(sd.mons).toHaveLength(6);
        sd.mons.forEach(mon => { expect(mon.set).toBeTruthy(); expect(mon.hp >= 0 && mon.hp <= mon.maxhp).toBe(true); });
      }
      // The loser's whole team fainted (these fixtures have no forfeits).
      const loser = s.sides[1 - (s.winnerSide as number)];
      expect(loser.mons.every(mon => mon.fainted)).toBe(true);
      expect(s.turn).toBeGreaterThan(0);
      expect(fx.filter(x => x.kind === 'faint').length).toBeGreaterThanOrEqual(6);
      expect(fx.filter(x => x.kind === 'move').length).toBeGreaterThan(s.turn / 2);
      expect(fx.some(x => x.kind === 'end')).toBe(true);
      // Every hit is a sensible fraction.
      fx.filter(x => x.kind === 'hit').forEach(h => { if (h.kind === 'hit') expect(h.lost >= 0 && h.lost <= 1 && h.remaining >= 0 && h.remaining <= 1).toBe(true); });
      // Our own request is always our own side.
      expect(s.request?.side.id).toBe(side === 0 ? 'p1' : 'p2');
      expect(s.log.length).toBeGreaterThan(20);
      expect(s.log.every(e => typeof e.text === 'string' && !e.text.includes('undefined'))).toBe(true);
    });
  }

  it('records terastallization', () => {
    const all = fixtures.flatMap(fx => fx.lines).filter(l => l.startsWith('|-terastallize|'));
    expect(all.length).toBeGreaterThan(0);
    const m = new BattleModel(0);
    const fx: BattleFx[] = [];
    for (const l of fixtures[0].lines) fx.push(...m.apply(l));
    const teras = fixtures[0].lines.filter(l => l.startsWith('|-terastallize|')).length;
    expect(fx.filter(x => x.kind === 'tera').length).toBe(teras);
  });

  it('parses kwargs', () => {
    expect(parseLine('|-damage|p2a: Garchomp|50/357|[from] Stealth Rock')).toEqual({ cmd: '-damage', args: ['p2a: Garchomp', '50/357'], kw: { from: 'Stealth Rock' } });
    expect(parseLine('|move|p1a: X|Spore|p2a: Y|[miss]')!.kw).toEqual({ miss: '' });
    expect(parseLine('not a line')).toBeNull();
  });

  it('maps every pool species and alternate forms to a set', () => {
    POOL.forEach(p => expect(setFor(p.name)?.name).toBe(p.name));
    expect(setFor('Mimikyu-Busted')?.name).toBe('Mimikyu');
  });

  it('knows every move in the pool', () => {
    POOL.forEach(p => p.moves.forEach(mv => expect(moveInfo(mv)).toBeTruthy()));
    expect(MOVES.struggle).toBeTruthy();
    expect(moveInfo('Make It Rain')!.type).toBe('Steel');
  });
});

describe('battle controller', () => {
  it('opens a new decision on every request (player streams carry no rqid)', async () => {
    (globalThis as unknown as { window: unknown }).window ??= globalThis;
    const { BattleController } = await import('../src/battle/controller.js');
    const f = fixtures.find(x => x.side === 0)!;
    const sent: string[] = [];
    const c = new BattleController({ mySide: 0, send: ch => sent.push(ch), speed: () => 0 });
    // Feed the log in server-sized chunks: each chunk ends right before the next request.
    const chunks: string[][] = [[]];
    for (const l of f.lines) { if (l.startsWith('|request|') && chunks[chunks.length - 1].length) chunks.push([]); chunks[chunks.length - 1].push(l); }
    let decisions = 0;
    for (const chunk of chunks) {
      c.ingest(1, chunk, false, null);
      const s = c.getSnapshot();
      if (s.state.phase === 'ended' || !s.state.request || s.state.request.wait) continue;
      expect(s.canChoose || !!s.state.request.teamPreview).toBe(true);
      c.choose(s.state.request.teamPreview ? 'team 1' : 'default');
      expect(c.getSnapshot().canChoose).toBe(false);
      decisions++;
    }
    expect(decisions).toBeGreaterThan(3);
    expect(sent.length).toBe(decisions);
  });
});

describe('move choreography', () => {
  it('every move in the pool has a hand-picked animation recipe with a sane impact time', async () => {
    const { MOVES } = await import('@shared');
    const { RECIPES, impactDelay, recipeFor } = await import('../src/engine/battle/moveFx.js');
    const missing = Object.keys(MOVES).filter(id => !RECIPES[id]);
    expect(missing).toEqual([]);
    for (const m of Object.values(MOVES)) {
      const d = impactDelay(recipeFor(m.name, m.type, m.category));
      expect(d > 0 && d < 1).toBe(true);
    }
  });
});

describe('matchup hints', () => {
  it('match the type chart, abilities and items the way the simulator applies them', async () => {
    const { POOL } = await import('@shared');
    const { moveVerdict, defenseChart } = await import('../src/battle/matchup.js');
    const f = (name: string, tera: string | null = null) => {
      const s = POOL.find(p => p.name === name)!;
      return { species: s.name, types: s.types, tera: tera as never, ability: s.ability, item: s.item };
    };
    const gambit = f('Kingambit');
    expect(moveVerdict('Close Combat', f('Great Tusk'), gambit)!.mult).toBe(4);
    expect(moveVerdict('Earthquake', f('Clodsire'), gambit)!.mult).toBe(2);
    // Air Balloon and Levitate stop Ground moves; Mold Breaker gets through Levitate but not a balloon.
    expect(moveVerdict('Earthquake', f('Clodsire'), f('Gholdengo'))!.notes.join()).toMatch(/Air Balloon/);
    expect(moveVerdict('Earthquake', f('Clodsire'), f('Rotom-Wash'))!.mult).toBe(0);
    expect(moveVerdict('Earthquake', { ...f('Clodsire'), ability: 'Mold Breaker' }, f('Rotom-Wash'))!.mult).toBe(2);
    // Terastallized defenders use their Tera type.
    expect(moveVerdict('Close Combat', f('Great Tusk'), f('Kingambit', 'Fairy'))!.mult).toBe(0.5);
    // Status immunities.
    expect(moveVerdict('Will-O-Wisp', f('Skeledirge'), f('Skeledirge'))!.tone).toBe('blocked');
    expect(moveVerdict('Toxic', f('Clodsire'), f('Gholdengo'))!.notes.join()).toMatch(/Good as Gold/);
    expect(moveVerdict('Spore', f('Clodsire'), f('Meowscarada'))!.tone).toBe('blocked');
    // STAB, including Protean and a Tera preview.
    expect(moveVerdict('Kowtow Cleave', gambit, f('Clodsire'))!.stab).toBe(true);
    expect(moveVerdict('Play Rough', f('Meowscarada'), gambit)!.stab).toBe(true);
    expect(moveVerdict('Body Press', f('Dondozo'), gambit)!.stab).toBe(false);
    expect(moveVerdict('Body Press', f('Dondozo'), gambit, 'Fighting')!.stab).toBe(true);
    const chart = defenseChart(gambit);
    expect(chart.x4).toEqual(['Fighting']);
    expect(chart.immune).toEqual(['Poison', 'Psychic']);
  });
});
