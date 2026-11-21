import type { CoinSide, GameAction, PublicRoom } from '@shared';
import { inviteLink } from '../../../net/session.js';
import { CopyButton, Icon, Spinner } from '../../primitives.js';
import { MODE_LABEL, PartnerAvatar, partnerStyle } from '../LobbyParts.js';
import type { MatchModel } from './model.js';

type Act = (a: GameAction) => void;
const shortCode = (code: string) => (code.length > 12 ? code.slice(0, 8) + '…' : code);

/** Host's waiting room: who is here, the open seat, the lobby settings and the invite. */
export function WaitingPanel({ room, m }: { room: PublicRoom; m: MatchModel }) {
  return (
    <section className="dock panel wait">
      <p className="eyebrow"><span className="jp">待機中</span> Waiting for a rival · {room.visibility === 'public' ? 'Public lobby' : 'Private room'}</p>
      <div className="wait__seats">
        <div className="seat" style={partnerStyle(m.mine)}>
          <PartnerAvatar id={m.mine} />
          <div className="seat__text"><strong>{m.myName}</strong><small><Icon name="crown" size={12} />Host</small></div>
          <span className="badge badge--ok">Ready</span>
        </div>
        <span className="wait__vs" aria-hidden="true">VS</span>
        <div className="seat seat--open">
          <span className="seat__ring"><Spinner size={22} label="Waiting for a rival" /></span>
          <div className="seat__text"><strong>Open seat</strong><small>Share the code or the link</small></div>
        </div>
      </div>
      <div className="code" aria-label="Room code" title={room.code}>{shortCode(room.code)}</div>
      <p className="dock__hint">Best of {room.bestOf} · {MODE_LABEL[room.mode]}. Your rival picks a partner and joins with this code.</p>
      <div className="dock__row">
        <CopyButton className="btn btn--primary" label="Copy invite link" getText={() => inviteLink(room.code)} />
        <CopyButton className="btn" label="Copy code" getText={() => room.code} />
      </div>
    </section>
  );
}

/**
 * One player calls each coin: picked at random for the first game of a series, then the winner of the
 * previous game. The call flips the coin at once.
 */
export function TossPanel({ room, m, act, flipping }: { room: PublicRoom; m: MatchModel; act: Act; flipping: boolean }) {
  const caller = room.caller;
  const callerName = caller === null ? 'Your rival' : m.names[caller];
  const why = room.games === 0 ? 'was picked at random to call' : 'won the last game and calls';
  const side = (s: CoinSide) => (
    <button key={s} className={`call call--${s}`} disabled={flipping} onClick={() => act({ type: 'call', side: s })}>
      <Icon name={s === 'heads' ? 'sun' : 'moon'} size={30} />
      <span>{s === 'heads' ? 'Heads' : 'Tails'}</span>
      <small>{s === 'heads' ? 'Sun face' : 'Moon face'}</small>
    </button>
  );
  return (
    <section className="dock panel toss">
      <p className="eyebrow"><span className="jp">コイントス</span> Game {m.gameNo} · Coin toss</p>
      {m.iCall ? <>
        <h3 className="dock__title">Your call</h3>
        <p className="dock__hint">You {why === 'was picked at random to call' ? 'were picked at random' : 'won the last game'}. Call it and the coin flips; the toss winner takes their pick of two dealt teams.</p>
        <div className="calls">{side('heads')}{side('tails')}</div>
      </> : <>
        <h3 className="dock__title">{callerName} calls the coin</h3>
        <p className="dock__hint">{callerName} {why} it. The coin flips the moment they call.</p>
        <div className="toss__wait"><Spinner size={22} label="Waiting for the call" /><span>Waiting for {callerName}…</span></div>
      </>}
    </section>
  );
}

export function TossResultPanel({ room, m, act, revealed }: { room: PublicRoom; m: MatchModel; act: Act; revealed: boolean }) {
  if (!revealed) return <section className="dock panel dock--quiet"><p className="eyebrow">The coin is in the air…</p></section>;
  const winnerName = m.names[room.tossWinner ?? 0];
  const called = room.caller !== null ? room.calls[room.caller] : null;
  const callerName = room.caller !== null ? (room.caller === m.me ? 'You' : m.names[room.caller]) : '';
  return (
    <section className="dock panel dock--result toss-result">
      <p className="eyebrow"><span className="jp">結果</span> {called ? `${callerName} called ${called} · ` : ''}It landed {room.result}</p>
      <h3 className="dock__title dock__title--gold">{m.iWonToss ? 'You won the toss' : `${winnerName} won the toss`}</h3>
      <p className="dock__hint">{m.iWonToss ? 'Dealing two teams: take the six you want.' : `${winnerName} picks one of two teams dealt face down; you get the other six. Their choice stays hidden.`}</p>
      <button className="btn btn--gold btn--xl" onClick={() => act({ type: 'spin' })}><Icon name="swords" />{m.iWonToss ? 'Deal now' : 'Deal two teams'}</button>
    </section>
  );
}
