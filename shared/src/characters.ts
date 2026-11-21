/**
 * Partner Pokémon a player can bring. The partner is the player's avatar: shown on the title screen, in
 * lobbies, on the scoreboard and on the field between battles. Presentation data (names, colours,
 * reactions, models) lives in the frontend roster; the server only needs the whitelist so it can
 * validate `avatar` messages.
 */
export const CHARACTER_IDS = [
  'greninja', 'dragonite', 'mewtwo', 'lugia', 'feraligatr', 'flygon', 'fuecoco',
  'marill', 'gimmighoul', 'fluttermane', 'toxel', 'kingambit', 'thwackey', 'eiscue',
] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

export const isCharacterId = (v: unknown): v is CharacterId =>
  typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);
