import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { hostAuth, type Vars } from '../auth.js';
import { premiumSummary, isPremium } from '../domain/tier.js';
import { LIMITS } from '../domain/limits.js';
import { applyPurchase } from '../domain/entitlement.js';
import { countsTowardLimit } from '../domain/state.js';

const verifyBody = z.object({ platform: z.enum(['play', 'appstore']), productId: z.string().min(1).max(100), purchaseToken: z.string().min(1).max(2000) });
const restoreBody = z.object({ platform: z.enum(['play', 'appstore']), purchaseTokens: z.array(z.string().min(1).max(2000)).max(20) });

export function meRoutes({ repo, play }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  const me = async (uid: string) => {
    const user = (await repo.users.get(uid))!;
    const games = await repo.games.listByHost(uid);
    const premium = isPremium(user);
    return {
      uid,
      premium: premiumSummary(user.premium),
      activeGames: games.filter(countsTowardLimit).length,
      limits: { activeGames: LIMITS.activeGames, questions: premium ? LIMITS.questionsPremium : LIMITS.questionsFree, hidden: LIMITS.hiddenFree },
    };
  };

  r.get('/', async (c) => c.json(await me(c.get('uid'))));

  r.post('/purchases/verify', async (c) => {
    const body = verifyBody.parse(await c.req.json());
    await applyPurchase(repo, play, c.get('user'), body.platform, body.productId, body.purchaseToken);
    return c.json(await me(c.get('uid')));
  });

  r.post('/purchases/restore', async (c) => {
    const body = restoreBody.parse(await c.req.json());
    let user = c.get('user');
    for (const token of body.purchaseTokens) {
      try { user = await applyPurchase(repo, play, user, body.platform, 'premium_forever', token); } catch { /* a token bound elsewhere or unknown: skip */ }
    }
    return c.json(await me(c.get('uid')));
  });

  return r;
}
