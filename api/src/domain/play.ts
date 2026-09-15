// Google Play purchase verification behind a small interface so tests use a fake and RevenueCat (D3b)
// could replace it later without touching the routes.
import type { PremiumState } from '../repo/types.js';

export interface VerifyResult { state: PremiumState; orderId?: string; raw?: Record<string, unknown> }

export interface PlayVerifier {
  verify(productId: string, purchaseToken: string): Promise<VerifyResult>;
}

/** Test/dev fake: tokens starting with `ok-` are active, `pending-` pending, `refund-` revoked, else unknown. */
export function fakePlayVerifier(): PlayVerifier {
  return {
    async verify(_productId, token) {
      if (token.startsWith('ok-')) return { state: 'active', orderId: `GPA.${token}` };
      if (token.startsWith('pending-')) return { state: 'pending' };
      if (token.startsWith('refund-')) return { state: 'revoked', orderId: `GPA.${token}` };
      return { state: 'unknown' };
    },
  };
}

/**
 * Real verifier: androidpublisher.purchases.products.get with Application Default Credentials.
 * The Cloud Run service account must be linked in the Play Console (API access). PLAY_PACKAGE_NAME required.
 */
export function createPlayVerifier(): PlayVerifier {
  if (process.env.DEV_AUTH === '1' || process.env.PLAY_FAKE === '1') return fakePlayVerifier();
  const packageName = process.env.PLAY_PACKAGE_NAME ?? 'com.jr07.bachelorquestionnaire';
  let client: Promise<import('googleapis').androidpublisher_v3.Androidpublisher> | null = null;
  const get = () => {
    if (!client) {
      client = (async () => {
        const { google } = await import('googleapis');
        const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
        return google.androidpublisher({ version: 'v3', auth });
      })();
    }
    return client;
  };
  return {
    async verify(productId, purchaseToken) {
      try {
        const api = await get();
        const res = await api.purchases.products.get({ packageName, productId, token: purchaseToken });
        const d = res.data;
        // purchaseState: 0 purchased, 1 canceled, 2 pending
        const state: PremiumState = d.purchaseState === 0 ? 'active' : d.purchaseState === 2 ? 'pending' : 'revoked';
        return { state, orderId: d.orderId ?? undefined, raw: { purchaseState: d.purchaseState, acknowledgementState: d.acknowledgementState, purchaseTimeMillis: d.purchaseTimeMillis } };
      } catch (e) {
        console.error(JSON.stringify({ severity: 'WARNING', message: 'play verify failed', error: String(e) }));
        return { state: 'unknown' };
      }
    },
  };
}
