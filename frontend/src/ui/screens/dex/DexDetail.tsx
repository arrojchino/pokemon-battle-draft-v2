import { forwardRef, memo, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Pokemon, RoleCategory } from '@shared';
import { Icon, Segmented } from '../../primitives.js';
import { ROLE_KEY, Sprite, TypeBadge } from '../../pokemon.js';
import { useT, type MessageKey } from '../../../i18n/index.js';
import { MAX_EV, ROLE_INFO, STATS, dexNo, isStab, matchups, parseEvs, setMoves, typeVar, type Matchups } from './dexData.js';

export type NavDir = 'open' | 'prev' | 'next';

type Props = {
  p: Pokemon; role: RoleCategory; dir: NavDir;
  /** Neighbours in the current results; null when there is nothing else to browse to. */
  prev: Pokemon | null; next: Pokemon | null;
  onNav: (step: 1 | -1) => void; onClose: () => void;
  /** Full-screen sheet (narrow screens): announced as a modal dialog. */
  sheet: boolean;
};

const CHART_ROWS: [keyof Matchups, string, MessageKey][] = [
  ['x4', '×4', 'dex.weak'], ['x2', '×2', 'dex.weak'], ['half', '×½', 'dex.resists'], ['quarter', '×¼', 'dex.resists'], ['immune', '×0', 'dex.immune'],
];
const CATEGORY: Record<string, MessageKey> = { Physical: 'dex.catPhysical', Special: 'dex.catSpecial', Status: 'dex.catStatus' };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * The selected set, laid out like a summary screen: hero art, the set itself, its four moves with
 * simulator data, and the defensive chart for its species types or its Tera type. Browsing with
 * previous/next keeps the scroll position, so the same section can be compared across Pokémon.
 */
