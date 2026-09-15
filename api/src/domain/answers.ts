import type { Answer, Question } from '../repo/types.js';

/** Same precedence as the client (spec FR-011): partner answer for the current revision, else host answer. */
export function answerFor(q: Question, a: Answer | null): { text: string; source: 'partner' | 'host' | 'none' } {
  if (a && a.questionRev === q.rev && a.text.trim()) return { text: a.text, source: 'partner' };
  if (q.hostAnswer && q.hostAnswer.trim()) return { text: q.hostAnswer, source: 'host' };
  return { text: '', source: 'none' };
}
