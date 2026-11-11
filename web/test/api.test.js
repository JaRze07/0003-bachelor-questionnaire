import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api.js';
import { drainOutbox } from '../src/store/sync.js';
import { listOutbox, queueOutbox } from '../src/store/journal.js';

const api = () => createApi({ baseUrl: 'https://api.test', getToken: async () => 'session-token' });
const answer = (status, body = '', headers = {}) => { globalThis.fetch = vi.fn(async () => new Response(body, { status, headers })); };
const failure = async (call) => { try { await call(); } catch (err) { return err; } return null; };

afterEach(() => { vi.restoreAllMocks(); });

describe('API client', () => {
  it('sends the session and returns the payload with its ETag', async () => {
    answer(200, JSON.stringify({ games: [] }), { etag: '"7"' });
    const res = await api().get('/games');
    expect(res).toMatchObject({ games: [], __etag: '"7"' });
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.test/v1/games');
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session-token');
  });

  it('maps an API error to its code, and tells the app when the session is dead', async () => {
    const onUnauthorized = vi.fn();
    answer(401, JSON.stringify({ error: { code: 'session_expired', message: 'session_expired' } }));
    const err = await failure(() => createApi({ baseUrl: 'https://api.test', onUnauthorized }).get('/me'));
    expect(err).toMatchObject({ status: 401, code: 'session_expired', offline: false });
    expect(onUnauthorized).toHaveBeenCalledWith('session_expired');
  });

  it('treats no network and a server that is down behind its proxy the same way: offline', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await failure(() => api().get('/games'))).toMatchObject({ status: 0, offline: true });
    for (const status of [502, 503, 504]) {
      answer(status, '<html><body>Bad Gateway</body></html>');          // not JSON: the proxy's own page
      expect(await failure(() => api().get('/games'))).toMatchObject({ status, offline: true });
      answer(status, '');
      expect(await failure(() => api().get('/games'))).toMatchObject({ status, offline: true });
    }
    answer(500, JSON.stringify({ error: { code: 'internal' } }));
    expect(await failure(() => api().get('/games'))).toMatchObject({ status: 500, code: 'internal', offline: false });
  });

  it('keeps a queued change while the server is down, and drops it only on a real refusal', async () => {
    await queueOutbox('g1', { method: 'DELETE', path: '/games/g1' }, undefined);
    answer(502, '');
    expect(await drainOutbox(api())).toBe(false);
    expect(await listOutbox()).toHaveLength(1);
    answer(404, JSON.stringify({ error: { code: 'game_not_found' } }));
    expect(await drainOutbox(api())).toBe(true);
    expect(await listOutbox()).toHaveLength(0);
  });
});
