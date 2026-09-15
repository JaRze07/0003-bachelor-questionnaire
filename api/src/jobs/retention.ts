import type { Repo } from '../repo/types.js';
import { LIMITS } from '../domain/limits.js';
import { nowIso } from '../domain/ids.js';

/** Warn at 83 days idle, delete at 90 (spec §8). Returns counts for the job log. */
export async function runRetention(repo: Repo, now = Date.now()): Promise<{ warned: number; deleted: number }> {
  const day = 86_400_000;
  const deleteBefore = new Date(now - LIMITS.retentionDays * day).toISOString();
  const warnBefore = new Date(now - LIMITS.retentionWarnDays * day).toISOString();
  let warned = 0, deleted = 0;
  for (const g of await repo.games.listIdleBefore(deleteBefore)) {
    await repo.games.deleteTree(g.id);
    deleted++;
  }
  for (const g of await repo.games.listIdleBefore(warnBefore)) {
    if (g.retentionWarnedAt) continue;
    g.retentionWarnedAt = nowIso();
    await repo.games.set(g);
    warned++;
  }
  return { warned, deleted };
}
