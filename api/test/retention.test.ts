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

  it('drops the warning once the organiser is active again, and warns afresh after the next idle spell', async () => {
    const h = harness();
    const g = await seedGame(h);
    const listed = async () => (await h.host('/games').then((r) => r.json()) as any).games[0].retentionWarnedAt;
    await h.repo.games.update(g.id, { lastActivityAt: daysAgo(85) });
    expect(await runRetention(h.repo)).toEqual({ warned: 1, deleted: 0 });
    expect(await listed()).toBeTruthy();
    expect(await runRetention(h.repo)).toEqual({ warned: 0, deleted: 0 });      // one warning per idle spell

    await h.host(`/games/${g.id}`, { method: 'PATCH', json: { title: 'Still on' } });   // activity
    expect(await listed()).toBeUndefined();

    await h.repo.games.update(g.id, { lastActivityAt: daysAgo(-1) });           // later than the old warning
    expect(await runRetention(h.repo, Date.now() + 86 * 86_400_000)).toEqual({ warned: 1, deleted: 0 });
  });

  it('warning a game does not undo a change made while the job was running', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.repo.games.update(g.id, { lastActivityAt: daysAgo(85) });
    // the job reads its list, then a takeover lands before the job writes
    const list = h.repo.games.listIdleBefore;
    h.repo.games.listIdleBefore = async (iso) => {
      const games = await list(iso);
      await h.repo.games.update(g.id, { epoch: 7 });
      return games;
    };
    await runRetention(h.repo);
    h.repo.games.listIdleBefore = list;
    const after = (await h.repo.games.get(g.id))!;
    expect(after.epoch).toBe(7);
    expect(after.retentionWarnedAt).toBeTruthy();
  });

  it('spectator polling does not extend retention', async () => {
    const h = harness();
    const g = await seedGame(h);
    const before = (await h.repo.games.get(g.id))!.lastActivityAt;
    await h.token('/s/summary', g.spectator);
    expect((await h.repo.games.get(g.id))!.lastActivityAt).toBe(before);
  });
});
