import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SUPPORTED, translator } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalogue = (lang) => read(`../i18n/${lang}.json`);
const bank = (lang) => read(`../curated/${lang}.json`);
const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe('translations', () => {
  const en = catalogue('en');

  it('ships a catalogue and a question bank for every launch language', () => {
    for (const lang of SUPPORTED) {
      expect(Object.keys(catalogue(lang)).length).toBeGreaterThan(100);
      expect(bank(lang).questions).toHaveLength(20);
    }
  });

  for (const lang of SUPPORTED.filter((l) => l !== 'en')) {
    it(`${lang}: same keys and placeholders as English`, () => {
      const other = catalogue(lang);
      expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(placeholders(other[key]), `${lang}.${key}`).toEqual(placeholders(en[key]));
        expect(String(other[key]).trim().length).toBeGreaterThan(0);
      }
    });

    it(`${lang}: question bank keeps the English ids and order`, () => {
      expect(bank(lang).questions.map((q) => q.id)).toEqual(bank('en').questions.map((q) => q.id));
      for (const q of bank(lang).questions) expect(q.text.length).toBeLessThanOrEqual(130);
    });
  }

  it('substitutes variables and falls back to English', () => {
    const t = translator({ 'a.b': 'Hi {name}' }, en);
    expect(t('a.b', { name: 'Ola' })).toBe('Hi Ola');
    expect(t('round.correct')).toBe(en['round.correct']);
    expect(t('nope.missing')).toBe('nope.missing');
  });
});
