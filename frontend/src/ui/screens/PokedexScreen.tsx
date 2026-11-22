import { POOL } from '@shared';
import { ScreenHeader } from '../primitives.js';
import { PokemonCard } from '../pokemon.js';
import { useT } from '../../i18n/index.js';

/** The draft pool: every set the coin can deal. The Pokédex workstream turns this into the full browser. */
export function PokedexScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <main className="screen dex">
      <ScreenHeader title={t('dex.title')} eyebrow={t('dex.countSets', { total: POOL.length })} onBack={onBack} />
      <div className="dex__grid scroller" tabIndex={0} aria-label={t('dex.poolAria')}>{POOL.map((p, i) => <PokemonCard key={p.name} p={p} index={i} compact />)}</div>
    </main>
  );
}
