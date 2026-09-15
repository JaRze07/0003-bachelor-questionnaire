import type { Platform, Premium, Repo, User } from '../repo/types.js';
import type { PlayVerifier } from './play.js';
import { conflict } from '../errors.js';
import { nowIso } from './ids.js';

export const PRODUCT_ID = 'premium_forever';

/**
 * Verify a purchase with the store and bind it to `uid` (spec FR-030/FR-036). Idempotent: the same token can
 * be verified again by the same uid (restore); a token bound to another uid is never rebound.
 */
export async function applyPurchase(repo: Repo, play: PlayVerifier, user: User, platform: Platform, productId: string, token: string): Promise<User> {
  if (productId !== PRODUCT_ID) throw conflict('unknown_product');
  const existing = await repo.purchases.get(token);
  if (existing && existing.uid !== user.uid) throw conflict('purchase_bound_elsewhere', 'This purchase is linked to another account');
  const result = await play.verify(productId, token);
  const now = nowIso();
  await repo.purchases.set({
    token, uid: user.uid, platform, productId,
    orderId: result.orderId ?? existing?.orderId,
    state: result.state,
    boundAt: existing?.boundAt ?? now,
    verifiedAt: now,
    raw: result.raw,
  });
  user.premium = nextPremium(user.premium, { platform, productId, token, state: result.state, now });
  await repo.users.set(user);
  return user;
}

/** Store notification (refund, revoke) for a known token: re-verify and update the owner. */
export async function applyNotification(repo: Repo, play: PlayVerifier, token: string, reason: string): Promise<boolean> {
  const p = await repo.purchases.get(token);
  if (!p) return false;
  const user = await repo.users.get(p.uid);
  if (!user) return false;
  const result = await play.verify(p.productId, token);
  const now = nowIso();
  p.state = result.state; p.verifiedAt = now; p.raw = result.raw ?? p.raw;
  await repo.purchases.set(p);
  user.premium = nextPremium(user.premium, { platform: p.platform, productId: p.productId, token, state: result.state, now, reason });
  await repo.users.set(user);
  return true;
}

export function nextPremium(cur: Premium, u: { platform: Platform; productId: string; token: string; state: Premium['state']; now: string; reason?: string }): Premium {
  const base: Premium = { ...cur, platform: u.platform, productId: u.productId, purchaseToken: u.token, lastVerifiedAt: u.now };
  switch (u.state) {
    case 'active':
      return { ...base, state: 'active', since: cur.state === 'active' ? cur.since : u.now, revokedAt: undefined, revokeReason: undefined };
    case 'pending':
      return cur.state === 'active' ? base : { ...base, state: 'pending' };
    case 'revoked':
      return { ...base, state: 'revoked', revokedAt: u.now, revokeReason: u.reason ?? 'store' };
    default:
      // unknown never downgrades an active entitlement; a failed check is retried later
      return cur.state === 'active' ? base : { ...base, state: cur.state === 'none' ? 'unknown' : cur.state };
  }
}
