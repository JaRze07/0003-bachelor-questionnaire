// Capacitor bridges with browser fallbacks, so every screen works in a plain browser during development.
import { meta, setMeta } from '../store/idb.js';

export const isNative = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

export async function deviceId() {
  let id = await meta('deviceId');
  if (!id) {
    id = `dev-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 18)}`;
    await setMeta('deviceId', id);
  }
  return id;
}

export async function deviceLabel() {
  const stored = await meta('deviceLabel');
  if (stored) return stored;
  const ua = globalThis.navigator?.userAgent ?? '';
  const guess = /Android/i.test(ua) ? 'Android phone' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'This device';
  await setMeta('deviceLabel', guess);
  return guess;
}

export async function share(text, title) {
  try {
    if (isNative() && globalThis.Capacitor?.Plugins?.Share) {
      await globalThis.Capacitor.Plugins.Share.share({ title, text });
      return true;
    }
    if (navigator.share) { await navigator.share({ title, text }); return true; }
  } catch { /* user dismissed */ }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return false; }
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Foreground seconds, used by the interstitial gate. */
export function trackForeground(onTick) {
  let last = Date.now();
  const tick = () => {
    const now = Date.now();
    const seconds = Math.round((now - last) / 1000);
    last = now;
    if (document.visibilityState === 'visible' && seconds > 0) onTick(seconds);
  };
  const timer = setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { last = Date.now(); });
  return () => clearInterval(timer);
}
