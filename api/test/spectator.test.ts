import { describe, expect, it } from 'vitest';
import { ev, harness, playRound, seedGame } from './helpers.js';

const start = (h: any, g: any) => h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });
const summary = (h: any, g: any) => h.token('/s/summary', g.spectator).then((r: Response) => r.json()) as Promise<any>;
const upload = (h: any, g: any, events: unknown[]) => h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events } });
const startEvent = (g: any, i: number, seq: number) =>
  ev('round.start', seq, { roundId: `round-${i + 1}`, questionId: g.questions[i].id, penalty: { type: 'dare', label: 'Dare', description: 'sing a song' } });

describe('live guest view', () => {
  it('shows the question on the table but hides the answer until the organiser reveals it', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await upload(h, g, [startEvent(g, 0, 1)]);
    const before = await summary(h, g);
    expect(before.live).toMatchObject({ n: 1, question: g.questions[0].text, answerRevealed: false, penalty: { label: 'Dare', description: 'sing a song' } });
    expect(before.live.answer).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain(`answer ${g.questions[0].id}`);

    await upload(h, g, [ev('round.reveal', 2, { roundId: 'round-1' })]);
    const after = await summary(h, g);
    expect(after.live.answerRevealed).toBe(true);
    expect(after.live.answer).toBe(`answer ${g.questions[0].id}`);
  });

  it('moves a marked round into the history with its answer and clears the table', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    const s = await summary(h, g);
    expect(s.live).toBeNull();
    expect(s.score).toEqual({ correct: 0, wrong: 1, played: 1, total: 20 });
    expect(s.rounds[0]).toMatchObject({ n: 1, result: 'wrong', answer: `answer ${g.questions[0].id}`, penalty: { description: '4 fingers' } });
  });

  it('never leaks answers of questions that were not played', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    await upload(h, g, [startEvent(g, 1, 50)]);
    const raw = JSON.stringify(await summary(h, g));
    for (const q of g.questions.slice(1)) expect(raw).not.toContain(`answer ${q.id}`);
    expect(raw).not.toContain('hostUid');
  });

  it('names the guest who took a strike back', async () => {
    const h = harness();
    const g = await seedGame(h);
    const user = (await h.repo.users.get('u1'))!;
    await h.repo.users.set({ ...user, premium: { state: 'active' } });
    await h.host(`/games/${g.id}`, { method: 'PATCH', json: { settings: { penaltyScheme: 'drink_or_dare', customPenalties: [], rules: { strikeBack: true, doubleOrNothing: false }, randomOrder: false } } });
    await start(h, g);
    await upload(h, g, [startEvent(g, 0, 1), ev('round.mark', 2, { roundId: 'round-1', result: 'correct' }), ev('round.strikeBack', 3, { roundId: 'round-1', guest: 'Ola' })]);
    expect((await summary(h, g)).rounds[0].takenBy).toEqual(['Ola']);
  });

  it('drops a voided round from the view and clears the table when the game is finished', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    await upload(h, g, [ev('round.fixup', 40, { roundId: 'round-1', questionId: g.questions[0].id, result: 'unplayed' })]);
    expect((await summary(h, g)).rounds).toHaveLength(0);
    await upload(h, g, [startEvent(g, 1, 50)]);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'finished', confirm: true } });
    const s = await summary(h, g);
    expect(s.status).toBe('finished');
    expect(s.live).toBeNull();
  });

  it('answers 304 for an unchanged revision and changes the ETag on a reveal', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await upload(h, g, [startEvent(g, 0, 1)]);
    const first = await h.token('/s/summary', g.spectator);
    const etag = first.headers.get('etag')!;
    expect((await h.token('/s/summary', g.spectator, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    await upload(h, g, [ev('round.reveal', 2, { roundId: 'round-1' })]);
    expect((await h.token('/s/summary', g.spectator)).headers.get('etag')).not.toBe(etag);
  });

  it('is gone after the game is deleted', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}`, { method: 'DELETE' });
    expect((await h.token('/s/summary', g.spectator)).status).toBe(404);
  });
});
