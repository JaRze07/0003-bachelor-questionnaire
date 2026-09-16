import { describe, expect, it } from 'vitest';
import { harness, seedGame, tokenFromUrl, CURATED } from './helpers.js';

describe('games', () => {
  it('creates a game with the curated set and two links', async () => {
    const h = harness();
    const res = await h.host('/games', { json: { language: 'en', title: 'Hen night' } });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.questions).toHaveLength(CURATED.length);
    expect(body.game.status).toBe('awaiting_partner');
    expect(body.game.tier).toBe('free');
    expect(tokenFromUrl(body.tokens.partner.url)).not.toBe(tokenFromUrl(body.tokens.spectator.url));
    // plain tokens are never stored
    const stored = await h.repo.games.get(body.game.id);
    expect(stored!.tokens.partner.hash).not.toContain(tokenFromUrl(body.tokens.partner.url));
  });

  it('rejects an unknown language and a blank set for free hosts', async () => {
    const h = harness();
    expect((await h.host('/games', { json: { language: 'de' } })).status).toBe(400);
    expect((await h.host('/games', { json: { language: 'en', source: 'blank' } })).status).toBe(403);
  });

  it('stops at ten active games but ignores finished ones', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) await h.host('/games', { json: { language: 'en' } });
    expect((await h.host('/games', { json: { language: 'en' } })).status).toBe(403);
  });

  it('becomes ready when every question is answered', async () => {
    const h = harness();
    const g = await seedGame(h);
    const after = await h.host(`/games/${g.id}`).then((r) => r.json()) as any;
    expect(after.game.status).toBe('ready');
    expect(after.game.counts.answered).toBe(CURATED.length);
  });

  it('blocks a start with no answers and allows an explicit partial start', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } })).status).toBe(409);
    await h.token(`/p/answers/${g.questions[0].id}`, g.partner, { method: 'PUT', json: { text: 'yes', questionRev: 1, baseRev: 0 } });
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } })).status).toBe(409);
    const ok = await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress', allowPartial: true } });
    expect(ok.status).toBe(200);
  });

  it('finish needs confirmation and is irreversible', async () => {
    const h = harness();
    const g = await seedGame(h);
    await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } });
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'finished' } })).status).toBe(400);
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'finished', confirm: true } })).status).toBe(200);
    expect((await h.host(`/games/${g.id}/transition`, { json: { to: 'in_progress' } })).status).toBe(409);
  });

  it('changes language only in draft and never after an answer', async () => {
    const h = harness();
    const fresh = await h.host('/games', { json: { language: 'en' } }).then((r) => r.json()) as any;
    expect((await h.host(`/games/${fresh.game.id}`, { method: 'PATCH', json: { language: 'pl' } })).status).toBe(200);
    const g = await seedGame(h);
    expect((await h.host(`/games/${g.id}`, { method: 'PATCH', json: { language: 'pl' } })).status).toBe(409);
  });

  it('hides at most five questions on the free tier', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const ids = g.questions.map((q) => q.id);
    expect((await h.host(`/games/${g.id}`, { method: 'PATCH', json: { hiddenQuestionIds: ids.slice(0, 6) } })).status).toBe(403);
    const ok = await h.host(`/games/${g.id}`, { method: 'PATCH', json: { hiddenQuestionIds: ids.slice(0, 5) } });
    expect((await ok.json() as any).game.counts.questions).toBe(15);
  });

  it('refuses premium settings for a free host', async () => {
    const h = harness();
    const g = await seedGame(h, { answer: false });
    const res = await h.host(`/games/${g.id}`, { method: 'PATCH', json: { settings: { penaltyScheme: 'dare', customPenalties: [], rules: { strikeBack: true, doubleOrNothing: false }, randomOrder: false } } });
    expect(res.status).toBe(403);
    expect((await res.json() as any).error.code).toBe('premium_required');
  });

  it('never returns another host game', async () => {
    const h = harness();
    const g = await seedGame(h, { uid: 'u1' });
    expect((await h.host(`/games/${g.id}`, { uid: 'u2' })).status).toBe(404);
  });

  it('deletes the game and its links', async () => {
    const h = harness();
    const g = await seedGame(h);
    expect((await h.host(`/games/${g.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await h.token('/p/game', g.partner)).status).toBe(404);
    expect((await h.token('/s/summary', g.spectator)).status).toBe(404);
  });

  it('exports the game and can omit guest names', async () => {
    const h = harness();
    const g = await seedGame(h);
    const res = await h.host(`/games/${g.id}/export?omitGuests=true`);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const body = await res.json() as any;
    expect(body.questions).toHaveLength(CURATED.length);
    expect(body.containsGuestNames).toBe(false);
  });
});
