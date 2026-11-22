import { pokedexHeight } from '@shared';

/**
 * How tall a Pokémon stands, in scene units. The stadium is built at roughly 1.7 m per unit (seat rows,
 * field lines, trainer boxes), so a 1.2 m Pokémon stands 0.7 units tall, about life size next to the
 * crowd. Real heights run from 0.2 m (Mimikyu) to 12 m (Dondozo), so they are compressed: relative size
 * reads at a glance, the smallest stay visible and the largest still fit the field.
 */
export const REF_HEIGHT = 0.7;
export function monSize(id: number): number {
  const h = pokedexHeight(id) || 1.2;
  return Math.min(1.35, Math.max(0.32, REF_HEIGHT * Math.pow(h / 1.2, 0.55)));
}
