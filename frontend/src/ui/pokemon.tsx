import { memo, useRef, useState, type CSSProperties } from 'react';
import { TYPE_NAMES, category, moveInfo, type Pokemon, type TypeName } from '@shared';
import { pokemonArt } from '../assets.js';
import { typeVerdict } from '../battle/matchup.js';

/** Type palette (mirrors --type-* in styles/tokens.css): conventional hues tuned for the dark UI. */
export const TYPE_COLORS: Record<TypeName, string> = {
  Normal: '#a8a77a', Fire: '#f0802f', Water: '#4f8ff7', Electric: '#f7d02c', Grass: '#5fc35a', Ice: '#7fd8e8',
  Fighting: '#d0473f', Poison: '#a849b0', Ground: '#d9b45a', Flying: '#8fa8f5', Psychic: '#f45b9a', Bug: '#9bbb2a',
  Rock: '#b8a258', Ghost: '#7b5bb5', Dragon: '#6439e8', Dark: '#4a4e5a', Steel: '#9aa7bd', Fairy: '#ee90c4', Stellar: '#40b5a5',
};

export const TypeBadge = ({ type, tera = false, size = 'md' }: { type: TypeName; tera?: boolean; size?: 'sm' | 'md' }) => (
  <span className={`type type--${size} ${tera ? 'type--tera' : ''}`} style={{ '--t': TYPE_COLORS[type] } as CSSProperties}>
    {tera && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.5 11 4 9 11 3 11 1 4Z" /></svg>}
    {type}{tera ? ' Tera' : ''}
  </span>
);

const ROLE_LABEL = { hazard: 'Hazards', support: 'Support', setup: 'Setup', attacker: 'Attacker', other: 'Flex' } as const;
const ROLES = ['Hazards', 'Support', 'Setup', 'Attacker', 'Flex'] as const;

/** A move's type, from the shared move data (Normal when unknown). */
const moveType = (name: string): TypeName => moveInfo(name)?.type ?? 'Normal';

/** Official art with a lettered fallback when the image host is unreachable. */
export function Sprite({ artId, name, className = '', eager = false }: { artId: number; name: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className={`${className} art--missing sprite--missing`} title={name} aria-label={name}>{name.slice(0, 2)}</span>
    : <img className={className} src={pokemonArt(artId)} alt={name} title={name} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

function Art({ p, className }: { p: Pokemon; className: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <div className={`${className} art--missing`} aria-label={p.name}>{p.name.slice(0, 2)}</div>
    : <img className={className} src={pokemonArt(p.artId ?? p.id)} alt={p.name} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

/**
 * Full set card. Its layout follows its own width (container query): art beside the set when there is
 * room, stacked when narrow. The tilt follows the pointer through CSS custom properties written
 * directly to the element (no React state per mousemove), and CSS transitions smooth it.
 * Moves carry `data-move` so a parent can attach hover cards to them.
 */
export const PokemonCard = memo(function PokemonCard({ p, index = 0, highlight, compact = false }: { p: Pokemon; index?: number; highlight?: string; compact?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <article
      ref={ref}
      className={`pcard ${compact ? 'pcard--compact' : ''}`}
      style={{ '--t1': TYPE_COLORS[p.types[0]], '--t2': TYPE_COLORS[p.types[1] ?? p.types[0]], '--i': index, '--hl': highlight ?? 'transparent' } as CSSProperties}
      onPointerMove={e => {
        const el = ref.current; if (!el || e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -6}deg`);
        el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
        el.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
      }}
      onPointerLeave={() => { const el = ref.current; if (!el) return; el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }}
    >
      <div className="pcard__frame">
        <div className="pcard__art"><Art p={p} className="pcard__img" /></div>
        <header className="pcard__head">
          <h4>{p.name}</h4>
          <span className="pcard__role">{ROLE_LABEL[category(p)]} · {p.role}</span>
        </header>
        <div className="pcard__types">{p.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}<TypeBadge type={p.tera} tera size="sm" /></div>
        <dl className="pcard__meta">
          <div><dt>Ability</dt><dd>{p.ability}</dd></div>
          <div><dt>Item</dt><dd>{p.item}</dd></div>
          <div><dt>Nature</dt><dd>{p.nature}</dd></div>
        </dl>
        <ul className="pcard__moves" aria-label="Moves">
          {p.moves.map(m => { const t = moveType(m); return <li key={m} data-move={m} style={{ '--t': TYPE_COLORS[t] } as CSSProperties}>{m}<span className="sr-only"> ({t})</span></li>; })}
        </ul>
        {!compact && <p className="pcard__quirk">{p.quirk}</p>}
      </div>
    </article>
  );
});

/** Compact roster chip for HUDs and history. */
export const PokemonChip = memo(function PokemonChip({ p }: { p: Pokemon }) {
  return (
    <div className="pchip" style={{ '--t1': TYPE_COLORS[p.types[0]] } as CSSProperties} title={`${p.name} @ ${p.item} · ${p.ability} · Tera ${p.tera}\n${p.moves.join(' / ')}`}>
      <Art p={p} className="pchip__img" />
      <span className="pchip__name">{p.name}</span>
      <span className="pchip__tera" style={{ '--t': TYPE_COLORS[p.tera] } as CSSProperties} aria-label={`Tera ${p.tera}`} />
    </div>
  );
});

/**
 * Team composition at a glance: role spread, the attacking types its moves reach, and the types that
 * hit several members super effectively (abilities and items such as Levitate or Air Balloon count).
 */
export function TeamSummary({ team }: { team: Pokemon[] }) {
  const roles: Record<string, number> = {};
  team.forEach(p => { const c = ROLE_LABEL[category(p)]; roles[c] = (roles[c] || 0) + 1; });
  const coverage = TYPE_NAMES.filter(t => team.some(p => p.moves.some(m => { const i = moveInfo(m); return !!i && i.category !== 'Status' && i.type === t; })));
  const weak = TYPE_NAMES.filter(t => t !== 'Stellar')
    .map(t => ({ t, n: team.filter(p => (typeVerdict(t, { species: p.name, types: p.types, tera: null, ability: p.ability, item: p.item }).mult ?? 1) >= 2).length }))
    .filter(w => w.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3);
  return (
    <div className="tsum">
      <dl className="tsum__roles" aria-label="Roles">
        {ROLES.map(r => <div key={r} className={roles[r] ? '' : 'is-zero'}><dt>{r}</dt><dd className="num">{roles[r] || 0}</dd></div>)}
      </dl>
      <div className="tsum__row">
        <span className="tsum__label">Coverage</span>
        <span className="tsum__dots" role="img" aria-label={`Attacking types: ${coverage.join(', ')}`}>
          {coverage.map(t => <i key={t} title={t} style={{ '--t': TYPE_COLORS[t] } as CSSProperties} />)}
        </span>
        <b className="num">{coverage.length}</b>
      </div>
      <div className="tsum__row">
        <span className="tsum__label">Weak spots</span>
        {weak.length
          ? weak.map(w => <span key={w.t} className="tsum__weak" title={`${w.n} of ${team.length} take super-effective ${w.t} damage`}><TypeBadge type={w.t} size="sm" /><b className="num">×{w.n}</b></span>)
          : <span className="tsum__none">No type hits two at once</span>}
      </div>
    </div>
  );
}
