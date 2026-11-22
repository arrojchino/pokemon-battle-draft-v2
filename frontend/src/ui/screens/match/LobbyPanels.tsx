import type { CoinSide, GameAction, PublicRoom } from '@shared';
import { inviteLink } from '../../../net/session.js';
import { CopyButton, Icon, Spinner } from '../../primitives.js';
import { MODE_LABEL, PartnerAvatar, partnerStyle } from '../LobbyParts.js';
import { sideKey, type MatchModel } from './model.js';
import { useT } from '../../../i18n/index.js';

type Act = (a: GameAction) => void;
const shortCode = (code: string) => (code.length > 12 ? code.slice(0, 8) + '…' : code);

/** Host's waiting room: who is here, the open seat, the lobby settings and the invite. */
export function WaitingPanel({ room, m }: { room: PublicRoom; m: MatchModel }) {
  const t = useT();
  return (
    <section className="dock panel wait">
      <p className="eyebrow">{t('lobby.waitingRival')} · {t(room.visibility === 'public' ? 'lobby.publicLobby' : 'lobby.privateRoom')}</p>
      <div className="wait__seats">
        <div className="seat" style={partnerStyle(m.mine)}>
          <PartnerAvatar id={m.mine} />
          <div className="seat__text"><strong>{m.myName}</strong><small><Icon name="crown" size={12} />{t('lobby.host')}</small></div>
          <span className="badge badge--ok">{t('lobby.ready')}</span>
        </div>
        <span className="wait__vs" aria-hidden="true">VS</span>
        <div className="seat seat--open">
          <span className="seat__ring"><Spinner size={22} label={t('lobby.waitingRival')} /></span>
          <div className="seat__text"><strong>{t('lobby.openSeat')}</strong><small>{t('lobby.shareHint')}</small></div>
        </div>
      </div>
      <div className="code" aria-label={t('lobby.roomCode')} title={room.code}>{shortCode(room.code)}</div>
      <p className="dock__hint">{t('match.bestOf', { n: room.bestOf })} · {t(MODE_LABEL[room.mode])}. {t('lobby.rivalJoinsHint')}</p>
      <div className="dock__row">
        <CopyButton className="btn btn--primary" label={t('lobby.copyInvite')} getText={() => inviteLink(room.code)} />
        <CopyButton className="btn" label={t('lobby.copyCode')} getText={() => room.code} />
      </div>
    </section>
  );
}

/**
 * One player calls each coin: picked at random for the first game of a series, then the winner of the
 * previous game. The call flips the coin at once.
 */
export function TossPanel({ room, m, act, flipping }: { room: PublicRoom; m: MatchModel; act: Act; flipping: boolean }) {
  const t = useT();
  const caller = room.caller;
  const callerName = caller === null ? t('lobby.yourRival') : m.names[caller];
  const random = room.games === 0;
  const side = (s: CoinSide) => (
    <button key={s} className={`call call--${s}`} disabled={flipping} onClick={() => act({ type: 'call', side: s })}>
      <Icon name={s === 'heads' ? 'sun' : 'moon'} size={30} />
      <span>{t(s === 'heads' ? 'lobby.heads' : 'lobby.tails')}</span>
      <small>{t(s === 'heads' ? 'lobby.sunFace' : 'lobby.moonFace')}</small>
    </button>
  );
  return (
    <section className="dock panel toss">
      <p className="eyebrow">{t('match.game', { n: m.gameNo })} · {t('score.phase.calls')}</p>
      {m.iCall ? <>
        <h3 className="dock__title">{t('lobby.yourCall')}</h3>
        <p className="dock__hint">{t(random ? 'lobby.youRandom' : 'lobby.youWonLast')} {t('lobby.callHint')}</p>
        <div className="calls">{side('heads')}{side('tails')}</div>
      </> : <>
        <h3 className="dock__title">{t('lobby.callsCoin', { name: callerName })}</h3>
        <p className="dock__hint">{t(random ? 'lobby.theyRandom' : 'lobby.theyWonLast', { name: callerName })} {t('lobby.flipsOnCall')}</p>
        <div className="toss__wait"><Spinner size={22} label={t('lobby.waitingCall')} /><span>{t('lobby.waitingFor', { name: callerName })}</span></div>
      </>}
    </section>
  );
}

export function TossResultPanel({ room, m, act, revealed }: { room: PublicRoom; m: MatchModel; act: Act; revealed: boolean }) {
  const t = useT();
  if (!revealed) return <section className="dock panel dock--quiet"><p className="eyebrow">{t('lobby.coinInAir')}</p></section>;
  const winnerName = m.names[room.tossWinner ?? 0];
  const called = room.caller !== null ? room.calls[room.caller] : null;
  const callerName = room.caller !== null ? m.names[room.caller] : '';
  return (
    <section className="dock panel dock--result toss-result">
      <p className="eyebrow">{called ? `${t(room.caller === m.me ? 'lobby.youCalled' : 'lobby.nameCalled', { name: callerName, side: t(sideKey(called)) })} · ` : ''}{t('lobby.landed', { side: room.result ? t(sideKey(room.result)) : '' })}</p>
      <h3 className="dock__title dock__title--gold">{m.iWonToss ? t('lobby.youWonToss') : t('match.wonToss', { name: winnerName })}</h3>
      <p className="dock__hint">{m.iWonToss ? t('lobby.dealingHint') : t('lobby.theyPickHint', { name: winnerName })}</p>
      <button className="btn btn--gold btn--xl" onClick={() => act({ type: 'spin' })}><Icon name="swords" />{t(m.iWonToss ? 'lobby.dealNow' : 'lobby.dealTwo')}</button>
    </section>
  );
}
