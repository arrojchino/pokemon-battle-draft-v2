import { POOL, TYPE_NAMES, moveInfo, type Pokemon, type TypeName } from '@shared';
import { impactLead, recipeFor } from '../engine/battle/moveFx.js';
import { isLang, translate, type MessageKey } from '../i18n/core.js';

/**
 * Client-side battle model. Pure: feed it simulator protocol lines (one player's stream, see
 * Pokémon Showdown's SIM-PROTOCOL.md) and it maintains a view of the battle plus a readable log and a
 * list of stage effects. Timing and animation live in the controller, not here.
 */

export type SideId = 0 | 1;
export type MonView = {
  key: string;            // "p1: Gholdengo" (no nicknames in this game, so species names are unique per side)
  species: string;
  set: Pokemon | null;    // the drafted set, for artwork and types
  hp: number; maxhp: number;
  status: string | null;
  fainted: boolean;
  boosts: Record<string, number>;
  tera: TypeName | null;  // terastallized type, once used
  transformed: string | null;
  /** Held item as far as the log shows (starts as the drafted item; null once consumed or knocked off). */
  item: string | null;
  /** What the battle has shown so far: the rival's set stays hidden except for these. */
  revealed: { moves: string[]; item: boolean; ability: string | null };
};
/** `layers`: how many times each condition was set (Spikes 1-3, Toxic Spikes 1-2; 1 for the rest). */
export type SideView = { name: string; mons: MonView[]; active: string | null; conditions: string[]; layers: Record<string, number> };

export type RequestMove = { move: string; id: string; pp?: number; maxpp?: number; target?: string; disabled?: boolean | string };
export type RequestPokemon = { ident: string; details: string; condition: string; active: boolean; item?: string; ability?: string; baseAbility?: string; teraType?: string; terastallized?: string; moves: string[];
  /** Gen 9 Revival Blessing: set on the active Pokémon while its user picks a fainted ally to revive. */
  reviving?: boolean };
export type BattleRequest = {
  rqid?: number; wait?: boolean; teamPreview?: boolean; forceSwitch?: boolean[];
  active?: { moves: RequestMove[]; canTerastallize?: string; trapped?: boolean; maybeTrapped?: boolean }[];
  side: { name: string; id: 'p1' | 'p2'; pokemon: RequestPokemon[] };
};

export type LogKind = 'turn' | 'move' | 'info' | 'good' | 'bad' | 'faint' | 'switch' | 'win' | 'error';
/** `key`: the dictionary key the text came from. Match on it rather than on the words, which follow the language. */
export type LogEntry = { id: number; text: string; kind: LogKind; key?: MessageKey };
type Params = Record<string, string | number>;
/**
 * A log message in the game's language. i18n/index.ts mirrors the language on `<html lang>`; reading it there keeps
 * this module pure (it never loads the settings store, so Node tests run it as is, in English).
 */
function tr(key: MessageKey, params?: Params): string {
  const l = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return translate(isLang(l) ? l : 'en', key, params);
}

export type Effectiveness = 'super' | 'resist' | 'immune' | 'normal';
export type BattleFx =
  | { kind: 'switch'; side: SideId; mon: MonView }
  | { kind: 'move'; side: SideId; move: string; type: TypeName; category: 'Physical' | 'Special' | 'Status'; target: SideId | null }
  | { kind: 'hit'; side: SideId; lost: number; remaining: number; crit: boolean; effect: Effectiveness; indirect: boolean }
  | { kind: 'heal'; side: SideId; gained: number }
  | { kind: 'faint'; side: SideId }
  | { kind: 'tera'; side: SideId; type: TypeName }
  /** Transform / Imposter: `side`'s Pokemon takes the shape of `species` (`set` for its artwork and model). */
  | { kind: 'transform'; side: SideId; mon: MonView; species: string; set: Pokemon | null }
  /** A transformed Pokemon is itself again: it left the field (`switch`) or fainted (`faint`). */
  | { kind: 'untransform'; side: SideId; reason: 'switch' | 'faint' }
  | { kind: 'status'; side: SideId; status: string }
  | { kind: 'boost'; side: SideId; up: boolean }
  | { kind: 'miss'; side: SideId }
  | { kind: 'turn'; turn: number }
  /** A side's lasting conditions changed (hazards, screens): the stage keeps them visible until they end. */
  | { kind: 'sideField'; side: SideId; layers: Record<string, number> }
  | { kind: 'weather'; weather: string | null }
  | { kind: 'end'; winner: SideId | null };

