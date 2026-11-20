import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { moveInfo, type TypeName } from '@shared';
import type { BattleController } from '../../../battle/controller.js';
import { setFor as setForSpecies, type BattleRequest, type LogEntry, type MonView, type SideView } from '../../../battle/model.js';
import { Icon } from '../../primitives.js';
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

function MonPlate({ mon, side, label, mine }: { mon: MonView | null; side: SideView; label: string; mine: boolean }) {
  if (!mon) return null;
  const types: TypeName[] = mon.tera ? [mon.tera] : mon.set?.types ?? [];
  const boosts = Object.entries(mon.boosts).filter(([, v]) => v);
  return (
    <section className={`plate2 ${mine ? 'plate2--mine' : 'plate2--theirs'}`} aria-label={`${label} active Pokémon`} style={{ '--t1': TYPE_COLORS[types[0] ?? 'Normal'] } as CSSProperties}>
      <header>
        <strong>{mon.species}</strong>
        <span className="plate2__lv">Lv100</span>
        {mon.status && <span className={`stat-chip stat-chip--${mon.status}`}>{STATUS_LABEL[mon.status] ?? mon.status}</span>}
        {mon.tera && <TypeBadge type={mon.tera} tera size="sm" />}
      </header>
      <HpBar mon={mon} exact />
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
  return <span className={`timer ${left <= 20 ? 'is-low' : ''}`} title="When time runs out, the default move is played for you"><Icon name="history" size={14} />{left}s</span>;
}

function TeamPreview({ req, theirs, choose }: { req: BattleRequest; theirs: SideView; choose: (c: string) => void }) {
  return (
    <div className="preview">
      <p className="eyebrow"><span className="jp">先発</span> Choose your lead</p>
      <div className="preview__theirs" aria-label="Opponent team">
        {theirs.mons.map(m => <Sprite eager key={m.key} artId={m.set?.artId ?? m.set?.id ?? 0} name={m.species} />)}
      </div>
      <div className="preview__mine">
        {req.side.pokemon.map((p, i) => {
          const sp = p.details.split(',')[0];
          const set = setForSpecies(sp);
          const order = [i + 1, ...[1, 2, 3, 4, 5, 6].filter(n => n !== i + 1)].join('');
          return (
            <button key={p.ident} className="lead" onClick={() => choose(`team ${order}`)} style={{ '--t1': TYPE_COLORS[set?.types[0] ?? 'Normal'] } as CSSProperties}>
              <Sprite eager artId={set?.artId ?? set?.id ?? 0} name={set?.name ?? p.ident.slice(4)} />
              <strong>{sp}</strong>
              <span>{set?.types.join(' / ')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Actions({ req, choose, mons }: { req: BattleRequest; choose: (c: string) => void; mons: SideView }) {
  const [tera, setTera] = useState(false);
  const active = req.active?.[0];
  const forced = !!req.forceSwitch?.[0];
  const trapped = !!active?.trapped;
  const bench = req.side.pokemon.map((p, i) => ({ p, i, mon: mons.mons.find(m => m.key === p.ident.replace(/^(p[12])[a-z]?:\s*/, '$1: ')) }));
  return (
    <div className="actions">
      {!forced && active && (
        <div className="moves">
          {active.moves.map((m, i) => {
            const info = moveInfo(m.move);
            const off = !!m.disabled || m.pp === 0;
            return (
              <button key={m.id} className="move" disabled={off} onClick={() => choose(`move ${i + 1}${tera ? ' terastallize' : ''}`)} style={{ '--t': TYPE_COLORS[info?.type ?? 'Normal'] } as CSSProperties} title={info?.desc}>
                <strong>{m.move}</strong>
                <span className="move__meta">
                  <em>{info?.type ?? '???'}</em>
                  <em>{info?.category ?? ''}{info && info.power ? ` · ${info.power}` : ''}{info && info.accuracy ? ` · ${info.accuracy}%` : ''}</em>
                  {m.pp !== undefined && <em className="move__pp">{m.pp}/{m.maxpp}</em>}
                </span>
              </button>
            );
          })}
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
          {forced && <p className="actions__prompt">Choose your next Pokémon</p>}
          {bench.map(({ p, i, mon }) => {
            const out = p.condition.endsWith(' fnt');
            const sp = p.details.split(',')[0];
            const set = setForSpecies(sp);
            const disabled = p.active || out || (trapped && !forced);
            return (
              <button key={p.ident} className={`swap ${p.active ? 'is-active' : ''} ${out ? 'is-out' : ''}`} disabled={disabled} onClick={() => choose(`switch ${i + 1}`)} title={`${sp} · ${p.condition}`}>
                <Sprite eager artId={set?.artId ?? set?.id ?? 0} name={set?.name ?? p.ident.slice(4)} />
                <span className="swap__hp"><i style={{ '--f': mon ? (mon.fainted ? 0 : mon.hp / mon.maxhp) : 1 } as CSSProperties} /></span>
                <span className="swap__name">{sp}</span>
              </button>
            );
          })}
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

/**
 * The in-app battle. The controller paces simulator events; this component only renders its snapshot
 * and turns clicks into simulator choices.
 */
export function BattleArena({ controller, mineLabel, theirsLabel, onForfeit, finished, onContinue, iWon }: {
  controller: BattleController; mineLabel: string; theirsLabel: string; onForfeit: () => void;
  finished: boolean; onContinue: () => void; iWon: boolean | null;
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

  return (
    <section className="arena" aria-label="Battle">
      <MonPlate mon={snap.active[opp]} side={s.sides[opp]} label={theirsLabel} mine={false} />
      <MonPlate mon={snap.active[me]} side={s.sides[me]} label={mineLabel} mine />
      {caption && !ended && <p className="caption" key={caption.id} aria-live="polite">{caption.text}</p>}
      <div className="arena__bar">
        <span className="arena__turn">{s.phase === 'preview' ? 'Team preview' : `Turn ${s.turn || 1}`}</span>
        <Timer deadline={snap.deadline} active={snap.canChoose} />
        {s.weather && <span className="arena__chip">{s.weather.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>}
        {s.sides[me].conditions.map(c => <span key={'m' + c} className="arena__chip arena__chip--mine">{c}</span>)}
        {s.sides[opp].conditions.map(c => <span key={'o' + c} className="arena__chip">{c} (foe)</span>)}
        <span className="arena__spacer" />
        <button className="iconbtn iconbtn--text" onClick={() => setLogOpen(v => !v)} aria-expanded={logOpen}><Icon name="history" />Log</button>
        {!ended && (confirmForfeit
          ? <button className="btn btn--sm" onClick={() => { onForfeit(); setConfirmForfeit(false); }}>Confirm forfeit</button>
          : <button className="iconbtn iconbtn--text" onClick={() => setConfirmForfeit(true)}><Icon name="leave" />Forfeit</button>)}
      </div>
      <div className="arena__dock panel">
        {ended ? (
          <div className="arena__end">
            <p className="eyebrow"><span className="jp">{iWon ? '勝利' : '敗北'}</span> Turn {s.turn}</p>
            <h3 className="dock__title dock__title--big">{iWon === null ? 'Draw' : iWon ? 'You win!' : `${s.winner} wins`}</h3>
            {finished && <button className="btn btn--primary btn--xl" onClick={onContinue}><Icon name="arrow" />Continue</button>}
          </div>
        ) : !req || s.phase === 'idle' ? (
          <p className="actions__wait">Preparing the arena…</p>
        ) : snap.busy ? (
          <p className="actions__wait">{caption?.text ?? '…'}</p>
        ) : req.wait || snap.choiceSent ? (
          <p className="actions__wait">{snap.choiceSent ? `Locked in. Waiting for ${theirsLabel}…` : `Waiting for ${theirsLabel}…`}</p>
        ) : req.teamPreview ? (
          <TeamPreview req={req} theirs={s.sides[opp]} choose={choose} />
        ) : (
          <Actions req={req} choose={choose} mons={s.sides[me]} />
        )}
      </div>
      <Log log={s.log} open={logOpen} onClose={() => setLogOpen(false)} />
    </section>
  );
}
