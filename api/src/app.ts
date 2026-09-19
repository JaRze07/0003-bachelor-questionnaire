import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Repo } from './repo/types.js';
import type { Vars } from './auth.js';
import { ApiError } from './errors.js';
import { uuid } from './domain/ids.js';
import { meRoutes } from './routes/me.js';
import { gameRoutes } from './routes/games.js';
import { questionRoutes } from './routes/questions.js';
import { eventRoutes } from './routes/events.js';
import { leaseRoutes } from './routes/lease.js';
import { tokenRoutes } from './routes/tokens.js';
import { partnerRoutes } from './routes/partner.js';
import { spectatorRoutes } from './routes/spectator.js';
import { internalRoutes } from './routes/internal.js';
import type { PlayVerifier } from './domain/play.js';

export interface AppDeps { repo: Repo; play: PlayVerifier; curated: (lang: string) => Promise<CuratedQuestion[] | null> }
export interface CuratedQuestion { id: string; text: string; theme?: string }

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Vars }>();

  app.use('*', async (c, next) => {
    const id = c.req.header('x-request-id') ?? uuid();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8080,capacitor://localhost,https://localhost')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.use('/v1/*', cors({
    origin: (o) => (origins.includes(o) ? o : null),
    allowHeaders: ['Authorization', 'Content-Type', 'X-Game-Token', 'If-None-Match', 'X-Request-Id'],
    exposeHeaders: ['ETag', 'X-Request-Id', 'Retry-After', 'Content-Disposition'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }));

  app.get('/healthz', (c) => c.json({ ok: true }));

  /**
   * Every mutating request is one transaction: either all of its writes land or none. Hono turns a thrown
   * error into a response inside `next()`, so the failure is read from `c.error` and converted into a rollback.
   * Routes that call the store's network (purchases, store notifications) manage their own short transactions,
   * because nothing should hold the writer while it waits for Google.
   */
  class Rollback extends Error {}
  app.use('/v1/*', async (c, next) => {
    const path = c.req.path;
    const reads = c.req.method === 'GET' || c.req.method === 'OPTIONS' || c.req.method === 'HEAD';
    if (reads || path.includes('/me/purchases') || path.includes('/internal/')) return next();
    try {
      await deps.repo.tx(async () => {
        await next();
        if (c.error) throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });

  const v1 = new Hono<{ Variables: Vars }>();
  v1.route('/me', meRoutes(deps));
  v1.route('/games', gameRoutes(deps));
  v1.route('/games', questionRoutes(deps));
  v1.route('/games', eventRoutes(deps));
  v1.route('/games', leaseRoutes(deps));
  v1.route('/games', tokenRoutes(deps));
  v1.route('/p', partnerRoutes(deps));
  v1.route('/s', spectatorRoutes(deps));
  v1.route('/internal', internalRoutes(deps));
  app.route('/v1', v1);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such route' } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err.status === 429 && err.details?.retryAfterSec) c.header('Retry-After', String(err.details.retryAfterSec));
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    }
    // zod errors surface as 400 with the issue list
    if ((err as { name?: string }).name === 'ZodError') {
      return c.json({ error: { code: 'validation', message: 'Invalid request', details: { issues: (err as { issues?: unknown }).issues } } }, 400);
    }
    console.error(JSON.stringify({ severity: 'ERROR', requestId: c.get('requestId'), message: err.message, stack: err.stack }));
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });

  return app;
}
