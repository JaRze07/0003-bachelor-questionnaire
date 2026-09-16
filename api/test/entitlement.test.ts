import { describe, expect, it } from 'vitest';
import { harness, seedGame } from './helpers.js';

const verify = (h: any, token: string, uid = 'u1') =>
  h.host('/me/purchases/verify', { uid, json: { platform: 'play', productId: 'premium_forever', purchaseToken: token } });

describe('premium entitlement', () => {
  it('activates on a verified purchase and is idempotent', async () => {
    const h = harness();
    expect((await h.host('/me').then((r: Response) => r.json()) as any).premium.state).toBe('none');
    const first = await verify(h, 'ok-abc').then((r: Response) => r.json()) as any;
    expect(first.premium.active).toBe(true);
    expect(first.limits.questions).toBe(100);
    const again = await verify(h, 'ok-abc').then((r: Response) => r.json()) as any;
    expect(again.premium.since).toBe(first.premium.since);
  });

  it('a pending purchase does not unlock premium', async () => {
    const h = harness();
    const body = await verify(h, 'pending-1').then((r: Response) => r.json()) as any;
    expect(body.premium.state).toBe('pending');
    expect(body.premium.active).toBe(false);
  });

  it('refuses to rebind a purchase to a second account', async () => {
    const h = harness();
    await verify(h, 'ok-shared');
    const res = await verify(h, 'ok-shared', 'u2');
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe('purchase_bound_elsewhere');
  });

  it('a refund revokes premium but keeps the games playable', async () => {
    const h = harness();
    await verify(h, 'ok-refundable');
    const g = await seedGame(h);
    await h.repo.purchases.set({ ...(await h.repo.purchases.get('ok-refundable'))!, token: 'refund-me' });
    const note = Buffer.from(JSON.stringify({ voidedPurchaseNotification: { purchaseToken: 'refund-me' } })).toString('base64');
    expect((await h.internal('/internal/play/rtdn', { message: { data: note } })).status).toBe(204);
    const me = await h.host('/me').then((r: Response) => r.json()) as any;
    expect(me.premium.state).toBe('revoked');
    const denied = await h.host(`/games/${g.id}/questions`, { json: { text: 'New one?' } });
    expect(denied.status).toBe(403);
    expect((await denied.json() as any).error.code).toBe('premium_revoked');
    expect((await h.host(`/games/${g.id}`)).status).toBe(200);
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } })).status).toBe(200);
  });

  it('restore skips tokens that belong to someone else', async () => {
    const h = harness();
    await verify(h, 'ok-other');
    const body = await h.host('/me/purchases/restore', { uid: 'u2', json: { platform: 'play', purchaseTokens: ['ok-other', 'ok-mine'] } }).then((r: Response) => r.json()) as any;
    expect(body.premium.active).toBe(true);
    expect((await h.repo.purchases.get('ok-mine'))!.uid).toBe('u2');
    expect((await h.repo.purchases.get('ok-other'))!.uid).toBe('u1');
  });

  it('rejects internal routes without the internal bearer', async () => {
    const h = harness();
    const res = await h.app.fetch(new Request('https://api.test/v1/internal/jobs/retention', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});
