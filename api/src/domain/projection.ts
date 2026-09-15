import type { Game, Projection, Round } from '../repo/types.js';
import { LIMITS } from './limits.js';

/**
 * The only thing spectators ever see. Built from marked rounds; partner answers, host answers, guest
 * nicknames, penalty descriptions and unplayed rounds are never copied in (spec FR-014).
 */
export function buildProjection(game: Game, rounds: Round[], playableTotal: number, now: string): Projection {
  const marked = rounds
    .filter((r) => r.result === 'correct' || r.result === 'wrong')
    .sort((a, b) => a.n - b.n);
  const correct = marked.filter((r) => r.result === 'correct').length;
  const wrong = marked.length - correct;
  return {
    gameId: game.id,
    language: game.language,
    title: game.title,
    status: game.status,
    score: { correct, wrong, played: marked.length, total: playableTotal },
    rounds: marked.slice(-LIMITS.projectionRounds).map((r) => ({
      n: r.n,
      question: r.frozen.text,
      result: r.result as 'correct' | 'wrong',
      penalty: { type: r.penalty.type, label: r.penalty.label },
      doubled: r.doubled,
    })),
    revision: game.revision,
    updatedAt: now,
  };
}
