import { forwardRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { RoleCategory, TypeName } from '@shared';
import { Icon, Segmented } from '../../primitives.js';
import { BATTLE_TYPES, ROLES, ROLE_INFO, typeVar, type SortKey } from './dexData.js';

type BarProps = {
  q: string; onQuery: (q: string) => void;
  sort: SortKey; onSort: (s: SortKey) => void;
  shown: number; total: number; filtered: boolean; onClear: () => void;
};

/** Sticky search row: query, live result count, reset, sort. "/" focuses the field from anywhere. */
export const DexSearchBar = forwardRef<HTMLInputElement, BarProps>(function DexSearchBar({ q, onQuery, sort, onSort, shown, total, filtered, onClear }, ref) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escape clears the query first; with an empty field it falls through and closes the detail.
    if (e.key === 'Escape' && q) { e.preventDefault(); onQuery(''); }
  };
  return (
    <div className="dexbar">
      <div className="dexbar__search">
        <Icon name="search" />
        <input ref={ref} className="input" type="search" value={q} aria-label="Search the draft pool" placeholder="Search name, move, ability or item"
          autoComplete="off" spellCheck={false} onChange={e => onQuery(e.target.value)} onKeyDown={onKeyDown} />
        {q
          ? <button type="button" className="iconbtn dexbar__clear" onClick={() => onQuery('')} aria-label="Clear search"><Icon name="close" size={16} /></button>
          : <kbd className="dexbar__kbd" aria-hidden="true">/</kbd>}
      </div>
      <p className="dexbar__count" aria-live="polite">
        {filtered ? <><b>{shown}</b> of {total}</> : <><b>{total}</b> sets</>}
      </p>
      {filtered && <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}><Icon name="refresh" size={14} />Reset</button>}
      <div className="dexbar__sort">
        <span className="dexbar__label">Sort</span>
        <Segmented label="Sort by" value={sort} onChange={onSort}
          options={[{ value: 'dex', label: 'No.' }, { value: 'name', label: 'A–Z' }, { value: 'role', label: 'Role' }]} />
      </div>
    </div>
  );
});

type FilterProps = {
  types: ReadonlySet<TypeName>; onType: (t: TypeName) => void; typeCounts: ReadonlyMap<TypeName, number>;
  roles: ReadonlySet<RoleCategory>; onRole: (r: RoleCategory) => void; roleCounts: ReadonlyMap<RoleCategory, number>;
};

/** Role and type chips. Several chips in one row widen the search (any of them); rows narrow it. */
export function DexFilters({ types, onType, typeCounts, roles, onRole, roleCounts }: FilterProps) {
  return (
    <div className="dexfilters">
      <div className="dexfilters__row" role="group" aria-label="Filter by role">
        <span className="dexfilters__label" aria-hidden="true">Role</span>
        <div className="dexfilters__chips">
          {ROLES.map(r => {
            const n = roleCounts.get(r) ?? 0;
            return (
              <button key={r} type="button" className={`dexchip ${n ? '' : 'is-empty'}`} aria-pressed={roles.has(r)} onClick={() => onRole(r)}>
                <Icon name={ROLE_INFO[r].icon} size={13} />{ROLE_INFO[r].label}<small>{n}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="dexfilters__row" role="group" aria-label="Filter by type">
        <span className="dexfilters__label" aria-hidden="true">Type</span>
        <div className="dexfilters__chips">
          {BATTLE_TYPES.map(t => {
            const n = typeCounts.get(t) ?? 0;
            return (
              <button key={t} type="button" className={`dexchip dexchip--type ${n ? '' : 'is-empty'}`} style={{ '--t': typeVar(t) } as CSSProperties}
                aria-pressed={types.has(t)} onClick={() => onType(t)}>
                {t}<small>{n}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
