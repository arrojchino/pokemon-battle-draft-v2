import { teamImport, type Pokemon } from '@shared';

/**
 * Showdown handoff. What is and is not possible (verified, see README "Showdown integration"):
 *  - play.pokemonshowdown.com is cross-origin. A page cannot inject a team into it, choose a format or
 *    start a battle inside an iframe, and Showdown has no URL parameter that imports a team.
 *  - What does work reliably: valid import text on the clipboard, a public open team sheet on PokePaste
 *    (its /create endpoint accepts a plain form POST), and the standard `/challenge user, format` command.
 */
export const SHOWDOWN_URL = 'https://play.pokemonshowdown.com/';
/** The client treats the URL path as a room id; `teambuilder` opens the Teambuilder directly. */
export const TEAMBUILDER_URL = 'https://play.pokemonshowdown.com/teambuilder';
export const POKEPASTE_CREATE = 'https://pokepast.es/create';

export type FormatOption = { id: string; label: string; note: string };
export const FORMATS: FormatOption[] = [
  { id: 'gen9customgame', label: '[Gen 9] Custom Game', note: 'Recommended. No tier bans or clauses beyond Team Preview, so every dealt team is legal. Challenge-only (not on the ladder).' },
  { id: 'gen9ou', label: '[Gen 9] OU', note: 'Standard OU rules. Some dealt sets break them (for example Spore under the Sleep Moves Clause) and will be rejected.' },
  { id: 'gen9anythinggoes', label: '[Gen 9] Anything Goes', note: 'Minimal bans, but Showdown still validates that sets are obtainable in Gen 9.' },
];

/** Sets that Gen 9 OU's ruleset rejects (from config/formats.ts: Sleep Moves Clause + banlist). */
const OU_BANNED_MOVES = new Set(['Spore', 'Sleep Powder', 'Hypnosis', 'Yawn', 'Lovely Kiss', 'Sing', 'Grass Whistle', 'Dark Void', 'Baton Pass', 'Last Respects', 'Shed Tail', 'Tera Blast']);
export function ouProblems(team: readonly Pokemon[]): string[] {
  return team.flatMap(p => p.moves.filter(m => OU_BANNED_MOVES.has(m)).map(m => `${p.name}: ${m}`));
}

export async function copyText(value: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(value); return true; }
  catch {
    // Fallback for browsers that block the async clipboard API outside secure contexts.
    try {
      const ta = document.createElement('textarea'); ta.value = value; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

/** Publish an open team sheet on PokePaste in a new tab via a top-level form POST (no CORS involved). */
export function openPokePaste(team: readonly Pokemon[], title: string, author: string, format: string) {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = POKEPASTE_CREATE; form.target = '_blank'; form.rel = 'noopener';
  const fields: Record<string, string> = { paste: teamImport(team), title: title.slice(0, 100), author: author.slice(0, 50), notes: `Format: ${format}\nDealt by Pokémon Battle Draft · Stadium League` };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('textarea'); input.name = name; input.value = value; form.appendChild(input);
  }
  form.style.display = 'none';
  document.body.appendChild(form); form.submit(); form.remove();
}

/** Showdown user names: letters, digits and spaces, up to 18 characters. */
export const cleanShowdownName = (v: string) => v.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 18);
export const challengeCommand = (opponent: string, format: string) => `/challenge ${cleanShowdownName(opponent) || 'OPPONENT'}, ${format}`;

export function seriesArchive(history: { game: number; winner: number; teams: [Pokemon[], Pokemon[]] }[], names: [string, string], current?: [Pokemon[], Pokemon[]]) {
  const block = (t: [Pokemon[], Pokemon[]]) => `=== ${names[0].toUpperCase()} ===\n\n${teamImport(t[0])}\n\n=== ${names[1].toUpperCase()} ===\n\n${teamImport(t[1])}`;
  const games = history.map(h => `========== GAME ${h.game} · ${names[h.winner].toUpperCase()} WON ==========\n\n${block(h.teams)}`);
  if (current && current[0].length === 6) games.push(`========== CURRENT GAME ==========\n\n${block(current)}`);
  return games.join('\n\n\n');
}
