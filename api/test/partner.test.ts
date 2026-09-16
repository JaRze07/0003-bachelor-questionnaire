import { describe, expect, it } from 'vitest';
import { harness, seedGame } from './helpers.js';

describe('partner form', () => {
  it('shows only questions and its own answers, never host data', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const body = await h.token('/p/game', g.partner).then((r) => r.json()) as any;
    expect(body.questions).toHaveLength(20);
    expect(JSON.stringify(body)).not.toContain('hostUid');
    expect(body.readOnly).toBe(false);
  });

  it('saves an answer and rejects a stale base revision from a second page', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const q = g.questions[0];
    const first = await h.token(`/p/answers/${q.id}`, g.partner, { method: 'PUT', json: { text: 'blue', questionRev: 1, baseRev: 0 } });
    expect((await first.json() as any).rev).toBe(1);
    const stale = await h.token(`/p/answers/${q.id}`, g.partner, { method: 'PUT', json: { text: 'green', questionRev: 1, baseRev: 0 } });
    expect(stale.status).toBe(409);
    const body = await stale.json() as any;
    expect(body.error.code).toBe('answer_conflict');
    expect(body.error.details.current.text).toBe('blue');
  });

  it('rejects an answer written against an old question revision', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const q = g.questions[0];
    await h.repo.questions.set(g.id, { ...(await h.repo.questions.get(g.id, q.id))!, text: 'Changed?', rev: 2 });
    const res = await h.token(`/p/answers/${q.id}`, g.partner, { method: 'PUT', json: { text: 'x', questionRev: 1, baseRev: 0 } });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe('question_changed');
  });

  it('marks questions added after the last load as new', async () => {
    const h = harness();
    const g = await seedGame(h);
    const user = (await h.repo.users.get('u1'))!;
    await h.repo.users.set({ ...user, premium: { state: 'active', since: '2026-01-01T00:00:00.000Z' } });
    const added = await h.host(`/games/${g.id}/questions`, { json: { text: 'What is my shoe size?' } }).then((r) => r.json()) as any;
    const view = await h.token('/p/game', g.partner).then((r) => r.json()) as any;
    const fresh = view.questions.find((q: any) => q.id === added.question.id);
    expect(fresh.isNew).toBe(true);
    expect(view.questions.filter((q: any) => q.isNew)).toHaveLength(1);
  });

  it('is read-only once the game is finished', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });
    await h.host(`/games/${g.id}/transition`, { json: { to: 'finished', confirm: true } });
    const view = await h.token('/p/game', g.partner).then((r) => r.json()) as any;
    expect(view.readOnly).toBe(true);
    expect((await h.token(`/p/answers/${g.questions[0].id}`, g.partner, { method: 'PUT', json: { text: 'late', questionRev: 1, baseRev: 1 } })).status).toBe(409);
  });

  it('stops working when the link is regenerated or revoked', async () => {
    const h = harness();
    const g = await seedGame(h);
    const fresh = await h.host(`/games/${g.id}/tokens/partner/regenerate`, { json: {} }).then((r) => r.json()) as any;
    expect((await h.token('/p/game', g.partner)).status).toBe(404);
    const newToken = new URL(fresh.url).hash.replace('#t=', '');
    expect((await h.token('/p/game', newToken)).status).toBe(200);
    await h.host(`/games/${g.id}/tokens/partner`, { method: 'DELETE' });
    expect((await h.token('/p/game', newToken)).status).toBe(404);
  });

  it('refuses a spectator token on partner routes', async () => {
    const h = harness();
    const g = await seedGame(h);
    expect((await h.token('/p/game', g.spectator)).status).toBe(404);
  });
});
