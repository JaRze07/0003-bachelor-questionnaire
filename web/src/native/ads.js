// AdMob: banner on home and scoreboard only, one interstitial per hour of use at a natural break.
// Every call fails closed: an SDK error leaves an empty slot and never blocks the game (spec FR-021).
import { meta, setMeta } from '../store/idb.js';
import { addActive, afterInterstitial, bannerAllowed, interstitialAllowed } from '../logic/adGate.js';

const TEST_IDS = { banner: 'ca-app-pub-3940256099942544/6300978111', interstitial: 'ca-app-pub-3940256099942544/1033173712' };
const plugin = () => globalThis.Capacitor?.Plugins?.AdMob ?? null;

let started = false;
let bannerVisible = false;
let bannerBroken = false;
let interstitialInFlight = false;

const unitIds = () => ({
  banner: globalThis.AD_UNIT_BANNER || TEST_IDS.banner,
  interstitial: globalThis.AD_UNIT_INTERSTITIAL || TEST_IDS.interstitial,
});

export async function initAds() {
  const p = plugin();
  if (!p || started) return;
  try {
    await p.initialize({ initializeForTesting: !globalThis.AD_UNIT_BANNER });
    const info = await p.requestConsentInfo();
    if (info?.isConsentFormAvailable && info.status === 'REQUIRED') {
      await p.showConsentForm();
      await setMeta('consent', { at: new Date().toISOString() });
    }
    started = true;
  } catch (err) {
    console.warn('ads init failed, continuing without ads', err);
  }
}

export async function syncBanner(screen, premium) {
  const p = plugin();
  const show = bannerAllowed(screen, premium);
  if (!p) {
    for (const id of ['ad-slot', 'ad-slot-score']) {
      const slot = document.getElementById(id);
      if (slot) slot.hidden = !show;
    }
    return;
  }
  if (bannerBroken) return;
  try {
    if (show && !bannerVisible) {
      await p.showBanner({ adId: unitIds().banner, position: 'BOTTOM_CENTER', margin: 0 });
      bannerVisible = true;
    } else if (!show && bannerVisible) {
      await p.hideBanner();
      bannerVisible = false;
    }
  } catch (err) {
    console.warn('banner failed', err);
    if (!show) {
      // It must not stay up on a screen that forbids it: remove it and stop using banners this session.
      try { await p.removeBanner(); } catch { /* nothing else to try */ }
      bannerVisible = false;
      bannerBroken = true;
    }
  }
}

export async function countUse(seconds) {
  const use = await meta('adUse', { activeSeconds: 0, lastInterstitialAt: null });
  await setMeta('adUse', addActive(use, seconds));
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('ad_timeout')), ms)),
]);

/**
 * Call at a natural break only. Returns true if an ad was shown. The hour's allowance is spent before the
 * SDK is called (so two navigations cannot both pass the check) and every call is bounded in time, so a
 * hung ad never holds up the game.
 */
export async function maybeInterstitial(breakName, premium) {
  if (interstitialInFlight) return false;
  const use = await meta('adUse', { activeSeconds: 0, lastInterstitialAt: null });
  if (!interstitialAllowed(use, breakName, premium)) return false;
  interstitialInFlight = true;
  await setMeta('adUse', afterInterstitial(use));   // spend it first
  const p = plugin();
  if (!p) { interstitialInFlight = false; return false; }
  try {
    await withTimeout(p.prepareInterstitial({ adId: unitIds().interstitial }), 5000);
    await withTimeout(p.showInterstitial(), 5000);
    return true;
  } catch (err) {
    console.warn('interstitial failed', err);
    return false;
  } finally {
    interstitialInFlight = false;
  }
}
