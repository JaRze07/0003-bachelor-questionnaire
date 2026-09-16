import { describe, expect, it } from 'vitest';
import { harness, playRound, seedGame } from './helpers.js';

describe('spectator page', () => {
  it('never exposes answers, guest names or unmarked rounds', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    // a started but unmarked round
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [{ id: 'open-round-9', seq: 99, type: 'round.start', at: new Date().toISOString(), payload: { roundId: 'round-9', questionId: g.questions[1].id } }] } });
    const res = await h.token('/s/summary', g.spectator);
    const body = await res.json() as any;
    const raw = JSON.stringify(body);
    expect(body.score).toEqual({ correct: 0, wrong: 1, played: 1, total: 20 });
    expect(body.rounds).toHaveLength(1);
    expect(raw).not.toContain('answer en-001');
    expect(raw).not.toContain('4 fingers');
    expect(raw).not.toContain(g.questions[1].text);
  });

  it('answers 304 for an unchanged revision and updates after a fix-up', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });
    await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    const first = await h.token('/s/summary', g.spectator);
    const etag = first.headers.get('etag')!;
    expect((await h.token('/s/summary', g.spectator, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [{ id: 'fixup-round-1', seq: 500, type: 'round.fixup', at: new Date().toISOString(), payload: { roundId: 'round-1', questionId: g.questions[0].id, result: 'wrong' } }] } });
    const second = await h.token('/s/summary', g.spectator);
    expect(second.headers.get('etag')).not.toBe(etag);
    expect((await second.json() as any).score.wrong).toBe(1);
  });

  it('is gone after the game is deleted', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}`, { method: 'DELETE' });
    expect((await h.token('/s/summary', g.spectator)).status).toBe(404);
  });
});
