import { TYPE_NAMES, conditionImmune, moveInfo, typeMultiplier, type MoveInfo, type TypeName } from '@shared';
import { tDoc as tr } from '../i18n/core.js';

/**
 * Showdown-style matchup hints. Both teams are public after the draft, so abilities and items are
 * known information and are taken into account (Levitate, Air Balloon, Volt Absorb, Good as Gold...).
 * Everything here is a hint for humans: the simulator stays the authority.
 */
export type Fighter = { species: string; types: TypeName[]; tera: TypeName | null; ability: string; item: string | null };

/** The types that count right now: a Terastallized Pokémon defends as its Tera type (Stellar keeps its own). */
export const liveTypes = (f: Fighter): TypeName[] => (f.tera && f.tera !== 'Stellar' ? [f.tera] : f.types);

export type Verdict = {
  mult: number | null;          // damage multiplier (null for status moves)
  tone: 'x4' | 'x2' | 'x1' | 'half' | 'quarter' | 'immune' | 'status' | 'blocked';
  label: string;                // "Super effective", "No effect", ... in the game's language
  notes: string[];              // why, in plain words (ability, item, move and type names stay English)
  stab: boolean;
};

const BYPASS = new Set(['Levitate', 'Volt Absorb', 'Purifying Salt', 'Heatproof', 'Disguise', 'Thermal Exchange', 'Good as Gold', 'Magic Bounce']);

/** teraPreview: the type the user would become if Terastallize is toggled on for this turn. */
export function moveVerdict(moveName: string, user: Fighter, target: Fighter | null, teraPreview: TypeName | null = null): Verdict | null {
  const m = moveInfo(moveName);
  if (!m) return null;
  // Gen 9: a Terastallized Pokémon keeps STAB on its original types and gains its Tera type.
  const tera = user.tera ?? teraPreview;
  const userTypes: TypeName[] = tera && tera !== 'Stellar' ? [...new Set([...user.types, tera])] : user.types;
  const stab = m.category !== 'Status' && (userTypes.includes(m.type) || user.ability === 'Protean');
  const notes: string[] = [];
  if (stab) notes.push(user.ability === 'Protean' && !userTypes.includes(m.type) ? tr('mu.protean') : tr('mu.stab'));
  if (!target || m.self) return { mult: null, tone: 'status', label: m.self ? tr('mu.affectsSide') : tr('mu.statusMove'), notes, stab };

  const moldBreaker = user.ability === 'Mold Breaker';
  const ability = moldBreaker && BYPASS.has(target.ability) ? '' : target.ability;
  if (moldBreaker && BYPASS.has(target.ability)) notes.push(tr('mu.moldBreaker', { ability: target.ability }));
  const types = liveTypes(target);

  if (m.category === 'Status') return statusVerdict(m, target, ability, types, notes, stab);

  let mult = typeMultiplier(m.type, types);
  const why = (s: string) => notes.push(s);
  if (mult === 0) why(tr('mu.immuneTo', { name: target.species, type: m.type }));
  if (m.type === 'Ground' && mult > 0) {
    if (ability === 'Levitate') { mult = 0; why('Levitate'); }
    else if (target.item === 'Air Balloon') { mult = 0; why(tr('mu.airBalloon')); }
  }
  if (m.type === 'Electric' && ability === 'Volt Absorb' && mult > 0) { mult = 0; why(tr('mu.voltAbsorb')); }
  if (m.type === 'Ghost' && ability === 'Purifying Salt' && mult > 0) why(tr('mu.purifyingSaltGhost'));
  if (m.type === 'Fire' && ability === 'Heatproof' && mult > 0) why(tr('mu.heatproof'));
  if (m.type === 'Fire' && ability === 'Thermal Exchange' && mult > 0) why(tr('mu.thermalExchange'));
  if (ability === 'Disguise' && mult > 0) why(tr('mu.disguise'));
  if (target.tera) why(tr('mu.tera', { types: liveTypes(target).join('/') }));
  return { mult, tone: toneOf(mult), label: labelOf(mult), notes, stab };
}

function statusVerdict(m: MoveInfo, target: Fighter, ability: string, types: TypeName[], notes: string[], stab: boolean): Verdict {
  const blocked = (why: string): Verdict => ({ mult: 0, tone: 'blocked', label: tr('mu.fails'), notes: [...notes, why], stab });
  if (ability === 'Good as Gold') return blocked(tr('mu.goodAsGold'));
  if (ability === 'Magic Bounce') return blocked(tr('mu.magicBounce'));
  if (m.typeImmunity && typeMultiplier(m.type, types) === 0) return blocked(tr('mu.immuneTo', { name: target.species, type: m.type }));
  if (m.powder && conditionImmune('powder', types)) return blocked(tr('mu.powder'));
  if (m.name === 'Leech Seed' && types.includes('Grass')) return blocked(tr('mu.seed'));
  if (m.status) {
    if (ability === 'Purifying Salt') return blocked(tr('mu.purifyingSaltStatus'));
    if (m.status === 'brn' && (ability === 'Thermal Exchange' || conditionImmune('brn', types))) return blocked(ability === 'Thermal Exchange' ? tr('mu.thermalBurn') : tr('mu.fireBurn'));
    if (m.status === 'par' && conditionImmune('par', types)) return blocked(tr('mu.elecPar'));
    if ((m.status === 'tox' || m.status === 'psn') && conditionImmune(m.status, types)) return blocked(tr('mu.poison'));
  }
  return { mult: null, tone: 'status', label: tr('mu.statusMove'), notes, stab };
}

const toneOf = (x: number): Verdict['tone'] => (x === 0 ? 'immune' : x >= 4 ? 'x4' : x >= 2 ? 'x2' : x <= 0.25 ? 'quarter' : x < 1 ? 'half' : 'x1');
const labelOf = (x: number) => tr(x === 0 ? 'mu.noEffect' : x >= 4 ? 'mu.x4' : x >= 2 ? 'mu.x2' : x <= 0.25 ? 'mu.quarter' : x < 1 ? 'mu.half' : 'mu.neutral');
export const shortMult = (v: Verdict | null) => (!v || v.mult === null ? '' : v.mult === 0 ? '✕' : v.mult === 0.25 ? '¼' : v.mult === 0.5 ? '½' : v.mult === 1 ? '' : `x${v.mult}`);

/** A bare attacking type against a Pokémon, including the always-on Ground/Electric immunities. */
export function typeVerdict(t: TypeName, f: Fighter): Verdict {
  let m = typeMultiplier(t, liveTypes(f));
  if (t === 'Ground' && (f.ability === 'Levitate' || f.item === 'Air Balloon')) m = 0;
  if (t === 'Electric' && f.ability === 'Volt Absorb') m = 0;
  return { mult: m, tone: toneOf(m), label: labelOf(m), notes: [], stab: false };
}

/** Defensive chart for a Pokémon's current typing, grouped like Showdown's type tooltip. */
export function defenseChart(f: Fighter) {
  const out = { x4: [] as TypeName[], x2: [] as TypeName[], half: [] as TypeName[], quarter: [] as TypeName[], immune: [] as TypeName[] };
  for (const t of TYPE_NAMES) {
    if (t === 'Stellar') continue;
    const m = typeVerdict(t, f).mult!;
    if (m === 0) out.immune.push(t); else if (m >= 4) out.x4.push(t); else if (m >= 2) out.x2.push(t); else if (m <= 0.25) out.quarter.push(t); else if (m < 1) out.half.push(t);
  }
  return out;
}
