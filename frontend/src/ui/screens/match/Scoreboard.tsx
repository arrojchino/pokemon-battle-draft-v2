import type { PublicRoom } from '@shared';
import { characterById } from '../../../characters/roster.js';
import { partnerStyle } from '../LobbyParts.js';
import type { MatchModel } from './model.js';

const PHASE_LABEL: Record<PublicRoom['phase'], string> = {
  calls: 'Coin toss', spin: 'Toss decided', pick: 'Draft', battle: 'Battle', between: 'Interval', complete: 'Series complete',
};

function Plate({ side, name, partner, wins, target, online, you, active }: { side: 'l' | 'r'; name: string; partner: string | null; wins: number; target: number; online: boolean | null; you: boolean; active: boolean }) {
  const c = characterById(partner as never);
  return (
    <div className={`plate plate--${side} ${active ? 'is-active' : ''}`} style={partnerStyle(c?.id)}>
      <div className="plate__portrait">{c ? <img src={c.portrait} alt="" /> : <span>?</span>}</div>
      <div className="plate__text">
        <strong>{name}{you && <em>You</em>}</strong>
        <small>{c ? c.name : 'Open seat'}{online !== null && <span className={`dot ${online ? 'dot--on' : ''}`} title={online ? 'Connected' : 'Disconnected'} />}</small>
      </div>
      <div className="plate__pips" aria-label={`${wins} of ${target} wins`}>{Array.from({ length: target }, (_, i) => <i key={i} className={i < wins ? 'is-won' : ''} />)}</div>
    </div>
  );
}

/** `watch`: a spectator's scoreboard (nobody is "you"; both trainers' links shown). */
export function Scoreboard({ room, m, watch = false }: { room: PublicRoom; m: MatchModel; watch?: boolean }) {
  const left = 0, right = 1;
  const partnerOf = (s: 0 | 1) => (s === m.me ? m.mine : m.theirs);
  const onlineOf = (s: 0 | 1) => (watch ? room.players[s]?.connected ?? null : s === m.me ? true : room.players[s] ? m.oppConnected : null);
  return (
    <header className="scoreboard" aria-label="Series score">
      <Plate side="l" name={m.names[left]} partner={partnerOf(left)} wins={room.wins[left]} target={m.target} online={onlineOf(left)} you={!watch && m.me === left} active={room.tossWinner === left && room.phase === 'pick'} />
      <div className="scoreboard__mid">
        <span className="scoreboard__phase">{PHASE_LABEL[room.phase]}</span>
        <strong className="scoreboard__score"><b>{room.wins[0]}</b><i>–</i><b>{room.wins[1]}</b></strong>
        <span className="scoreboard__game">Game {m.gameNo} · Best of {room.bestOf}</span>
      </div>
      <Plate side="r" name={room.players[right]?.name ?? 'Waiting…'} partner={partnerOf(right)} wins={room.wins[right]} target={m.target} online={onlineOf(right)} you={!watch && m.me === right} active={room.tossWinner === right && room.phase === 'pick'} />
    </header>
  );
}
