import { memo, type CSSProperties } from 'react';
import type { Pokemon, RoleCategory } from '@shared';
import { Icon } from '../../primitives.js';
import { Sprite, TypeBadge } from '../../pokemon.js';
import { ROLE_INFO, dexNo, typeVar, type Match } from './dexData.js';

const FIELD = { name: 'Name', move: 'Move', ability: 'Ability', item: 'Item' } as const;

type Props = {
  p: Pokemon; role: RoleCategory; match: Match; index: number;
  tabbable: boolean; selected: boolean;
  onOpen: (name: string) => void; onFocusCard: (name: string) => void;
};

/**
 * One grid slot. The <li> carries the entrance and FLIP motion, the button carries hover and focus,
 * so the two never fight over `transform`. A search that matched a move, ability or item says so.
 */
export const DexCard = memo(function DexCard({ p, role, match, index, tabbable, selected, onOpen, onFocusCard }: Props) {
  const r = ROLE_INFO[role];
  const hit = match.field === 'name' ? null : match;
  return (
    <li data-flip={p.name} style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className={`card card--interactive dexcard ${selected ? 'is-selected' : ''}`}
        data-name={p.name}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected || undefined}
        aria-label={`${p.name}, ${dexNo(p.id)}, ${p.types.join(' and ')}, ${r.label}: ${p.role}${hit ? `. Matches ${FIELD[hit.field].toLowerCase()} ${hit.value}` : ''}`}
        style={{ '--t1': typeVar(p.types[0]), '--t2': typeVar(p.types[1] ?? p.types[0]) } as CSSProperties}
        onClick={() => onOpen(p.name)}
        onFocus={() => onFocusCard(p.name)}
      >
        <span className="dexcard__art">
          <span className="dexcard__ball"><Icon name="ball" /></span>
          <Sprite artId={p.artId ?? p.id} name={p.name} className="dexcard__img" />
          <span className="dexcard__no">{dexNo(p.id)}</span>
          {hit && <span className="badge badge--accent dexcard__hit"><Icon name="search" size={11} />{FIELD[hit.field]} · {hit.value}</span>}
        </span>
        <span className="dexcard__body">
          <span className="dexcard__name">{p.name}</span>
          <span className="dexcard__types">{p.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</span>
          <span className="dexcard__role"><Icon name={r.icon} size={13} /><b>{r.label}</b><span>{p.role}</span></span>
        </span>
      </button>
    </li>
  );
});
