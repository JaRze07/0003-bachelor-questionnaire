import { describe, expect, it } from 'vitest';
import { ev, harness, playRound, seedGame } from './helpers.js';

const start = async (h: any, g: any) => h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });

describe('event upload and lease', () => {
  it('is idempotent: the same event id twice produces one round', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    const again = await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    expect((await again.json() as any).acknowledged).toHaveLength(2);
    const rounds = await h.repo.rounds.list(g.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].result).toBe('correct');
  });

  it('freezes the question text and answer at round start', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    const stored = await h.repo.questions.get(g.id, g.questions[0].id);
    await h.repo.questions.set(g.id, { ...stored!, text: 'Edited later?', rev: 2 });
    const round = (await h.repo.rounds.list(g.id))[0];
    expect(round.frozen.text).toBe(g.questions[0].text);
    expect(round.frozen.answer.text).toBe(`answer ${g.questions[0].id}`);
  });

  it('rejects uploads from an old epoch after a takeover', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await h.host(`/games/${g.id}/lease`, { json: { deviceId: 'dev-1', label: 'Phone A' } });
    const over = await h.host(`/games/${g.id}/lease/takeover`, { json: { deviceId: 'dev-2', label: 'Phone B', confirm: true } }).then((r) => r.json()) as any;
    expect(over.epoch).toBe(2);
    const stale = await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).error.code).toBe('stale_epoch');
    const ok = await playRound(h, g.id, g.questions[0].id, 'correct', 1, { epoch: 2 });
    expect(ok.status).toBe(200);
  });

  it('takeover needs confirmation and keeps the holder otherwise', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/lease`, { json: { deviceId: 'dev-1', label: 'A' } });
    expect((await h.host(`/games/${g.id}/lease/takeover`, { json: { deviceId: 'dev-2', label: 'B' } })).status).toBe(400);
    const view = await h.host(`/games/${g.id}/lease`, { json: { deviceId: 'dev-2', label: 'B' } }).then((r) => r.json()) as any;
    expect(view.isHolder).toBe(false);
    expect(view.epoch).toBe(1);
  });

  it('applies strike back only on a correct round with the rule on', async () => {
    const h = harness();
    const g = await seedGame(h);
    const user = (await h.repo.users.get('u1'))!;
    await h.repo.users.set({ ...user, premium: { state: 'active' } });
    await h.host(`/games/${g.id}`, { method: 'PATCH', json: { settings: { penaltyScheme: 'drink_or_dare', customPenalties: [], rules: { strikeBack: true, doubleOrNothing: true }, randomOrder: false } } });
    await start(h, g);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'r1', questionId: g.questions[0].id, penalty: { type: 'dare', label: 'dare', description: 'sing' } }),
      ev('round.double', 2, { roundId: 'r1' }),
      ev('round.mark', 3, { roundId: 'r1', result: 'correct' }),
      ev('round.strikeBack', 4, { roundId: 'r1', guest: 'Ola' }),
      ev('round.strikeBack', 5, { roundId: 'r1', guest: 'Tomek' }),
      ev('round.strikeBack', 6, { roundId: 'r1', guest: 'Third' }),
    ] } });
    const round = (await h.repo.rounds.list(g.id))[0];
    expect(round.doubled).toBe(true);
    expect(round.strikeBack.map((s: any) => s.guest)).toEqual(['Ola', 'Tomek']);
  });

  it('ignores a strike back when the rule is off', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'r1', questionId: g.questions[0].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
      ev('round.mark', 2, { roundId: 'r1', result: 'correct' }),
      ev('round.strikeBack', 3, { roundId: 'r1', guest: 'Ola' }),
    ] } });
    expect((await h.repo.rounds.list(g.id))[0].strikeBack).toHaveLength(0);
  });

  it('a fix-up to unplayed returns the question to the queue', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [ev('round.fixup', 50, { roundId: 'r1', questionId: g.questions[0].id, result: 'unplayed' })] } });
    const game = await h.host(`/games/${g.id}`).then((r) => r.json()) as any;
    expect(game.game.counts.rounds).toBe(0);
    expect(game.rounds[0].result).toBe('unplayed');
  });

  it('hands back partner answers written while the host was offline', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    await h.token(`/p/answers/${g.questions[3].id}`, g.partner, { method: 'PUT', json: { text: 'late answer', questionRev: 1, baseRev: 0 } });
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [] } });
    const body = await res.json() as any;
    expect(body.partnerAnswers[g.questions[3].id].text).toBe('late answer');
  });
});
