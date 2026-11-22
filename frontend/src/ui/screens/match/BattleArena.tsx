import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { moveInfo, type TypeName } from '@shared';
import type { BattleController } from '../../../battle/controller.js';
import { isRevival, setFor as setForSpecies, switchLocked, type BattleRequest, type LogEntry, type MonView, type RequestPokemon, type SideView } from '../../../battle/model.js';
import { Icon } from '../../primitives.js';
import { sound } from '../../../audio/sound.js';
import { moveVerdict, type Fighter } from '../../../battle/matchup.js';
import { MonCard, MoveCard, TipLayer, VerdictChip, useTip } from './Tips.js';
import { Sprite, TYPE_COLORS, TypeBadge } from '../../pokemon.js';

const STATUS_LABEL: Record<string, string> = { brn: 'BRN', par: 'PAR', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRZ' };
const STAT_SHORT: Record<string, string> = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe', accuracy: 'Acc', evasion: 'Eva' };

function HpBar({ mon, exact }: { mon: MonView; exact: boolean }) {
  const f = mon.fainted ? 0 : mon.hp / mon.maxhp;
  const tone = f > 0.5 ? 'ok' : f > 0.2 ? 'mid' : 'low';
  return (
    <div className={`hp hp--${tone}`}>
      <div className="hp__track"><i className="hp__ghost" style={{ '--f': f } as CSSProperties} /><i className="hp__fill" style={{ '--f': f } as CSSProperties} /></div>
      <span className="hp__num">{exact ? `${mon.hp}/${mon.maxhp}` : `${Math.round(f * 100)}%`}</span>
    </div>
  );
}

/**
 * What we know about a Pokémon on the field. Our own sets are fully known; for the rival only species,
 * types and what the battle has revealed (moves used, item and ability once shown).
 */
export function fighterOfMon(mon: MonView | null, known = true): Fighter | null {
  if (!mon) return null;
  const item = known || mon.revealed.item ? mon.item : 'Unknown';
  return { species: mon.species, types: mon.set?.types ?? ['Normal'], tera: mon.tera, ability: known ? mon.set?.ability ?? '' : mon.revealed.ability ?? '', item };
}
const hiddenNote = (mon: MonView) => (mon.revealed.moves.length ? `${mon.revealed.moves.length} of 4 moves revealed. The rest of its set is hidden.` : 'Its set stays hidden until it acts.');

/** Floating damage and healing numbers from observed HP changes of the active Pokémon. */
function useHpPops(mon: MonView | null, exact: boolean) {
  const last = useRef<{ key: string; hp: number } | null>(null);
  const seq = useRef(0);
  const [pops, setPops] = useState<{ id: number; text: string; heal: boolean }[]>([]);
  const hp = mon ? (mon.fainted ? 0 : mon.hp) : 0;
  useEffect(() => {
    if (!mon) return;
    const prev = last.current; last.current = { key: mon.key, hp };
    if (!prev || prev.key !== mon.key || prev.hp === hp) return;
    const d = hp - prev.hp;
    const id = ++seq.current;
    setPops(p => [...p.slice(-2), { id, text: `${d < 0 ? '−' : '+'}${Math.abs(d)}${exact ? '' : '%'}`, heal: d > 0 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mon?.key, hp]);
  const done = (id: number) => setPops(p => p.filter(x => x.id !== id));
  return { pops, done };
}
/** Our own Pokémon, straight from the simulator request (exact item and ability). */
function fighterOfReq(p: RequestPokemon, mon?: MonView | null): Fighter {
  const species = p.details.split(',')[0];
  const set = setForSpecies(species);
  const tera = (p.terastallized || mon?.tera || null) as TypeName | null;
  const name = (id?: string) => set && id && set.ability.toLowerCase().replace(/[^a-z0-9]/g, '') === id ? set.ability : set?.ability ?? id ?? '';
  return { species, types: set?.types ?? ['Normal'], tera, ability: name(p.ability ?? p.baseAbility), item: p.item ? (set && set.item.toLowerCase().replace(/[^a-z0-9]/g, '') === p.item ? set.item : p.item) : null };
}

/** `known`: this side's sets are ours to see (a player's own side). A spectator knows neither side's. */
function MonPlate({ mon, side, label, mine, foe, known = mine, foeKnown = !mine }: { mon: MonView | null; side: SideView; label: string; mine: boolean; foe: MonView | null; known?: boolean; foeKnown?: boolean }) {
  const tip = useTip(() => {
    const f = fighterOfMon(mon, known); if (!f || !mon) return null;
    const vs = fighterOfMon(foe, foeKnown);
    return <MonCard f={f} hp={mon} pct={!known} status={mon.status} moves={known ? mon.set?.moves ?? [] : mon.revealed.moves} vs={vs} foeAttacker={vs} note={known ? undefined : hiddenNote(mon)} />;
  });
  const { pops, done } = useHpPops(mon, known);
  if (!mon) return null;
  const types: TypeName[] = mon.tera ? [mon.tera] : mon.set?.types ?? [];
  const boosts = Object.entries(mon.boosts).filter(([, v]) => v);
  return (
    <section {...tip} tabIndex={0} className={`plate2 ${mine ? 'plate2--mine' : 'plate2--theirs'}`} aria-label={`${label} active Pokémon`} style={{ '--t1': TYPE_COLORS[types[0] ?? 'Normal'] } as CSSProperties}>
      <header>
        <strong>{mon.species}</strong>
        <span className="plate2__lv">Lv100</span>
        {mon.status && <span className={`stat-chip stat-chip--${mon.status}`}>{STATUS_LABEL[mon.status] ?? mon.status}</span>}
        {mon.tera && <TypeBadge type={mon.tera} tera size="sm" />}
      </header>
      <HpBar mon={mon} exact={known} />
      <div className="pops" aria-hidden="true">{pops.map(p => <b key={p.id} className={`pop ${p.heal ? 'pop--heal' : ''}`} onAnimationEnd={() => done(p.id)}>{p.text}</b>)}</div>
      <div className="plate2__row">
        <div className="plate2__types">{!mon.tera && mon.set?.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</div>
        {boosts.map(([k, v]) => <span key={k} className={`boost ${v > 0 ? 'boost--up' : 'boost--down'}`}>{v > 0 ? '+' : ''}{v} {STAT_SHORT[k] ?? k}</span>)}
      </div>
      <div className="plate2__team" aria-label={`${label} team`}>
        {side.mons.map(m => <i key={m.key} title={m.species} className={m.fainted ? 'is-out' : m.status ? 'is-status' : ''} />)}
        <span>{label}</span>
      </div>
    </section>
  );
}

function Timer({ deadline, active }: { deadline: number | null; active: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline || !active) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [deadline, active]);
  if (!deadline || !active) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <TimerFace left={left} />;
}

function TimerFace({ left }: { left: number }) {
  // Tick through the last ten seconds, louder for the final three.
  useEffect(() => { if (left > 0 && left <= 10) sound.play(left <= 3 ? 'tickUrgent' : 'tick'); }, [left]);
  return <span className={`timer ${left <= 20 ? 'is-low' : ''}`} title="When time runs out, the default move is played for you"><Icon name="history" size={14} />{left}s</span>;
}

function TeamPreview({ req, theirs, choose }: { req: BattleRequest; theirs: SideView; choose: (c: string) => void }) {
  return (
    <div className="preview">
      <p className="eyebrow"><span className="jp">先発</span> Choose your lead</p>
      <div className="preview__theirs" aria-label="Opponent team">
        {theirs.mons.map(m => <FoePreview key={m.key} mon={m} />)}
      </div>
      <div className="preview__mine">
        {req.side.pokemon.map((p, i) => {
          const sp = p.details.split(',')[0];
          const order = [i + 1, ...[1, 2, 3, 4, 5, 6].filter(n => n !== i + 1)].join('');
          return <LeadButton key={p.ident} p={p} onPick={() => choose(`team ${order}`)} sp={sp} />;
        })}
      </div>
    </div>
  );
}
function FoePreview({ mon }: { mon: MonView }) {
  const tip = useTip(() => <MonCard f={fighterOfMon(mon, false)!} moves={[]} vs={null} note="Its set stays hidden until it is revealed in battle." />);
  return <span {...tip} tabIndex={0} className="preview__foe"><Sprite eager artId={mon.set?.artId ?? mon.set?.id ?? 0} name={mon.species} /></span>;
}
function LeadButton({ p, sp, onPick }: { p: RequestPokemon; sp: string; onPick: () => void }) {
  const set = setForSpecies(sp);
  const tip = useTip(() => <MonCard f={fighterOfReq(p)} moves={set?.moves ?? p.moves} vs={null} note={set ? `Tera ${set.tera} available` : undefined} />);
  return (
    <button {...tip} className="lead" onClick={onPick} style={{ '--t1': TYPE_COLORS[set?.types[0] ?? 'Normal'] } as CSSProperties}>
      <Sprite eager artId={set?.artId ?? set?.id ?? 0} name={set?.name ?? p.ident.slice(4)} />
      <strong>{sp}</strong>
      <span>{set?.types.join(' / ')}</span>
    </button>
  );
}
function MoveButton({ m, index, off, user, target, teraPreview, onPick }: { m: { move: string; id: string; pp?: number; maxpp?: number }; index: number; off: boolean; user: Fighter; target: Fighter | null; teraPreview: TypeName | null; onPick: (i: number) => void }) {
  const info = moveInfo(m.move);
  const v = moveVerdict(m.move, user, target, teraPreview);
  const tip = useTip(() => <MoveCard name={m.move} pp={m.pp} maxpp={m.maxpp} user={user} target={target} teraPreview={teraPreview} />);
  return (
    <button {...tip} className={`move ${v ? `move--${v.tone}` : ''}`} disabled={off} onClick={() => onPick(index)} style={{ '--t': TYPE_COLORS[info?.type ?? 'Normal'] } as CSSProperties}>
      <strong>{m.move}</strong>
      <span className="move__meta">
        <em>{info?.type ?? '???'}</em>
        <em>{info?.category ?? ''}{info && info.power ? ` · ${info.power}` : ''}{info && info.accuracy ? ` · ${info.accuracy}%` : ''}</em>
        {m.pp !== undefined && <em className="move__pp">{m.pp}/{m.maxpp}</em>}
      </span>
      <span className="move__vs"><VerdictChip v={v} compact />{v?.stab && <span className="vchip vchip--stab">STAB</span>}</span>
    </button>
  );
}
function SwapButton({ p, mon, disabled, foe, onPick, revive }: { p: RequestPokemon; mon: MonView | undefined; disabled: boolean; foe: Fighter | null; onPick: () => void; revive?: boolean }) {
  const out = p.condition.endsWith(' fnt');
  const sp = p.details.split(',')[0];
  const set = setForSpecies(sp);
  const tip = useTip(() => {
    const [hp, maxhp] = p.condition.split(' ')[0].split('/').map(Number);
    return <MonCard f={fighterOfReq(p, mon)} hp={out ? { hp: 0, maxhp: maxhp || hp } : { hp, maxhp }} status={mon?.status ?? null} moves={set?.moves ?? p.moves} vs={foe} foeAttacker={foe} />;
  });
  return (
    <button {...tip} className={`swap ${p.active ? 'is-active' : ''} ${out ? 'is-out' : ''} ${revive && out && !disabled ? 'is-revive' : ''}`} disabled={disabled} onClick={onPick} aria-label={revive && out && !disabled ? `Revive ${sp}` : undefined}>
      <Sprite eager artId={set?.artId ?? set?.id ?? 0} name={set?.name ?? p.ident.slice(4)} />
      <span className="swap__hp"><i style={{ '--f': mon ? (mon.fainted ? 0 : mon.hp / mon.maxhp) : 1 } as CSSProperties} /></span>
      <span className="swap__name">{sp}</span>
    </button>
  );
}

function Actions({ req, choose, mons, foe }: { req: BattleRequest; choose: (c: string) => void; mons: SideView; foe: MonView | null }) {
  const [tera, setTera] = useState(false);
  const active = req.active?.[0];
  const forced = !!req.forceSwitch?.[0];
  const revival = isRevival(req);
  const bench = req.side.pokemon.map((p, i) => ({ p, i, mon: mons.mons.find(m => m.key === p.ident.replace(/^(p[12])[a-z]?:\s*/, '$1: ')) }));
  const me = bench.find(b => b.p.active);
  const user = me ? fighterOfReq(me.p, me.mon) : null;
  const target = fighterOfMon(foe, false);
  const teraPreview = tera && active?.canTerastallize ? active.canTerastallize as TypeName : null;
  return (
    <div className="actions">
      {!forced && active && (
        <div className="moves">
          {active.moves.map((m, i) => user && (
            <MoveButton key={m.id} m={m} index={i} off={!!m.disabled || m.pp === 0} user={user} target={target} teraPreview={teraPreview} onPick={k => choose(`move ${k + 1}${tera ? ' terastallize' : ''}`)} />
          ))}
        </div>
      )}
      <div className="actions__side">
        {!forced && active?.canTerastallize && (
          <button className={`tera ${tera ? 'is-on' : ''}`} aria-pressed={tera} onClick={() => setTera(v => !v)} style={{ '--t': TYPE_COLORS[active.canTerastallize as TypeName] ?? '#fff' } as CSSProperties}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.5 11 4 9 11 3 11 1 4Z" /></svg>
            Terastallize<small>{active.canTerastallize}</small>
          </button>
        )}
        <div className="switches" aria-label="Switch">
          {forced && <p className="actions__prompt">{revival ? 'Revival Blessing: choose a fainted Pokémon to revive' : 'Choose your next Pokémon'}</p>}
          {bench.map(({ p, i, mon }) => (
            <SwapButton key={p.ident} p={p} mon={mon} foe={target} revive={revival} disabled={switchLocked(p, req)} onPick={() => choose(`switch ${i + 1}`)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Log({ log, open, onClose }: { log: LogEntry[]; open: boolean; onClose: () => void }) {
  return (
    <aside className={`blog ${open ? 'is-open' : ''}`} aria-label="Battle log" aria-hidden={!open}>
      <header><strong>Battle log</strong><button className="iconbtn" onClick={onClose} aria-label="Close log" tabIndex={open ? 0 : -1}><Icon name="close" /></button></header>
      <ol>{log.slice(-160).map(e => <li key={e.id} className={`blog__${e.kind}`}>{e.text}</li>)}</ol>
    </aside>
  );
}

type Tone = 'crit' | 'super' | 'resist' | 'miss' | 'ko' | 'immune';
const TONES: [RegExp, Tone][] = [
  [/^A critical hit!/, 'crit'],
  [/^It's super effective!/, 'super'],
  [/^It's not very effective/, 'resist'],
  [/avoided the attack!$|^But it failed!/, 'miss'],
  [/fainted!$/, 'ko'],
  [/^It doesn't affect/, 'immune'],
];
const toneOf = (text: string): Tone | null => TONES.find(([re]) => re.test(text))?.[1] ?? null;

/** The big moments get a sound cue; the words themselves stay in the message box. */
function useMomentCues(log: LogEntry[]) {
  const seen = useRef(log.length ? log[log.length - 1].id : 0);
  useEffect(() => {
    const fresh = log.filter(e => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const tones = fresh.map(e => toneOf(e.text));
    if (tones.includes('ko')) sound.play('ko', { gain: 0.8 });
    else if (tones.includes('crit') || tones.includes('super')) sound.play('stamp', { gain: 0.5 });
    // The log array may be mutated in place, so key on its length and last id too.
  }, [log, log.length, log[log.length - 1]?.id]);
}

/**
 * The in-app battle. The controller paces simulator events; this component only renders its snapshot
 * and turns clicks into simulator choices.
 */
export function BattleArena({ controller, mineLabel, theirsLabel, onForfeit, finished, onContinue, iWon, spectating = false }: {
  controller: BattleController; mineLabel: string; theirsLabel: string; onForfeit: () => void;
  finished: boolean; onContinue: () => void; iWon: boolean | null;
  /** Watching someone else's battle: no choices, no forfeit, both sides seen from outside. */
  spectating?: boolean;
}) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [logOpen, setLogOpen] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const s = snap.state;
  const me = s.mySide; const opp = (1 - me) as 0 | 1;
  const req = s.request;
  const choose = (c: string) => controller.choose(c);
  const caption = [...s.log].reverse().find(e => e.kind !== 'turn');
  const ended = s.phase === 'ended' && !snap.busy;
  useMomentCues(s.log);
  const tone = caption ? toneOf(caption.text) : null;

  return (
    <TipLayer>
    <section className="arena" aria-label="Battle">
      <MonPlate mon={snap.active[opp]} side={s.sides[opp]} label={theirsLabel} mine={false} foe={snap.active[me]} foeKnown={!spectating} />
      <MonPlate mon={snap.active[me]} side={s.sides[me]} label={mineLabel} mine known={!spectating} foe={snap.active[opp]} />
      <div className="arena__bar">
        <span className="arena__turn">{s.phase === 'preview' ? 'Team preview' : `Turn ${s.turn || 1}`}</span>
        <Timer deadline={snap.deadline} active={snap.canChoose} />
        {s.weather && <span className="arena__chip">{s.weather.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>}
        {s.sides[me].conditions.map(c => <span key={'m' + c} className="arena__chip arena__chip--mine">{c}</span>)}
        {s.sides[opp].conditions.map(c => <span key={'o' + c} className="arena__chip">{c} (foe)</span>)}
        <span className="arena__spacer" />
        <button className="iconbtn iconbtn--text" onClick={() => setLogOpen(v => !v)} aria-expanded={logOpen}><Icon name="history" />Log</button>
        {!ended && !spectating && (confirmForfeit
          ? <button className="btn btn--sm" onClick={() => { onForfeit(); setConfirmForfeit(false); }}>Confirm forfeit</button>
          : <button className="iconbtn iconbtn--text" onClick={() => setConfirmForfeit(true)}><Icon name="leave" />Forfeit</button>)}
      </div>
      <div className="arena__dock panel">
        {ended ? (
          <div className="arena__end">
            <p className="eyebrow"><span className="jp">{spectating ? '決着' : iWon ? '勝利' : '敗北'}</span> Turn {s.turn}</p>
            <h3 className="dock__title dock__title--big">{spectating ? (s.winner ? `${s.winner} wins` : 'Draw') : iWon === null ? 'Draw' : iWon ? 'You win!' : `${s.winner} wins`}</h3>
            {finished && <button className="btn btn--primary btn--xl" onClick={onContinue}><Icon name="arrow" />Continue</button>}
          </div>
        ) : spectating ? (
          <p className={`actions__wait ${snap.busy ? `msg ${tone ? `msg--${tone}` : ''}` : ''}`} key={snap.busy ? caption?.id : s.phase} aria-live="polite">
            {s.phase === 'idle' ? 'Preparing the arena…' : snap.busy ? caption?.text ?? '…'
              : s.phase === 'preview' ? `${mineLabel} and ${theirsLabel} are choosing their leads…` : `${mineLabel} and ${theirsLabel} are choosing…`}
          </p>
        ) : !req || s.phase === 'idle' ? (
          <p className="actions__wait">Preparing the arena…</p>
        ) : snap.busy ? (
          <p className={`actions__wait msg ${tone ? `msg--${tone}` : ''}`} key={caption?.id} aria-live="polite">{caption?.text ?? '…'}</p>
        ) : req.wait || snap.choiceSent ? (
          <p className="actions__wait">{snap.choiceSent ? `Locked in. Waiting for ${theirsLabel}…` : `Waiting for ${theirsLabel}…`}</p>
        ) : req.teamPreview ? (
          <TeamPreview req={req} theirs={s.sides[opp]} choose={choose} />
        ) : (
          <>
            {caption && s.turn > 1 && <p className={`msg msg--last ${tone ? `msg--${tone}` : ''}`}>{caption.text}</p>}
            <Actions req={req} choose={choose} mons={s.sides[me]} foe={snap.active[opp]} />
          </>
        )}
      </div>
      <Log log={s.log} open={logOpen} onClose={() => setLogOpen(false)} />
    </section>
    </TipLayer>
  );
}
