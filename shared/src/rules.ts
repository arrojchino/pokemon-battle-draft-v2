import { POOL, type Pokemon, type Tier } from './pool.js';

const has = (s: string, words: string[]) => words.some(w => s.toLowerCase().includes(w));

export type RoleCategory = 'hazard' | 'support' | 'setup' | 'attacker' | 'other';

/** Role buckets used to keep dealt teams playable. Unchanged from the original game. */
export function category(p: Pokemon): RoleCategory {
  const r = p.role.toLowerCase();
  if (has(r, ['hazard', 'spikes', 'rocks', 'defog', 'spinner', 'suicide'])) return 'hazard';
  if (has(r, ['wall', 'tank', 'defensive', 'utility', 'support', 'screens', 'revival', 'disruption'])) return 'support';
  if (has(r, ['setup', 'sweeper', 'cleaner', 'breaker', 'dance', 'drum'])) return 'setup';
  if (has(r, ['pivot', 'attacker', 'revenge', 'priority'])) return 'attacker';
  return 'other';
}

/**
 * Power points by Smogon singles tier. The dealer splits every draw so both teams carry the same total, so
 * the toss winner chooses a style, not a stronger team.
 */
export const TIER_POINTS: Record<Tier, number> = { Uber: 5, OU: 4, UUBL: 3.5, UU: 3, RUBL: 2.5, RU: 2, NUBL: 2, NU: 1.5, PUBL: 1.5, PU: 1, ZU: 1 };
export const teamPower = (team: readonly Pokemon[]) => team.reduce((s, p) => s + (TIER_POINTS[p.tier] ?? 2), 0);

const CATEGORIES: RoleCategory[] = ['hazard', 'support', 'setup', 'attacker', 'other'];
export function roleCounts(team: readonly Pokemon[]): Record<RoleCategory, number> {
  const c: Record<RoleCategory, number> = { hazard: 0, support: 0, setup: 0, attacker: 0, other: 0 };
  for (const p of team) c[category(p)]++;
  return c;
}

/** A dealt six is playable: enough offence, not all walls or all setup, and no three sharing a type. */
export function playable(team: readonly Pokemon[]) {
  const c = roleCounts(team);
  if (c.hazard > 2 || c.support > 3 || c.setup > 3 || c.attacker + c.setup < 2) return false;
  const types = new Map<string, number>();
  for (const p of team) for (const t of p.types) {
    const n = (types.get(t) ?? 0) + 1;
    if (n > 2) return false;
    types.set(t, n);
  }
  return true;
}

const bits = (m: number) => { let n = 0; for (; m; m &= m - 1) n++; return n; };

/**
 * Deal two teams of six from the pool. Twelve distinct species are drawn at random; then, of the 462 ways
 * to split them, the dealer keeps the playable splits closest in power (within one point) and in role
 * spread, and picks one of the best at random. Deterministic given `rand`; used by the server, the peer
 * host and unit tests.
 */
export function generateTeams(rand: () => number = Math.random, pool: readonly Pokemon[] = POOL): [Pokemon[], Pokemon[]] {
  const pick = (n: number) => Math.floor(rand() * n);
  const shuffled = () => {
    const bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) { const j = pick(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    return bag;
  };
  for (let attempt = 0; attempt < 200; attempt++) {
    const draw: Pokemon[] = [];
    const seen = new Set<string>();
    for (const p of shuffled()) {
      if (seen.has(p.name)) continue;
      seen.add(p.name); draw.push(p);
      if (draw.length === 12) break;
    }
    if (draw.length < 12) break;
    const all = roleCounts(draw);
    if (all.hazard < 1 || all.support < 1 || all.attacker + all.setup < 4) continue;
    let best = Infinity, ties: number[] = [];
    for (let mask = 1; mask < 1 << 12; mask += 2) { // the first draw always on side A: each split counted once
      if (bits(mask) !== 6) continue;
      const a = draw.filter((_, i) => (mask >> i) & 1), b = draw.filter((_, i) => !((mask >> i) & 1));
      const gap = Math.abs(teamPower(a) - teamPower(b));
      if (gap > 1 || !playable(a) || !playable(b)) continue;
      const ca = roleCounts(a), cb = roleCounts(b);
      const score = gap * 4 + CATEGORIES.reduce((s, r) => s + Math.abs(ca[r] - cb[r]), 0);
      if (score < best - 1e-9) { best = score; ties = [mask]; } else if (score < best + 1e-9) ties.push(mask);
    }
    if (!ties.length) continue;
    const mask = ties[pick(ties.length)];
    const a = draw.filter((_, i) => (mask >> i) & 1), b = draw.filter((_, i) => !((mask >> i) & 1));
    return rand() < 0.5 ? [a, b] : [b, a];
  }
  // Fallback (not expected with this pool): an unbiased shuffle.
  const bag = shuffled();
  return [bag.slice(0, 6), bag.slice(6, 12)];
}

/** Showdown import/export text. Format unchanged from the original game. */
export function teamImport(team: readonly Pokemon[]): string {
  return team.map(p =>
    `${p.name} @ ${p.item}\nAbility: ${p.ability}\nTera Type: ${p.tera}\nEVs: ${p.evs}\n${p.nature} Nature\n${p.ivs ? `IVs: ${p.ivs}\n` : ''}${p.moves.map(m => ' - ' + m).join('\n')}`
  ).join('\n\n');
}

export type CoinSide = 'heads' | 'tails';

export function coinWinner(calls: readonly [string | null, string | null], result: CoinSide): number | null {
  if (!calls[0] || !calls[1] || calls[0] === calls[1]) return null;
  return calls[0] === result ? 0 : calls[1] === result ? 1 : null;
}

export const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;
