import { POOL, TYPE_NAMES, moveInfo, type Pokemon, type TypeName } from '@shared';
import { impactDelay, recipeFor } from '../engine/battle/moveFx.js';

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
export type SideView = { name: string; mons: MonView[]; active: string | null; conditions: string[] };

export type RequestMove = { move: string; id: string; pp?: number; maxpp?: number; target?: string; disabled?: boolean | string };
export type RequestPokemon = { ident: string; details: string; condition: string; active: boolean; item?: string; ability?: string; baseAbility?: string; teraType?: string; terastallized?: string; moves: string[] };
export type BattleRequest = {
  rqid?: number; wait?: boolean; teamPreview?: boolean; forceSwitch?: boolean[];
  active?: { moves: RequestMove[]; canTerastallize?: string; trapped?: boolean; maybeTrapped?: boolean }[];
  side: { name: string; id: 'p1' | 'p2'; pokemon: RequestPokemon[] };
};

export type LogKind = 'turn' | 'move' | 'info' | 'good' | 'bad' | 'faint' | 'switch' | 'win' | 'error';
export type LogEntry = { id: number; text: string; kind: LogKind };

export type Effectiveness = 'super' | 'resist' | 'immune' | 'normal';
export type BattleFx =
  | { kind: 'switch'; side: SideId; mon: MonView }
  | { kind: 'move'; side: SideId; move: string; type: TypeName; category: 'Physical' | 'Special' | 'Status'; target: SideId | null }
  | { kind: 'hit'; side: SideId; lost: number; remaining: number; crit: boolean; effect: Effectiveness; indirect: boolean }
  | { kind: 'heal'; side: SideId; gained: number }
  | { kind: 'faint'; side: SideId }
  | { kind: 'tera'; side: SideId; type: TypeName }
  | { kind: 'status'; side: SideId; status: string }
  | { kind: 'boost'; side: SideId; up: boolean }
  | { kind: 'miss'; side: SideId }
  | { kind: 'turn'; turn: number }
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
  sides: [{ name: 'Player 1', mons: [], active: null, conditions: [] }, { name: 'Player 2', mons: [], active: null, conditions: [] }],
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
/** Switching is locked only for the active Pokémon, fainted ones, and when the simulator reports a trap
 * (sleep, paralysis and other statuses never lock it). A forced replacement ignores traps. */
