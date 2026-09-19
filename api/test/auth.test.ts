import { describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

const post = (h: any, path: string, json: unknown, headers: Record<string, string> = {}) =>
  h.app.fetch(new Request(`https://api.test/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(json) }));
const get = (h: any, path: string, token: string) =>
  h.app.fetch(new Request(`https://api.test/v1${path}`, { headers: { Authorization: `Bearer ${token}` } }));

describe('sign-in and sessions', () => {
  it('exchanges a Google token for our own session and signs the host in', async () => {
    const h = harness();
    const res = await post(h, '/auth/google', { idToken: 'google-ok-12345.rest-of-token' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.uid).toBe('g:12345');
    expect(body.token.length).toBeGreaterThan(40);
    const me = await get(h, '/me', body.token);
    expect((await me.json() as any).uid).toBe('g:12345');
  });

  it('stores only a hash of the session token', async () => {
    const h = harness();
    const { token } = await post(h, '/auth/google', { idToken: 'google-ok-777.x-padding-padding' }).then((r: Response) => r.json()) as any;
    expect(await h.repo.sessions.get(token)).toBeNull();
  });

  it('rejects a bad Google token and an unknown session', async () => {
    const h = harness();
    expect((await post(h, '/auth/google', { idToken: 'forged-token-forged-token-forged' })).status).toBe(401);
    expect((await get(h, '/me', 'x'.repeat(48))).status).toBe(401);
  });

  it('sign-out kills the session at once', async () => {
    const h = harness();
    const { token } = await post(h, '/auth/google', { idToken: 'google-ok-42.padding-padding-pad' }).then((r: Response) => r.json()) as any;
    expect((await post(h, '/auth/signout', {}, { Authorization: `Bearer ${token}` })).status).toBe(204);
    expect((await get(h, '/me', token)).status).toBe(401);
  });

  it('refuses an expired session and removes it', async () => {
    const h = harness();
    const { token } = await post(h, '/auth/google', { idToken: 'google-ok-99.padding-padding-pad' }).then((r: Response) => r.json()) as any;
    const { hashToken } = await import('../src/domain/ids.js');
    const session = (await h.repo.sessions.get(hashToken(token)))!;
    await h.repo.sessions.set({ ...session, expiresAt: '2020-01-01T00:00:00.000Z' });
    const res = await get(h, '/me', token);
    expect(res.status).toBe(401);
    expect(await h.repo.sessions.get(hashToken(token))).toBeNull();
  });

  it('the same Google account keeps its games across sessions and devices', async () => {
    const h = harness();
    const a = await post(h, '/auth/google', { idToken: 'google-ok-555.phone-padding-pad' }).then((r: Response) => r.json()) as any;
    await h.app.fetch(new Request('https://api.test/v1/games', { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'en' }) }));
    const b = await post(h, '/auth/google', { idToken: 'google-ok-555.laptop-padding-pa' }).then((r: Response) => r.json()) as any;
    const games = await get(h, '/games', b.token).then((r: Response) => r.json()) as any;
    expect(games.games).toHaveLength(1);
  });
});
