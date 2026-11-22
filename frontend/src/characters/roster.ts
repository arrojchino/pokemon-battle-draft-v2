import type { CharacterId, TypeName } from '@shared';
import { pokemonArt } from '../assets.js';
import type { MessageKey } from '../i18n/core.js';

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

/**
 * Partner Pokémon. Every one is a Switch-era rig with a full battle clip set (idle, attack, damage,
 * faint), so the Pokémon you look at most is always among the best-looking ones: thirteen grade A and
 * Lugia grade B for its 512 px textures (docs/ASSET_AUDIT.md). Dex numbers and types are the official
 * ones; quips are original.
 */
/** The dictionary key of a partner's quip (the English `quip` field stays as the reference text). */
export const quipKey = (id: CharacterId) => `quip.${id}` as MessageKey;

export const ROSTER: Character[] = [
  partner('greninja', 'Greninja', 658, ['Water', 'Dark'], '#3d7bff', '#10275c', 'Already three moves ahead of you.', { select: 'nod', attack: 'punch' }),
  partner('dragonite', 'Dragonite', 149, ['Dragon', 'Flying'], '#ffa94d', '#7a4310', 'Gentle until the bell rings.', { tossWin: 'victory' }),
  partner('mewtwo', 'Mewtwo', 150, ['Psychic'], '#c39bff', '#4b2a7a', 'Studied every possible draft. Twice.', { select: 'nod', tossWin: 'nod', gameWin: 'thumbs' }),
  partner('lugia', 'Lugia', 249, ['Psychic', 'Flying'], '#b9c8ff', '#34407a', 'Calms the storm, then wins the match.', { select: 'bow', gameWin: 'bow' }),
  partner('feraligatr', 'Feraligatr', 160, ['Water'], '#4f9dff', '#12407a', 'Bites first. Asks questions never.', { select: 'excited', attack: 'punch' }),
  partner('flygon', 'Flygon', 330, ['Ground', 'Dragon'], '#7be06a', '#1e5a1a', 'Kicks up a sandstorm and calls it strategy.', { tossWin: 'twirl' }),
  partner('fuecoco', 'Fuecoco', 909, ['Fire'], '#ff5a3c', '#7a1a0b', 'Eats first, battles second, wins third.', { select: 'excited' }),
  partner('marill', 'Marill', 183, ['Water', 'Fairy'], '#4fb4ff', '#154c7a', 'Small, round, and absolutely sure of itself.', { select: 'excited', tossLose: 'faceplant' }),
  partner('gimmighoul', 'Gimmighoul', 999, ['Ghost'], '#f5c542', '#6b4a0a', 'Guards its coins harder than your lead.', { tossLose: 'thinking', gameLose: 'faceplant' }),
  partner('fluttermane', 'Flutter Mane', 987, ['Ghost', 'Fairy'], '#d36bff', '#4c1a6b', 'An ancient wail with modern timing.', { select: 'twirl' }),
  partner('toxel', 'Toxel', 848, ['Electric', 'Poison'], '#b07cff', '#3d1d6b', 'Tiny, grumpy and full of sparks.', { select: 'excited', gameLose: 'faceplant' }),
  partner('kingambit', 'Kingambit', 983, ['Dark', 'Steel'], '#e04848', '#5a1010', 'Leads from the front. Every time.', { select: 'nod', tossWin: 'nod', gameWin: 'thumbs' }),
  partner('thwackey', 'Thwackey', 811, ['Grass'], '#8fd14f', '#2f5a12', 'Keeps the beat, keeps the pressure.', { select: 'excited', tossWin: 'twirl' }),
  partner('eiscue', 'Eiscue', 875, ['Ice'], '#7fd8ff', '#1d5a7a', 'Keeps a cool head. Literally.', { select: 'bow', tossLose: 'faceplant' }),
];

export const characterById = (id: CharacterId | null | undefined) => ROSTER.find(c => c.id === id) ?? null;
export const DEFAULT_CHARACTER: CharacterId = 'greninja';
