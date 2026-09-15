// Interstitial gate: at most one per 60 minutes of active foreground use, only at natural breaks.
// Placement allow-list keeps banners off every screen but home and scoreboard (spec FR-021).

export const INTERSTITIAL_EVERY_SEC = 3600;
export const BANNER_SCREENS = new Set(['home', 'scoreboard']);
export const BREAKS = new Set(['scoreboard_closed', 'before_new_game']);

export function bannerAllowed(screen, premium) {
  return !premium && BANNER_SCREENS.has(screen);
}

/**
 * `use` = { activeSeconds, lastInterstitialAt } persisted in meta. Returns true when an interstitial may show
 * at `breakName` now. `activeSeconds` counts foreground time since the last interstitial.
 */
export function interstitialAllowed(use, breakName, premium) {
  if (premium) return false;
  if (!BREAKS.has(breakName)) return false;
  return (use.activeSeconds || 0) >= INTERSTITIAL_EVERY_SEC;
}

export function afterInterstitial(use, now = Date.now()) {
  return { activeSeconds: 0, lastInterstitialAt: new Date(now).toISOString() };
}

/** Add foreground seconds; ignores absurd jumps (clock changes, sleep). */
export function addActive(use, seconds) {
  const s = Math.max(0, Math.min(seconds, 300));
  return { ...use, activeSeconds: (use.activeSeconds || 0) + s };
}
