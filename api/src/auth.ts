import type { Context, MiddlewareHandler } from 'hono';
import type { Game, Repo, TokenRole, User } from './repo/types.js';
import { ApiError, gone, notFound, tooMany, unauthorized } from './errors.js';
import { hashToken, nowIso } from './domain/ids.js';

export type Vars = { uid: string; user: User; game: Game; tokenRole: TokenRole; requestId: string };

/* ---------- Firebase ID tokens ---------- */

type Verifier = (idToken: string) => Promise<{ uid: string }>;
let verifier: Verifier | null = null;

async function firebaseVerifier(): Promise<Verifier> {
  if (verifier) return verifier;
  const admin = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const app = admin.getApps()[0] ?? admin.initializeApp();
  const auth = getAuth(app);
  verifier = async (idToken) => {
    const decoded = await auth.verifyIdToken(idToken);
    return { uid: decoded.uid };
  };
  return verifier;
}

/** Test hook: replace the verifier. */
export function setVerifier(v: Verifier | null) { verifier = v; }

export async function verifyBearer(header: string | undefined): Promise<string> {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) throw unauthorized();
  const token = m[1].trim();
  if (process.env.DEV_AUTH === '1' && token.startsWith('dev:')) {
    const uid = token.slice(4);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw unauthorized('bad_dev_uid');
    return uid;
  }
  try {
    const v = await firebaseVerifier();
    return (await v(token)).uid;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw unauthorized('invalid_id_token');
  }
}

/** Host middleware: verifies the ID token and upserts users/{uid}. */
export function hostAuth(repo: Repo): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const uid = await verifyBearer(c.req.header('authorization'));
    rateLimit(`host:${uid}`, 300, 60);
    let user = await repo.users.get(uid);
    const now = nowIso();
    if (!user) {
      user = { uid, premium: { state: 'none' }, createdAt: now, lastSeenAt: now };
      await repo.users.set(user);
    } else if (Date.parse(user.lastSeenAt) < Date.now() - 60_000) {
      user.lastSeenAt = now;
      await repo.users.set(user);
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
    const token = c.req.header('x-game-token');
    if (!token || token.length < 20 || token.length > 128) throw notFound('link_unavailable');
    const hash = hashToken(token);
    rateLimit(`${role}:${hash}`, role === 'partner' ? 60 : 20, 60);
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
  if (buckets.size > 50_000) buckets.clear(); // crude memory guard
}

export function resetRateLimits() { buckets.clear(); }

export const clientIp = (c: Context) =>
  (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
