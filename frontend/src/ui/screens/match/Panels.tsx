import { useState, type CSSProperties } from 'react';
import type { CoinSide, GameAction, Pokemon, PublicRoom } from '@shared';
import { characterById } from '../../../characters/roster.js';
import { CopyButton, Icon } from '../../primitives.js';
import { PokemonCard, PokemonChip, TeamSummary } from '../../pokemon.js';
import type { MatchModel } from './model.js';

type Act = (a: GameAction) => void;

export function WaitingPanel({ room }: { room: PublicRoom }) {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.code)}${new URLSearchParams(location.search).get('ws') ? `&ws=${encodeURIComponent(new URLSearchParams(location.search).get('ws')!)}` : ''}`;
  return (
    <section className="dock panel dock--wait">
      <p className="eyebrow"><span className="jp">待機中</span> Waiting for a rival</p>
      <div className="code" aria-label="Room code">{room.code.length > 12 ? room.code.slice(0, 8) + '…' : room.code}</div>
      <p className="dock__hint">Share the link. Your rival picks a partner and joins this room.</p>
      <div className="dock__row">
        <CopyButton className="btn btn--primary" label="Copy invite link" getText={() => link} />
        <CopyButton className="btn" label="Copy code" getText={() => room.code} />
      </div>
    </section>
  );
}

export function TossPanel({ room, m, act, flipping }: { room: PublicRoom; m: MatchModel; act: Act; flipping: boolean }) {
  const mine = room.calls[m.me]; const theirs = room.calls[m.opp];
  const both = !!mine && !!theirs;
  const side = (s: CoinSide) => (
    <button
      className={`call call--${s} ${mine === s ? 'is-on' : ''}`}
      disabled={theirs === s || flipping}
      aria-pressed={mine === s}
      onClick={() => act({ type: 'call', side: s })}
    >
      <Icon name={s === 'heads' ? 'sun' : 'moon'} size={28} />
      <span>{s === 'heads' ? 'Heads' : 'Tails'}</span>
      <small>{theirs === s ? `${m.oppName} called it` : s === 'heads' ? 'Sun face' : 'Moon face'}</small>
    </button>
  );
  return (
    <section className="dock panel">
      <p className="eyebrow"><span className="jp">コイントス</span> Game {m.gameNo} · Call the coin</p>
      <p className="dock__hint">The toss winner chooses which of two dealt teams to take. Calls must be opposite.</p>
      <div className="calls">{side('heads')}{side('tails')}</div>
      <div className="dock__row">
        <span className="dock__status">{!mine ? 'Make your call' : !theirs ? `Waiting for ${m.oppName} to call` : 'Both calls locked'}</span>
        <button className="btn btn--primary" disabled={!both || flipping} onClick={() => act({ type: 'flip' })}><Icon name="spark" />Flip the coin</button>
      </div>
    </section>
  );
}

export function TossResultPanel({ room, m, act, revealed }: { room: PublicRoom; m: MatchModel; act: Act; revealed: boolean }) {
  if (!revealed) return <section className="dock panel dock--quiet"><p className="eyebrow">The coin is in the air…</p></section>;
  const winnerName = m.names[room.tossWinner ?? 0];
  return (
    <section className="dock panel dock--result">
      <p className="eyebrow"><span className="jp">結果</span> {room.result === 'heads' ? 'Heads' : 'Tails'}</p>
      <h3 className="dock__title">{m.iWonToss ? 'You won the toss' : `${winnerName} won the toss`}</h3>
      <p className="dock__hint">{m.iWonToss ? 'Deal the teams, then pick the one you want.' : 'Deal the teams. Your rival picks first; you get the other six.'}</p>
      <button className="btn btn--primary btn--xl" onClick={() => act({ type: 'spin' })}><Icon name="swords" />Deal two teams</button>
    </section>
  );
}

export function DraftBoard({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const [hover, setHover] = useState<0 | 1 | null>(null);
  const canPick = room.tossWinner === m.me;
  const accent = characterById(m.mine)?.accent;
  if (!room.candidates) return null;
  return (
    <section className="draft" aria-label="Team draft">
      <header className="draft__head">
        <p className="eyebrow"><span className="jp">ドラフト</span> {canPick ? 'You won the toss · choose your six' : `${m.oppName} is choosing`}</p>
        <p className="draft__sub">{canPick ? 'The other team goes to your rival. Sets are fixed: what you see is what you bring to Showdown.' : 'Whichever team they leave becomes yours.'}</p>
      </header>
      <div className="draft__cols">
        {room.candidates.map((team, i) => (
          <div key={i} className={`draft__col ${hover === i ? 'is-hover' : ''}`} onMouseEnter={() => setHover(i as 0 | 1)} onMouseLeave={() => setHover(null)}>
            <div className="draft__colhead">
              <h3>Team {i ? 'B' : 'A'}</h3>
              <TeamSummary team={team} />
            </div>
            <div className="draft__grid">{team.map((p, k) => <PokemonCard key={p.name} p={p} index={k + i * 6} highlight={hover === i ? accent : undefined} compact />)}</div>
            {canPick && <button className="btn btn--primary btn--xl" onClick={() => act({ type: 'pick', team: i as 0 | 1 })}><Icon name="check" />Take Team {i ? 'B' : 'A'}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function TeamStrip({ label, team, accent }: { label: string; team: Pokemon[]; accent?: string }) {
  return (
    <div className="strip" style={{ '--accent': accent } as CSSProperties}>
      <span className="strip__label">{label}</span>
      <div className="strip__row">{team.map(p => <PokemonChip key={p.name} p={p} />)}</div>
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
    <section className="dock panel dock--result">
      <p className="eyebrow"><span className="jp">{iWon ? '勝利' : '敗北'}</span> Game {last?.game} result</p>
      <h3 className="dock__title">{iWon ? 'You took the game' : `${m.names[last?.winner ?? 0]} took the game`}</h3>
      <p className="dock__hint">Series {room.wins[0]}–{room.wins[1]}. First to {m.target} wins.</p>
      <button className="btn btn--primary btn--xl" onClick={() => act({ type: 'next' })}><Icon name="arrow" />Next game</button>
    </section>
  );
}

export function CompletePanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const iWon = m.seriesWinner === m.me;
  return (
    <section className="dock panel dock--result dock--victory">
      <p className="eyebrow"><span className="jp">シリーズ終了</span> Series complete · {room.wins[0]}–{room.wins[1]}</p>
      <h3 className="dock__title dock__title--big">{iWon ? 'Victory' : `${m.names[m.seriesWinner ?? 0]} wins the series`}</h3>
      <div className="dock__row">
        <button className="btn btn--primary" onClick={() => act({ type: 'reset', bestOf: 3 })}><Icon name="spark" />Rematch · Best of 3</button>
        <button className="btn" onClick={() => act({ type: 'reset', bestOf: 5 })}>Best of 5</button>
      </div>
    </section>
  );
}
