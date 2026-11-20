import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameAction, PublicRoom, Seat } from '@shared';
import { characterById } from '../../characters/roster.js';
import { useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import type { Transport } from '../../net/types.js';
import type { Layout } from '../../engine/World.js';
import { ErrorBoundary } from '../../app/ErrorBoundary.js';
import { CopyButton, Icon, toast } from '../primitives.js';
import { matchModel } from './match/model.js';
import { Scoreboard } from './match/Scoreboard.js';
import { CompletePanel, DraftBoard, IntervalPanel, TossPanel, TossResultPanel, WaitingPanel } from './match/Panels.js';
import { BattlePanel } from './match/BattlePanel.js';
import { HistoryDrawer } from './match/HistoryDrawer.js';

/**
 * The match. Authoritative state comes from the transport; this component maps it onto the stage
 * (camera, partners, coin) and onto the phase panels, and turns state transitions into reactions.
 */
export function MatchScreen({ room, seat, transport, link }: { room: PublicRoom; seat: Seat; transport: Transport; link: string }) {
  const s = useSettings();
  const { world, status } = useWorld();
  const m = useMemo(() => matchModel(room, seat, s.partner), [room, seat, s.partner]);
  const act = (a: GameAction) => transport.act(a);
  const [history, setHistory] = useState(false);
  const [revealed, setRevealed] = useState(room.phase !== 'spin');
  const [flipping, setFlipping] = useState(false);
  const prev = useRef<PublicRoom | null>(null);
  const flippedKey = useRef('');
  const accent = characterById(m.mine)?.accent ?? '#3ee6ff';

  // Keep our partner in sync with the authority (v2 servers only; v1 just ignores the message).
  useEffect(() => {
    if (room.protocol >= 2 && room.players[seat] && room.players[seat]!.avatar !== s.partner) transport.act({ type: 'avatar', avatar: s.partner });
  }, [room.protocol, room.players, seat, s.partner, transport]);

  // Stage layout follows the phase.
  useEffect(() => {
    if (!world) return;
    let layout: Layout;
    if (room.phase === 'complete' && m.seriesWinner !== null) {
      const winnerIsMe = m.seriesWinner === m.me;
      layout = { mode: 'victory', winner: (winnerIsMe ? m.mine : m.theirs) ?? m.mine, loser: winnerIsMe ? m.theirs : m.mine };
    } else {
      const shot = !m.hasOpponent ? 'room' : room.phase === 'pick' ? 'draft' : room.phase === 'battle' ? 'battle' : 'match';
      layout = { mode: 'duo', mine: m.mine, theirs: m.theirs, shot, coin: m.hasOpponent && (room.phase === 'calls' || room.phase === 'spin') };
    }
    world.setLayout(layout);
  }, [world, room.phase, m]);

  // Reactions to authoritative transitions.
  useEffect(() => {
    const p = prev.current; prev.current = room;
    if (!world) return;
    const mineC = characterById(m.mine)!; const theirsC = characterById(m.theirs);
    const who = (s0: Seat) => (s0 === m.me ? 'mine' : 'theirs') as 'mine' | 'theirs';
    const charOf = (s0: Seat) => (s0 === m.me ? mineC : theirsC);
    if (p && !p.players[m.opp] && room.players[m.opp]) {
      setTimeout(() => world.emote('theirs', 'greet'), 900);
      toast(`${m.oppName} joined the room`, 'ok');
    }
    if (p && p.players[m.opp]?.connected && room.players[m.opp] && !room.players[m.opp]!.connected) toast(`${m.oppName} disconnected. Their seat is kept.`, 'error');
    // Coin: animate only when we saw the flip happen live; on reconnect just show the face.
    const key = `${room.code}:${room.games}:${room.result}`;
    if (room.phase === 'spin' && room.result && flippedKey.current !== key) {
      flippedKey.current = key;
      const winner = room.tossWinner as Seat;
      const react = () => {
        setRevealed(true); setFlipping(false);
        world.emote(who(winner), charOf(winner)?.personality.on.tossWin ?? 'excited');
        world.emote(who((1 - winner) as Seat), charOf((1 - winner) as Seat)?.personality.on.tossLose ?? 'surprised');
      };
      // The reveal never waits on rendering alone: if frames are slow or the tab is hidden, a wall-clock
      // timeout finishes it so the game can always continue.
      if (p?.phase === 'calls') {
        setRevealed(false); setFlipping(true);
        let done = false; const finish = () => { if (!done) { done = true; react(); } };
        void world.flipCoin(room.result).then(finish); window.setTimeout(finish, 2600);
      }
      else { world.showCoinFace(room.result); setRevealed(true); }
    }
    if (room.phase !== 'spin' && room.phase !== 'calls') setRevealed(true);
    if (p && room.games > p.games && room.history.length) {
      const w = room.history[room.history.length - 1].winner;
      if (room.phase === 'complete') setTimeout(() => world.emote(who(w), charOf(w)?.personality.on.seriesWin ?? 'victory'), 1400);
      else { world.emote(who(w), charOf(w)?.personality.on.gameWin ?? 'victory'); world.emote(who((1 - w) as Seat), charOf((1 - w) as Seat)?.personality.on.gameLose ?? 'sad'); }
    }
    if (p && p.phase === 'pick' && room.phase === 'battle') world.emote(who(room.tossWinner as Seat), 'nod');
  }, [room, world, m]);

  useEffect(() => { if (status.kind === 'fallback') { setRevealed(true); setFlipping(false); } }, [status.kind]);

  const panel = () => {
    if (!m.hasOpponent) return <WaitingPanel room={room} />;
    switch (room.phase) {
      case 'calls': return <TossPanel room={room} m={m} act={act} flipping={flipping} />;
      case 'spin': return <TossResultPanel room={room} m={m} act={act} revealed={revealed || status.kind === 'fallback'} />;
      case 'pick': return <DraftBoard room={room} m={m} act={act} />;
      case 'battle': return <BattlePanel room={room} m={m} act={act} />;
      case 'between': return <IntervalPanel room={room} m={m} act={act} />;
      case 'complete': return <CompletePanel room={room} m={m} act={act} />;
    }
  };
  const inviteLink = `${location.origin}${location.pathname}?room=${encodeURIComponent(room.code)}`;

  return (
    <main className={`screen match phase-${room.phase}`} style={{ '--accent': accent } as CSSProperties}>
      <Scoreboard room={room} m={m} />
      <div className="roombar">
        <span className={`dot ${link === 'online' ? 'dot--on' : link === 'connecting' ? 'dot--wait' : ''}`} title={`Link ${link}`} />
        <span className="roombar__code mono" title={room.code}>{room.code.length > 10 ? room.code.slice(0, 8) + '…' : room.code}</span>
        <CopyButton className="iconbtn iconbtn--text" label="Invite" getText={() => inviteLink} />
        <button className="iconbtn iconbtn--text" onClick={() => setHistory(h => !h)} aria-expanded={history}><Icon name="history" />History</button>
        <details className="roombar__menu">
          <summary className="iconbtn" aria-label="Room menu"><Icon name="gear" /></summary>
          <div className="menu-pop panel">
            <button onClick={() => act({ type: 'reset', bestOf: 3 })}>New series · Best of 3</button>
            <button onClick={() => act({ type: 'reset', bestOf: 5 })}>New series · Best of 5</button>
            <button onClick={() => transport.leave()}><Icon name="leave" />Leave room</button>
          </div>
        </details>
      </div>
      <ErrorBoundary label="match panel" compact>
        <div className="match__dock" key={`${room.phase}-${m.hasOpponent}`}>{panel()}</div>
      </ErrorBoundary>
      <HistoryDrawer room={room} m={m} open={history} onClose={() => setHistory(false)} />
    </main>
  );
}
