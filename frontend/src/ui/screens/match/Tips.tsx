import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { moveInfo, type TypeName } from '@shared';
import { defenseChart, liveTypes, moveVerdict, shortMult, typeVerdict, type Fighter, type Verdict } from '../../../battle/matchup.js';
import { TYPE_COLORS, TypeBadge } from '../../pokemon.js';

/* ------------------------------------------------------------------ tooltip layer */

type Tip = { content: ReactNode; rect: DOMRect } | null;
const TipCtx = createContext<(t: Tip) => void>(() => {});

/**
 * Showdown-style hover cards. Mouse: hover or keyboard focus. Touch: press and hold (the tap that
 * follows a long press is swallowed so it does not also pick the move).
 */
export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!tip || !box.current) { setPos(null); return; }
    const w = box.current.offsetWidth, h = box.current.offsetHeight;
    const r = tip.rect; const vw = window.innerWidth;
    const below = r.top - h - 12 < 8;
    setPos({ left: Math.min(vw - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)), top: below ? r.bottom + 10 : r.top - h - 10, below });
  }, [tip]);
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [tip]);
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {tip && (
        <div ref={box} className={`tip ${pos?.below ? 'tip--below' : ''}`} role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
          {tip.content}
        </div>
      )}
    </TipCtx.Provider>
  );
}

/** Props to spread on anything that should show a tip. `content` is built lazily on show. */
export function useTip(content: () => ReactNode) {
  const set = useContext(TipCtx);
  const hold = useRef(0); const swallow = useRef(false);
  const show = useCallback((el: Element) => set({ content: content(), rect: el.getBoundingClientRect() }), [set, content]);
  const hide = useCallback(() => { window.clearTimeout(hold.current); set(null); }, [set]);
  useEffect(() => hide, [hide]);
  return {
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') show(e.currentTarget); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') hide(); },
    onFocus: (e: React.FocusEvent) => show(e.currentTarget),
    onBlur: hide,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget; swallow.current = false;
      hold.current = window.setTimeout(() => { swallow.current = true; show(el); }, 380);
    },
    onPointerUp: (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') { window.clearTimeout(hold.current); if (swallow.current) window.setTimeout(hide, 1600); } },
    onClickCapture: (e: React.MouseEvent) => { if (swallow.current) { e.preventDefault(); e.stopPropagation(); swallow.current = false; } },
    onContextMenu: (e: React.MouseEvent) => { if (swallow.current) e.preventDefault(); },
  };
}

/**
 * Move cards for a whole region: any descendant with `data-move` shows that move when the mouse rests
 * on it. One listener pair instead of one per chip; `userOf` says whose move it is (for STAB).
 */
export function useMoveTips(userOf: (el: Element) => Fighter | null) {
  const set = useContext(TipCtx);
  const current = useRef<Element | null>(null);
  const hide = useCallback(() => { current.current = null; set(null); }, [set]);
  useEffect(() => hide, [hide]);
  return {
    onPointerOver: (e: React.PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = (e.target as Element).closest('[data-move]');
      if (el === current.current) return;
      current.current = el;
      const user = el && userOf(el);
      set(el && user ? { content: <MoveCard name={el.getAttribute('data-move')!} user={user} target={null} teraPreview={null} />, rect: el.getBoundingClientRect() } : null);
    },
    onPointerLeave: hide,
  };
}

/* ------------------------------------------------------------------ cards */

const pct = (a: number) => (a ? `${a}%` : 'Never misses');

export function VerdictChip({ v, compact = false }: { v: Verdict | null; compact?: boolean }) {
  if (!v || (v.tone === 'x1' && compact) || (v.tone === 'status' && compact)) return null;
  return <span className={`vchip vchip--${v.tone}`}>{compact ? shortMult(v) || '✕' : v.label}</span>;
}

