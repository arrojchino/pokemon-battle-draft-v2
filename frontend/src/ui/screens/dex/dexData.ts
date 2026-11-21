import { POOL, TYPE_NAMES, category, moveInfo, typeMultiplier, type MoveInfo, type Pokemon, type RoleCategory, type TypeName } from '@shared';
import type { IconName } from '../../primitives.js';

/**
 * Pure Pokédex logic over the curated pool: search, filters, sorting, faceted counts and the
 * defensive type chart. Everything is derived from shared/ data; nothing here is invented.
 */

export const ROLES: readonly RoleCategory[] = ['hazard', 'support', 'setup', 'attacker', 'other'];
export const ROLE_INFO: Record<RoleCategory, { label: string; icon: IconName }> = {
  hazard: { label: 'Hazards', icon: 'spark' },
  support: { label: 'Support', icon: 'shield' },
  setup: { label: 'Setup', icon: 'gauge' },
  attacker: { label: 'Attacker', icon: 'swords' },
  other: { label: 'Flex', icon: 'sliders' },
};

/** The eighteen attacking types; Stellar only exists as a Tera type. */
export const BATTLE_TYPES: readonly TypeName[] = TYPE_NAMES.filter(t => t !== 'Stellar');

export const dexNo = (id: number) => `No. ${String(id).padStart(4, '0')}`;
export const typeVar = (t: TypeName) => `var(--type-${t.toLowerCase()})`;

export type SortKey = 'dex' | 'name' | 'role';
export type Match = { field: 'name' | 'move' | 'ability' | 'item'; value: string };
export type Entry = { p: Pokemon; role: RoleCategory; match: Match };
export type DexQuery = { q: string; types: ReadonlySet<TypeName>; roles: ReadonlySet<RoleCategory>; sort: SortKey };

/** Case, accent and punctuation insensitive: "uturn" finds U-turn, "pokemon" finds Pokémon. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Where the query matches a set (name first), or null when it does not. */
export function matchQuery(p: Pokemon, q: string): Match | null {
  const k = fold(q);
  if (!k || fold(p.name).includes(k)) return { field: 'name', value: p.name };
  const move = p.moves.find(m => fold(m).includes(k));
  if (move) return { field: 'move', value: move };
  if (fold(p.ability).includes(k)) return { field: 'ability', value: p.ability };
  if (fold(p.item).includes(k)) return { field: 'item', value: p.item };
  return null;
}

const ORDER: Record<SortKey, (a: Entry, b: Entry) => number> = {
  dex: (a, b) => a.p.id - b.p.id,
  name: (a, b) => a.p.name.localeCompare(b.p.name),
  role: (a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.p.id - b.p.id,
};

/**
 * Filters combine with AND across groups and OR inside a group (any selected type, any selected role).
 * Chip counts are faceted: each one says how many results that chip covers given the other filters.
 */
export function browse({ q, types, roles, sort }: DexQuery, pool: readonly Pokemon[] = POOL) {
  const found: Entry[] = [];
  for (const p of pool) { const match = matchQuery(p, q); if (match) found.push({ p, role: category(p), match }); }
  const typeOk = (e: Entry) => !types.size || e.p.types.some(t => types.has(t));
  const roleOk = (e: Entry) => !roles.size || roles.has(e.role);
  const typeCounts = new Map<TypeName, number>();
  const roleCounts = new Map<RoleCategory, number>();
  for (const e of found) {
    if (roleOk(e)) e.p.types.forEach(t => typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1));
    if (typeOk(e)) roleCounts.set(e.role, (roleCounts.get(e.role) ?? 0) + 1);
  }
  const results = found.filter(e => typeOk(e) && roleOk(e)).sort(ORDER[sort]);
  return { results, typeCounts, roleCounts };
}

export type Matchups = { x4: TypeName[]; x2: TypeName[]; half: TypeName[]; quarter: TypeName[]; immune: TypeName[] };

/** Defensive chart from the type chart alone (abilities and items are not applied). */
export function matchups(defender: readonly TypeName[]): Matchups {
  const out: Matchups = { x4: [], x2: [], half: [], quarter: [], immune: [] };
  for (const t of BATTLE_TYPES) {
    const m = typeMultiplier(t, defender);
    if (m === 0) out.immune.push(t);
    else if (m >= 4) out.x4.push(t);
    else if (m >= 2) out.x2.push(t);
    else if (m <= 0.25) out.quarter.push(t);
    else if (m < 1) out.half.push(t);
  }
  return out;
}

export const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'] as const;
export type Stat = typeof STATS[number];
export const MAX_EV = 252;

/** "252 HP / 4 Def / 252 SpD" to a full six-stat spread (unlisted stats are 0). */
export function parseEvs(evs: string): Record<Stat, number> {
  const out: Record<Stat, number> = { HP: 0, Atk: 0, Def: 0, SpA: 0, SpD: 0, Spe: 0 };
  for (const part of evs.split('/')) {
    const m = /^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/.exec(part.trim());
    if (m) out[m[2] as Stat] = Number(m[1]);
  }
  return out;
}

/** A set's moves with their simulator data (null if a move were ever missing from the table). */
export const setMoves = (p: Pokemon): { name: string; info: MoveInfo | null }[] => p.moves.map(name => ({ name, info: moveInfo(name) }));

/** Same-type attack bonus from the species types (status moves never get it). */
export const isStab = (p: Pokemon, m: MoveInfo) => m.category !== 'Status' && p.types.includes(m.type);

/** Previous and next entries around `name`, wrapping; outside the list, next is the first entry. */
export function neighbours(list: readonly Entry[], name: string | null): [Entry, Entry] | null {
  if (!list.length) return null;
  const i = list.findIndex(e => e.p.name === name);
  const n = list.length;
  return i < 0 ? [list[n - 1], list[0]] : [list[(i - 1 + n) % n], list[(i + 1) % n]];
}
