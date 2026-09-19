import type { Game, Projection, ProjectionPenalty, Round } from '../repo/types.js';
import { LIMITS } from './limits.js';

const penaltyOf = (r: Round): ProjectionPenalty => ({ type: r.penalty.type, label: r.penalty.label, description: r.penalty.description });

/**
 * What guests see (spec 002 §3). Built only from rounds the organiser has started:
 *  - played rounds with question, the partner's answer, penalty, result and who took a strike back;
 *  - the round on the table, whose answer is included only after the organiser revealed it.
 * Never included: answers of questions not played yet, the current answer before the reveal, hidden or
 * deleted questions, voided rounds, anything about the organiser's account.
 */
export function buildProjection(game: Game, rounds: Round[], playableTotal: number, now: string): Projection {
  const marked = rounds
    .filter((r) => !r.voided && (r.result === 'correct' || r.result === 'wrong'))
    .sort((a, b) => a.n - b.n);
  const correct = marked.filter((r) => r.result === 'correct').length;

  const open = game.status === 'finished' ? [] : rounds
    .filter((r) => !r.voided && r.result === 'unplayed')
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const current = open[0];

  return {
    gameId: game.id,
    language: game.language,
    title: game.title,
    status: game.status,
    score: { correct, wrong: marked.length - correct, played: marked.length, total: playableTotal },
    live: current ? {
      n: marked.length + 1,
      question: current.frozen.text,
      theme: current.frozen.theme,
      penalty: penaltyOf(current),
      doubled: current.doubled,
      answerRevealed: Boolean(current.revealedAt),
      ...(current.revealedAt ? { answer: current.frozen.answer.text } : {}),
    } : null,
    rounds: marked.slice(-LIMITS.projectionRounds).map((r) => ({
      n: r.n,
      question: r.frozen.text,
      theme: r.frozen.theme,
      answer: r.frozen.answer.text,
      result: r.result as 'correct' | 'wrong',
      penalty: penaltyOf(r),
      doubled: r.doubled,
      takenBy: r.strikeBack.map((g) => g.guest),
    })),
    revision: game.revision,
    updatedAt: now,
  };
}
