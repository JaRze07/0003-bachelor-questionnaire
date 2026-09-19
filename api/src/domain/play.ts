// Google Play purchase verification behind a small interface so tests use a fake and RevenueCat (D3b)
// could replace it later without touching the routes.
import type { PremiumState } from '../repo/types.js';

export interface VerifyResult { state: PremiumState; orderId?: string; raw?: Record<string, unknown> }

export interface PlayVerifier {
  verify(productId: string, purchaseToken: string): Promise<VerifyResult>;
}

/**
 * Test/dev fake: tokens starting with `ok-` are active, `pending-` pending, `refund-` revoked, else unknown.
 * `overrides` lets a test flip a token later, the way a refund does in the store.
 */
export function fakePlayVerifier(overrides = new Map<string, PremiumState>()): PlayVerifier & { overrides: Map<string, PremiumState> } {
  return {
    overrides,
    async verify(_productId, token) {
      const forced = overrides.get(token);
      if (forced) return { state: forced, orderId: `GPA.${token}` };
      if (token.startsWith('ok-')) return { state: 'active', orderId: `GPA.${token}` };
      if (token.startsWith('pending-')) return { state: 'pending' };
      if (token.startsWith('refund-')) return { state: 'revoked', orderId: `GPA.${token}` };
      return { state: 'unknown' };
    },
  };
}

/**
 * Real verifier: Play Developer API `purchases.products.get`, called with a service-account access token.
 * GOOGLE_APPLICATION_CREDENTIALS points at the key file on the box; the account must be linked in the
 * Play Console (API access). PLAY_PACKAGE_NAME names the app.
 */
export function createPlayVerifier(): PlayVerifier {
  if (process.env.DEV_AUTH === '1' || process.env.PLAY_FAKE === '1') return fakePlayVerifier();
  const packageName = process.env.PLAY_PACKAGE_NAME ?? 'com.jr07.bachelorquestionnaire';
  let auth: import('google-auth-library').GoogleAuth | null = null;
  return {
    async verify(productId, purchaseToken) {
      try {
        if (!auth) {
          const { GoogleAuth } = await import('google-auth-library');
          auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
        }
        const client = await auth.getClient();
        const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`
          + `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
        const res = await client.request<{ purchaseState?: number; orderId?: string; acknowledgementState?: number; purchaseTimeMillis?: string }>({ url, timeout: 8000 });
        const d = res.data;
        // purchaseState: 0 purchased, 1 canceled, 2 pending
        const state: PremiumState = d.purchaseState === 0 ? 'active' : d.purchaseState === 2 ? 'pending' : 'revoked';
        return { state, orderId: d.orderId ?? undefined, raw: { purchaseState: d.purchaseState, acknowledgementState: d.acknowledgementState, purchaseTimeMillis: d.purchaseTimeMillis } };
      } catch (e) {
        const status = (e as { response?: { status?: number } }).response?.status;
        // 404/410: the store says this purchase does not exist (or was voided long ago) - that is an answer.
        if (status === 404 || status === 410) return { state: 'revoked' };
        console.error(JSON.stringify({ severity: 'WARNING', message: 'play verify failed', status, error: String(e) }));
        return { state: 'unknown' };
      }
    },
  };
}