export type BattleState = {
  mySide: SideId;
  phase: 'idle' | 'preview' | 'active' | 'ended';
  turn: number;
  sides: [SideView, SideView];
  weather: string | null;
  field: string[];
  log: LogEntry[];
  request: BattleRequest | null;
  winner: string | null;
  winnerSide: SideId | null;
};

export const emptyState = (mySide: SideId): BattleState => ({
  mySide, phase: 'idle', turn: 0, weather: null, field: [], log: [], request: null, winner: null, winnerSide: null,
  sides: [{ name: tr('model.player', { n: 1 }), mons: [], active: null, conditions: [], layers: {} }, { name: tr('model.player', { n: 2 }), mons: [], active: null, conditions: [], layers: {} }],
});

/** Line → command + args. Kwargs like `[from] item: Life Orb` are split out. */
export function parseLine(line: string): { cmd: string; args: string[]; kw: Record<string, string> } | null {
  if (!line.startsWith('|')) return null;
  const parts = line.slice(1).split('|');
  const cmd = parts[0];
  const args: string[] = []; const kw: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const m = /^\[(\w+)\]\s?(.*)$/.exec(p);
    if (m) kw[m[1]] = m[2]; else args.push(p);
  }
  return { cmd, args, kw };
}

const sideOf = (ident: string): SideId => (ident.startsWith('p2') ? 1 : 0);
/** "p1a: Gholdengo" → "p1: Gholdengo" */
const monKey = (ident: string) => ident.replace(/^(p[12])[a-z]?:\s*/, '$1: ');
const speciesOf = (details: string) => details.split(',')[0].trim();
/** Revival Blessing request: a forced "switch" whose only valid targets are fainted party members. */
export const isRevival = (req: BattleRequest) => !!req.forceSwitch?.[0] && req.side.pokemon.some(p => p.active && p.reviving);

/** Switching is locked only for the active Pokémon, fainted ones, and when the simulator reports a trap
 * (sleep, paralysis and other statuses never lock it). A forced replacement ignores traps. During a
 * Revival Blessing it is the other way round: only fainted Pokémon can be chosen. */
export function switchLocked(p: RequestPokemon, req: BattleRequest): boolean {
  const fainted = p.condition.endsWith(' fnt');
  if (isRevival(req)) return p.active || !fainted;
  return p.active || fainted || (!!req.active?.[0]?.trapped && !req.forceSwitch?.[0]);
}

export function setFor(species: string): Pokemon | null {
  return POOL.find(p => p.name === species) ?? POOL.find(p => species.startsWith(p.name + '-')) ?? null;
}
function parseCondition(c: string): { hp: number; maxhp: number; status: string | null; fainted: boolean } {
  const [hpPart, status] = c.trim().split(' ');
  if (hpPart === '0' || status === 'fnt') return { hp: 0, maxhp: 100, status: null, fainted: true };
  const [hp, max] = hpPart.split('/').map(Number);
  return { hp, maxhp: max || 100, status: status ?? null, fainted: false };
}
const asType = (t: string | undefined): TypeName | null => ((TYPE_NAMES as readonly string[]).includes(t ?? '') ? (t as TypeName) : null);

