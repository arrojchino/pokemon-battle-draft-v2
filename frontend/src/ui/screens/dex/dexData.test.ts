import { describe, it, expect } from 'vitest';
import { POOL, category, type TypeName } from '@shared';
import { BATTLE_TYPES, browse, dexNo, matchQuery, matchups, neighbours, parseEvs, setMoves, isStab, type DexQuery } from './dexData.js';

const q = (patch: Partial<DexQuery> = {}): DexQuery => ({ q: '', types: new Set(), roles: new Set(), sort: 'dex', ...patch });
const byName = (name: string) => POOL.find(p => p.name === name)!;
const names = (r: ReturnType<typeof browse>) => r.results.map(e => e.p.name);

describe('pokédex search', () => {
  it('matches names first, then moves, abilities and items, ignoring case and punctuation', () => {
    expect(matchQuery(byName('Gengar'), 'GEN')).toEqual({ field: 'name', value: 'Gengar' });
    expect(matchQuery(byName('Scizor'), 'uturn')).toEqual({ field: 'move', value: 'U-turn' });
    expect(matchQuery(byName('Skeledirge'), 'will o wisp')).toEqual({ field: 'move', value: 'Will-O-Wisp' });
    expect(matchQuery(byName('Rotom-Wash'), 'levitate')).toEqual({ field: 'ability', value: 'Levitate' });
    expect(matchQuery(byName('Clodsire'), 'leftovers')).toEqual({ field: 'item', value: 'Leftovers' });
    expect(matchQuery(byName('Gengar'), 'zzz')).toBeNull();
  });
  it('finds every Knock Off user and nothing else', () => {
    const r = browse(q({ q: 'knock off' }));
    expect(r.results.length).toBe(POOL.filter(p => p.moves.includes('Knock Off')).length);
    expect(r.results.every(e => e.match.value === 'Knock Off')).toBe(true);
  });
});

describe('pokédex filters and sorting', () => {
  it('lists the whole pool in dex order by default', () => {
    const r = browse(q());
    expect(r.results).toHaveLength(POOL.length);
    const ids = r.results.map(e => e.p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(dexNo(94)).toBe('No. 0094');
  });
  it('sorts by name and by role bucket', () => {
    const az = names(browse(q({ sort: 'name' })));
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
    const roles = browse(q({ sort: 'role' })).results.map(e => e.role);
    expect(roles.indexOf('hazard')).toBe(0);
    expect(roles.lastIndexOf('hazard')).toBeLessThan(roles.indexOf('support'));
  });
  it('ORs types inside the group and ANDs across groups', () => {
    const ghostOrFairy = browse(q({ types: new Set<TypeName>(['Ghost', 'Fairy']) }));
    expect(ghostOrFairy.results.length).toBe(POOL.filter(p => p.types.includes('Ghost') || p.types.includes('Fairy')).length);
    const ghostSetup = browse(q({ types: new Set<TypeName>(['Ghost']), roles: new Set(['setup'] as const) }));
    expect(ghostSetup.results.length).toBeGreaterThan(0);
    ghostSetup.results.forEach(e => { expect(e.p.types).toContain('Ghost'); expect(category(e.p)).toBe('setup'); });
  });
  it('gives faceted counts that match the results each chip would add', () => {
    const base = q({ roles: new Set(['attacker'] as const) });
    const r = browse(base);
    for (const t of BATTLE_TYPES) {
      const alone = browse({ ...base, types: new Set([t]) }).results.length;
      expect(r.typeCounts.get(t) ?? 0).toBe(alone);
    }
    expect(r.roleCounts.get('attacker')).toBe(r.results.length);
  });
});

describe('pokédex set data', () => {
  it('builds defensive charts from the type chart', () => {
    expect(matchups(byName('Gholdengo').types)).toMatchObject({ immune: ['Normal', 'Fighting', 'Poison'], x2: ['Fire', 'Ground', 'Ghost', 'Dark'] });
    expect(matchups(byName('Garchomp').types).x4).toEqual(['Ice']);
    expect(matchups(byName('Corviknight').types)).toMatchObject({ quarter: ['Grass', 'Bug'], immune: ['Poison', 'Ground'] });
    expect(matchups(['Water'])).toMatchObject({ x4: [], x2: ['Electric', 'Grass'], immune: [] });
  });
  it('parses every EV spread in the pool', () => {
    POOL.forEach(p => {
      const spread = parseEvs(p.evs);
      const listed = p.evs.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
      expect(Object.values(spread).reduce((a, b) => a + b, 0)).toBe(listed);
      expect(listed).toBeLessThanOrEqual(510);
    });
    expect(parseEvs(byName('Sinistcha').evs)).toEqual({ HP: 252, Atk: 0, Def: 252, SpA: 4, SpD: 0, Spe: 0 });
  });
  it('has simulator data for every move and marks STAB from species types', () => {
    POOL.forEach(p => setMoves(p).forEach(m => expect(m.info, m.name).not.toBeNull()));
    const gengar = byName('Gengar');
    const stab = setMoves(gengar).filter(m => isStab(gengar, m.info!)).map(m => m.name);
    expect(stab).toEqual(['Shadow Ball', 'Sludge Bomb']);
  });
  it('wraps previous and next around the visible list', () => {
    const list = browse(q()).results;
    const last = list[list.length - 1].p.name;
    expect(neighbours(list, list[0].p.name)!.map(e => e.p.name)).toEqual([last, list[1].p.name]);
    expect(neighbours(list, 'Missingno')!.map(e => e.p.name)).toEqual([last, list[0].p.name]);
    expect(neighbours([], null)).toBeNull();
  });
});
