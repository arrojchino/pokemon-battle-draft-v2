/**
 * Partner ids accepted by the server. Presentation data (names, models, colors) lives in the
 * frontend roster; the server only needs the whitelist so it can validate `avatar` messages.
 */
export const CHARACTER_IDS = ['rei', 'kanade', 'mirei'] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

export const isCharacterId = (v: unknown): v is CharacterId =>
  typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);