const STAT: Record<string, MessageKey> = { atk: 'model.statAtk', def: 'model.statDef', spa: 'model.statSpa', spd: 'model.statSpd', spe: 'model.statSpe', accuracy: 'model.statAccuracy', evasion: 'model.statEvasion' };
/** A stat's name as the log says it (the simulator id when unknown). */
const statName = (id: string) => (STAT[id] ? tr(STAT[id]) : id);
const STATUS: Record<string, MessageKey> = { brn: 'model.statusBrn', par: 'model.statusPar', slp: 'model.statusSlp', psn: 'model.statusPsn', tox: 'model.statusTox', frz: 'model.statusFrz' };
const WEATHER: Record<string, MessageKey> = { RainDance: 'model.weatherRain', SunnyDay: 'model.weatherSun', Sandstorm: 'model.weatherSand', Snowscape: 'model.weatherSnow', Snow: 'model.weatherSnow', none: 'model.weatherClear' };
const START: Record<string, MessageKey> = {
  confusion: 'model.startConfusion', substitute: 'model.startSubstitute', taunt: 'model.startTaunt', encore: 'model.startEncore', leechseed: 'model.startLeechSeed',
  yawn: 'model.startYawn', saltcure: 'model.startSaltCure', focusenergy: 'model.startFocusEnergy', curse: 'model.startCurse', disable: 'model.startDisable',
  torment: 'model.startTorment', healblock: 'model.startHealBlock', charge: 'model.startCharge', flashfire: 'model.startFlashFire', destinybond: 'model.startDestinyBond',
  magnetrise: 'model.startMagnetRise', aquaring: 'model.startAquaRing', ingrain: 'model.startIngrain', attract: 'model.startAttract', nightmare: 'model.startNightmare',
  slowstart: 'model.startSlowStart', smackdown: 'model.startSmackDown', tarshot: 'model.startTarShot', throatchop: 'model.startThroatChop', embargo: 'model.startEmbargo',
};
const clean = (s: string) => s.replace(/^(move|item|ability):\s*/, '');
/**
 * How the games word a volatile effect starting (`-start`), from the simulator's effect id. Unknown effects fall
 * back to "Name: Effect!" with the id spaced into words.
 */
export function startText(who: string, raw: string, plain = who): string {
  const l = startLine(who, raw, plain);
  return tr(l.key, l.params);
}
/** `startText` as a dictionary key and its parameters: `who` starts a sentence, `plain` is the name as is. */
function startLine(who: string, raw: string, plain: string): { key: MessageKey; params: Params } {
  const e = clean(raw), id = e.toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = { Who: who, who: plain };
  const boost = /^(protosynthesis|quarkdrive)(atk|def|spa|spd|spe)$/.exec(id);
  if (boost) return { key: 'model.startBoost', params: { ...p, ability: boost[1] === 'protosynthesis' ? 'Protosynthesis' : 'Quark Drive', stat: statName(boost[2]) } };
  const perish = /^perish(\d)$/.exec(id);
  if (perish) return { key: 'model.perish', params: { ...p, n: perish[1] } };
  const stock = /^stockpile(\d)$/.exec(id);
  if (stock) return { key: 'model.stockpile', params: { ...p, n: stock[1] } };
  const key = START[id];
  return key ? { key, params: p } : { key: 'model.startOther', params: { ...p, effect: e.replace(/([a-z])([A-Z])/g, '$1 $2') } };
}

export class BattleModel {
  state: BattleState;
  private seq = 0;
  private pendingCrit = false;
  private pendingEffect: Effectiveness = 'normal';
  /** `spectator`: nobody's side is "yours"; the log names each trainer. */
  constructor(mySide: SideId, private spectator = false) { this.state = emptyState(mySide); }

  /** Team-preview entries are keyed by species until the battle reveals their in-battle name. */
  private provisional = new Set<MonView>();

  private mon(ident: string, details?: string, fromPreview = false): MonView {
    const side = this.state.sides[sideOf(ident)];
    const key = monKey(ident);
    let m = side.mons.find(x => x.key === key);
    // e.g. Rotom-Wash appears as "p1a: Rotom" in battle but as "Rotom-Wash" in team preview.
    if (!m && details && !fromPreview) {
      const species = speciesOf(details);
      m = side.mons.find(x => this.provisional.has(x) && (x.species === species || species.startsWith(x.species + '-') || x.species.startsWith(species + '-')));
      if (m) { m.key = key; this.provisional.delete(m); }
    }
    if (!m) {
      const species = details ? speciesOf(details) : key.split(': ')[1];
      { const set = setFor(species); m = { key, species, set, hp: 100, maxhp: 100, status: null, fainted: false, boosts: {}, tera: null, transformed: null, item: set?.item ?? null, revealed: { moves: [], item: false, ability: null } }; }
      side.mons.push(m);
      if (fromPreview) this.provisional.add(m);
    }
    return m;
  }
  private name(m: MonView) {
    if (this.spectator) return tr('model.monOf', { trainer: this.state.sides[sideOf(m.key)].name, mon: m.species });
    return sideOf(m.key) === this.state.mySide ? m.species : tr('model.monOpposing', { mon: m.species });
  }
  /** A Pokémon as the log names it: `who` as is, `Who` capitalized to start a sentence. */
  private w(m: MonView) { const who = this.name(m); return { who, Who: this.cap(who) }; }
  /** Whose side of the field, as the log says it. */
  private whose(side: SideId) { return this.spectator ? tr('model.sideOf', { trainer: this.state.sides[side].name }) : side === this.state.mySide ? tr('model.sideYours') : tr('model.sideOpponent'); }
  private cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
  private log(text: string, kind: LogKind = 'info', key?: MessageKey) { this.state.log.push({ id: ++this.seq, text, kind, key }); if (this.state.log.length > 400) this.state.log.splice(0, 100); }
  /** Log a dictionary message (in the current language), keeping its key on the entry. */
  private say(key: MessageKey, params: Params = {}, kind: LogKind = 'info') { this.log(tr(key, params), kind, key); }

