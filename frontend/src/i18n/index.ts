/**
 * The game's current language and the `t()` / `useT()` everything else uses. The language is a setting
 * (`settings.lang`, first from `navigator.language`); changing it re-renders every screen that called
 * `useT()` and updates `<html lang>`, with no reload. Code outside React (toasts, error text) calls `t()`.
 */
import { Fragment, createElement, useSyncExternalStore, type ReactNode } from 'react';
import { settings } from '../app/settings.js';
import { LANGS, translate, type Lang, type MessageKey, type Params } from './core.js';

export { LANG_CODES, LANGS, detectLang, isLang, type Lang, type MessageKey } from './core.js';

let lang: Lang = settings.get().lang;
const listeners = new Set<() => void>();
function apply(next: Lang) {
  if (next === lang) return;
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach(l => l());
}
if (typeof document !== 'undefined') document.documentElement.lang = lang;
settings.subscribe(() => apply(settings.get().lang));

export const getLang = () => lang;
export const onLangChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** A message in the current language. */
export function t(key: MessageKey, params?: Params): string { return translate(lang, key, params); }

/**
 * A message with React nodes in its placeholders (a bold name, a link): `{name}` parts become the nodes, in
 * the order the language puts them.
 */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode {
  const parts = translate(lang, key).split(/(\{\w+\})/);
  return createElement(Fragment, null, ...parts.map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return createElement(Fragment, { key: i }, m && m[1] in nodes ? nodes[m[1]] : p);
  }));
}

export type T = typeof t & { rich: typeof tRich; lang: Lang };

/** `t` for a component: it re-renders when the language changes. */
export function useT(): T {
  const l = useSyncExternalStore(onLangChange, getLang, getLang);
  return Object.assign((key: MessageKey, params?: Params) => translate(l, key, params), { rich: tRich, lang: l });
}

/** The display name of each language, written in that language (for the picker). */
export const languageName = (l: Lang) => LANGS[l].name;
