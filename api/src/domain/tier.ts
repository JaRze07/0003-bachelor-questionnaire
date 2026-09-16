import type { Game, GameSettings, Premium, User } from '../repo/types.js';
import { forbidden } from '../errors.js';

export const isPremium = (user: User | null | undefined): boolean => user?.premium.state === 'active';

/** Premium mutations are allowed only with an active entitlement; revoked gets its own code (spec FR-036). */
export function requirePremium(user: User | null | undefined): void {
  if (isPremium(user)) return;
  if (user?.premium.state === 'revoked') throw forbidden('premium_revoked', 'Premium was refunded; existing games stay playable');
  throw forbidden('premium_required');
}

/** Free hosts may only use the default scheme and no extra rules. */
export function assertSettingsAllowed(settings: GameSettings, user: User | null | undefined): void {
  if (isPremium(user)) return;
  const wantsPremium = settings.penaltyScheme !== 'drink_or_dare'
    || settings.customPenalties.length > 0
    || settings.rules.strikeBack || settings.rules.doubleOrNothing;
  if (wantsPremium) requirePremium(user);
}

export const defaultSettings = (): GameSettings => ({
  penaltyScheme: 'drink_or_dare',
  customPenalties: [],
  rules: { strikeBack: false, doubleOrNothing: false },
  randomOrder: false,
});

export const premiumSummary = (p: Premium) => ({
  active: p.state === 'active',
  state: p.state,
  since: p.since,
  lastVerifiedAt: p.lastVerifiedAt,
});

export const tierOf = (user: User | null | undefined): Game['tier'] => (isPremium(user) ? 'premium' : 'free');
