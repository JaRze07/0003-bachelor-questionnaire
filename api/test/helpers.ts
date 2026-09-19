import { createApp } from '../src/app.js';
import { createMemoryRepo } from '../src/repo/memory.js';
import { createSqliteRepo } from '../src/repo/sqlite.js';
import { fakePlayVerifier } from '../src/domain/play.js';
import { resetRateLimits } from '../src/auth.js';
import type { Repo } from '../src/repo/types.js';

process.env.DEV_AUTH = '1';
process.env.WEB_BASE = 'https://example.test';

export const CURATED = Array.from({ length: 20 }, (_, i) => ({
  id: `en-${String(i + 1).padStart(3, '0')}`, text: `Question ${i + 1}?`, theme: 'T',
}));

export interface Harness {
  repo: Repo;
  play: ReturnType<typeof fakePlayVerifier>;
  app: ReturnType<typeof createApp>;
  host: (path: string, init?: RequestInit & { uid?: string; json?: unknown }) => Promise<Response>;
  token: (path: string, token: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  internal: (path: string, json?: unknown) => Promise<Response>;
}

export function harness(): Harness {
  resetRateLimits();
  // The whole suite runs against both stores: TEST_REPO=memory for speed, sqlite (default) for the real thing.
  const repo: Repo = process.env.TEST_REPO === 'memory' ? createMemoryRepo() : createSqliteRepo(':memory:');
  const play = fakePlayVerifier();
  const app = createApp({
    repo,
    play,
    google: async (idToken: string) => {
      if (!idToken.startsWith('google-ok-')) { const { unauthorized } = await import('../src/errors.js'); throw unauthorized('invalid_google_token'); }
      return { sub: idToken.slice('google-ok-'.length).split('.')[0], name: 'Test Host' };
    },
    curated: async (lang) => (lang === 'en' || lang === 'pl' ? CURATED : null),
  });
  const call = async (path: string, init: RequestInit & { json?: unknown } = {}, headers: Record<string, string> = {}) => {
    const { json, ...rest } = init;
    return app.fetch(new Request(`https://api.test/v1${path}`, {
      method: json !== undefined ? (rest.method ?? 'POST') : (rest.method ?? 'GET'),
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(rest.headers as Record<string, string> ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : (rest.body as BodyInit | undefined),
    }));
  };
  return {
    repo, app, play,
    host: (path, init = {}) => call(path, init, { Authorization: `Bearer dev:${init.uid ?? 'u1'}` }),
    token: (path, token, init = {}) => call(path, init, { 'X-Game-Token': token }),
    internal: (path, json) => call(path, { json: json ?? {} }, { Authorization: 'Bearer dev:internal' }),
  };
}

export const tokenFromUrl = (url: string) => new URL(url).hash.replace('#t=', '');

/** Create a game, answer every question through the partner link, return ids and tokens. */
export async function seedGame(h: Harness, opts: { uid?: string; language?: string; answer?: boolean } = {}) {
  const res = await h.host('/games', { uid: opts.uid, json: { language: opts.language ?? 'en', title: 'Party' } });
  const body = await res.json() as any;
  const partner = tokenFromUrl(body.tokens.partner.url);
  const spectator = tokenFromUrl(body.tokens.spectator.url);
  if (opts.answer !== false) {
    const game = await h.token('/p/game', partner).then((r) => r.json()) as any;
    for (const q of game.questions) {
      await h.token(`/p/answers/${q.id}`, partner, { method: 'PUT', json: { text: `answer ${q.id}`, questionRev: q.rev, baseRev: 0 } });
    }
  }
  return { id: body.game.id as string, partner, spectator, questions: body.questions as any[], uid: opts.uid ?? 'u1' };
}

export const ev = (type: string, seq: number, payload: Record<string, unknown>, id = `e${seq}-${type.replace('.', '-')}`) =>
  ({ id, seq, type, at: new Date(2026, 8, 16, 20, seq).toISOString(), payload });

/** Play one full round through the event upload endpoint. */
export async function playRound(h: Harness, gameId: string, questionId: string, result: 'correct' | 'wrong', n = 1, extra: Record<string, unknown> = {}) {
  const roundId = `round-${n}`;
  return h.host(`/games/${gameId}/events`, {
    json: {
      epoch: (extra.epoch as number) ?? 1, deviceId: 'dev-1',
      events: [
        ev('round.start', n * 10, { roundId, questionId, penalty: { type: 'drink', label: 'drink', description: '4 fingers' } }, `start-${roundId}`),
        ev('round.mark', n * 10 + 1, { roundId, result }, `marked-${roundId}`),
      ],
    },
  });
}
