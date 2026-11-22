/**
 * Translation core, free of React and of the settings store so it can be unit tested. One dictionary per
 * language (`en.ts` is the reference and the fallback); adding a language is one new file plus a line in LANGS.
 * Messages use `{name}` placeholders. Nothing here calls a translation service: every string ships with the game.
 *
 * Not translated on purpose: Pokémon, move, ability and item names (they come from Showdown data), player
 * names and player chat.
 */
import { en, type MessageKey } from './en.js';
import { es } from './es.js';

export type { MessageKey } from './en.js';
export type Dictionary = Partial<Record<MessageKey, string>>;
export type Params = Record<string, string | number>;

/** Every language the game ships, in the order the picker shows them. `name` is written in that language. */
export const LANGS = {
  en: { name: 'English', dict: en as Dictionary },
  es: { name: 'Español', dict: es },
} as const;
export type Lang = keyof typeof LANGS;
export const LANG_CODES = Object.keys(LANGS) as Lang[];
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && v in LANGS;

/** The language a browser asks for (`navigator.language`, e.g. 'es-MX'), or English when the game lacks it. */
export function detectLang(preferred: readonly string[] | string | undefined | null): Lang {
  const list = Array.isArray(preferred) ? preferred : preferred ? [preferred] : [];
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

/** Fill `{name}` placeholders; unknown ones stay visible so a missing parameter is easy to spot. */
export function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** A message in `lang`, falling back to English for a key the language does not have yet. */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const s = LANGS[lang].dict[key] ?? en[key] ?? key;
  return fill(s, params);
}

/**
 * The game's language as mirrored on `<html lang>` by i18n/index.ts, for pure modules (battle model, matchup hints)
 * that must not load the settings store; English when there is no document (Node tests).
 */
export function docLang(): Lang {
  const l = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return isLang(l) ? l : 'en';
}
/** `translate` in the language on `<html lang>`. Call it when the text is needed, never at module load. */
export const tDoc = (key: MessageKey, params?: Params): string => translate(docLang(), key, params);

/** Keys a language is missing compared with English (the completeness test fails on any). */
export function missingKeys(lang: Lang): MessageKey[] {
  const d = LANGS[lang].dict;
  return (Object.keys(en) as MessageKey[]).filter(k => typeof d[k] !== 'string' || d[k] === '');
}

/** Placeholders a translation uses that English does not (a typo there would show up as raw text). */
export function strayPlaceholders(lang: Lang): string[] {
  const d = LANGS[lang].dict, out: string[] = [];
  const names = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]));
  for (const k of Object.keys(en) as MessageKey[]) {
    const tr = d[k];
    if (!tr) continue;
    const want = names(en[k]);
    for (const n of names(tr)) if (!want.has(n)) out.push(`${k}: {${n}}`);
  }
  return out;
}
