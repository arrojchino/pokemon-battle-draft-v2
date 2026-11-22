import { memo, type CSSProperties } from 'react';
import type { Pokemon, RoleCategory } from '@shared';
import { Icon } from '../../primitives.js';
import { ROLE_KEY, Sprite, TypeBadge } from '../../pokemon.js';
import { useT, type MessageKey } from '../../../i18n/index.js';
import { ROLE_INFO, dexNo, typeVar, type Match } from './dexData.js';

const FIELD = { name: 'dex.fieldName', move: 'dex.fieldMove', ability: 'dex.fieldAbility', item: 'dex.fieldItem' } as const satisfies Record<string, MessageKey>;

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
  const t = useT();
  const r = ROLE_INFO[role];
  const hit = match.field === 'name' ? null : match;
  const aria = { name: p.name, no: dexNo(p.id), types: p.types.length === 2 ? t('dex.typesTwo', { a: p.types[0], b: p.types[1] }) : p.types.join(', '), role: t(ROLE_KEY[role]), detail: p.role };
  return (
    <li data-flip={p.name} style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className={`card card--interactive dexcard ${selected ? 'is-selected' : ''}`}
        data-name={p.name}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected || undefined}
        aria-label={hit ? t('dex.cardAriaMatch', { ...aria, field: t(FIELD[hit.field]).toLowerCase(), value: hit.value }) : t('dex.cardAria', aria)}
        style={{ '--t1': typeVar(p.types[0]), '--t2': typeVar(p.types[1] ?? p.types[0]) } as CSSProperties}
        onClick={() => onOpen(p.name)}
        onFocus={() => onFocusCard(p.name)}
      >
        <span className="dexcard__art">
          <span className="dexcard__ball"><Icon name="ball" /></span>
          <Sprite artId={p.artId ?? p.id} name={p.name} className="dexcard__img" />
          <span className="dexcard__no">{dexNo(p.id)}</span>
          {hit && <span className="badge badge--accent dexcard__hit"><Icon name="search" size={11} />{t(FIELD[hit.field])} · {hit.value}</span>}
        </span>
        <span className="dexcard__body">
          <span className="dexcard__name">{p.name}</span>
          <span className="dexcard__types">{p.types.map(t => <TypeBadge key={t} type={t} size="sm" />)}</span>
          <span className="dexcard__role"><Icon name={r.icon} size={13} /><b>{t(ROLE_KEY[role])}</b><span>{p.role}</span></span>
        </span>
      </button>
    </li>
  );
});
