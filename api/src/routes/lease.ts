import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { hostAuth, ownedGame, type Vars } from '../auth.js';
import { badRequest } from '../errors.js';
import { nowIso } from '../domain/ids.js';

const leaseBody = z.object({ deviceId: z.string().min(4).max(80), label: z.string().trim().max(60).default('') });
const takeoverBody = leaseBody.extend({ confirm: z.literal(true).optional() });

export function leaseRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  const view = (game: Vars['game'], deviceId: string) => ({
    epoch: game.epoch,
    holder: game.lease ? { deviceId: game.lease.deviceId, label: game.lease.label, updatedAt: game.lease.updatedAt } : null,
    lastSyncAt: game.lease?.lastSyncAt ?? null,
    isHolder: game.lease?.deviceId === deviceId,
  });

  /** First device to ask becomes the holder; others get read-only info. Never changes the epoch. */
  r.post('/:id/lease', ownedGame(repo), async (c) => {
    const b = leaseBody.parse(await c.req.json());
    const game = c.get('game');
    const now = nowIso();
    if (!game.lease) {
      game.lease = { deviceId: b.deviceId, label: b.label, updatedAt: now, lastSyncAt: now };
      await repo.games.set(game);
    } else if (game.lease.deviceId === b.deviceId) {
      game.lease.updatedAt = now;
      if (b.label) game.lease.label = b.label;
      await repo.games.set(game);
    }
    return c.json(view(game, b.deviceId));
  });

  /** Explicit, confirmed takeover: epoch++ so uploads from the old device are rejected (spec §7). */
  r.post('/:id/lease/takeover', ownedGame(repo), async (c) => {
    const b = takeoverBody.parse(await c.req.json());
    if (!b.confirm) throw badRequest('confirm_required');
    const game = c.get('game');
    const now = nowIso();
    if (game.lease?.deviceId !== b.deviceId) {
      game.epoch += 1;
      game.lease = { deviceId: b.deviceId, label: b.label, updatedAt: now, lastSyncAt: now };
      game.updatedAt = now;
      await repo.games.set(game);
    }
    return c.json(view(game, b.deviceId));
  });

  return r;
}
