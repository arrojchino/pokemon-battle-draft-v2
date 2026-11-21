/**
 * Partner bot paint jobs accepted by the server. Every player brings the same comic battle bot and
 * picks its paint; presentation data (names, colours, reactions) lives in the frontend roster. The
 * server only needs the whitelist so it can validate `avatar` messages.
 */
export const CHARACTER_IDS = ['rust', 'toxic', 'caution', 'hotrod', 'bruiser', 'coolant', 'oilslick', 'bonedry'] as const;
export type CharacterId = typeof CHARACTER_IDS[number];

export const isCharacterId = (v: unknown): v is CharacterId =>
  typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);
