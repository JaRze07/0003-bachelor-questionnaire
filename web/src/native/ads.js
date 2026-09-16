// AdMob: banner on home and scoreboard only, one interstitial per hour of use at a natural break.
// Every call fails closed: an SDK error leaves an empty slot and never blocks the game (spec FR-021).
import { meta, setMeta } from '../store/idb.js';
import { addActive, afterInterstitial, bannerAllowed, interstitialAllowed } from '../logic/adGate.js';

const TEST_IDS = { banner: 'ca-app-pub-3940256099942544/6300978111', interstitial: 'ca-app-pub-3940256099942544/1033173712' };
const plugin = () => globalThis.Capacitor?.Plugins?.AdMob ?? null;

let started = false;
let bannerVisible = false;

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
    document.body.classList.toggle('has-ad', show);
    const slot = document.getElementById('ad-slot');
    if (slot) slot.hidden = !show;
    return;
  }
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
  }
}

export async function countUse(seconds) {
  const use = await meta('adUse', { activeSeconds: 0, lastInterstitialAt: null });
  await setMeta('adUse', addActive(use, seconds));
}

/** Call at a natural break only. Returns true if an ad was shown. */
export async function maybeInterstitial(breakName, premium) {
  const use = await meta('adUse', { activeSeconds: 0, lastInterstitialAt: null });
  if (!interstitialAllowed(use, breakName, premium)) return false;
  const p = plugin();
  if (!p) { await setMeta('adUse', afterInterstitial(use)); return false; }
  try {
    await p.prepareInterstitial({ adId: unitIds().interstitial });
    await p.showInterstitial();
    await setMeta('adUse', afterInterstitial(use));
    return true;
  } catch (err) {
    console.warn('interstitial failed', err);
    return false;
  }
}
