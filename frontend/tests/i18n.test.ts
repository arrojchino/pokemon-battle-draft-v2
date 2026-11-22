import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.js';
import { LANG_CODES, detectLang, fill, missingKeys, strayPlaceholders, translate } from '../src/i18n/core.js';

describe('i18n dictionaries', () => {
  it('every language has every English key', () => {
    for (const l of LANG_CODES) expect(missingKeys(l), `${l} is missing keys`).toEqual([]);
  });
  it('translations only use placeholders English also uses', () => {
    for (const l of LANG_CODES) expect(strayPlaceholders(l), `${l} has unknown placeholders`).toEqual([]);
  });
  it('no message carries an em dash or CJK characters', () => {
    const bad = /[\u2014\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
    for (const l of LANG_CODES) for (const k of Object.keys(en) as (keyof typeof en)[]) expect(bad.test(translate(l, k)), `${l} ${k}`).toBe(false);
  });
});

describe('i18n lookup', () => {
  it('translates and falls back to English for a missing key', () => {
    expect(translate('es', 'common.back')).toBe('Volver');
    expect(translate('en', 'common.back')).toBe('Back');
  });
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('Hi {name}, {n} left', { name: 'Ash', n: 3 })).toBe('Hi Ash, 3 left');
    expect(fill('Hi {who}', { name: 'Ash' })).toBe('Hi {who}');
  });
  it('picks the browser language when the game ships it', () => {
    expect(detectLang('es-MX')).toBe('es');
    expect(detectLang(['fr-FR', 'es-ES'])).toBe('es');
    expect(detectLang('ja-JP')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