export function switchLocked(p: RequestPokemon, req: BattleRequest): boolean {
  return p.active || p.condition.endsWith(' fnt') || (!!req.active?.[0]?.trapped && !req.forceSwitch?.[0]);
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

const STAT: Record<string, string> = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness' };
const STATUS: Record<string, string> = { brn: 'was burned', par: 'is paralyzed', slp: 'fell asleep', psn: 'was poisoned', tox: 'was badly poisoned', frz: 'was frozen solid' };
const WEATHER: Record<string, string> = { RainDance: 'It started to rain.', SunnyDay: 'The sunlight turned harsh.', Sandstorm: 'A sandstorm kicked up.', Snowscape: 'It started to snow.', Snow: 'It started to snow.', none: 'The weather cleared.' };
const clean = (s: string) => s.replace(/^(move|item|ability):\s*/, '');

export class BattleModel {
  state: BattleState;
  private seq = 0;
  private pendingCrit = false;
  private pendingEffect: Effectiveness = 'normal';
  constructor(mySide: SideId) { this.state = emptyState(mySide); }

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
  private name(m: MonView) { return sideOf(m.key) === this.state.mySide ? m.species : `the opposing ${m.species}`; }
  private cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
  private log(text: string, kind: LogKind = 'info') { this.state.log.push({ id: ++this.seq, text, kind }); if (this.state.log.length > 400) this.state.log.splice(0, 100); }

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
      case 'start': s.phase = 'active'; this.log('The battle begins!', 'turn'); break;
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
        Object.assign(m, { hp: c.hp, maxhp: c.maxhp, status: c.status, fainted: c.fainted, boosts: {}, transformed: null });
        const prev = s.sides[side].mons.find(x => x.key === s.sides[side].active);
        if (prev && prev !== m) { prev.boosts = {}; prev.transformed = null; }
        s.sides[side].active = m.key;
        this.log(side === s.mySide ? `Go! ${m.species}!` : `${s.sides[side].name} sent out ${m.species}!`, 'switch');
        fx.push({ kind: 'switch', side, mon: m });
        break;
      }
      case 'detailschange': case '-formechange': { const m = this.mon(args[0]); m.species = speciesOf(args[1]); m.set = setFor(m.species) ?? m.set; break; }
      case 'move': {
        const m = this.mon(args[0]);
        const info = moveInfo(args[1]);
        if (args[1] !== 'Struggle' && !m.revealed.moves.includes(args[1])) m.revealed.moves.push(args[1]);
        this.pendingCrit = false; this.pendingEffect = 'normal';
        this.log(`${this.cap(this.name(m))} used ${args[1]}!`, 'move');
        const target = args[2] ? sideOf(args[2]) : null;
        if (kw.still === undefined || kw.miss !== undefined) fx.push({ kind: 'move', side: sideOf(args[0]), move: args[1], type: info?.type ?? 'Normal', category: info?.category ?? 'Status', target });
        if (kw.miss !== undefined && args[2]) { this.log(`${this.cap(this.name(this.mon(args[2])))} avoided the attack!`); fx.push({ kind: 'miss', side: sideOf(args[2]) }); }
        break;
      }
      case '-crit': this.pendingCrit = true; this.log('A critical hit!', 'good'); break;
      case '-supereffective': this.pendingEffect = 'super'; this.log("It's super effective!", 'good'); break;
      case '-resisted': this.pendingEffect = 'resist'; this.log("It's not very effective…"); break;
      case '-immune': { const m = this.mon(args[0]); this.log(`It doesn't affect ${this.name(m)}…`); fx.push({ kind: 'hit', side: sideOf(args[0]), lost: 0, remaining: m.hp / m.maxhp, crit: false, effect: 'immune', indirect: false }); break; }
      case '-miss': { if (args[1]) { this.log(`${this.cap(this.name(this.mon(args[1])))} avoided the attack!`); fx.push({ kind: 'miss', side: sideOf(args[1]) }); } break; }
      case '-fail': this.log('But it failed!'); break;
      case '-damage': case '-sethp': {
        const m = this.mon(args[0]);
        const before = m.hp / m.maxhp;
        const c = parseCondition(args[1]);
        m.hp = c.hp; m.maxhp = c.fainted ? m.maxhp : c.maxhp; m.status = c.fainted ? m.status : c.status;
        const after = c.fainted ? 0 : m.hp / m.maxhp;
        const lost = Math.max(0, before - after);
        if (cmd === '-damage') {
          const pct = Math.round(lost * 100);
          const who = this.cap(this.name(m));
          this.log(from ? `${who} was hurt by ${from}${pct ? ` (${pct}%)` : ''}.` : `${who} lost ${pct}% of its health.`, sideOf(args[0]) === s.mySide ? 'bad' : 'good');
          fx.push({ kind: 'hit', side: sideOf(args[0]), lost, remaining: after, crit: this.pendingCrit, effect: this.pendingEffect, indirect: !!from });
        }
        this.pendingCrit = false; this.pendingEffect = 'normal';
        break;
      }
      case '-heal': {
        const m = this.mon(args[0]); const before = m.hp / m.maxhp;
        const c = parseCondition(args[1]); m.hp = c.hp; m.maxhp = c.maxhp; m.status = c.status;
        this.log(`${this.cap(this.name(m))} restored HP${from ? ` (${from})` : ''}.`, sideOf(args[0]) === s.mySide ? 'good' : 'info');
        fx.push({ kind: 'heal', side: sideOf(args[0]), gained: Math.max(0, m.hp / m.maxhp - before) });
        break;
      }
      case 'faint': { const m = this.mon(args[0]); m.hp = 0; m.fainted = true; this.log(`${this.cap(this.name(m))} fainted!`, 'faint'); fx.push({ kind: 'faint', side: sideOf(args[0]) }); break; }
      case '-status': { const m = this.mon(args[0]); m.status = args[1]; this.log(`${this.cap(this.name(m))} ${STATUS[args[1]] ?? `is ${args[1]}`}!`); fx.push({ kind: 'status', side: sideOf(args[0]), status: args[1] }); break; }
      case '-curestatus': { const m = this.mon(args[0]); m.status = null; this.log(`${this.cap(this.name(m))} recovered.`); break; }
      case '-boost': case '-unboost': {
        const m = this.mon(args[0]); const n = Number(args[2]) || 0; const up = cmd === '-boost';
        m.boosts[args[1]] = Math.max(-6, Math.min(6, (m.boosts[args[1]] ?? 0) + (up ? n : -n)));
        if (n) { this.log(`${this.cap(this.name(m))}'s ${STAT[args[1]] ?? args[1]} ${up ? 'rose' : 'fell'}${n >= 2 ? ' sharply' : ''}!`); fx.push({ kind: 'boost', side: sideOf(args[0]), up }); }
        break;
      }
      case '-setboost': { const m = this.mon(args[0]); m.boosts[args[1]] = Number(args[2]) || 0; this.log(`${this.cap(this.name(m))} maximized its ${STAT[args[1]] ?? args[1]}!`); fx.push({ kind: 'boost', side: sideOf(args[0]), up: true }); break; }
      case '-clearboost': case '-clearallboost': case '-clearnegativeboost': {
        if (cmd === '-clearallboost') s.sides.forEach(sd => sd.mons.forEach(m => (m.boosts = {})));
        else { const m = this.mon(args[0]); m.boosts = cmd === '-clearboost' ? {} : Object.fromEntries(Object.entries(m.boosts).filter(([, v]) => v > 0)); }
        break;
      }
      case '-terastallize': {
        const m = this.mon(args[0]); const t = asType(args[1]); m.tera = t;
        this.log(`${this.cap(this.name(m))} terastallized into the ${args[1]} type!`, 'good');
        if (t) fx.push({ kind: 'tera', side: sideOf(args[0]), type: t });
        break;
      }
      case '-transform': { const m = this.mon(args[0]); const t = this.mon(args[1]); m.transformed = t.species; this.log(`${this.cap(this.name(m))} transformed into ${t.species}!`); break; }
      case '-weather': { if (kw.upkeep === undefined) { s.weather = args[0] === 'none' ? null : args[0]; this.log(WEATHER[args[0]] ?? `${args[0]} started.`); } break; }
      case '-fieldstart': { const f = clean(args[0]); if (!s.field.includes(f)) s.field.push(f); this.log(`${f} took effect.`); break; }
      case '-fieldend': { const f = clean(args[0]); s.field = s.field.filter(x => x !== f); this.log(`${f} ended.`); break; }
      case '-sidestart': { const side = sideOf(args[0]); const c = clean(args[1]); if (!s.sides[side].conditions.includes(c)) s.sides[side].conditions.push(c); this.log(`${c} was set on ${side === s.mySide ? 'your' : "the opponent's"} side.`); break; }
      case '-sideend': { const side = sideOf(args[0]); const c = clean(args[1]); s.sides[side].conditions = s.sides[side].conditions.filter(x => x !== c); this.log(`${c} ended on ${side === s.mySide ? 'your' : "the opponent's"} side.`); break; }
      case '-enditem': { const m = this.mon(args[0]); m.item = null; m.revealed.item = true; this.log(kw.eat !== undefined ? `${this.cap(this.name(m))} ate its ${args[1]}.` : `${this.cap(this.name(m))}'s ${args[1]} ${from === 'Knock Off' || kw.from?.includes('Knock Off') ? 'was knocked off' : 'was used up'}.`); break; }
      case '-item': { const m = this.mon(args[0]); m.item = args[1] ?? m.item; m.revealed.item = true; this.log(`${this.cap(this.name(m))} has ${args[1]}${from ? ` (${from})` : ''}.`); break; }
      case '-ability': { const m = this.mon(args[0]); m.revealed.ability = args[1] ?? m.revealed.ability; this.log(`[${this.cap(this.name(m))}'s ${args[1]}]`); break; }
      case '-start': { const m = this.mon(args[0]); const e = clean(args[1]); if (!/typechange|typeadd/.test(e)) this.log(`${this.cap(this.name(m))}: ${e}${kw.silent !== undefined ? '' : '!'}`); break; }
      case '-end': { const m = this.mon(args[0]); this.log(`${this.cap(this.name(m))}'s ${clean(args[1])} ended.`); break; }
      case '-activate': { if (args[0]?.includes(':') && args[1]?.startsWith('ability: ')) this.mon(args[0]).revealed.ability = clean(args[1]);
        if (args[0] && args[1]) this.log(`${clean(args[1])} activated${args[0].includes(':') ? ` for ${this.name(this.mon(args[0]))}` : ''}.`); break; }
      case '-hitcount': this.log(`Hit ${args[1]} time${args[1] === '1' ? '' : 's'}!`); break;
      case '-prepare': { const m = this.mon(args[0]); this.log(`${this.cap(this.name(m))} is preparing ${args[1]}…`); break; }
      case 'cant': { const m = this.mon(args[0]); this.log(`${this.cap(this.name(m))} can't move${args[1] ? ` (${clean(args[1])})` : ''}!`); break; }
      case 'turn': s.turn = Number(args[0]) || s.turn; this.log(`Turn ${s.turn}`, 'turn'); fx.push({ kind: 'turn', turn: s.turn }); break;
      case 'win': {
        s.phase = 'ended'; s.winner = args[0];
        s.winnerSide = s.sides[0].name === args[0] ? 0 : s.sides[1].name === args[0] ? 1 : null;
        this.log(`${args[0]} won the battle!`, 'win'); fx.push({ kind: 'end', winner: s.winnerSide });
        break;
      }
      case 'tie': s.phase = 'ended'; this.log('The battle ended in a draw.', 'win'); fx.push({ kind: 'end', winner: null }); break;
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
      return r.kind === 'self' ? 1050 : Math.round(260 + impactDelay(r) * 1000);
    }
    case '-damage': return 700;
    case 'faint': return 1500;
    case '-terastallize': return 1300;
    case '-heal': case '-status': case '-boost': case '-unboost': case '-setboost': return 550;
    case 'turn': return 450;
    case 'win': case 'tie': return 1600;
    case '-weather': case '-sidestart': case '-sideend': case '-fieldstart': case '-transform': case 'cant': case '-immune': case '-miss': case '-fail': case '-enditem': case '-item': case '-start': case '-end': case '-activate': case '-ability': case '-prepare': case '-hitcount': return 420;
    case 'start': return 600;
    default: return 0;
  }
}