  /** Apply one line. Returns the stage effects it produced (often none). */
  apply(line: string): BattleFx[] {
    const p = parseLine(line);
    if (!p) return [];
    const { cmd, args, kw } = p;
    const s = this.state;
    const fx: BattleFx[] = [];
    const from = kw.from ? clean(kw.from) : '';
    // `[from] item: X` / `[from] ability: Y` reveal the holder's item or ability ([of] names the holder when it is not args[0]).
    const holder = [kw.of, args[0]].find(a => a && /^p[12][a-d]: /.test(a));
    if (holder && kw.from?.startsWith('item:')) this.mon(holder).revealed.item = true;
    if (holder && kw.from?.startsWith('ability:')) this.mon(holder).revealed.ability = from;
    switch (cmd) {
      case 'player': if (args[1]) s.sides[args[0] === 'p2' ? 1 : 0].name = args[1]; break;
      case 'poke': { const side = s.sides[args[0] === 'p2' ? 1 : 0]; const sp = speciesOf(args[1]); if (!side.mons.some(m => m.species === sp)) this.mon(`${args[0]}: ${sp}`, args[1], true); break; }
      case 'teampreview': s.phase = 'preview'; break;
      case 'start': s.phase = 'active'; this.say('model.battleBegins', {}, 'turn'); break;
      case 'request': {
        try { s.request = JSON.parse(line.slice(9)) as BattleRequest; } catch { s.request = null; }
        // Our own HP is exact in the request: keep the bench in sync (the log only covers the active slot).
        for (const rp of s.request?.side.pokemon ?? []) {
          const m = this.mon(rp.ident, rp.details);
          const c = parseCondition(rp.condition);
          m.hp = c.hp; if (!c.fainted) m.maxhp = c.maxhp; m.status = c.status; m.fainted = c.fainted;
          if (rp.terastallized) m.tera = asType(rp.terastallized);
        }
        break;
      }
      case 'switch': case 'drag': case 'replace': {
        const side = sideOf(args[0]);
        const m = this.mon(args[0], args[1]);
        const c = parseCondition(args[2] ?? '100/100');
        const prev = s.sides[side].mons.find(x => x.key === s.sides[side].active);
        // A transformed Pokemon leaving the field (or coming back in through a replace) is itself again.
        if (m.transformed || prev?.transformed) fx.push({ kind: 'untransform', side, reason: 'switch' });
        Object.assign(m, { hp: c.hp, maxhp: c.maxhp, status: c.status, fainted: c.fainted, boosts: {}, transformed: null });
        if (prev && prev !== m) { prev.boosts = {}; prev.transformed = null; }
        s.sides[side].active = m.key;
        if (side === s.mySide && !this.spectator) this.say('model.go', { mon: m.species }, 'switch');
        else this.say('model.sentOut', { trainer: s.sides[side].name, mon: m.species }, 'switch');
        fx.push({ kind: 'switch', side, mon: m });
        break;
      }
      case 'detailschange': case '-formechange': { const m = this.mon(args[0]); m.species = speciesOf(args[1]); m.set = setFor(m.species) ?? m.set; break; }
      case 'move': {
        const m = this.mon(args[0]);
        const info = moveInfo(args[1]);
        if (args[1] !== 'Struggle' && !m.revealed.moves.includes(args[1])) m.revealed.moves.push(args[1]);
        this.pendingCrit = false; this.pendingEffect = 'normal';
        this.say('model.used', { ...this.w(m), move: args[1] }, 'move');
        const target = args[2] ? sideOf(args[2]) : null;
        if (kw.still === undefined || kw.miss !== undefined) fx.push({ kind: 'move', side: sideOf(args[0]), move: args[1], type: info?.type ?? 'Normal', category: info?.category ?? 'Status', target });
        if (kw.miss !== undefined && args[2]) { this.say('model.avoided', this.w(this.mon(args[2]))); fx.push({ kind: 'miss', side: sideOf(args[2]) }); }
        break;
      }
      case '-crit': this.pendingCrit = true; this.say('model.crit', {}, 'good'); break;
      case '-supereffective': this.pendingEffect = 'super'; this.say('model.superEffective', {}, 'good'); break;
      case '-resisted': this.pendingEffect = 'resist'; this.say('model.resisted'); break;
      case '-immune': { const m = this.mon(args[0]); this.say('model.immune', this.w(m)); fx.push({ kind: 'hit', side: sideOf(args[0]), lost: 0, remaining: m.hp / m.maxhp, crit: false, effect: 'immune', indirect: false }); break; }
      case '-miss': { if (args[1]) { this.say('model.avoided', this.w(this.mon(args[1]))); fx.push({ kind: 'miss', side: sideOf(args[1]) }); } break; }
      case '-fail': this.say('model.failed'); break;
      case '-damage': case '-sethp': {
        const m = this.mon(args[0]);
        const before = m.hp / m.maxhp;
        const c = parseCondition(args[1]);
        m.hp = c.hp; m.maxhp = c.fainted ? m.maxhp : c.maxhp; m.status = c.fainted ? m.status : c.status;
        const after = c.fainted ? 0 : m.hp / m.maxhp;
        const lost = Math.max(0, before - after);
        if (cmd === '-damage') {
          const pct = Math.round(lost * 100);
          const who = this.w(m), tone: LogKind = sideOf(args[0]) === s.mySide ? 'bad' : 'good';
          if (from) this.say(pct ? 'model.hurtByPct' : 'model.hurtBy', { ...who, from, pct }, tone);
          else this.say('model.lostHealth', { ...who, pct }, tone);
          fx.push({ kind: 'hit', side: sideOf(args[0]), lost, remaining: after, crit: this.pendingCrit, effect: this.pendingEffect, indirect: !!from });
        }
        this.pendingCrit = false; this.pendingEffect = 'normal';
        break;
      }
      case '-heal': {
        const m = this.mon(args[0]); const before = m.hp / m.maxhp;
        const c = parseCondition(args[1]); m.hp = c.hp; m.maxhp = c.maxhp; m.status = c.status;
        const revived = m.fainted && !c.fainted;
        if (revived) m.fainted = false;
        this.say(revived ? 'model.revived' : from ? 'model.restoredFrom' : 'model.restored', { ...this.w(m), from }, sideOf(args[0]) === s.mySide ? 'good' : 'info');
        // A revived Pokémon waits on the bench: no healing effect on whoever is on the field.
        if (!revived) fx.push({ kind: 'heal', side: sideOf(args[0]), gained: Math.max(0, m.hp / m.maxhp - before) });
        break;
      }
      case 'faint': {
        const m = this.mon(args[0]); m.hp = 0; m.fainted = true; this.say('model.fainted', this.w(m), 'faint'); fx.push({ kind: 'faint', side: sideOf(args[0]) });
        if (m.transformed) { m.transformed = null; fx.push({ kind: 'untransform', side: sideOf(args[0]), reason: 'faint' }); }
        break;
      }
      case '-status': { const m = this.mon(args[0]); m.status = args[1]; this.say(STATUS[args[1]] ?? 'model.statusOther', { ...this.w(m), status: args[1] }); fx.push({ kind: 'status', side: sideOf(args[0]), status: args[1] }); break; }
      case '-curestatus': { const m = this.mon(args[0]); m.status = null; this.say('model.recovered', this.w(m)); break; }
      case '-boost': case '-unboost': {
        const m = this.mon(args[0]); const n = Number(args[2]) || 0; const up = cmd === '-boost';
        m.boosts[args[1]] = Math.max(-6, Math.min(6, (m.boosts[args[1]] ?? 0) + (up ? n : -n)));
        if (n) { this.say(up ? (n >= 2 ? 'model.boostUpSharp' : 'model.boostUp') : n >= 2 ? 'model.boostDownSharp' : 'model.boostDown', { ...this.w(m), stat: statName(args[1]) }); fx.push({ kind: 'boost', side: sideOf(args[0]), up }); }
        break;
      }
      case '-setboost': { const m = this.mon(args[0]); m.boosts[args[1]] = Number(args[2]) || 0; this.say('model.maxed', { ...this.w(m), stat: statName(args[1]) }); fx.push({ kind: 'boost', side: sideOf(args[0]), up: true }); break; }
      case '-clearboost': case '-clearallboost': case '-clearnegativeboost': {
        if (cmd === '-clearallboost') s.sides.forEach(sd => sd.mons.forEach(m => (m.boosts = {})));
        else { const m = this.mon(args[0]); m.boosts = cmd === '-clearboost' ? {} : Object.fromEntries(Object.entries(m.boosts).filter(([, v]) => v > 0)); }
        break;
      }
      case '-terastallize': {
        const m = this.mon(args[0]); const t = asType(args[1]); m.tera = t;
        this.say('model.tera', { ...this.w(m), type: args[1] }, 'good');
        if (t) fx.push({ kind: 'tera', side: sideOf(args[0]), type: t });
        break;
      }
      case '-transform': {
        // Transform (the move) and Imposter (`[from] ability: Imposter`, right after the switch-in) both land here.
        // Copying a Pokemon that is itself transformed copies what it looks like now.
        const m = this.mon(args[0]); const t = this.mon(args[1]); const into = t.transformed ?? t.species;
        m.transformed = into; this.say('model.transformed', { ...this.w(m), mon: into });
        fx.push({ kind: 'transform', side: sideOf(args[0]), mon: m, species: into, set: t.transformed ? setFor(into) : t.set ?? setFor(into) });
        break;
      }
      case '-weather': { if (kw.upkeep === undefined) { s.weather = args[0] === 'none' ? null : args[0]; this.say(WEATHER[args[0]] ?? 'model.weatherStart', { weather: args[0] }); fx.push({ kind: 'weather', weather: s.weather }); } break; }
      case '-fieldstart': { const f = clean(args[0]); if (!s.field.includes(f)) s.field.push(f); this.say('model.fieldStart', { field: f }); break; }
      case '-fieldend': { const f = clean(args[0]); s.field = s.field.filter(x => x !== f); this.say('model.fieldEnd', { field: f }); break; }
      case '-sidestart': {
        const side = sideOf(args[0]), c = clean(args[1]), v = s.sides[side];
        if (!v.conditions.includes(c)) v.conditions.push(c);
        // Spikes stack to 3 layers and Toxic Spikes to 2; each layer is its own -sidestart.
        v.layers = { ...v.layers, [c]: Math.min(c === 'Spikes' ? 3 : c === 'Toxic Spikes' ? 2 : 1, (v.layers[c] ?? 0) + 1) };
        this.say('model.sideStart', { condition: c, side: this.whose(side) });
        fx.push({ kind: 'sideField', side, layers: { ...v.layers } });
        break;
      }
      case '-sideend': {
        const side = sideOf(args[0]), c = clean(args[1]), v = s.sides[side];
        v.conditions = v.conditions.filter(x => x !== c);
        const { [c]: _gone, ...rest } = v.layers; v.layers = rest;
        this.say('model.sideEnd', { condition: c, side: this.whose(side) });
        fx.push({ kind: 'sideField', side, layers: { ...v.layers } });
        break;
      }
      case '-enditem': { const m = this.mon(args[0]); m.item = null; m.revealed.item = true; this.say(kw.eat !== undefined ? 'model.ateItem' : from === 'Knock Off' || kw.from?.includes('Knock Off') ? 'model.itemKnocked' : 'model.itemUsed', { ...this.w(m), item: args[1] }); break; }
      case '-item': { const m = this.mon(args[0]); m.item = args[1] ?? m.item; m.revealed.item = true; this.say(from ? 'model.hasItemFrom' : 'model.hasItem', { ...this.w(m), item: args[1], from }); break; }
      case '-ability': { const m = this.mon(args[0]); m.revealed.ability = args[1] ?? m.revealed.ability; this.say('model.ability', { ...this.w(m), ability: args[1] }); break; }
      case '-start': { const m = this.mon(args[0]); const e = clean(args[1]); if (!/typechange|typeadd/.test(e) && kw.silent === undefined) { const who = this.w(m), l = startLine(who.Who, args[1], who.who); this.say(l.key, l.params); } break; }
      case '-end': { const m = this.mon(args[0]); this.say('model.effectEnd', { ...this.w(m), effect: clean(args[1]) }); break; }
      case '-activate': { if (args[0]?.includes(':') && args[1]?.startsWith('ability: ')) this.mon(args[0]).revealed.ability = clean(args[1]);
        // Protosynthesis and Quark Drive announce themselves in the -start that follows (which stat rose).
        if (args[0] && args[1] && !/^ability: (Protosynthesis|Quark Drive)$/.test(args[1])) { if (args[0].includes(':')) this.say('model.activatedFor', { effect: clean(args[1]), ...this.w(this.mon(args[0])) }); else this.say('model.activated', { effect: clean(args[1]) }); } break; }
      case '-hitcount': this.say(args[1] === '1' ? 'model.hitOne' : 'model.hitOther', { n: args[1] }); break;
      case '-prepare': { const m = this.mon(args[0]); this.say('model.preparing', { ...this.w(m), move: args[1] }); break; }
      case 'cant': { const m = this.mon(args[0]); this.say(args[1] ? 'model.cantMoveWhy' : 'model.cantMove', { ...this.w(m), reason: args[1] ? clean(args[1]) : '' }); break; }
      case 'turn': s.turn = Number(args[0]) || s.turn; this.say('model.turn', { n: s.turn }, 'turn'); fx.push({ kind: 'turn', turn: s.turn }); break;
      case 'win': {
        s.phase = 'ended'; s.winner = args[0];
        s.winnerSide = s.sides[0].name === args[0] ? 0 : s.sides[1].name === args[0] ? 1 : null;
        this.say('model.won', { name: args[0] }, 'win'); fx.push({ kind: 'end', winner: s.winnerSide });
        break;
      }
      case 'tie': s.phase = 'ended'; this.say('model.tie', {}, 'win'); fx.push({ kind: 'end', winner: null }); break;
      case 'error': this.log(line.slice(7).replace(/^\[[^\]]*\]\s*/, ''), 'error'); break;
      case '-message': this.log(args[0] ?? ''); break;
      default: break; // gen, tier, rule, gametype, teamsize, upkeep, -anim, -hint, -singleturn, -singlemove, j, l, etc.
    }
    return fx;
  }

  activeMon(side: SideId): MonView | null { const sd = this.state.sides[side]; return sd.mons.find(m => m.key === sd.active) ?? null; }
}

