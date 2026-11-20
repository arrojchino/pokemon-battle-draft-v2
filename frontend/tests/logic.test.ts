import { describe, it, expect } from 'vitest';
import { POOL, TYPE_NAMES } from '../../shared/src/pool.js';
import { generateTeams, teamImport, coinWinner, winsNeeded, category } from '../../shared/src/rules.js';

/** Seeded PRNG so failures are reproducible. */
const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('pool and rules', () => {
  it('keeps the curated pool intact', () => {
    expect(POOL).toHaveLength(38);
    expect(new Set(POOL.map(p => p.name)).size).toBe(38);
    POOL.forEach(p => {
      expect(p.id).toBeGreaterThan(0);
      expect(p.moves.length).toBe(p.name === 'Ditto' ? 1 : 4);
      expect(p.ability && p.item && p.tera && p.evs && p.nature).toBeTruthy();
    });
  });
  it('gives every Pokémon one or two valid species types and a valid tera type', () => {
    POOL.forEach(p => {
      expect(p.types.length >= 1 && p.types.length <= 2).toBe(true);
      p.types.forEach(t => expect(TYPE_NAMES.includes(t)).toBe(true));
      expect(TYPE_NAMES.includes(p.tera)).toBe(true);
    });
    expect(POOL.find(p => p.name === 'Rotom-Wash')!.types).toEqual(['Electric', 'Water']);
  });
  it('deals two unique six-Pokémon teams', () => {
    for (let i = 0; i < 30; i++) {
      const [a, b] = generateTeams();
      expect(a).toHaveLength(6); expect(b).toHaveLength(6);
      expect(new Set([...a, ...b].map(p => p.name)).size).toBe(12);
    }
  });
  it('respects the role-balance constraints and is deterministic for a seed', () => {
    for (let seed = 1; seed < 200; seed++) {
      const [a, b] = generateTeams(mulberry32(seed));
      const counts: Record<string, number> = {};
      [...a, ...b].forEach(p => { const c = category(p); counts[c] = (counts[c] || 0) + 1; });
      expect((counts.hazard || 0) >= 1 && (counts.hazard || 0) <= 3).toBe(true);
      expect((counts.support || 0) >= 1 && (counts.support || 0) <= 3).toBe(true);
      expect((counts.setup || 0) >= 1 && (counts.setup || 0) <= 4).toBe(true);
      expect(counts.attacker || 0).toBeGreaterThan(1);
    }
    expect(generateTeams(mulberry32(42))).toEqual(generateTeams(mulberry32(42)));
  });
  it('exports valid Showdown import text', () => {
    const text = teamImport(POOL.slice(0, 1));
    expect(text).toContain('Gholdengo @ Air Balloon');
    expect(text).toContain('Ability: Good as Gold');
    expect(text).toContain('Tera Type: Fighting');
    expect(text).toContain(' - Nasty Plot');
  });
  it('resolves the toss from opposite calls only', () => {
    expect(coinWinner(['heads', 'tails'], 'heads')).toBe(0);
    expect(coinWinner(['heads', 'tails'], 'tails')).toBe(1);
    expect(coinWinner(['heads', 'heads'], 'heads')).toBeNull();
    expect(coinWinner([null, 'tails'], 'tails')).toBeNull();
  });
  it('computes series targets', () => { expect(winsNeeded(3)).toBe(2); expect(winsNeeded(5)).toBe(3); });
});
