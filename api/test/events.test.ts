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
    // right epoch, wrong device: still refused, the new phone holds the game
    const wrongDevice = await h.host(`/games/${g.id}/events`, { json: { epoch: 2, deviceId: 'dev-1', events: [] } });
    expect((await wrongDevice.json() as any).error.code).toBe('not_lease_holder');
    const ok = await h.host(`/games/${g.id}/events`, { json: { epoch: 2, deviceId: 'dev-2', events: [
      ev('round.start', 1, { roundId: 'round-7', questionId: g.questions[0].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
      ev('round.mark', 2, { roundId: 'round-7', result: 'correct' }),
    ] } });
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).acknowledged).toHaveLength(2);
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
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, penalty: { type: 'dare', label: 'dare', description: 'sing' } }),
      ev('round.double', 2, { roundId: 'round-1' }),
      ev('round.mark', 3, { roundId: 'round-1', result: 'correct' }),
      ev('round.strikeBack', 4, { roundId: 'round-1', guest: 'Ola' }),
      ev('round.strikeBack', 5, { roundId: 'round-1', guest: 'Tomek' }),
      ev('round.strikeBack', 6, { roundId: 'round-1', guest: 'Third' }),
    ] } });
    const round = (await h.repo.rounds.list(g.id))[0];
    expect(round.doubled).toBe(true);
    expect(round.strikeBack.map((s: any) => s.guest)).toEqual(['Ola', 'Tomek']);
  });

  it('ignores a strike back when the rule is off', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
      ev('round.mark', 2, { roundId: 'round-1', result: 'correct' }),
      ev('round.strikeBack', 3, { roundId: 'round-1', guest: 'Ola' }),
    ] } });
    expect((await h.repo.rounds.list(g.id))[0].strikeBack).toHaveLength(0);
  });

  it('a fix-up to unplayed returns the question to the queue', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [ev('round.fixup', 50, { roundId: 'round-1', questionId: g.questions[0].id, result: 'unplayed' })] } });
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

describe('hardening from the Codex review', () => {
  it('refuses an event id that is not a safe document id', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      { id: '../escape/id', seq: 1, type: 'round.start', at: new Date().toISOString(), payload: {} },
    ] } });
    expect(res.status).toBe(400);
  });

  it('refuses a payload that would blow the document limit', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, filler: 'x'.repeat(70_000) }),
    ] } });
    const body = await res.json() as any;
    expect(body.rejected[0]).toMatchObject({ reason: 'too_large' });
    expect(await h.repo.rounds.list(g.id)).toHaveLength(0);
  });

  it('reports events it could not apply instead of acknowledging them', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.mark', 1, { roundId: 'round-missing', result: 'correct' }),
    ] } });
    const body = await res.json() as any;
    expect(body.acknowledged).toHaveLength(0);
    expect(body.rejected[0].reason).toBe('not_applicable');
  });

  it('freezes a finished game against further gameplay', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'correct', 1);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'finished', confirm: true } });
    const res = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.start', 5, { roundId: 'round-late', questionId: g.questions[1].id, penalty: { type: 'drink', label: 'drink', description: 'x' } }),
    ] } });
    expect((await res.json() as any).rejected).toHaveLength(1);
    // a fix-up within 24 h is still allowed
    const fix = await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [
      ev('round.fixup', 6, { roundId: 'round-1', questionId: g.questions[0].id, result: 'wrong' }),
    ] } });
    expect((await fix.json() as any).acknowledged).toHaveLength(1);
  });
});

describe('second review fixes', () => {
  it('does not name the same guest twice when an upload is retried', async () => {
    const h = harness();
    const g = await seedGame(h);
    const user = (await h.repo.users.get('u1'))!;
    await h.repo.users.set({ ...user, premium: { state: 'active' } });
    await h.host(`/games/${g.id}`, { method: 'PATCH', json: { settings: { penaltyScheme: 'drink_or_dare', customPenalties: [], rules: { strikeBack: true, doubleOrNothing: false }, randomOrder: false } } });
    await start(h, g);
    const events = [
      ev('round.start', 1, { roundId: 'round-1', questionId: g.questions[0].id, penalty: { type: 'dare', label: 'dare', description: 'x' } }),
      ev('round.mark', 2, { roundId: 'round-1', result: 'correct' }),
      ev('round.strikeBack', 3, { roundId: 'round-1', guest: 'Ola' }),
    ];
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events } });
    // same action, new event ids (the client resent after a timeout)
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: events.map((e) => ({ ...e, id: `${e.id}-retry` })) } });
    expect((await h.repo.rounds.list(g.id))[0].strikeBack).toEqual([{ guest: 'Ola' }]);
  });

  it('marks a voided round so its question returns to the queue', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await playRound(h, g.id, g.questions[0].id, 'wrong', 1);
    await h.host(`/games/${g.id}/events`, { json: { epoch: 1, deviceId: 'dev-1', events: [ev('round.fixup', 60, { roundId: 'round-1', questionId: g.questions[0].id, result: 'unplayed' })] } });
    expect((await h.repo.rounds.list(g.id))[0].voided).toBe(true);
  });

  it('keeps a takeover when a derived refresh runs after it', async () => {
    const h = harness();
    const g = await seedGame(h); await start(h, g);
    await h.host(`/games/${g.id}/lease`, { json: { deviceId: 'dev-1', label: 'A' } });
    await h.host(`/games/${g.id}/lease/takeover`, { json: { deviceId: 'dev-2', label: 'B', confirm: true } });
    // an unrelated host mutation must not restore the old epoch or holder
    await h.host(`/games/${g.id}`, { method: 'PATCH', json: { title: 'Renamed' } });
    const game = (await h.repo.games.get(g.id))!;
    expect(game.epoch).toBe(2);
    expect(game.lease!.deviceId).toBe('dev-2');
    expect(game.title).toBe('Renamed');
  });
});
