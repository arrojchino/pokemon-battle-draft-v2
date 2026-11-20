import { memo, useRef, useState, type CSSProperties } from 'react';
import { category, type Pokemon, type TypeName } from '@shared';
import { pokemonArt } from '../assets.js';

/** Conventional type palette used across Pokémon fan tools. */
export const TYPE_COLORS: Record<TypeName, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad', Stellar: '#40b5a5',
};

export const TypeBadge = ({ type, tera = false, size = 'md' }: { type: TypeName; tera?: boolean; size?: 'sm' | 'md' }) => (
  <span className={`type type--${size} ${tera ? 'type--tera' : ''}`} style={{ '--t': TYPE_COLORS[type] } as CSSProperties}>
    {tera && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.5 11 4 9 11 3 11 1 4Z" /></svg>}
    {type}{tera ? ' Tera' : ''}
  </span>
);

const ROLE_LABEL = { hazard: 'Hazards', support: 'Support', setup: 'Setup', attacker: 'Attacker', other: 'Flex' } as const;

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
 * Full set card. The tilt follows the pointer through CSS custom properties written directly to the
 * element (no React state per mousemove), and CSS transitions smooth it.
 */
export const PokemonCard = memo(function PokemonCard({ p, index = 0, highlight, compact = false }: { p: Pokemon; index?: number; highlight?: string; compact?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const primary = TYPE_COLORS[p.types[0]];
  return (
    <article
      ref={ref}
      className={`pcard ${compact ? 'pcard--compact' : ''}`}
      title={compact ? p.quirk : undefined}
      style={{ '--t1': primary, '--t2': TYPE_COLORS[p.types[1] ?? p.types[0]], '--i': index, '--hl': highlight ?? 'transparent' } as CSSProperties}
      onPointerMove={e => {
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
        el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 12}deg`);
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
        <ul className="pcard__moves">{p.moves.map(m => <li key={m}>{m}</li>)}</ul>
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

/** Team composition: role spread, species-type spread and Tera types at a glance. */
export function TeamSummary({ team }: { team: Pokemon[] }) {
  const roles: Record<string, number> = {};
  const types: Partial<Record<TypeName, number>> = {};
  team.forEach(p => { const c = ROLE_LABEL[category(p)]; roles[c] = (roles[c] || 0) + 1; p.types.forEach(t => (types[t] = (types[t] || 0) + 1)); });
  const sortedTypes = (Object.entries(types) as [TypeName, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div className="tsum">
      <div className="tsum__roles">
        {(['Hazards', 'Support', 'Setup', 'Attacker', 'Flex'] as const).map(r => (
          <div key={r} className="tsum__role"><span>{r}</span><i style={{ '--n': roles[r] || 0 } as CSSProperties} /><b>{roles[r] || 0}</b></div>
        ))}
      </div>
      <div className="tsum__types" aria-label="Species types">
        {sortedTypes.map(([t, n]) => <span key={t} className="tsum__type" style={{ '--t': TYPE_COLORS[t], flexGrow: n } as CSSProperties} title={`${t} ×${n}`} />)}
      </div>
      <div className="tsum__tera">{team.map(p => <TypeBadge key={p.name} type={p.tera} tera size="sm" />)}</div>
    </div>
  );
}
