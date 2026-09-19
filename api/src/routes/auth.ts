import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { clientIp, rateLimit, SESSION_DAYS, type Vars } from '../auth.js';
import { hashToken, newToken, nowIso } from '../domain/ids.js';

const googleBody = z.object({ idToken: z.string().min(20).max(4096) });

export function authRoutes({ repo, google }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();

  /** Exchange a Google ID token for our own 30-day session. The Google token is used once and thrown away. */
  r.post('/google', async (c) => {
    rateLimit(`auth:${clientIp(c)}`, 20, 60);
    const body = googleBody.parse(await c.req.json());
    const identity = await google(body.idToken);
    const uid = `g:${identity.sub}`;
    const token = newToken();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    await repo.sessions.set({ id: hashToken(token), uid, provider: 'google', createdAt: now, expiresAt });
    const existing = await repo.users.get(uid);
    if (!existing) await repo.users.set({ uid, premium: { state: 'none' }, createdAt: now, lastSeenAt: now });
    return c.json({ token, uid, name: identity.name ?? null, expiresAt });
  });

  /** Sign out: the session stops working at once, on every device that still holds it. */
  r.post('/signout', async (c) => {
    const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
    if (m) await repo.sessions.delete(hashToken(m[1].trim()));
    return c.body(null, 204);
  });

  return r;
}
