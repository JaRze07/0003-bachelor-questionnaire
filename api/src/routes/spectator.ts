import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { gameTokenAuth, type Vars } from '../auth.js';
import { notFound } from '../errors.js';

export function spectatorRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', gameTokenAuth(repo, 'spectator'));

  /** Serialises only the projection document (spec FR-014). ETag = projection revision. */
  r.get('/summary', async (c) => {
    const game = c.get('game');
    const p = await repo.projections.get(game.id);
    if (!p) throw notFound('link_unavailable');
    const etag = `"${p.revision}"`;
    c.header('Cache-Control', 'no-store');
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json({ language: p.language, title: p.title, status: p.status, score: p.score, live: p.live ?? null, rounds: p.rounds, revision: p.revision, updatedAt: p.updatedAt });
  });

  return r;
}
