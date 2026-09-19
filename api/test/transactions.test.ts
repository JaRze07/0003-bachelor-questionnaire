import { describe, expect, it } from 'vitest';
import { ev, harness, seedGame } from './helpers.js';

describe('one request, one transaction', () => {
  it('rolls back every write of a request that fails half way', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });

    // the round is written first, the projection afterwards: make the second step fail
    const original = h.repo.projections.set;
    h.repo.projections.set = async () => { throw new Error('disk full'); };
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
    ] } });
    h.repo.projections.set = original;

    expect(res.status).toBe(500);
    expect(await h.repo.rounds.list(g.id)).toHaveLength(0);
    expect(await h.repo.events.list(g.id)).toHaveLength(0);

    // and the retry applies cleanly, because nothing of the first attempt was kept
    const retry = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
    ] } });
    expect((await retry.json() as any).acknowledged).toHaveLength(1);
    expect(await h.repo.rounds.list(g.id)).toHaveLength(1);
  });

  it('keeps a failed create from leaving tokens or questions behind', async () => {
    const h = harness();
    const original = h.repo.projections.set;
    h.repo.projections.set = async () => { throw new Error('boom'); };
    const res = await h.host('/games', { json: { language: 'en' } });
    h.repo.projections.set = original;
    expect(res.status).toBe(500);
    expect(await h.repo.games.listByHost('u1')).toHaveLength(0);
  });

  it('survives a storm of parallel writers without losing one', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const results = await Promise.all(g.questions.map((q: any) =>
      h.token(`/p/answers/${q.id}`, g.partner, { method: 'PUT', json: { text: `a-${q.id}`, questionRev: 1, baseRev: 0 } })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const game = await h.host(`/games/${g.id}`).then((r) => r.json()) as any;
    expect(game.game.counts.answered).toBe(20);
    expect(game.game.status).toBe('ready');
  });
});

describe('read isolation on a real database file', () => {
  it('a reader outside the transaction never sees uncommitted writes', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createSqliteRepo } = await import('../src/repo/sqlite.js');
    const dir = mkdtempSync(join(tmpdir(), 'bq-'));
    const repo = createSqliteRepo(join(dir, 'test.db'));
    const user = { uid: 'u1', premium: { state: 'none' as const }, createdAt: 'x', lastSeenAt: 'x' };
    let seenOutside: unknown = 'unset';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const writer = repo.tx(async () => {
      await repo.users.set(user);
      expect(await repo.users.get('u1')).not.toBeNull();   // the transaction reads its own write
      await gate;                                          // a real await: other requests run now
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    seenOutside = await repo.users.get('u1');               // another request, outside the transaction
    release();
    await writer;

    expect(seenOutside).toBeNull();
    expect(await repo.users.get('u1')).not.toBeNull();     // visible once committed
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
