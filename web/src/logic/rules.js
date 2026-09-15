// Extra rules (premium toggles): strike back and double or nothing. Spec §10.

export const GUEST_MAX = 40;

/** What the host can do after marking a round, given the rules frozen into that round. */
export function outcome(round) {
  const rules = round.frozen.rules || {};
  const doubled = Boolean(round.doubled && rules.doubleOrNothing);
  if (round.result === 'wrong') {
    return { showPenalty: true, multiplier: doubled ? 2 : 1, strikeBack: false, maxGuests: 0 };
  }
  if (round.result === 'correct') {
    const sb = Boolean(rules.strikeBack);
    return { showPenalty: false, multiplier: 1, strikeBack: sb, maxGuests: sb ? (doubled ? 2 : 1) : 0 };
  }
  return { showPenalty: false, multiplier: 1, strikeBack: false, maxGuests: 0 };
}

export function canDouble(round, settings) {
  return Boolean(settings.rules && settings.rules.doubleOrNothing) && !round.doubled && !round.revealedAnswer;
}

export function addStrikeBack(round, guest) {
  const o = outcome(round);
  const name = String(guest || '').trim().slice(0, GUEST_MAX);
  if (!o.strikeBack || !name) return false;
  round.strikeBack = round.strikeBack || [];
  if (round.strikeBack.length >= o.maxGuests) return false;
  round.strikeBack.push({ guest: name });
  return true;
}
