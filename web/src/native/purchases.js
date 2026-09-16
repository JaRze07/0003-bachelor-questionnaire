// In-app purchase behind a small interface (spec D3): @capgo/native-purchases on device,
// a local stub in the browser. The server is the only authority on the entitlement.
import { meta, setMeta } from '../store/idb.js';

export const PRODUCT_ID = 'premium_forever';
const plugin = () => globalThis.Capacitor?.Plugins?.NativePurchases ?? null;

export async function productPrice() {
  const p = plugin();
  if (!p) return '€1.00';
  try {
    const { products } = await p.getProducts({ productIdentifiers: [PRODUCT_ID] });
    return products?.[0]?.priceString ?? '€1.00';
  } catch { return null; }
}

/**
 * Buy and let the API verify. Returns the /me payload, or an error code:
 * 'cancelled' | 'offline' | 'unavailable' | 'bound_elsewhere' | 'failed'.
 */
export async function buy(api) {
  const p = plugin();
  try {
    if (!p) {
      const token = `ok-dev-${Date.now()}`;
      await setMeta('devPurchase', token);
      return await api.post('/me/purchases/verify', { platform: 'play', productId: PRODUCT_ID, purchaseToken: token });
    }
    const { transaction } = await p.purchaseProduct({ productIdentifier: PRODUCT_ID });
    const token = transaction?.transactionId ?? transaction?.purchaseToken;
    if (!token) return { error: 'failed' };
    return await api.post('/me/purchases/verify', { platform: 'play', productId: PRODUCT_ID, purchaseToken: token });
  } catch (err) {
    if (err?.offline) return { error: 'offline' };
    if (err?.code === 'purchase_bound_elsewhere') return { error: 'bound_elsewhere' };
    const message = String(err?.message ?? '').toLowerCase();
    if (message.includes('cancel')) return { error: 'cancelled' };
    if (message.includes('unavailable') || message.includes('not available')) return { error: 'unavailable' };
    return { error: 'failed' };
  }
}

export async function restore(api) {
  const p = plugin();
  try {
    let tokens = [];
    if (p) {
      const { transactions } = await p.restorePurchases();
      tokens = (transactions ?? []).map((t) => t.transactionId ?? t.purchaseToken).filter(Boolean);
    } else {
      const token = await meta('devPurchase');
      tokens = token ? [token] : [];
    }
    if (!tokens.length) return { error: 'none' };
    return await api.post('/me/purchases/restore', { platform: 'play', purchaseTokens: tokens });
  } catch (err) {
    return { error: err?.offline ? 'offline' : 'failed' };
  }
}
