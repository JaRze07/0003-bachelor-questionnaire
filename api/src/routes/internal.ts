import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Vars } from '../auth.js';
import { verifyInternal } from '../domain/internalAuth.js';
import { applyNotification } from '../domain/entitlement.js';
import { runRetention } from '../jobs/retention.js';

const pubsubBody = z.object({ message: z.object({ data: z.string(), messageId: z.string().optional() }) });

export function internalRoutes({ repo, play }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', async (c, next) => { await verifyInternal(c.req.header('authorization')); await next(); });

  /** Google Play real-time developer notifications (Pub/Sub push). Always 204 after recording. */
  r.post('/play/rtdn', async (c) => {
    const b = pubsubBody.parse(await c.req.json());
    let note: { oneTimeProductNotification?: { purchaseToken?: string; notificationType?: number }; voidedPurchaseNotification?: { purchaseToken?: string; refundType?: number } } = {};
    try { note = JSON.parse(Buffer.from(b.message.data, 'base64').toString('utf8')); } catch { return c.body(null, 204); }
    const token = note.oneTimeProductNotification?.purchaseToken ?? note.voidedPurchaseNotification?.purchaseToken;
    if (token) {
      const reason = note.voidedPurchaseNotification ? 'voided' : `one_time_${note.oneTimeProductNotification?.notificationType ?? 0}`;
      await applyNotification(repo, play, token, reason);
    }
    return c.body(null, 204);
  });

  r.post('/jobs/retention', async (c) => c.json(await runRetention(repo)));

  return r;
}
