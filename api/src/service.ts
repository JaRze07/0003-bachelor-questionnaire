// Shared game helpers used by several routes: derived counts, status, projection, activity.
import type { Answer, Game, Question, Repo, Round } from './repo/types.js';
import { buildProjection } from './domain/projection.js';
import { completenessStatus } from './domain/state.js';
import { nowIso } from './domain/ids.js';

export interface FullGame { game: Game; questions: Question[]; answers: Answer[]; rounds: Round[] }

export async function loadFull(repo: Repo, game: Game): Promise<FullGame> {
  const [questions, answers, rounds] = await Promise.all([
    repo.questions.list(game.id), repo.answers.list(game.id), repo.rounds.list(game.id),
  ]);
  return { game, questions, answers, rounds };
}

/** Questions the host can play: not hidden (free tier) and existing. */
export function playableQuestions(game: Game, questions: Question[]): Question[] {
  const hidden = new Set(game.hiddenQuestionIds);
  return questions.filter((q) => !hidden.has(q.id));
}

/** A question is answered when a partner answer for its current revision exists and is non-blank, or the host supplied one. */
export function answeredIds(questions: Question[], answers: Answer[]): Set<string> {
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  const out = new Set<string>();
  for (const q of questions) {
    const a = byQ.get(q.id);
    if ((a && a.questionRev === q.rev && a.text.trim()) || (q.hostAnswer && q.hostAnswer.trim())) out.add(q.id);
  }
  return out;
}

/**
 * Recompute counts, completeness status and the spectator projection, bump the revision and save.
 * `activity` = true when the change counts as host/partner activity for retention (spec §4).
 */
export async function refreshDerived(repo: Repo, full: FullGame, opts: { activity?: boolean; bump?: boolean } = {}): Promise<Game> {
  const { game, questions, answers, rounds } = full;
  const playable = playableQuestions(game, questions);
  const answered = answeredIds(playable, answers);
  const marked = rounds.filter((r) => r.result === 'correct' || r.result === 'wrong');
  game.counts = {
    questions: playable.length,
    answered: answered.size,
    rounds: marked.length,
    correct: marked.filter((r) => r.result === 'correct').length,
    wrong: marked.filter((r) => r.result === 'wrong').length,
  };
  game.status = completenessStatus(game, playable.length, answered.size);
  const now = nowIso();
  if (opts.bump !== false) game.revision += 1;
  game.updatedAt = now;
  if (opts.activity) game.lastActivityAt = now;
  await repo.games.set(game);
  await repo.projections.set(buildProjection(game, rounds, playable.length, now));
  return game;
}

export function nextOrder(questions: Question[]): number {
  return questions.reduce((m, q) => Math.max(m, q.order), 0) + 10;
}
