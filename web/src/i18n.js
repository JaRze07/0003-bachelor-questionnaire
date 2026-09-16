// Message catalogue. Game language wins for game text; the device language only decorates the shell.
export const SUPPORTED = ['en', 'de', 'es', 'pt', 'pl'];
export const FALLBACK = 'en';

const cache = new Map();

export async function loadCatalogue(lang) {
  const code = SUPPORTED.includes(lang) ? lang : FALLBACK;
  if (cache.has(code)) return cache.get(code);
  const res = await fetch(`i18n/${code}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`catalogue_missing:${code}`);
  const messages = await res.json();
  cache.set(code, messages);
  return messages;
}

export function translator(messages, fallbackMessages = null) {
  return function t(key, vars = {}) {
    let value = messages[key];
    if (value === undefined && fallbackMessages) value = fallbackMessages[key];
    if (value === undefined) {
      console.warn('missing translation', key);
      return key;
    }
    return String(value).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
  };
}

export function deviceLanguage(nav = globalThis.navigator) {
  const raw = (nav?.language || FALLBACK).slice(0, 2).toLowerCase();
  return SUPPORTED.includes(raw) ? raw : FALLBACK;
}

/** Both catalogues so a missing key falls back to English without a second fetch. */
export async function makeTranslator(lang) {
  const [messages, fallback] = await Promise.all([
    loadCatalogue(lang),
    lang === FALLBACK ? Promise.resolve(null) : loadCatalogue(FALLBACK),
  ]);
  return translator(messages, fallback);
}
