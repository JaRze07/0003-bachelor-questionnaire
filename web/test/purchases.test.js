import { afterEach, describe, expect, it, vi } from 'vitest';
import { buy, PRODUCT_ID, restore } from '../src/native/purchases.js';

// The shapes below are the ones @capgo/native-purchases 8.7 documents: purchaseProduct() resolves with the
// transaction itself, restorePurchases() with nothing, getPurchases() with { purchases }. On Android
// `transactionId` is the order number and `purchaseToken` is what the Play Developer API verifies.
const androidPurchase = (over = {}) => ({ transactionId: 'GPA.1234-5678-9012-34567', purchaseToken: 'play-token-abc', productIdentifier: PRODUCT_ID, ...over });
const me = { uid: 'g:1', premium: { active: true, state: 'active' } };
const apiOk = () => ({ post: vi.fn(async () => me) });
const install = (plugin) => { globalThis.Capacitor = { Plugins: { NativePurchases: plugin } }; };

afterEach(() => { delete globalThis.Capacitor; });

describe('in-app purchase', () => {
  it('sends the Play purchase token, not the order number, to be verified', async () => {
    install({ purchaseProduct: vi.fn(async () => androidPurchase()) });
    const api = apiOk();
    expect(await buy(api)).toBe(me);
    expect(api.post).toHaveBeenCalledWith('/me/purchases/verify', { platform: 'play', productId: PRODUCT_ID, purchaseToken: 'play-token-abc' });
  });

  it('falls back to the transaction id where there is no purchase token (iOS)', async () => {
    install({ purchaseProduct: vi.fn(async () => ({ transactionId: '2000001043762129', productIdentifier: PRODUCT_ID })) });
    const api = apiOk();
    await buy(api);
    expect(api.post.mock.calls[0][1].purchaseToken).toBe('2000001043762129');
  });

  it('reports a cancelled sheet, a bound purchase and an unconfirmed one as what they are', async () => {
    install({ purchaseProduct: vi.fn(async () => { throw new Error('User cancelled the purchase'); }) });
    expect(await buy(apiOk())).toEqual({ error: 'cancelled' });

    install({ purchaseProduct: vi.fn(async () => androidPurchase()) });
    const refuse = (code) => ({ post: vi.fn(async () => { throw Object.assign(new Error(code), { code }); }) });
    expect(await buy(refuse('purchase_bound_elsewhere'))).toEqual({ error: 'bound_elsewhere' });
    expect(await buy(refuse('verification_unavailable'))).toEqual({ error: 'unconfirmed' });
    expect(await buy({ post: vi.fn(async () => { throw Object.assign(new Error('No connection'), { offline: true }); }) })).toEqual({ error: 'offline' });
  });

  it('restores from the purchases the store lists, this product only', async () => {
    const plugin = {
      restorePurchases: vi.fn(async () => undefined),
      getPurchases: vi.fn(async () => ({ purchases: [androidPurchase(), androidPurchase({ purchaseToken: 'other-app-item', productIdentifier: 'something_else' })] })),
    };
    install(plugin);
    const api = apiOk();
    expect(await restore(api)).toBe(me);
    expect(plugin.restorePurchases).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/me/purchases/restore', { platform: 'play', purchaseTokens: ['play-token-abc'] });
  });

  it('says so when the store has nothing to restore', async () => {
    install({ restorePurchases: vi.fn(async () => undefined), getPurchases: vi.fn(async () => ({ purchases: [] })) });
    const api = apiOk();
    expect(await restore(api)).toEqual({ error: 'none' });
    expect(api.post).not.toHaveBeenCalled();
  });
});
