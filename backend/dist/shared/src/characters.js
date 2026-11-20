/**
 * Partner ids accepted by the server. Presentation data (names, models, colors) lives in the
 * frontend roster; the server only needs the whitelist so it can validate `avatar` messages.
 */
export const CHARACTER_IDS = ['rei', 'kanade', 'mirei'];
export const isCharacterId = (v) => typeof v === 'string' && CHARACTER_IDS.includes(v);
