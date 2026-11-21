import type { CharacterId, TypeName } from '@shared';
import { pokemonArt } from '../assets.js';

export type Emote = 'idle' | 'greet' | 'excited' | 'surprised' | 'victory' | 'sad' | 'thinking' | 'bow' | 'twirl' | 'nod' | 'punch' | 'thumbs' | 'faceplant';

export type Character = {
  id: CharacterId;
  name: string;
  /** National Pokédex number: artwork, 3D model and cry. */
  dex: number;
  types: TypeName[];
  /** One short line of personality. */
  quip: string;
  /** UI accent for this partner (signature colour, readable on the dark interface). */
  accent: string;
  accent2: string;
  /** Official artwork, used wherever a portrait is shown. */
  portrait: string;
  /** Which reaction each game moment triggers. */
  personality: { on: { select: Emote; hover: Emote; tossWin: Emote; tossLose: Emote; gameWin: Emote; gameLose: Emote; seriesWin: Emote; attack: Emote } };
};

const partner = (id: CharacterId, name: string, dex: number, types: TypeName[], accent: string, accent2: string, quip: string, on: Partial<Character['personality']['on']> = {}): Character => ({
  id, name, dex, types, accent, accent2, quip, portrait: pokemonArt(dex),
  personality: { on: { select: 'greet', hover: 'nod', tossWin: 'excited', tossLose: 'surprised', gameWin: 'victory', gameLose: 'sad', seriesWin: 'victory', attack: 'punch', ...on } },
});

/** Partner Pokémon. Dex numbers and types are the official ones; quips are original. */
export const ROSTER: Character[] = [
  partner('pikachu', 'Pikachu', 25, ['Electric'], '#ffd23f', '#a37b00', 'Cheeks charged, tail up, ready for anything.', { select: 'excited' }),
  partner('eevee', 'Eevee', 133, ['Normal'], '#e0a56b', '#7a4a22', 'Hasn\u2019t picked an evolution. Has picked a side.', { tossWin: 'twirl' }),
  partner('charizard', 'Charizard', 6, ['Fire', 'Flying'], '#ff7a2f', '#8a2f05', 'The tail flame burns brighter before a big match.', { select: 'punch', gameWin: 'punch' }),
  partner('blastoise', 'Blastoise', 9, ['Water'], '#4f8cff', '#163c8c', 'Two cannons, zero hesitation.', { select: 'nod' }),
  partner('venusaur', 'Venusaur', 3, ['Grass', 'Poison'], '#62d26f', '#1f6b2a', 'Patient as a forest. Twice as stubborn.', { select: 'bow', gameWin: 'bow' }),
  partner('gengar', 'Gengar', 94, ['Ghost', 'Poison'], '#9a6bff', '#3d1f7a', 'Grins in the dark. Grins wider when you lose.', { tossLose: 'thinking', gameLose: 'faceplant' }),
  partner('umbreon', 'Umbreon', 197, ['Dark'], '#f5c542', '#5c4508', 'Rings glow when the stadium lights go down.', { select: 'nod' }),
  partner('snorlax', 'Snorlax', 143, ['Normal'], '#3fb5c4', '#145861', 'Will wake up for a final. Probably.', { select: 'nod', tossLose: 'faceplant' }),
  partner('lapras', 'Lapras', 131, ['Water', 'Ice'], '#5ec8e5', '#1a5f73', 'Carries the whole team across rough water.', { select: 'bow' }),
  partner('mimikyu', 'Mimikyu', 778, ['Ghost', 'Fairy'], '#f2d36b', '#6f5a12', 'The disguise is holding. Mostly.', { tossWin: 'twirl', gameLose: 'faceplant' }),
  partner('dragonite', 'Dragonite', 149, ['Dragon', 'Flying'], '#ffa94d', '#7a4310', 'Gentle until the bell rings.', { tossWin: 'victory' }),
  partner('greninja', 'Greninja', 658, ['Water', 'Dark'], '#3d7bff', '#10275c', 'Already three moves ahead of you.', { select: 'nod', attack: 'punch' }),
  partner('mewtwo', 'Mewtwo', 150, ['Psychic'], '#c39bff', '#4b2a7a', 'Studied every possible draft. Twice.', { select: 'nod', tossWin: 'nod', gameWin: 'thumbs' }),
  partner('fuecoco', 'Fuecoco', 909, ['Fire'], '#ff5a3c', '#7a1a0b', 'Eats first, battles second, wins third.', { select: 'excited' }),
];

export const characterById = (id: CharacterId | null | undefined) => ROSTER.find(c => c.id === id) ?? null;
export const DEFAULT_CHARACTER: CharacterId = 'pikachu';
