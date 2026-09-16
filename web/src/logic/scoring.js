export function tally(rounds) {
  let correct = 0, wrong = 0;
  for (const r of rounds) {
    if (r.result === 'correct') correct++;
    else if (r.result === 'wrong') wrong++;
  }
  return { correct, wrong, played: correct + wrong };
}

/** Round numbers follow order of play; fix-up to "unplayed" removes the round and renumbers. */
export function renumber(rounds) {
  const kept = rounds.filter((r) => r.result !== 'unplayed').sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  kept.forEach((r, i) => { r.n = i + 1; });
  return kept;
}

export function summaryText(t, title, rounds) {
  const s = tally(rounds);
  const lines = [title ? `${title}` : t('summary.title'), t('summary.score', { correct: s.correct, wrong: s.wrong })];
  for (const r of rounds.filter((r) => r.result !== 'unplayed')) {
    lines.push(`${r.n}. ${r.frozen.text} — ${t('result.' + r.result)}${r.doubled ? ' ×2' : ''}`);
  }
  return lines.join('\n');
}
