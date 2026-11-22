import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PublicRoom } from '@shared';
import { characterById } from '../../characters/roster.js';
import { useReducedMotion, useSettings } from '../../app/settings.js';
import { useWorld } from '../../app/WorldProvider.js';
import type { Transport } from '../../net/types.js';
import type { Layout } from '../../engine/World.js';
import { ErrorBoundary } from '../../app/ErrorBoundary.js';
import { BattleController } from '../../battle/controller.js';
import type { BattleFx } from '../../battle/model.js';
import { createStageBridge } from '../../battle/stageBridge.js';
import { Icon } from '../primitives.js';
import { linkKey, matchModel } from './match/model.js';
import { PHASE_LABEL, Scoreboard } from './match/Scoreboard.js';
import { t as tr, useT } from '../../i18n/index.js';
import { BattleArena } from './match/BattleArena.js';

/** `?fast` plays battle animations at ~12x speed (for testing). */
const FAST = new URLSearchParams(location.search).has('fast');
type Arena = { id: number; controller: BattleController; dispose: () => void; dismissed: boolean };

/** What is happening in the watched room between battles. */
function between(room: PublicRoom, names: [string, string]): { eyebrow: string; title: string; hint: string } {
  const lead = room.wins[0] === room.wins[1] ? tr('watch.level') : tr('watch.leads', { name: names[room.wins[0] > room.wins[1] ? 0 : 1] });
  const score = `${lead} ${Math.max(...room.wins)}–${Math.min(...room.wins)} · ${tr('match.bestOf', { n: room.bestOf })}`;
  switch (room.phase) {
    case 'calls': return { eyebrow: tr(PHASE_LABEL.calls), title: tr('watch.aboutToCall'), hint: score };
    case 'spin': return { eyebrow: tr(PHASE_LABEL.calls), title: room.tossWinner === null ? tr('watch.inAir') : tr('match.wonToss', { name: names[room.tossWinner] }), hint: tr('watch.dealHint') };
    case 'pick': return { eyebrow: tr(PHASE_LABEL.pick), title: room.tossWinner === null ? tr('watch.winnerChoosing') : tr('watch.nameChoosing', { name: names[room.tossWinner] }), hint: tr('watch.pickHint') };
    case 'battle': return { eyebrow: tr(PHASE_LABEL.battle), title: room.mode === 'app' ? tr('watch.starting') : tr('watch.onShowdown'), hint: room.mode === 'app' ? score : tr('watch.offSiteHint') };
    case 'between': return { eyebrow: tr(PHASE_LABEL.between), title: tr('watch.gameGoesTo', { n: room.games, name: names[room.history[room.history.length - 1]?.winner ?? 0] }), hint: score };
    case 'complete': return { eyebrow: tr(PHASE_LABEL.complete), title: tr('watch.winsSeries', { name: names[room.wins[0] > room.wins[1] ? 0 : 1] }), hint: `${room.wins[0]}–${room.wins[1]}` };
  }
}

/**
 * Watching someone else's room: the scoreboard, the stage and, while they battle here, the battle itself
 * from their public stream (the first trainer's side near the lens). Nothing here acts on the room.
 */
