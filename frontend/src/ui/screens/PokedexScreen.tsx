import { POOL } from '@shared';
import { ScreenHeader } from '../primitives.js';
import { PokemonCard } from '../pokemon.js';

/** The draft pool: every set the coin can deal. The Pokédex workstream turns this into the full browser. */
export function PokedexScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen dex">
      <ScreenHeader title="Draft Pool" eyebrow={`${POOL.length} sets`} jp="図鑑" onBack={onBack} />
      <div className="dex__grid">{POOL.map((p, i) => <PokemonCard key={p.name} p={p} index={i} compact />)}</div>
    </main>
  );
}
