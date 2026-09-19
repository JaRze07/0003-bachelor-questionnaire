import type { Context, MiddlewareHandler } from 'hono';
import type { Game, Repo, TokenRole, User } from './repo/types.js';
import { gone, notFound, tooMany, unauthorized } from './errors.js';
import { hashToken, nowIso } from './domain/ids.js';

export type Vars = { uid: string; user: User; game: Game; tokenRole: TokenRole; requestId: string };

/* ---------- Sessions ---------- */
// The client signs in with Google once (routes/auth.ts) and gets our own bearer token. Only its sha256 is
// stored, so a copy of the database does not contain a usable credential.

export const SESSION_DAYS = 30;

export async function verifyBearer(repo: Repo, header: string | undefined): Promise<string> {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) throw unauthorized();
  const token = m[1].trim();
  if (process.env.DEV_AUTH === '1' && token.startsWith('dev:')) {
    const uid = token.slice(4);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw unauthorized('bad_dev_uid');
    return uid;
  }
  if (token.length < 32 || token.length > 128) throw unauthorized('invalid_session');
  const session = await repo.sessions.get(hashToken(token));
  if (!session) throw unauthorized('invalid_session');
  if (session.expiresAt < nowIso()) {
    await repo.sessions.delete(session.id);
    throw unauthorized('session_expired');
  }
  return session.uid;
}

/** Host middleware: resolves the session and upserts users/{uid}. */
export function hostAuth(repo: Repo): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const uid = await verifyBearer(repo, c.req.header('authorization'));
    rateLimit(`host:${uid}`, 300, 60);
    let user = await repo.users.get(uid);
    const now = nowIso();
    if (!user) {
      user = { uid, premium: { state: 'none' }, createdAt: now, lastSeenAt: now };
      await repo.users.set(user);
    } else if (Date.parse(user.lastSeenAt) < Date.now() - 60_000) {
      // field-level update: a full set() here would overwrite a concurrent premium change
      await repo.users.update(uid, { lastSeenAt: now });
      user.lastSeenAt = now;
    }
    c.set('uid', uid);
    c.set('user', user);
    await next();
  };
}

/** Loads the game from :id and checks ownership. 404 for other people's games (no existence leak). */
export function ownedGame(repo: Repo): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const id = c.req.param('id');
    const game = id ? await repo.games.get(id) : null;
    if (!game || game.hostUid !== c.get('uid')) throw notFound('game_not_found');
    c.set('game', game);
    await next();
  };
}

/* ---------- Partner / spectator tokens ---------- */

export function gameTokenAuth(repo: Repo, role: TokenRole): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    // Caller bucket first, so an unknown token cannot buy unlimited lookups by varying itself.
    rateLimit(`ip:${clientIp(c)}`, 240, 60);
    const token = c.req.header('x-game-token');
    if (!token || token.length < 20 || token.length > 128) throw notFound('link_unavailable');
    const hash = hashToken(token);
    // A whole room shares one guest link and polls every 2.5 s, so the per-link budget has to fit a party
    // (100 guests), while the caller bucket above keeps a single device honest.
    rateLimit(`${role}:${hash}`, role === 'partner' ? 120 : 3000, 60);
    const doc = await repo.tokens.get(hash);
    if (!doc || doc.role !== role) throw notFound('link_unavailable');
    const game = await repo.games.get(doc.gameId);
    if (!game) throw gone();
    const state = game.tokens[role];
    if (state.hash !== hash || state.version !== doc.version || state.revokedAt) throw notFound('link_unavailable');
    c.set('game', game);
    c.set('tokenRole', role);
    await next();
  };
}

/* ---------- Rate limiting (per instance; Cloud Run runs at most 2) ---------- */

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowSec: number, now = Date.now()): void {
  const cutoff = now - windowSec * 1000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw tooMany(Math.ceil((hits[0] + windowSec * 1000 - now) / 1000));
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 20_000) sweep(now);
}

/** Drop buckets whose newest hit is older than 5 minutes. Never clears live limits wholesale. */
function sweep(now: number) {
  const cutoff = now - 300_000;
  for (const [key, hits] of buckets) if (!hits.length || hits[hits.length - 1] < cutoff) buckets.delete(key);
}

export function resetRateLimits() { buckets.clear(); }

export const clientIp = (c: Context) =>
  (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
