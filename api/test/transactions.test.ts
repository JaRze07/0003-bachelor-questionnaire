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

describe('request bodies and the single writer', () => {
  it('does not hold the writer while a request body is still arriving', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const [q1, q2] = g.questions;
    const answer = (text: string) => JSON.stringify({ text, questionRev: 1, baseRev: 0 });

    // A partner on a bad connection: the request has started (headers and length are in), the body has not
    // arrived yet.
    let finishUpload!: () => void;
    const slowBody = new ReadableStream<Uint8Array>({
      start(controller) {
        finishUpload = () => { controller.enqueue(new TextEncoder().encode(answer('slow'))); controller.close(); };
      },
    });
    const slow = h.app.fetch(new Request(`https://api.test/v1/p/answers/${q1.id}`, {
      method: 'PUT', body: slowBody, duplex: 'half',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(answer('slow'))), 'X-Game-Token': g.partner },
    } as RequestInit));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Everybody else keeps writing in the meantime.
    const fast = await Promise.race([
      h.token(`/p/answers/${q2.id}`, g.partner, { method: 'PUT', body: answer('fast'), headers: { 'Content-Type': 'application/json' } }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    expect(fast?.status).toBe(200);

    finishUpload();
    expect((await slow).status).toBe(200);
    expect((await h.repo.answers.get(g.id, q1.id))!.text).toBe('slow');
    expect((await h.repo.answers.get(g.id, q2.id))!.text).toBe('fast');
  });

  it('refuses a body larger than anything the app sends, before reading it', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const { MAX_BODY_BYTES } = await import('../src/app.js');
    const huge = JSON.stringify({ epoch: 1, deviceId: 'dev-1', events: [], padding: 'x'.repeat(MAX_BODY_BYTES) });

    const declared = await h.host(`/games/${g.id}/events`, { method: 'POST', body: huge, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(huge)) } });
    expect(declared.status).toBe(413);
    expect((await declared.json() as any).error.code).toBe('payload_too_large');

    // The same body with no declared length (chunked) is counted as it arrives.
    const chunked = await h.app.fetch(new Request(`https://api.test/v1/games/${g.id}/events`, {
      method: 'POST', duplex: 'half',
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(huge)); c.close(); } }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev:u1' },
    } as RequestInit));
    expect(chunked.status).toBe(413);

    // An ordinary upload still goes through.
    const ok = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [] } });
    expect(ok.status).toBe(200);
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
