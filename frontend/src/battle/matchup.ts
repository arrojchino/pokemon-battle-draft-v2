import { TYPE_NAMES, conditionImmune, moveInfo, typeMultiplier, type MoveInfo, type TypeName } from '@shared';

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
  label: string;                // "Super effective", "No effect", ...
  notes: string[];              // why, in plain words
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
  if (stab) notes.push(user.ability === 'Protean' && !userTypes.includes(m.type) ? 'Protean makes it STAB (x1.5)' : 'Same-type bonus (STAB x1.5)');
  if (!target || m.self) return { mult: null, tone: 'status', label: m.self ? 'Affects your side' : 'Status move', notes, stab };

  const moldBreaker = user.ability === 'Mold Breaker';
  const ability = moldBreaker && BYPASS.has(target.ability) ? '' : target.ability;
  if (moldBreaker && BYPASS.has(target.ability)) notes.push(`Mold Breaker ignores ${target.ability}`);
  const types = liveTypes(target);

  if (m.category === 'Status') return statusVerdict(m, target, ability, types, notes, stab);

  let mult = typeMultiplier(m.type, types);
  const why = (s: string) => notes.push(s);
  if (mult === 0) why(`${target.species} is immune to ${m.type}`);
  if (m.type === 'Ground' && mult > 0) {
    if (ability === 'Levitate') { mult = 0; why('Levitate'); }
    else if (target.item === 'Air Balloon') { mult = 0; why('Air Balloon (pops when hit)'); }
  }
  if (m.type === 'Electric' && ability === 'Volt Absorb' && mult > 0) { mult = 0; why('Volt Absorb heals it instead'); }
  if (m.type === 'Ghost' && ability === 'Purifying Salt' && mult > 0) why('Purifying Salt halves Ghost damage');
  if (m.type === 'Fire' && ability === 'Heatproof' && mult > 0) why('Heatproof halves Fire damage');
  if (m.type === 'Fire' && ability === 'Thermal Exchange' && mult > 0) why('Thermal Exchange: Fire raises its Attack');
  if (ability === 'Disguise' && mult > 0) why('Disguise absorbs the first hit');
  if (target.tera) why(`Terastallized: defends as ${liveTypes(target).join('/')}`);
  return { mult, tone: toneOf(mult), label: labelOf(mult), notes, stab };
}

function statusVerdict(m: MoveInfo, target: Fighter, ability: string, types: TypeName[], notes: string[], stab: boolean): Verdict {
  const blocked = (why: string): Verdict => ({ mult: 0, tone: 'blocked', label: 'Fails', notes: [...notes, why], stab });
  if (ability === 'Good as Gold') return blocked('Good as Gold blocks status moves');
  if (ability === 'Magic Bounce') return blocked('Magic Bounce reflects it back');
  if (m.typeImmunity && typeMultiplier(m.type, types) === 0) return blocked(`${target.species} is immune to ${m.type}`);
  if (m.powder && conditionImmune('powder', types)) return blocked('Grass types ignore powder moves');
  if (m.name === 'Leech Seed' && types.includes('Grass')) return blocked('Grass types cannot be seeded');
  if (m.status) {
    if (ability === 'Purifying Salt') return blocked('Purifying Salt prevents status');
    if (m.status === 'brn' && (ability === 'Thermal Exchange' || conditionImmune('brn', types))) return blocked(ability === 'Thermal Exchange' ? 'Thermal Exchange prevents burns' : 'Fire types cannot be burned');
    if (m.status === 'par' && conditionImmune('par', types)) return blocked('Electric types cannot be paralyzed');
    if ((m.status === 'tox' || m.status === 'psn') && conditionImmune(m.status, types)) return blocked('Poison and Steel types cannot be poisoned');
  }
  return { mult: null, tone: 'status', label: 'Status move', notes, stab };
}

const toneOf = (x: number): Verdict['tone'] => (x === 0 ? 'immune' : x >= 4 ? 'x4' : x >= 2 ? 'x2' : x <= 0.25 ? 'quarter' : x < 1 ? 'half' : 'x1');
const labelOf = (x: number) => (x === 0 ? 'No effect' : x >= 4 ? 'Super effective x4' : x >= 2 ? 'Super effective x2' : x <= 0.25 ? 'Barely effective x0.25' : x < 1 ? 'Not very effective x0.5' : 'Neutral');
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
