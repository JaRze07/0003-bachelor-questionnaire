import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { hostAuth, ownedGame, type Vars } from '../auth.js';
import type { Game, Language, Question, TokenRole } from '../repo/types.js';
import { LANGUAGES } from '../repo/types.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { hashToken, newId, newToken, nowIso } from '../domain/ids.js';
import { LIMITS } from '../domain/limits.js';
import { assertSettingsAllowed, defaultSettings, isPremium, requirePremium, tierOf } from '../domain/tier.js';
import { assertTransition, countsTowardLimit } from '../domain/state.js';
import { answeredIds, loadFull, playableQuestions, refreshDerived } from '../service.js';

export const WEB_BASE = () => (process.env.WEB_BASE ?? 'http://localhost:5173').replace(/\/+$/, '');
export const linkFor = (role: TokenRole, token: string) => `${WEB_BASE()}/${role}.html#t=${token}`;

const settingsSchema = z.object({
  penaltyScheme: z.enum(['drink_or_dare', 'drink', 'dare', 'custom']),
  customPenalties: z.array(z.object({ label: z.string().trim().min(1).max(LIMITS.penaltyLabel), description: z.string().max(LIMITS.penaltyDescription).optional() })).max(LIMITS.customPenalties),
  rules: z.object({ strikeBack: z.boolean(), doubleOrNothing: z.boolean() }),
  randomOrder: z.boolean(),
});
const langSchema = z.enum(LANGUAGES as [Language, ...Language[]]);
const createBody = z.object({ language: langSchema, title: z.string().trim().max(LIMITS.title).optional(), source: z.enum(['curated', 'blank']).default('curated') });
const patchBody = z.object({
  title: z.string().trim().max(LIMITS.title).optional(),
  language: langSchema.optional(),
  settings: settingsSchema.optional(),
  hiddenQuestionIds: z.array(z.string()).max(LIMITS.questionsPremium).optional(),
  ifRevision: z.number().int().optional(),
});
const transitionBody = z.object({ to: z.enum(['awaiting_partner', 'in_progress', 'finished']), allowPartial: z.boolean().optional(), confirm: z.literal(true).optional() });

export async function issueToken(deps: AppDeps, game: Game, role: TokenRole): Promise<string> {
  const token = newToken();
  const hash = hashToken(token);
  const prev = game.tokens[role];
  if (prev?.hash) await deps.repo.tokens.delete(prev.hash);
  const version = (prev?.version ?? 0) + 1;
  game.tokens[role] = { hash, version };
  await deps.repo.tokens.set({ hash, gameId: game.id, role, version, createdAt: nowIso() });
  return token;
}

export async function curatedQuestions(deps: AppDeps, language: Language, now: string): Promise<Question[]> {
  const set = await deps.curated(language);
  if (!set) throw badRequest('curated_missing', `No curated set for ${language}`);
  return set.slice(0, LIMITS.questionsFree).map((q, i) => ({
    id: q.id, text: q.text, theme: q.theme, order: (i + 1) * 10, rev: 1, source: 'curated' as const, createdAt: now,
  }));
}

