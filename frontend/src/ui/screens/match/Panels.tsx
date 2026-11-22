import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { GameAction, Pokemon, PublicRoom, RivalPreview } from '@shared';
import { useReducedMotion } from '../../../app/settings.js';
import { Icon } from '../../primitives.js';
import { PokemonCard, PokemonChip, Sprite, TeamSummary } from '../../pokemon.js';
import type { MatchModel } from './model.js';
import { useT } from '../../../i18n/index.js';

type Act = (a: GameAction) => void;

/** Smallest scale the draft shrinks to on desktop: below this the set text stops being comfortable to read. */
const MIN_FIT = 0.8;
/**
 * Fits the draft's columns to the screen height on desktop: when the two teams are taller than the space
 * under the scoreboard, they are scaled down (never below `MIN_FIT`; past that it scrolls). Phones keep a
 * single column that scrolls naturally.
 */
function useFitHeight(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = ref.current, cols = el?.querySelector<HTMLElement>('.draft__cols');
    if (!el || !cols) return;
    const fit = () => {
      cols.style.zoom = '';
      // Phones (either way up) scroll one column instead: shrinking that far would make the sets unreadable.
      if (window.innerWidth <= 760 || window.innerHeight < 560) return;
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const avail = el.clientHeight - cols.offsetTop - pad;
      const z = Math.max(MIN_FIT, Math.min(1, avail / cols.offsetHeight));
      if (z < 0.995) cols.style.zoom = z.toFixed(3);
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * The draft. Only the toss winner receives the two dealt teams; the rival sees them face down and never
 * learns which six were taken (in battle they only see what the other side reveals).
 */
export function DraftBoard({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const t = useT();
  const [hover, setHover] = useState<0 | 1 | null>(null);
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const reduced = useReducedMotion();
  const canPick = room.tossWinner === m.me && !!room.candidates;
  const take = (i: 0 | 1) => { if (chosen !== null) return; setChosen(i); window.setTimeout(() => act({ type: 'pick', team: i }), reduced ? 0 : 650); };
  const box = useRef<HTMLElement>(null);
  useFitHeight(box, [room.candidates, canPick]);

  if (!room.candidates) {
    return (
      <section ref={box} className="draft draft--sealed" aria-label={t('panel.teamDraft')}>
        <header className="draft__head">
          <p className="eyebrow">{t('panel.oppChoosing', { name: m.oppName })}</p>
          <p className="draft__sub">{t('panel.sealedSub', { name: m.oppName })}</p>
        </header>
        <div className="draft__cols">
          {[0, 1].map(i => (
            <div key={i} className="draft__col draft__col--sealed">
              <div className="draft__colhead"><h3>{t('panel.team', { letter: i ? 'B' : 'A' })}</h3><span className="badge">{t('panel.faceDown')}</span></div>
              <div className="draft__grid">{Array.from({ length: 6 }, (_, k) => <div key={k} className="cardback" style={{ '--i': k + i * 6 } as CSSProperties} aria-hidden="true"><span className="cardback__ball" /></div>)}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={box} className={`draft ${chosen !== null ? 'has-choice' : ''}`} aria-label={t('panel.teamDraft')}>
      <header className="draft__head">
        <p className="eyebrow">{canPick ? t('panel.wonToss') : t('panel.oppChoosing', { name: m.oppName })}</p>
        <p className="draft__sub">{t('panel.pickSub', { name: m.oppName })}</p>
      </header>
      <div className="draft__cols">
        {room.candidates.map((team, i) => (
          <div key={i} className={`draft__col ${hover === i ? 'is-hover' : ''} ${chosen === i ? 'is-chosen' : chosen !== null ? 'is-passed' : ''}`} onMouseEnter={() => setHover(i as 0 | 1)} onMouseLeave={() => setHover(null)}>
            <div className="draft__colhead">
              <h3>{t('panel.team', { letter: i ? 'B' : 'A' })}</h3>
              <TeamSummary team={team} />
              {canPick && <button className="btn btn--primary btn--lg draft__take" disabled={chosen !== null} onClick={() => take(i as 0 | 1)}><Icon name="check" />{chosen === i ? t('panel.taken') : t('panel.takeTeam', { letter: i ? 'B' : 'A' })}</button>}
            </div>
            <div className="draft__grid">{team.map((p, k) => <PokemonCard key={p.name} p={p} index={k + i * 6} compact />)}</div>
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
  const t = useT();
  return (
    <div className="strip strip--rival" style={{ '--partner': partner } as CSSProperties}>
      <span className="strip__label">{label}<em>{t('panel.setsHidden')}</em></span>
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
  const t = useT();
  const [confirm, setConfirm] = useState<0 | 1 | null>(null);
  return (
    <div className="report">
      <span className="report__q">{t('panel.whoWon', { n: m.gameNo })}</span>
      {[0, 1].map(s => (
        confirm === s
          ? <button key={s} className="btn btn--primary" onClick={() => { act({ type: 'result', winner: s as 0 | 1 }); setConfirm(null); }}><Icon name="check" />{t('panel.confirmWinner', { name: m.names[s] })}</button>
          : <button key={s} className="btn" onClick={() => setConfirm(s as 0 | 1)} disabled={room.phase !== 'battle'}>{s === m.me ? t('panel.iWon') : t('panel.playerWon', { name: m.names[s] })}</button>
      ))}
    </div>
  );
}

export function IntervalPanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const t = useT();
  const last = room.history[room.history.length - 1];
  const iWon = last?.winner === m.me;
  return (
    <section className={`dock panel dock--result ${iWon ? 'dock--win' : ''}`}>
      <p className="eyebrow">{t('panel.gameResult', { n: last?.game ?? '' })}</p>
      <h3 className={`dock__title ${iWon ? 'dock__title--gold' : ''}`}>{iWon ? t('panel.youTookGame') : t('panel.playerTookGame', { name: m.names[last?.winner ?? 0] })}</h3>
      <p className="dock__hint">{t('panel.seriesScore', { a: room.wins[0], b: room.wins[1], n: m.target })} {iWon ? t('panel.youCallCoin') : t('panel.playerCallsCoin', { name: m.names[last?.winner ?? 0] })}</p>
      <button className="btn btn--primary btn--xl" onClick={() => act({ type: 'next' })}><Icon name="arrow" />{t('panel.nextGame')}</button>
    </section>
  );
}

export function CompletePanel({ room, m, act }: { room: PublicRoom; m: MatchModel; act: Act }) {
  const t = useT();
  const iWon = m.seriesWinner === m.me;
  return (
    <section className={`dock panel dock--result dock--victory ${iWon ? 'dock--win' : ''}`}>
      <p className="eyebrow">{t('panel.seriesComplete', { a: room.wins[0], b: room.wins[1] })}</p>
      <h3 className={`dock__title dock__title--big ${iWon ? 'dock__title--gold' : ''}`}>{iWon ? t('panel.victory') : t('panel.playerWinsSeries', { name: m.names[m.seriesWinner ?? 0] })}</h3>
      <div className="dock__row">
        <button className="btn btn--gold" onClick={() => act({ type: 'reset', bestOf: 3 })}><Icon name="spark" />{t('panel.rematchBo3')}</button>
        <button className="btn" onClick={() => act({ type: 'reset', bestOf: 5 })}>{t('panel.bestOf5')}</button>
      </div>
    </section>
  );
}