export function MoveCard({ name, pp, maxpp, user, target, teraPreview }: { name: string; pp?: number; maxpp?: number; user: Fighter; target: Fighter | null; teraPreview: TypeName | null }) {
  const m = moveInfo(name);
  if (!m) return <strong>{name}</strong>;
  const v = moveVerdict(name, user, target, teraPreview);
  const stabPower = v?.stab && m.power ? Math.floor(m.power * 1.5) : null;
  return (
    <div className="tipcard" style={{ '--t': TYPE_COLORS[m.type] } as CSSProperties}>
      <header><strong>{m.name}</strong><TypeBadge type={m.type} size="sm" /><span className={`cat cat--${m.category.toLowerCase()}`}>{m.category}</span></header>
      <dl className="tipcard__stats">
        <div><dt>Power</dt><dd>{m.power ? <>{m.power}{stabPower && <small> ({stabPower} STAB)</small>}</> : '—'}</dd></div>
        <div><dt>Accuracy</dt><dd>{pct(m.accuracy)}</dd></div>
        {pp !== undefined && <div><dt>PP</dt><dd>{pp}/{maxpp}</dd></div>}
        {m.priority !== 0 && <div><dt>Priority</dt><dd>{m.priority > 0 ? `+${m.priority}` : m.priority}</dd></div>}
      </dl>
      <p className="tipcard__desc">{m.desc}</p>
      {target && v && v.tone !== 'status' && (
        <p className="tipcard__verdict">vs {target.species}: <VerdictChip v={v} /></p>
      )}
      {v && v.notes.length > 0 && <ul className="tipcard__notes">{v.notes.map(n => <li key={n}>{n}</li>)}</ul>}
      {teraPreview && <p className="tipcard__hint">Terastallize is on: STAB from {teraPreview} this turn.</p>}
    </div>
  );
}

function TypeRow({ label, types, tone }: { label: string; types: TypeName[]; tone: string }) {
  if (!types.length) return null;
  return <div className={`chart chart--${tone}`}><dt>{label}</dt><dd>{types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</dd></div>;
}

/** A Pokémon card: typing, set, HP, the defensive chart, and its moves against the opposing active. */
export function MonCard({ f, hp, pct, status, moves, vs, foeAttacker, note }: {
  f: Fighter; hp?: { hp: number; maxhp: number } | null; pct?: boolean; status?: string | null; moves: string[]; vs: Fighter | null; foeAttacker?: Fighter | null; note?: string;
}) {
  const chart = defenseChart(f);
  const types = liveTypes(f);
  // How hard the opposing active's own types hit this Pokémon.
  const incoming = foeAttacker ? liveTypes(foeAttacker).map(t => ({ t, v: typeVerdict(t, f) })) : [];
  return (
    <div className="tipcard" style={{ '--t': TYPE_COLORS[types[0] ?? 'Normal'] } as CSSProperties}>
      <header><strong>{f.species}</strong>{types.map(t => <TypeBadge key={t} type={t} size="sm" />)}{f.tera && <span className="tipcard__tera">Tera</span>}</header>
      <dl className="tipcard__stats">
        {hp && <div><dt>HP</dt><dd>{pct ? `${Math.round((hp.hp / hp.maxhp) * 100)}%` : `${hp.hp}/${hp.maxhp}`}{status ? ` · ${status.toUpperCase()}` : ''}</dd></div>}
        <div><dt>Ability</dt><dd>{f.ability || '?'}</dd></div>
        <div><dt>Item</dt><dd>{f.item ?? 'None'}</dd></div>
      </dl>
      {note && <p className="tipcard__hint">{note}</p>}
      <dl className="tipcard__chart">
        <TypeRow label="Weak x4" types={chart.x4} tone="x4" />
        <TypeRow label="Weak x2" types={chart.x2} tone="x2" />
        <TypeRow label="Resists" types={[...chart.half, ...chart.quarter]} tone="half" />
        <TypeRow label="Immune" types={chart.immune} tone="immune" />
      </dl>
      {incoming.length > 0 && (
        <p className="tipcard__verdict">Takes from {foeAttacker!.species}'s types: {incoming.map(({ t, v }) => <span key={t} className={`vchip vchip--${v.tone}`}>{t} {shortMult(v) || 'x1'}</span>)}</p>
      )}
      <ul className="tipcard__moves">
        {moves.map(mv => {
          const info = moveInfo(mv);
          const v = moveVerdict(mv, f, vs);
          return <li key={mv} style={{ '--t': TYPE_COLORS[info?.type ?? 'Normal'] } as CSSProperties}><i />{mv}{vs && <VerdictChip v={v} compact />}</li>;
        })}
      </ul>
    </div>
  );
}
