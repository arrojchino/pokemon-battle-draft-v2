/**
 * Errors from the backend and the peer host arrive as fixed English sentences (the wire protocol stays English so
 * every client version understands it). This maps each one back to its `srv.*` key and shows it in the player's
 * language; a message the dictionary does not know is shown as sent.
 */
import { en } from './en.js';
import { isLang, translate, type Lang, type MessageKey } from './core.js';

let byText: Map<string, MessageKey> | null = null;
/** English text -> `srv.*` key, for every message without placeholders (built on first use). */
function keyFor(message: string): MessageKey | undefined {
  if (!byText) {
    byText = new Map();
    for (const k of Object.keys(en) as MessageKey[]) if (k.startsWith('srv.') && !en[k].includes('{')) byText.set(en[k], k);
  }
  return byText.get(message);
}

/** The one server message that names a player: `${name} calls this coin` (shared/src/room.ts). */
const CALLS_COIN = /^(.+) calls this coin$/;

/** A server error message in `lang` (pure: no settings involved, so tests can pick the language). */
export function localizeServerErrorIn(lang: Lang, message: string): string {
  const key = keyFor(message);
  if (key) return translate(lang, key);
  const coin = CALLS_COIN.exec(message);
  if (coin) return translate(lang, 'srv.callsCoin', { name: coin[1] });
  return message;
}

/**
 * A server error message in the current language. index.ts mirrors the language on `<html lang>`; reading it there
 * keeps this module free of the settings store, so it loads in Node tests.
 */
export function localizeServerError(message: string): string {
  const l = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return localizeServerErrorIn(isLang(l) ? l : 'en', message);
}