/** How long each line holds the stage, in ms at normal speed (0 = instant). */
export function lineDuration(line: string): number {
  const cmd = line.slice(1).split('|', 1)[0];
  switch (cmd) {
    case 'switch': case 'drag': case 'replace': return 1100;
    case 'move': {
      // Hold until the animation's hit lands, so the damage line plays on impact.
      const name = line.split('|')[3] ?? '';
      const info = moveInfo(name);
      const r = recipeFor(name, info?.type ?? 'Normal', info?.category ?? 'Status');
      return r.kind === 'self' ? 1050 : Math.round(260 + impactLead(r) * 1000);
    }
    case '-damage': return 700;
    case 'faint': return 1500;
    case '-terastallize': return 1300;
    case '-heal': case '-status': case '-boost': case '-unboost': case '-setboost': return 550;
    case 'turn': return 450;
    case 'win': case 'tie': return 1600;
    // The morph on stage: melt, reshape, reveal (about 1.7 s).
    case '-transform': return 1600;
    case '-weather': case '-sidestart': case '-sideend': case '-fieldstart': case 'cant': case '-immune': case '-miss': case '-fail': case '-enditem': case '-item': case '-start': case '-end': case '-activate': case '-ability': case '-prepare': case '-hitcount': return 420;
    case 'start': return 600;
    default: return 0;
  }
}
