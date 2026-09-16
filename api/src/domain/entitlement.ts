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
  // Claim first, atomically: two accounts verifying the same token cannot both end up premium.
  const claim = await repo.purchases.claim(token, user.uid);
  if (!claim.ok) throw conflict('purchase_bound_elsewhere', 'This purchase is linked to another account');
  const existing = await repo.purchases.get(token);
  const result = await play.verify(productId, token);
  // 'unknown' means the store could not be reached: bind nothing, so a Play outage cannot
  // hand a token to the wrong account or park it forever.
  if (result.state === 'unknown' && (!existing || existing.productId === '')) {
    // Nothing was ever verified for this token: drop the reservation so a later attempt can claim it.
    await repo.purchases.release(token, user.uid);
    throw conflict('verification_unavailable', 'The store could not confirm this purchase yet');
  }
  const now = nowIso();
  await repo.purchases.set({
    token, uid: user.uid, platform, productId,
    orderId: result.orderId ?? existing?.orderId,
    state: result.state,
    boundAt: existing?.boundAt ?? now,
    verifiedAt: now,
    raw: result.raw,
  });
  user.premium = await aggregate(repo, user, { platform, productId, token, state: result.state, now });
  await repo.users.update(user.uid, { premium: user.premium });
  return user;
}

/**
 * Entitlement over all purchases bound to the user: premium stays active while any purchase is active,
 * so re-verifying an old refunded token cannot revoke a newer valid one.
 */
async function aggregate(repo: Repo, user: User, u: Parameters<typeof nextPremium>[1]): Promise<Premium> {
  const next = nextPremium(user.premium, u);
  if (next.state === 'active') return next;
  const others = (await repo.purchases.listByUid(user.uid)).filter((p) => p.token !== u.token);
  const stillActive = others.find((p) => p.state === 'active');
  if (!stillActive) return next;
  return {
    ...next, state: 'active', platform: stillActive.platform, productId: stillActive.productId,
    purchaseToken: stillActive.token, since: user.premium.since ?? stillActive.boundAt,
    revokedAt: undefined, revokeReason: undefined,
  };
}

/** Store notification (refund, revoke) for a known token: re-verify and update the owner. */
export class TransientVerification extends Error {}

export async function applyNotification(repo: Repo, play: PlayVerifier, token: string, reason: string): Promise<boolean> {
  const p = await repo.purchases.get(token);
  if (!p) return false;
  const user = await repo.users.get(p.uid);
  if (!user) return false;
  const result = await play.verify(p.productId, token);
  // The store was unreachable: let Pub/Sub retry instead of acknowledging a refund we could not confirm.
  if (result.state === 'unknown') throw new TransientVerification('store unreachable');
  const now = nowIso();
  p.state = result.state; p.verifiedAt = now; p.raw = result.raw ?? p.raw;
  await repo.purchases.set(p);
  user.premium = await aggregate(repo, user, { platform: p.platform, productId: p.productId, token, state: result.state, now, reason });
  await repo.users.update(user.uid, { premium: user.premium });
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
