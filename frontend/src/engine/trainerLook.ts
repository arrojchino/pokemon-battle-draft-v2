/**
 * A trainer's look: outfit and accent from their partner's colour, a stable variation from their id, so the same
 * person looks the same on every screen (and the profile picker shows the colour the world uses).
 */
const OUTFITS = ['#2b3a67', '#5a2a3c', '#1f4d4a', '#3d3354', '#4a3b22', '#22324a', '#5b2f2f', '#2d4a2b'];
const HAIR = ['#2a1d16', '#5a3a22', '#c8a26a', '#1b1b22', '#7a2e2e', '#3a4a6a'];
const hash = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };

export const trainerOutfit = (id: string) => OUTFITS[hash(id) % OUTFITS.length];

export function trainerLook(id: string, accent: string) {
  const h = hash(id);
  return { outfit: OUTFITS[h % OUTFITS.length], accent, hair: HAIR[(h >>> 4) % HAIR.length] };
}