export function gameRoutes(deps: AppDeps) {
  const { repo } = deps;
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  r.post('/', async (c) => {
    const body = createBody.parse(await c.req.json());
    const user = c.get('user');
    if (body.source === 'blank') requirePremium(user);
    const games = await repo.games.listByHost(user.uid);
    if (games.filter(countsTowardLimit).length >= LIMITS.activeGames) throw forbidden('active_game_limit');
    const now = nowIso();
    const game: Game = {
      id: newId(), hostUid: user.uid, status: 'awaiting_partner', language: body.language, title: body.title,
      settings: defaultSettings(), tier: tierOf(user), hiddenQuestionIds: [],
      tokens: { partner: { hash: '', version: 0 }, spectator: { hash: '', version: 0 } },
      epoch: 1, revision: 0,
      counts: { questions: 0, answered: 0, rounds: 0, correct: 0, wrong: 0 },
      lastActivityAt: now, createdAt: now, updatedAt: now,
    };
    const partner = await issueToken(deps, game, 'partner');
    const spectator = await issueToken(deps, game, 'spectator');
    const questions = body.source === 'curated' ? await curatedQuestions(deps, body.language, now) : [];
    await repo.questions.setMany(game.id, questions);
    await repo.games.set(game);
    await refreshDerived(repo, { game, questions, answers: [], rounds: [] }, { activity: true });
    return c.json({ game, questions, tokens: { partner: { url: linkFor('partner', partner) }, spectator: { url: linkFor('spectator', spectator) } }, epoch: game.epoch }, 201);
  });

  r.get('/', async (c) => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const games = (await repo.games.listByHost(c.get('uid')))
      .filter((g) => g.status !== 'finished' || (g.finishedAt ?? g.updatedAt) > cutoff)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return c.json({
      games: games.map((g) => ({
        id: g.id, title: g.title, status: g.status, language: g.language, tier: g.tier, counts: g.counts, epoch: g.epoch,
        partner: { opened: Boolean(g.partnerOpenedAt), answered: g.counts.answered, total: g.counts.questions, newUnanswered: Math.max(0, g.counts.questions - g.counts.answered) },
        lastActivityAt: g.lastActivityAt, createdAt: g.createdAt, updatedAt: g.updatedAt, retentionWarnedAt: g.retentionWarnedAt,
      })),
    });
  });

  r.get('/:id', ownedGame(repo), async (c) => {
    const full = await loadFull(repo, c.get('game'));
    const answers = Object.fromEntries(full.answers.map((a) => [a.questionId, { text: a.text, rev: a.rev, questionRev: a.questionRev, updatedAt: a.updatedAt }]));
    return c.json({ game: full.game, questions: full.questions, answers, rounds: full.rounds, epoch: full.game.epoch, revision: full.game.revision, serverTime: nowIso() });
  });

  r.patch('/:id', ownedGame(repo), async (c) => {
    const body = patchBody.parse(await c.req.json());
    const game = c.get('game');
    const user = c.get('user');
    if (body.ifRevision !== undefined && body.ifRevision !== game.revision) throw conflict('revision_mismatch', undefined, { revision: game.revision });
    const full = await loadFull(repo, game);
    if (body.title !== undefined) game.title = body.title;
    if (body.settings) { assertSettingsAllowed(body.settings, user); game.settings = body.settings; }
    if (body.hiddenQuestionIds) {
      if (!isPremium(user) && body.hiddenQuestionIds.length > LIMITS.hiddenFree) throw forbidden('hidden_limit');
      const ids = new Set(full.questions.map((q) => q.id));
      game.hiddenQuestionIds = body.hiddenQuestionIds.filter((id) => ids.has(id));
    }
    if (body.language && body.language !== game.language) {
      const started = game.status === 'in_progress' || game.status === 'finished';
      if (started || game.partnerOpenedAt || full.answers.length) throw conflict('language_locked', 'Language can change only before the partner opens the link and before any answer exists');
      const now = nowIso();
      for (const q of full.questions.filter((q) => q.source === 'curated')) await repo.questions.delete(game.id, q.id);
      const fresh = await curatedQuestions(deps, body.language, now);
      await repo.questions.setMany(game.id, fresh);
      full.questions = [...fresh, ...full.questions.filter((q) => q.source === 'custom')];
      game.language = body.language;
      game.hiddenQuestionIds = [];
    }
    await refreshDerived(repo, full, { activity: true });
    return c.json({ game });
  });

  r.post('/:id/transition', ownedGame(repo), async (c) => {
    const body = transitionBody.parse(await c.req.json());
    const game = c.get('game');
    const full = await loadFull(repo, game);
    assertTransition(game, body.to);
    if (body.to === 'in_progress') {
      const playable = playableQuestions(game, full.questions);
      const answered = answeredIds(playable, full.answers);
      if (answered.size === 0) throw conflict('no_answers', 'No question has an answer yet');
      if (answered.size < playable.length && !body.allowPartial) throw conflict('partial_answers', undefined, { answered: answered.size, total: playable.length });
    }
    if (body.to === 'finished') {
      if (!body.confirm) throw badRequest('confirm_required');
      game.finishedAt = nowIso();
    }
    game.status = body.to;
    await refreshDerived(repo, full, { activity: true });
    return c.json({ game });
  });

  r.delete('/:id', ownedGame(repo), async (c) => {
    const game = c.get('game');
    await repo.games.deleteTree(game.id);
    return c.body(null, 204);
  });

  r.get('/:id/export', ownedGame(repo), async (c) => {
    const game = c.get('game');
    const full = await loadFull(repo, game);
    const omitGuests = c.req.query('omitGuests') === 'true';
    const events = await repo.events.list(game.id);
    const rounds = omitGuests ? full.rounds.map((r) => ({ ...r, strikeBack: [] })) : full.rounds;
    c.header('Content-Disposition', `attachment; filename="bachelor-questionnaire-${game.id}.json"`);
    return c.json({
      exportedAt: nowIso(), containsGuestNames: !omitGuests && full.rounds.some((r) => r.strikeBack.length > 0),
      game: { id: game.id, title: game.title, language: game.language, status: game.status, settings: game.settings, counts: game.counts, createdAt: game.createdAt, finishedAt: game.finishedAt },
      questions: full.questions, answers: full.answers, rounds, events,
    });
  });

  return r;
}
