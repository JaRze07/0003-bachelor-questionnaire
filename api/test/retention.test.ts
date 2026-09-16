import { describe, expect, it } from 'vitest';
import { harness, seedGame } from './helpers.js';
import { runRetention } from '../src/jobs/retention.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('retention', () => {
  it('warns at 83 days and deletes at 90', async () => {
    const h = harness();
    const fresh = await seedGame(h);
    const old = await seedGame(h);
    const veryOld = await seedGame(h);
    await h.repo.games.set({ ...(await h.repo.games.get(old.id))!, lastActivityAt: daysAgo(85) });
    await h.repo.games.set({ ...(await h.repo.games.get(veryOld.id))!, lastActivityAt: daysAgo(120) });
    const result = await runRetention(h.repo);
    expect(result).toEqual({ warned: 1, deleted: 1 });
    expect(await h.repo.games.get(veryOld.id)).toBeNull();
    expect((await h.repo.games.get(old.id))!.retentionWarnedAt).toBeTruthy();
    expect((await h.repo.games.get(fresh.id))!.retentionWarnedAt).toBeUndefined();
    expect((await h.token('/s/summary', veryOld.spectator)).status).toBe(404);
  });

  it('spectator polling does not extend retention', async () => {
    const h = harness();
    const g = await seedGame(h);
    const before = (await h.repo.games.get(g.id))!.lastActivityAt;
    await h.token('/s/summary', g.spectator);
    expect((await h.repo.games.get(g.id))!.lastActivityAt).toBe(before);
  });
});
