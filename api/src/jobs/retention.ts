import type { Game, Repo } from '../repo/types.js';
import { LIMITS } from '../domain/limits.js';
import { nowIso } from '../domain/ids.js';

/** A warning counts only while nothing has happened in the game since it was given. */
export const retentionWarningCurrent = (g: Game): boolean =>
  Boolean(g.retentionWarnedAt && g.retentionWarnedAt >= g.lastActivityAt);

/**
 * Warn at 83 days idle, delete at 90 (spec §8). Returns counts for the job log.
 * The job runs beside live requests, so each game is looked at again inside its own transaction before it is
 * touched: a game the organiser opened a moment ago is neither deleted nor overwritten with a stale copy.
 */
export async function runRetention(repo: Repo, now = Date.now()): Promise<{ warned: number; deleted: number }> {
  const day = 86_400_000;
  const deleteBefore = new Date(now - LIMITS.retentionDays * day).toISOString();
  const warnBefore = new Date(now - LIMITS.retentionWarnDays * day).toISOString();
  let warned = 0, deleted = 0;
  for (const { id } of await repo.games.listIdleBefore(deleteBefore)) {
    await repo.tx(async () => {
      const g = await repo.games.get(id);
      if (!g || g.lastActivityAt >= deleteBefore) return;
      await repo.games.deleteTree(id);
      deleted++;
    });
  }
  for (const { id } of await repo.games.listIdleBefore(warnBefore)) {
    await repo.tx(async () => {
      const g = await repo.games.get(id);
      if (!g || g.lastActivityAt >= warnBefore || retentionWarningCurrent(g)) return;
      await repo.games.update(id, { retentionWarnedAt: nowIso() });
      warned++;
    });
  }
  return { warned, deleted };
}
