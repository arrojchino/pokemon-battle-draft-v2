import { useState, type CSSProperties } from 'react';
import type { GameAction, Pokemon, PublicRoom, RivalPreview } from '@shared';
import { useReducedMotion } from '../../../app/settings.js';
import { Icon } from '../../primitives.js';
import { PokemonCard, PokemonChip, Sprite, TeamSummary } from '../../pokemon.js';
import type { MatchModel } from './model.js';

type Act = (a: GameAction) => void;

/**
 * The draft. Only the toss winner receives the two dealt teams; the rival sees them face down and never
 * learns which six were taken (in battle they only see what the other side reveals).
 */
export function DraftBoard({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const [hover, setHover] = useState<0 | 1 | null>(null);
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const reduced = useReducedMotion();
  const canPick = room.tossWinner === m.me && !!room.candidates;
  const take = (i: 0 | 1) => { if (chosen !== null) return; setChosen(i); window.setTimeout(() => act({ type: 'pick', team: i }), reduced ? 0 : 650); };

  if (!room.candidates) {
    return (
      <section className="draft draft--sealed" aria-label="Team draft">
        <header className="draft__head">
          <p className="eyebrow"><span className="jp">ドラフト</span> {m.oppName} is choosing</p>
          <p className="draft__sub">Two teams were dealt face down. {m.oppName} takes one and the other six are yours. Their pick stays hidden; in battle you only see what their Pokémon reveal.</p>
        </header>
        <div className="draft__cols">
          {[0, 1].map(i => (
            <div key={i} className="draft__col draft__col--sealed">
              <div className="draft__colhead"><h3>Team {i ? 'B' : 'A'}</h3><span className="badge">Face down</span></div>
              <div className="draft__grid">{Array.from({ length: 6 }, (_, k) => <div key={k} className="cardback" style={{ '--i': k + i * 6 } as CSSProperties} aria-hidden="true"><span className="cardback__ball" /></div>)}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={`draft ${chosen !== null ? 'has-choice' : ''}`} aria-label="Team draft">
      <header className="draft__head">
        <p className="eyebrow"><span className="jp">ドラフト</span> {canPick ? 'You won the toss · choose your six' : `${m.oppName} is choosing`}</p>
        <p className="draft__sub">The other team goes to {m.oppName}, who cannot see these cards or your choice. Sets are fixed: what you see is what you battle with.</p>
      </header>
      <div className="draft__cols">
        {room.candidates.map((team, i) => (
          <div key={i} className={`draft__col ${hover === i ? 'is-hover' : ''} ${chosen === i ? 'is-chosen' : chosen !== null ? 'is-passed' : ''}`} onMouseEnter={() => setHover(i as 0 | 1)} onMouseLeave={() => setHover(null)}>
            <div className="draft__colhead">
              <h3>Team {i ? 'B' : 'A'}</h3>
              <TeamSummary team={team} />
            </div>
            <div className="draft__grid">{team.map((p, k) => <PokemonCard key={p.name} p={p} index={k + i * 6} compact />)}</div>
            {canPick && <button className="btn btn--primary btn--xl" disabled={chosen !== null} onClick={() => take(i as 0 | 1)}><Icon name="check" />{chosen === i ? 'Taken' : `Take Team ${i ? 'B' : 'A'}`}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function TeamStrip({ label, team, partner }: { label: string; team: Pokemon[]; partner?: string }) {
  return (
    <div className="strip" style={{ '--partner': partner } as CSSProperties}>
      <span className="strip__label">{label}</span>
      <div className="strip__row">{team.map(p => <PokemonChip key={p.name} p={p} />)}</div>
    </div>
  );
}

/** The rival's six as Team Preview shows them: species and types, sets hidden. */
export function RivalStrip({ label, rival, partner }: { label: string; rival: RivalPreview[]; partner?: string }) {
  return (
    <div className="strip strip--rival" style={{ '--partner': partner } as CSSProperties}>
      <span className="strip__label">{label}<em>Sets hidden</em></span>
      <div className="strip__row">
        {rival.map(p => (
          <div key={p.name} className="pchip pchip--rival" title={`${p.name} · ${p.types.join(' / ')}`}>
            <Sprite artId={p.artId ?? p.id} name={p.name} className="pchip__img" />
            <span className="pchip__name">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ResultReport({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const [confirm, setConfirm] = useState<0 | 1 | null>(null);
  return (
    <div className="report">
      <span className="report__q">Who won game {m.gameNo}?</span>
      {[0, 1].map(s => (
        confirm === s
          ? <button key={s} className="btn btn--primary" onClick={() => { act({ type: 'result', winner: s as 0 | 1 }); setConfirm(null); }}><Icon name="check" />Confirm {m.names[s]}</button>
          : <button key={s} className="btn" onClick={() => setConfirm(s as 0 | 1)} disabled={room.phase !== 'battle'}>{s === m.me ? 'I won' : `${m.names[s]} won`}</button>
      ))}
    </div>
  );
}

export function IntervalPanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const last = room.history[room.history.length - 1];
  const iWon = last?.winner === m.me;
  return (
    <section className={`dock panel dock--result ${iWon ? 'dock--win' : ''}`}>
      <p className="eyebrow"><span className="jp">{iWon ? '勝利' : '敗北'}</span> Game {last?.game} result</p>
      <h3 className={`dock__title ${iWon ? 'dock__title--gold' : ''}`}>{iWon ? 'You took the game' : `${m.names[last?.winner ?? 0]} took the game`}</h3>
      <p className="dock__hint">Series {room.wins[0]}–{room.wins[1]}. First to {m.target} wins. {iWon ? 'You call the next coin.' : `${m.names[last?.winner ?? 0]} calls the next coin.`}</p>
      <button className="btn btn--primary btn--xl" onClick={() => act({ type: 'next' })}><Icon name="arrow" />Next game</button>
    </section>
  );
}

export function CompletePanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const iWon = m.seriesWinner === m.me;
  return (
    <section className={`dock panel dock--result dock--victory ${iWon ? 'dock--win' : ''}`}>
      <p className="eyebrow"><span className="jp">シリーズ終了</span> Series complete · {room.wins[0]}–{room.wins[1]}</p>
      <h3 className={`dock__title dock__title--big ${iWon ? 'dock__title--gold' : ''}`}>{iWon ? 'Victory' : `${m.names[m.seriesWinner ?? 0]} wins the series`}</h3>
      <div className="dock__row">
        <button className="btn btn--gold" onClick={() => act({ type: 'reset', bestOf: 3 })}><Icon name="spark" />Rematch · Best of 3</button>
        <button className="btn" onClick={() => act({ type: 'reset', bestOf: 5 })}>Best of 5</button>
      </div>
    </section>
  );
}
