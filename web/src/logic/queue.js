// Pure question-queue logic. No DOM, no storage.

/** Questions that can still be played: not hidden, not already used by a marked/started round. */
export function unplayed(questions, rounds, hiddenIds = []) {
  const hidden = new Set(hiddenIds);
  const used = new Set(rounds.filter((r) => r.result !== 'unplayed').map((r) => r.questionId));
  return questions.filter((q) => !hidden.has(q.id) && !used.has(q.id)).sort((a, b) => a.order - b.order);
}

/** The answer to reveal: partner's for the current revision, else the host-supplied one. */
export function answerFor(question, answers) {
  const a = answers[question.id];
  if (a && a.questionRev === question.rev && a.text && a.text.trim()) return { text: a.text, source: 'partner' };
  if (question.hostAnswer && question.hostAnswer.trim()) return { text: question.hostAnswer, source: 'host' };
  return { text: '', source: 'none' };
}

export function playable(questions, rounds, answers, hiddenIds = []) {
  return unplayed(questions, rounds, hiddenIds).filter((q) => answerFor(q, answers).source !== 'none');
}

/**
 * Pick the next question once per round (spec: the choice is made when the round starts and never
 * changes under the host). `random()` is injectable for tests.
 */
export function chooseNext(pool, randomOrder, random = Math.random) {
  if (!pool.length) return null;
  if (!randomOrder) return pool[0];
  return pool[Math.floor(random() * pool.length)];
}

/** Late-added questions that became playable since `knownIds`: appended, never inserted (spec FR-013). */
export function newlyPlayable(pool, knownIds) {
  const known = new Set(knownIds);
  return pool.filter((q) => !known.has(q.id));
}
