import { describe, expect, it } from 'vitest';
import { answerFor, chooseNext, newlyPlayable, playable, unplayed } from '../src/logic/queue.js';
import { renumber, tally } from '../src/logic/scoring.js';
import { penaltyOptions, validateCustomList, validatePenalty } from '../src/logic/penalties.js';
import { addStrikeBack, canDouble, outcome } from '../src/logic/rules.js';
import { addActive, afterInterstitial, bannerAllowed, interstitialAllowed, INTERSTITIAL_EVERY_SEC } from '../src/logic/adGate.js';

const q = (id, order, rev = 1, extra = {}) => ({ id, text: `Q${id}`, order, rev, ...extra });
const answers = (...ids) => Object.fromEntries(ids.map((id) => [id, { text: `a-${id}`, rev: 1, questionRev: 1 }]));

describe('queue', () => {
  const qs = [q('a', 10), q('b', 20), q('c', 30)];
  it('skips hidden and played questions', () => {
    const rounds = [{ questionId: 'a', result: 'correct' }, { questionId: 'c', result: 'unplayed' }];
    expect(unplayed(qs, rounds, ['b']).map((x) => x.id)).toEqual(['c']);
  });
  it('prefers the partner answer for the current revision, else the host answer', () => {
    expect(answerFor(q('a', 10, 2), answers('a')).source).toBe('none');
    expect(answerFor(q('a', 10, 2, { hostAnswer: 'host says' }), answers('a'))).toEqual({ text: 'host says', source: 'host' });
    expect(answerFor(q('a', 10), answers('a')).source).toBe('partner');
  });
  it('plays only questions that have an answer', () => {
    expect(playable(qs, [], answers('a', 'c')).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('picks in order, or randomly once per round', () => {
    expect(chooseNext(qs, false).id).toBe('a');
    expect(chooseNext(qs, true, () => 0.99).id).toBe('c');
    expect(chooseNext([], true)).toBeNull();
  });
  it('reports questions that became playable later', () => {
    expect(newlyPlayable(qs, ['a', 'b']).map((x) => x.id)).toEqual(['c']);
  });
});

describe('scoring', () => {
  it('counts and renumbers, dropping unplayed rounds', () => {
    const rounds = [
      { result: 'correct', startedAt: '2026-09-16T20:00:00Z' },
      { result: 'unplayed', startedAt: '2026-09-16T20:05:00Z' },
      { result: 'wrong', startedAt: '2026-09-16T20:10:00Z' },
    ];
    expect(tally(rounds)).toEqual({ correct: 1, wrong: 1, played: 2 });
    expect(renumber(rounds).map((r) => r.n)).toEqual([1, 2]);
  });
});

describe('penalties', () => {
  it('offers the options of the scheme', () => {
    expect(penaltyOptions({ penaltyScheme: 'drink_or_dare' }).map((p) => p.type)).toEqual(['drink', 'dare']);
    expect(penaltyOptions({ penaltyScheme: 'dare' }).map((p) => p.type)).toEqual(['dare']);
    expect(penaltyOptions({ penaltyScheme: 'custom', customPenalties: [{ label: 'Shot' }] })[0].label).toBe('Shot');
  });
  it('validates lengths and list size', () => {
    expect(validatePenalty({ type: 'drink', label: 'x'.repeat(41) })).toContain('label');
    expect(validateCustomList(Array.from({ length: 7 }, () => ({ label: 'a' })))).toBe(false);
    expect(validateCustomList([{ label: 'Shot', description: 'neat' }])).toBe(true);
  });
});

describe('extra rules', () => {
  const round = (result, rules, doubled = false) => ({ result, doubled, strikeBack: [], frozen: { rules } });
  it('shows the penalty on a wrong answer, doubled when the rule is on', () => {
    expect(outcome(round('wrong', { doubleOrNothing: true }, true))).toMatchObject({ showPenalty: true, multiplier: 2 });
    expect(outcome(round('wrong', { doubleOrNothing: false }, true)).multiplier).toBe(1);
  });
  it('offers strike back on a correct answer only with the rule on', () => {
    expect(outcome(round('correct', { strikeBack: true })).maxGuests).toBe(1);
    expect(outcome(round('correct', { strikeBack: true, doubleOrNothing: true }, true)).maxGuests).toBe(2);
    expect(outcome(round('correct', { strikeBack: false })).strikeBack).toBe(false);
  });
  it('caps guests and trims names', () => {
    const r = round('correct', { strikeBack: true });
    expect(addStrikeBack(r, '  Ola  ')).toBe(true);
    expect(addStrikeBack(r, 'Tomek')).toBe(false);
    expect(r.strikeBack).toEqual([{ guest: 'Ola' }]);
  });
  it('allows doubling only before the answer is revealed', () => {
    expect(canDouble({ doubled: false }, { rules: { doubleOrNothing: true } })).toBe(true);
    expect(canDouble({ doubled: false, revealedAnswer: true }, { rules: { doubleOrNothing: true } })).toBe(false);
  });
});

describe('ad gate', () => {
  it('shows banners only on home and scoreboard, never for premium', () => {
    expect(bannerAllowed('home', false)).toBe(true);
    expect(bannerAllowed('question', false)).toBe(false);
    expect(bannerAllowed('home', true)).toBe(false);
  });
  it('allows one interstitial per hour of use, only at a break', () => {
    const use = { activeSeconds: INTERSTITIAL_EVERY_SEC };
    expect(interstitialAllowed(use, 'scoreboard_closed', false)).toBe(true);
    expect(interstitialAllowed(use, 'mid_round', false)).toBe(false);
    expect(interstitialAllowed(use, 'scoreboard_closed', true)).toBe(false);
    expect(interstitialAllowed({ activeSeconds: 10 }, 'scoreboard_closed', false)).toBe(false);
    expect(interstitialAllowed(afterInterstitial(use), 'scoreboard_closed', false)).toBe(false);
  });
  it('ignores absurd foreground jumps', () => {
    expect(addActive({ activeSeconds: 0 }, 99999).activeSeconds).toBe(300);
    expect(addActive({ activeSeconds: 5 }, -3).activeSeconds).toBe(5);
  });
});

describe('queue after the Codex review', () => {
  const qs = [q('a', 10), q('b', 20)];
  it('keeps a started round holding its question', () => {
    const rounds = [{ questionId: 'a', result: 'unplayed', started: true }];
    expect(unplayed(qs, rounds).map((x) => x.id)).toEqual(['b']);
  });
  it('returns the question only when the round is voided', () => {
    const rounds = [{ questionId: 'a', result: 'unplayed', started: true, voided: true }];
    expect(unplayed(qs, rounds).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