export const DexDetail = memo(forwardRef<HTMLElement, Props>(function DexDetail({ p, role, dir, prev, next, onNav, onClose, sheet }, ref) {
  const t = useT();
  const [chartOf, setChartOf] = useState<'species' | 'tera'>('species');
  const chart = useMemo(() => matchups(chartOf === 'tera' ? [p.tera] : p.types), [p, chartOf]);
  const evs = parseEvs(p.evs);
  const r = ROLE_INFO[role];

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.target as Element).closest('[role=radiogroup]')) return;
    if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onNav(-1); }
    if (e.key === 'ArrowRight' && next) { e.preventDefault(); onNav(1); }
  };

  return (
    <aside
      ref={ref}
      className="panel dexpanel"
      tabIndex={-1}
      role={sheet ? 'dialog' : 'region'}
      aria-modal={sheet || undefined}
      aria-labelledby="dexpanel-name"
      onKeyDown={onKeyDown}
      style={{ '--t1': typeVar(p.types[0]), '--t2': typeVar(p.types[1] ?? p.types[0]) } as CSSProperties}
    >
      <header className="dexpanel__bar">
        <span className="dexpanel__no">{dexNo(p.id)}</span>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('dex.closeDetails')}><Icon name="close" /></button>
      </header>

      <section className="dexhero" key={p.name} data-dir={dir}>
        <div className="dexhero__stage">
          <span className="dexhero__ball"><Icon name="ball" /></span>
          <Sprite artId={p.artId ?? p.id} name={p.name} className="dexhero__img" eager />
        </div>
        <h2 id="dexpanel-name" className="dexhero__name">{p.name}</h2>
        <div className="dexhero__types">{p.types.map(ty => <TypeBadge key={ty} type={ty} />)}</div>
        <p className="dexhero__role"><Icon name={r.icon} size={14} /><b>{t(ROLE_KEY[role])}</b> · {p.role}</p>
        <q className="dexhero__quirk">{p.quirk}</q>
      </section>

      <section className="dexsec" aria-labelledby="dexsec-set">
        <h3 id="dexsec-set" className="eyebrow">{t('dex.battleSet')}</h3>
        <dl className="dexset">
          <div><dt>{t('mon.ability')}</dt><dd>{p.ability}</dd></div>
          <div><dt>{t('mon.item')}</dt><dd>{p.item}</dd></div>
          <div><dt>{t('mon.nature')}</dt><dd>{p.nature}</dd></div>
          <div><dt>{t('dex.teraType')}</dt><dd><TypeBadge type={p.tera} tera size="sm" /></dd></div>
        </dl>
        <dl className="dexevs" aria-label={t('dex.evsAria', { evs: p.evs })}>
          {STATS.map(s => (
            <div key={s} className={evs[s] ? '' : 'is-zero'} style={{ '--v': evs[s] / MAX_EV } as CSSProperties}>
              <dt>{s}</dt><dd><i aria-hidden="true" /><b>{evs[s]}</b></dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="dexsec" aria-labelledby="dexsec-moves">
        <h3 id="dexsec-moves" className="eyebrow">{t('mon.moves')}</h3>
        <ol className="dexmoves">
          {setMoves(p).map(({ name, info }) => info ? (
            <li key={name} className="dexmove" style={{ '--t': typeVar(info.type) } as CSSProperties}>
              <div className="dexmove__head">
                <strong className="dexmove__name">{info.name}</strong>
                <TypeBadge type={info.type} size="sm" />
                <span className={`cat cat--${info.category.toLowerCase()}`}>{CATEGORY[info.category] ? t(CATEGORY[info.category]) : info.category}</span>
              </div>
              <div className="dexmove__stats">
                <dl>
                  <div><dt>{t('dex.power')}</dt><dd>{info.power || '–'}</dd></div>
                  <div><dt>{t('dex.accuracy')}</dt><dd title={info.accuracy ? undefined : t('dex.noAccuracyCheck')}>{info.accuracy ? `${info.accuracy}%` : '–'}</dd></div>
                  {info.priority !== 0 && <div><dt>{t('dex.priority')}</dt><dd>{signed(info.priority)}</dd></div>}
                </dl>
                {isStab(p, info) && <span className="vchip vchip--stab" title={t('dex.stabTitle')}>STAB</span>}
              </div>
              {info.desc && <p className="dexmove__desc">{info.desc}</p>}
            </li>
          ) : <li key={name} className="dexmove"><strong className="dexmove__name">{name}</strong></li>)}
        </ol>
      </section>

      <section className="dexsec" aria-labelledby="dexsec-chart">
        <div className="dexsec__head">
          <h3 id="dexsec-chart" className="eyebrow">{t('dex.matchups')}</h3>
          <Segmented label={t('dex.defensiveTyping')} value={chartOf} onChange={setChartOf}
            options={[{ value: 'species', label: p.types.join(' / ') }, { value: 'tera', label: `Tera ${p.tera}` }]} />
        </div>
        <dl className="dexchart">
          {CHART_ROWS.map(([key, mult, label]) => chart[key].length > 0 && (
            <div key={key}>
              <dt><span className={`vchip vchip--${key}`}>{mult}</span>{t(label)}</dt>
              <dd>{chart[key].map(ty => <TypeBadge key={ty} type={ty} size="sm" />)}</dd>
            </div>
          ))}
        </dl>
        <p className="dexsec__note">{t('dex.chartNote')}</p>
      </section>

      {prev && next && (
        <nav className="dexpanel__nav" aria-label={t('dex.browsePool')}>
          <NavButton p={prev} step={-1} onNav={onNav} />
          <NavButton p={next} step={1} onNav={onNav} />
        </nav>
      )}
    </aside>
  );
}));

function NavButton({ p, step, onNav }: { p: Pokemon; step: 1 | -1; onNav: (step: 1 | -1) => void }) {
  const t = useT();
  return (
    <button type="button" className={`dexnav dexnav--${step > 0 ? 'next' : 'prev'}`} onClick={() => onNav(step)} aria-label={t(step > 0 ? 'dex.navNext' : 'dex.navPrev', { name: p.name })}>
      <Icon name={step > 0 ? 'chevron' : 'back'} size={16} />
      <Sprite key={p.name} artId={p.artId ?? p.id} name={p.name} className="dexnav__img" />
      <span className="dexnav__text"><small>{dexNo(p.id)}</small><strong>{p.name}</strong></span>
    </button>
  );
}
