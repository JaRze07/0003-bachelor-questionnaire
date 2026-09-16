import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { gameTokenAuth, type Vars } from '../auth.js';
import { conflict, notFound } from '../errors.js';
import { nowIso } from '../domain/ids.js';
import { LIMITS } from '../domain/limits.js';
import { partnerMayWrite } from '../domain/state.js';
import { loadFull, playableQuestions, refreshDerived } from '../service.js';

const answerBody = z.object({ text: z.string().max(LIMITS.answerText), questionRev: z.number().int().positive(), baseRev: z.number().int().nonnegative() });
const reportBody = z.object({ reason: z.string().trim().min(1).max(500) });

export function partnerRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', gameTokenAuth(repo, 'partner'));

  r.get('/game', async (c) => {
    const game = c.get('game');
    const full = await loadFull(repo, game);
    const previousLoad = game.partnerLastLoadedAt ?? '';
    const answersByQ = new Map(full.answers.map((a) => [a.questionId, a]));
    const questions = playableQuestions(game, full.questions).map((q) => {
      const a = answersByQ.get(q.id);
      const answered = Boolean(a && a.questionRev === q.rev && a.text.trim());
      return { id: q.id, rev: q.rev, text: q.text, theme: q.theme, order: q.order, isNew: !answered && q.createdAt > previousLoad };
    });
    const answers = Object.fromEntries(full.answers.filter((a) => questions.some((q) => q.id === a.questionId)).map((a) => [a.questionId, { text: a.text, rev: a.rev, questionRev: a.questionRev }]));
    const now = nowIso();
    const fields: Record<string, string> = { partnerLastLoadedAt: now };
    if (!game.partnerOpenedAt) { game.partnerOpenedAt = now; fields.partnerOpenedAt = now; }
    game.partnerLastLoadedAt = now;
    await repo.games.update(game.id, fields);
    return c.json({ language: game.language, status: game.status, title: game.title, readOnly: !partnerMayWrite(game), questions, answers, lastLoadedAt: previousLoad || null });
  });

  r.put('/answers/:qId', async (c) => {
    const b = answerBody.parse(await c.req.json());
    const game = c.get('game');
    if (!partnerMayWrite(game)) throw conflict('game_closed');
    const full = await loadFull(repo, game);
    const q = playableQuestions(game, full.questions).find((x) => x.id === c.req.param('qId'));
    if (!q) throw notFound('question_not_found');
    if (q.rev !== b.questionRev) throw conflict('question_changed', undefined, { questionRev: q.rev, text: q.text });
    const existing = full.answers.find((a) => a.questionId === q.id);
    const currentRev = existing && existing.questionRev === q.rev ? existing.rev : 0;
    if (b.baseRev !== currentRev) throw conflict('answer_conflict', undefined, { current: existing ? { text: existing.text, rev: existing.rev } : null });
    const now = nowIso();
    const saved = { questionId: q.id, text: b.text, rev: currentRev + 1, questionRev: q.rev, updatedAt: now };
    await repo.answers.set(game.id, saved);
    full.answers = [...full.answers.filter((a) => a.questionId !== q.id), saved];
    game.partnerLastAnswerAt = now;
    await refreshDerived(repo, full, { activity: true });
    return c.json({ rev: saved.rev, savedAt: now });
  });

  r.post('/report', async (c) => {
    const b = reportBody.parse(await c.req.json());
    console.warn(JSON.stringify({ severity: 'WARNING', message: 'partner report', gameId: c.get('game').id, reason: b.reason }));
    return c.body(null, 204);
  });

  return r;
}
