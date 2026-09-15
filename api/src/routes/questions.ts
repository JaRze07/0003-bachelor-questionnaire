import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { hostAuth, ownedGame, type Vars } from '../auth.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { newId, nowIso } from '../domain/ids.js';
import { LIMITS } from '../domain/limits.js';
import { requirePremium } from '../domain/tier.js';
import { loadFull, nextOrder, refreshDerived } from '../service.js';

const createBody = z.object({ text: z.string().trim().min(1).max(LIMITS.questionText), theme: z.string().trim().max(40).optional(), afterId: z.string().optional() });
const patchBody = z.object({ text: z.string().trim().min(1).max(LIMITS.questionText).optional(), theme: z.string().trim().max(40).optional(), confirmInvalidate: z.literal(true).optional() });
const reorderBody = z.object({ orderedIds: z.array(z.string()).min(1).max(LIMITS.questionsPremium) });
const hostAnswerBody = z.object({ text: z.string().max(LIMITS.answerText) });

export function questionRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  r.post('/:id/questions', ownedGame(repo), async (c) => {
    requirePremium(c.get('user'));
    const body = createBody.parse(await c.req.json());
    const full = await loadFull(repo, c.get('game'));
    if (full.game.status === 'finished') throw conflict('game_finished');
    if (full.questions.length >= LIMITS.questionsPremium) throw forbidden('question_limit');
    let order = nextOrder(full.questions);
    if (body.afterId) {
      const idx = full.questions.findIndex((q) => q.id === body.afterId);
      if (idx >= 0) {
        const next = full.questions[idx + 1];
        order = next ? (full.questions[idx].order + next.order) / 2 : order;
      }
    }
    const q = { id: newId(), text: body.text, theme: body.theme, order, rev: 1, source: 'custom' as const, createdAt: nowIso() };
    await repo.questions.set(full.game.id, q);
    full.questions.push(q);
    await refreshDerived(repo, full, { activity: true });
    return c.json({ question: q }, 201);
  });

  r.patch('/:id/questions/:qId', ownedGame(repo), async (c) => {
    requirePremium(c.get('user'));
    const body = patchBody.parse(await c.req.json());
    const full = await loadFull(repo, c.get('game'));
    const q = full.questions.find((x) => x.id === c.req.param('qId'));
    if (!q) throw notFound('question_not_found');
    if (body.text !== undefined && body.text !== q.text) {
      const answer = full.answers.find((a) => a.questionId === q.id && a.questionRev === q.rev && a.text.trim());
      if (answer && !body.confirmInvalidate) throw conflict('answer_would_be_invalidated');
      q.text = body.text;
      q.rev += 1;
    }
    if (body.theme !== undefined) q.theme = body.theme;
    await repo.questions.set(full.game.id, q);
    await refreshDerived(repo, full, { activity: true });
    return c.json({ question: q });
  });

  r.post('/:id/questions/reorder', ownedGame(repo), async (c) => {
    requirePremium(c.get('user'));
    const body = reorderBody.parse(await c.req.json());
    const full = await loadFull(repo, c.get('game'));
    const byId = new Map(full.questions.map((q) => [q.id, q]));
    let order = 10;
    for (const id of body.orderedIds) {
      const q = byId.get(id);
      if (!q) continue;
      q.order = order; order += 10;
      byId.delete(id);
    }
    for (const q of byId.values()) { q.order = order; order += 10; } // anything not listed goes to the end
    await repo.questions.setMany(full.game.id, full.questions);
    await refreshDerived(repo, full, { activity: true });
    return c.body(null, 204);
  });

  r.delete('/:id/questions/:qId', ownedGame(repo), async (c) => {
    requirePremium(c.get('user'));
    const full = await loadFull(repo, c.get('game'));
    const qId = c.req.param('qId');
    if (!full.questions.some((q) => q.id === qId)) throw notFound('question_not_found');
    await repo.questions.delete(full.game.id, qId);
    await repo.answers.delete(full.game.id, qId);
    full.questions = full.questions.filter((q) => q.id !== qId);
    full.answers = full.answers.filter((a) => a.questionId !== qId);
    full.game.hiddenQuestionIds = full.game.hiddenQuestionIds.filter((id) => id !== qId);
    await refreshDerived(repo, full, { activity: true });
    return c.body(null, 204);
  });

  r.put('/:id/questions/:qId/host-answer', ownedGame(repo), async (c) => {
    const body = hostAnswerBody.parse(await c.req.json());
    const full = await loadFull(repo, c.get('game'));
    const q = full.questions.find((x) => x.id === c.req.param('qId'));
    if (!q) throw notFound('question_not_found');
    q.hostAnswer = body.text.trim() || undefined;
    await repo.questions.set(full.game.id, q);
    await refreshDerived(repo, full, { activity: true });
    return c.body(null, 204);
  });

  return r;
}