export function WatchScreen({ room, transport, link, onLeave }: { room: PublicRoom; transport: Transport; link: string; onLeave: () => void }) {
  const t = useT();
  const s = useSettings();
  const { world } = useWorld();
  // The language is a dependency: the model holds default names ("Player 1") in it.
  const m = useMemo(() => matchModel(room, 0, s.partner), [room, s.partner, t.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const [arena, setArena] = useState<Arena | null>(null);
  const fxRef = useRef<((f: BattleFx, instant: boolean) => void) | undefined>(undefined);
  const bridged = useRef<{ world: unknown; id: number } | null>(null);
  const battleId = room.mode === 'app' ? room.battle?.id ?? null : null;

  useEffect(() => {
    if (battleId === null || (arena && arena.id === battleId)) return;
    const controller = new BattleController({ mySide: 0, spectator: true, send: () => {}, onFx: (f, instant) => fxRef.current?.(f, instant), speed: () => (FAST ? 0.08 : reducedRef.current ? 0.5 : 1) });
    const off = transport.onBattle((id, lines, reset, deadline) => { if (id === battleId) controller.ingest(id, lines, reset, deadline); });
    setArena({ id: battleId, controller, dispose: () => { off(); controller.dispose(); }, dismissed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleId, transport]);
  useEffect(() => () => arena?.dispose(), [arena]);
  const snap = useSyncExternalStore(arena ? arena.controller.subscribe : noopSubscribe, arena ? arena.controller.getSnapshot : nullSnapshot);
  const battleOver = !!snap && snap.state.phase === 'ended' && !snap.busy;
  const teamKey = snap ? snap.state.sides.map(x => x.mons.map(mon => mon.set?.artId ?? mon.set?.id ?? 0).join(',')).join(',') : '';
  useEffect(() => { if (world && teamKey) world.prepareMons(teamKey.split(',').map(Number).filter(Boolean)); }, [world, teamKey]);
  const showArena = !!arena && !arena.dismissed && (room.phase === 'battle' || (!!snap && snap.state.phase !== 'idle'));
  const dismiss = () => setArena(a => (a ? { ...a, dismissed: true } : a));
  useEffect(() => { if (!showArena || !battleOver || room.phase === 'battle') return; const tm = setTimeout(dismiss, 9000); return () => clearTimeout(tm); }, [showArena, battleOver, room.phase]);

  // The stage follows the room like a player's would, from the first trainer's side.
  useEffect(() => {
    if (!world) return;
    let layout: Layout;
    if (showArena && m.theirs) layout = { mode: 'arena', mine: m.mine, theirs: m.theirs };
    else if (room.phase === 'complete' && m.seriesWinner !== null) {
      const first = m.seriesWinner === 0;
      layout = { mode: 'victory', winner: (first ? m.mine : m.theirs) ?? m.mine, loser: first ? m.theirs : m.mine };
    } else layout = { mode: 'duo', mine: m.mine, theirs: m.theirs, shot: room.phase === 'pick' ? 'draft' : 'match', coin: room.phase === 'calls' || room.phase === 'spin' };
    world.setLayout(layout);
  }, [world, room.phase, m, showArena]);
  useEffect(() => { if (world && room.phase === 'spin') world.showCoinFace(room.result); }, [world, room.phase, room.result]);
  useEffect(() => {
    if (!world || !arena) { fxRef.current = undefined; return; }
    fxRef.current = createStageBridge(world, 0, characterById(m.mine)!, characterById(m.theirs));
    if (bridged.current?.world !== world || bridged.current.id !== arena.id) { bridged.current = { world, id: arena.id }; arena.controller.resync(); }
  }, [world, arena, m.mine, m.theirs]);

  const info = between(room, m.names);
  return (
    <main className={`screen match watch phase-${room.phase} ${showArena ? 'has-arena' : ''}`}>
      <Scoreboard room={room} m={m} watch />
      <div className="roombar">
        <span className={`dot ${link === 'online' ? 'dot--on' : link === 'connecting' ? 'dot--wait' : ''}`} title={t(linkKey(link))} />
        <span className="roombar__watch"><Icon name="eye" size={14} />{room.watchers > 1 ? t('watch.watchingWith', { n: room.watchers - 1 }) : t('watch.watching')}</span>
        <button type="button" className="iconbtn iconbtn--text" onClick={onLeave}><Icon name="leave" />{t('watch.stop')}</button>
      </div>
      <ErrorBoundary label={t('watch.panel')} compact>
        <div className="match__dock" key={showArena ? `arena-${arena?.id}` : room.phase}>
          {showArena && arena
            ? <BattleArena controller={arena.controller} spectating mineLabel={m.names[0]} theirsLabel={m.names[1]} onForfeit={() => {}} finished={room.phase !== 'battle'} onContinue={dismiss} iWon={null} />
            : (
              <section className="dock panel dock--quiet watch__panel" aria-live="polite">
                <p className="eyebrow">{info.eyebrow}</p>
                <h3 className="dock__title">{info.title}</h3>
                <p className="dock__hint">{info.hint}</p>
              </section>
            )}
        </div>
      </ErrorBoundary>
    </main>
  );
}

const noopSubscribe = () => () => {};
const nullSnapshot = () => null;
