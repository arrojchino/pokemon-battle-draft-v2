import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { PLAZA_SINCE, type GameAction, type PublicRoom, type Seat } from '@shared';
import { characterById } from '../../characters/roster.js';
import { useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import type { Transport } from '../../net/types.js';
import { inviteLink } from '../../net/session.js';
import type { Layout } from '../../engine/World.js';
import { ErrorBoundary } from '../../app/ErrorBoundary.js';
import { CopyButton, Icon, openSettings, toast } from '../primitives.js';
import { matchModel } from './match/model.js';
import { Scoreboard } from './match/Scoreboard.js';
import { CompletePanel, DraftBoard, IntervalPanel } from './match/Panels.js';
import { TossPanel, TossResultPanel, WaitingPanel } from './match/LobbyPanels.js';
import { BattlePanel } from './match/BattlePanel.js';
import { HistoryDrawer } from './match/HistoryDrawer.js';
import { PlazaHud } from './match/Plaza.js';
import { BattleArena } from './match/BattleArena.js';
import { BattleController } from '../../battle/controller.js';
import { sound } from '../../audio/sound.js';
import type { BattleFx } from '../../battle/model.js';
import { createStageBridge } from '../../battle/stageBridge.js';
import { useReducedMotion } from '../../app/settings.js';

/** `?fast` plays battle animations at ~12x speed (for testing). */
const FAST = new URLSearchParams(location.search).has('fast');
type Arena = { id: number; controller: BattleController; dispose: () => void; dismissed: boolean; reacted: boolean };

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
  const partnerColor = characterById(m.mine)?.accent;
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced); reducedRef.current = reduced;

  // In-app battle: one controller per battle id, fed by this player's simulator stream.
  const [arena, setArena] = useState<Arena | null>(null);
  // Battle events reach the 3D stage through a ref, so a stage that arrives late (page reload, slow
  // asset load, context restore) still gets them; it is then resynced to the current position.
  const fxRef = useRef<((f: BattleFx, instant: boolean) => void) | undefined>(undefined);
  const bridged = useRef<{ world: unknown; id: number } | null>(null);
  const battleId = room.mode === 'app' ? room.battle?.id ?? null : null;
  useEffect(() => {
    if (battleId === null || (arena && arena.id === battleId)) return;
    const controller = new BattleController({ mySide: seat, send: c => transport.choose(c), onFx: (f, instant) => fxRef.current?.(f, instant), speed: () => (FAST ? 0.08 : reducedRef.current ? 0.5 : 1) });
    const off = transport.onBattle((id, lines, reset, deadline) => { if (id === battleId) controller.ingest(id, lines, reset, deadline); });
    setArena({ id: battleId, controller, dispose: () => { off(); controller.dispose(); }, dismissed: false, reacted: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, transport, seat]);
  useEffect(() => () => arena?.dispose(), [arena]);
  const arenaSnap = useSyncExternalStore(arena ? arena.controller.subscribe : noopSubscribe, arena ? arena.controller.getSnapshot : nullSnapshot);
  const battleOver = !!arenaSnap && arenaSnap.state.phase === 'ended' && !arenaSnap.busy;
  // Team Preview names all twelve Pokémon: download and compile their models before anyone is sent out.
  const teamKey = arenaSnap ? arenaSnap.state.sides.map(s => s.mons.map(mon => mon.set?.artId ?? mon.set?.id ?? 0).join(',')).join(',') : '';
  useEffect(() => { if (world && teamKey) world.prepareMons(teamKey.split(',').map(Number).filter(Boolean)); }, [world, teamKey]);
  // Visible during the battle phase, and after it until Continue (so the final knockout plays out).
  // A reset mid-battle abandons an unfinished arena.
  // Keep the arena up after the server records the result until local playback has shown the ending
  // (a slower client may still be animating the last turn) and the player continues or it auto-dismisses.
  const showArena = !!arena && !arena.dismissed && (room.phase === 'battle' || (!!arenaSnap && arenaSnap.state.phase !== 'idle'));
  const dismissArena = () => setArena(a => (a ? { ...a, dismissed: true } : a));
  // The plaza: while waiting for a rival and until the coin is called, the stage is a place to walk and talk.
  const chatty = room.protocol >= PLAZA_SINCE;
  const plaza = chatty && !showArena && (!m.hasOpponent || room.phase === 'calls');
  useEffect(() => {
    if (!arena || arena.reacted || !battleOver || !world || !arenaSnap) return;
    arena.reacted = true;
    const w = arenaSnap.state.winnerSide;
    if (w === null) return;
    const mineWon = w === seat;
    sound.play(mineWon ? 'win' : 'lose');
    const mineC = characterById(m.mine); const theirsC = characterById(m.theirs);
    world.emote('mine', mineWon ? mineC?.personality.on.gameWin ?? 'victory' : mineC?.personality.on.gameLose ?? 'sad');
    world.emote('theirs', mineWon ? theirsC?.personality.on.gameLose ?? 'sad' : theirsC?.personality.on.gameWin ?? 'victory');
  }, [arena, battleOver, arenaSnap, world, seat, m.mine, m.theirs]);
  // Once the result is recorded, move on by itself after a beat.
  useEffect(() => { if (!showArena || !battleOver || room.phase === 'battle') return; const t = setTimeout(dismissArena, 9000); return () => clearTimeout(t); }, [showArena, battleOver, room.phase]);

  // Keep our partner in sync with the authority (v2 servers only; v1 just ignores the message).
  useEffect(() => {
    if (room.protocol >= 2 && room.players[seat] && room.players[seat]!.avatar !== s.partner) transport.act({ type: 'avatar', avatar: s.partner });
  }, [room.protocol, room.players, seat, s.partner, transport]);

  // Stage layout follows the phase.
  useEffect(() => {
    if (!world) return;
    let layout: Layout;
    if (showArena && m.theirs) {
      layout = { mode: 'arena', mine: m.mine, theirs: m.theirs };
    } else if (plaza) {
      layout = { mode: 'plaza', mine: m.mine, theirs: m.theirs, seat: m.me };
    } else if (room.phase === 'complete' && m.seriesWinner !== null) {
      const winnerIsMe = m.seriesWinner === m.me;
      layout = { mode: 'victory', winner: (winnerIsMe ? m.mine : m.theirs) ?? m.mine, loser: winnerIsMe ? m.theirs : m.mine };
    } else {
      const shot = !m.hasOpponent ? 'room' : room.phase === 'pick' ? 'draft' : room.phase === 'battle' ? 'battle' : 'match';
      layout = { mode: 'duo', mine: m.mine, theirs: m.theirs, shot, coin: m.hasOpponent && (room.phase === 'calls' || room.phase === 'spin') };
    }
    world.setLayout(layout);
  }, [world, room.phase, m, showArena, plaza]);

  // Attach the battle bridge after the layout so a late stage is resynced onto the arena.
  useEffect(() => {
    if (!world || !arena) { fxRef.current = undefined; return; }
    fxRef.current = createStageBridge(world, seat, characterById(m.mine)!, characterById(m.theirs));
    if (bridged.current?.world !== world || bridged.current.id !== arena.id) {
      bridged.current = { world, id: arena.id };
      arena.controller.resync();
    }
  }, [world, arena, seat, m.mine, m.theirs]);

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
        sound.play(winner === seat ? 'tossWin' : 'tossLose');
        world.emote(who(winner), charOf(winner)?.personality.on.tossWin ?? 'excited');
        world.emote(who((1 - winner) as Seat), charOf((1 - winner) as Seat)?.personality.on.tossLose ?? 'surprised');
        // The toss winner's client deals as soon as the coin lands; the other player keeps a Deal button.
        if (winner === seat) window.setTimeout(() => transport.act({ type: 'spin' }), reducedRef.current ? 300 : 1200);
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
    if (p && room.games > p.games && room.history.length && room.mode !== 'app') {
      const w = room.history[room.history.length - 1].winner;
      if (room.phase === 'complete') setTimeout(() => { world.emote(who(w), charOf(w)?.personality.on.seriesWin ?? 'victory'); world.emote(who((1 - w) as Seat), 'faceplant'); }, 1400);
      else { world.emote(who(w), charOf(w)?.personality.on.gameWin ?? 'victory'); world.emote(who((1 - w) as Seat), charOf((1 - w) as Seat)?.personality.on.gameLose ?? 'sad'); }
    }
    if (p && p.phase === 'pick' && room.phase === 'battle') { world.emote(who(room.tossWinner as Seat), 'nod'); sound.play('pick'); }
    if (p && p.phase !== 'pick' && room.phase === 'pick') sound.play('deal');
    if (p && !p.players[m.opp] && room.players[m.opp]) sound.play('join');
    if (p && room.games > p.games && room.history.length && room.mode !== 'app') sound.play(room.history[room.history.length - 1].winner === seat ? 'win' : 'lose');
  }, [room, world, m]);

  useEffect(() => { if (status.kind === 'fallback') { setRevealed(true); setFlipping(false); } }, [status.kind]);

  const panel = () => {
    if (showArena && arena) {
      const w = arenaSnap?.state.winnerSide;
      return <BattleArena controller={arena.controller} mineLabel={m.myName} theirsLabel={m.oppName} onForfeit={() => transport.forfeit()}
        finished={room.phase !== 'battle'} onContinue={dismissArena} iWon={w === undefined || w === null ? null : w === seat} />;
    }
    if (!m.hasOpponent) return <WaitingPanel room={room} m={m} />;
    switch (room.phase) {
      case 'calls': return <TossPanel room={room} m={m} act={act} flipping={flipping} />;
      case 'spin': return <TossResultPanel room={room} m={m} act={act} revealed={revealed || status.kind === 'fallback'} />;
      case 'pick': return <DraftBoard room={room} m={m} act={act} />;
      case 'battle': return <BattlePanel room={room} m={m} act={act} />;
      case 'between': return <IntervalPanel room={room} m={m} act={act} />;
      case 'complete': return <CompletePanel room={room} m={m} act={act} />;
    }
  };

  return (
    <main className={`screen match phase-${room.phase} ${showArena ? 'has-arena' : ''} ${plaza ? 'is-plaza' : ''}`} style={{ '--partner': partnerColor } as CSSProperties}>
      {chatty && !showArena && room.phase !== 'pick' && <PlazaHud world={world} room={room} m={m} transport={transport} walking={plaza} />}
      <Scoreboard room={room} m={m} />
      <div className="roombar">
        <span className={`dot ${link === 'online' ? 'dot--on' : link === 'connecting' ? 'dot--wait' : ''}`} title={`Link ${link}`} />
        <span className="roombar__code mono" title={room.code}>{room.code.length > 10 ? room.code.slice(0, 8) + '…' : room.code}</span>
        {room.watchers > 0 && <span className="roombar__watch" title={`${room.watchers} watching this room`}><Icon name="eye" size={14} />{room.watchers}</span>}
        <CopyButton className="iconbtn iconbtn--text" label="Invite" getText={() => inviteLink(room.code)} />
        <button className="iconbtn iconbtn--text" onClick={() => setHistory(h => !h)} aria-expanded={history}><Icon name="history" />History</button>
        <details className="roombar__menu">
          <summary className="iconbtn" aria-label="Room menu"><Icon name="gear" /></summary>
          <div className="menu-pop panel">
            {transport.supportsBattles && room.phase !== 'battle' && room.phase !== 'pick' && (
              <button onClick={() => act({ type: 'mode', mode: room.mode === 'app' ? 'showdown' : 'app' })}><Icon name="swords" />{room.mode === 'app' ? 'Battle on Showdown instead' : 'Battle here instead'}</button>
            )}
            <button onClick={openSettings}><Icon name="sliders" />Settings</button>
            <button onClick={() => act({ type: 'reset', bestOf: 3 })}>New series · Best of 3</button>
            <button onClick={() => act({ type: 'reset', bestOf: 5 })}>New series · Best of 5</button>
            <button onClick={() => transport.leave()}><Icon name="leave" />Leave room</button>
          </div>
        </details>
      </div>
      <ErrorBoundary label="match panel" compact>
        <div className="match__dock" key={showArena ? `arena-${arena?.id}` : `${room.phase}-${m.hasOpponent}`}>{panel()}</div>
      </ErrorBoundary>
      <HistoryDrawer room={room} m={m} open={history} onClose={() => setHistory(false)} />
    </main>
  );
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;
