// The round flow: penalty setup, question, verdict, penalty screen, strike back, scoreboard, fix-up.
import { $, confirmModal, el, on, show, timeAgo, toast } from './ui.js';
import { premium, setSnapshot, state, sync } from './state.js';
import { appendMany, uuid } from '../store/journal.js';
import { answerFor, chooseNext, playable } from '../logic/queue.js';
import { penaltyOptions } from '../logic/penalties.js';
import { outcome } from '../logic/rules.js';
import { renumber, summaryText, tally } from '../logic/scoring.js';
import { maybeInterstitial } from '../native/ads.js';
import { downloadJson, share } from '../native/device.js';

let filter = 'all';
let chosenPenalty = null;
const busy = new Set();

/**
 * One journal write per user action. The screen may only move after the transaction commits, and the
 * snapshot it produced becomes the in-memory copy (nothing else is a correct view of the game).
 * The lock is per kind of action: a double tap on the same button is a no-op, while a different action
 * (marking a round right after revealing the answer) is never swallowed. IndexedDB orders the writes.
 */
async function commit(entries, buttons = [], kind = entries[0]?.type ?? 'action') {
  if (busy.has(kind)) return null;
  busy.add(kind);
  for (const id of buttons) { const node = $(id); if (node) node.disabled = true; }
  try {
    const { snapshot } = await appendMany(snap().gameId, entries);
    setSnapshot(snapshot);
    return snapshot;
  } catch (err) {
    console.error('could not record the action', err);
    toast(err.message === 'read_only' ? t('game.readOnly') : t('error.generic'));
    return null;
  } finally {
    busy.delete(kind);
    for (const id of buttons) { const node = $(id); if (node) node.disabled = false; }
  }
}

/**
 * The organiser showed the answer on their own screen: tell the guests' page. The screen never waits for this;
 * if it cannot be recorded the guests simply see the answer when the round is marked.
 */
async function recordReveal() {
  const d = state.draft;
  if (!d || d.revealRecorded) return;
  d.revealRecorded = true;
  const updated = await commit([{
    type: 'round.reveal',
    payload: { roundId: d.roundId },
    mutate: (snapshot) => {
      const round = snapshot.rounds.find((r) => r.id === d.roundId);
      if (round && !round.revealedAt) round.revealedAt = new Date().toISOString();
    },
  }], [], 'reveal');
  if (updated) sync().catch(() => {});
  else d.revealRecorded = false;
}

const snap = () => state.snapshot;
const t = (...a) => state.t(...a);

export function pool() {
  const s = snap();
  return playable(s.questions, s.rounds ?? [], s.answers ?? {}, s.game?.hiddenQuestionIds ?? []);
}

/* ---------- penalty setup ---------- */

export function startRound() {
  const s = snap();
  const candidates = pool();
  if (!candidates.length) { toast(t('round.noneLeft')); return; }
  const question = chooseNext(candidates, Boolean(s.game.settings.randomOrder));
  state.draft = {
    roundId: uuid(),
    questionId: question.id,
    question,
    answer: answerFor(question, s.answers ?? {}),
    penalty: null,
    doubled: false,
  };
  renderSetup();
  show('setup');
}

function renderSetup() {
  const s = snap();
  const options = penaltyOptions(s.game.settings);
  const row = $('penalty-choices');
  row.innerHTML = '';
  chosenPenalty = options.length === 1 ? options[0] : null;
  for (const option of options) {
    const label = option.type === 'drink' || option.type === 'dare' ? t(`penalty.${option.type}`) : option.label;
    const button = el('button', 'choice', label);
    button.type = 'button';
    if (chosenPenalty && chosenPenalty.label === option.label) button.classList.add('is-active');
    button.addEventListener('click', () => {
      chosenPenalty = option;
      for (const b of row.children) b.classList.remove('is-active');
      button.classList.add('is-active');
      if (option.description && !$('penalty-input').value) $('penalty-input').value = option.description;
      refreshReveal();
    });
    row.appendChild(button);
  }
  $('setup-round').textContent = t('round.title', { n: (s.rounds ?? []).filter((r) => r.result !== 'unplayed').length + 1 });
  $('penalty-input').value = '';
  $('toggle-double').checked = false;
  $('double-row').hidden = !(s.game.settings.rules?.doubleOrNothing);
  refreshReveal();
}

function refreshReveal() {
  $('btn-reveal').disabled = !(chosenPenalty && $('penalty-input').value.trim());
}

/* ---------- question ---------- */

async function reveal() {
  const s = snap();
  const d = state.draft;
  if (!d || !chosenPenalty) return;
  d.penalty = {
    type: chosenPenalty.type,
    label: chosenPenalty.type === 'custom' ? chosenPenalty.label : t(`penalty.${chosenPenalty.type}`),
    description: $('penalty-input').value.trim().slice(0, 200),
  };
  d.doubled = $('toggle-double').checked;
  const frozen = {
    questionRev: d.question.rev,
    text: d.question.text,
    theme: d.question.theme,
    answer: d.answer,
    penaltyScheme: s.game.settings.penaltyScheme,
    rules: { ...s.game.settings.rules },
  };
  // The start and the doubling are one action for the host, so they are one transaction.
  const entries = [{
    type: 'round.start',
    payload: { roundId: d.roundId, questionId: d.questionId, penalty: d.penalty, frozen },
    mutate: (snapshot) => {
      snapshot.rounds = snapshot.rounds ?? [];
      if (snapshot.rounds.some((r) => r.id === d.roundId)) return;
      snapshot.rounds.push({
        id: d.roundId, n: snapshot.rounds.filter((r) => r.result !== 'unplayed').length + 1,
        questionId: d.questionId, frozen, epoch: snapshot.epoch, penalty: d.penalty,
        result: 'unplayed', started: true, doubled: Boolean(d.doubled), strikeBack: [],
        startedAt: new Date().toISOString(),
      });
      snapshot.currentRoundId = d.roundId;
    },
  }];
  if (d.doubled) {
    entries.push({ type: 'round.double', payload: { roundId: d.roundId }, mutate: () => {} });
  }
  if (!(await commit(entries, ['btn-reveal']))) return;
  renderQuestion();
  show('question');
  sync().catch(() => {});
}

function renderQuestion() {
  const d = state.draft;
  $('question-round').textContent = t('round.title', { n: (snap().rounds ?? []).filter((r) => r.result !== 'unplayed').length });
  $('question-penalty').textContent = d.doubled ? `${d.penalty.label} ×2` : d.penalty.label;
  $('question-theme').textContent = d.question.theme ?? '';
  $('question-text').textContent = d.question.text;
  $('answer-text').textContent = d.answer.text;
  $('answer-box').hidden = true;
  $('btn-peek').hidden = false;
}

/* ---------- verdict ---------- */

async function judge(result) {
  const d = state.draft;
  if (!d) return;
  const updated = await commit([{
    type: 'round.mark',
    payload: { roundId: d.roundId, result },
    mutate: (snapshot) => {
      const round = snapshot.rounds.find((r) => r.id === d.roundId);
      if (round && round.result === 'unplayed') { round.result = result; round.markedAt = new Date().toISOString(); }
      snapshot.currentRoundId = null;
    },
  }], ['btn-correct', 'btn-wrong']);
  if (!updated) return;
  sync().catch(() => {});
  const round = updated.rounds.find((r) => r.id === d.roundId);
  if (!round) { finishRound(); return; }
  const next = outcome(round);
  if (next.showPenalty) {
    $('penalty-kicker').textContent = d.penalty.label;
    $('penalty-text').textContent = next.multiplier > 1 ? `${d.penalty.description} ×2` : d.penalty.description;
    show('penalty');
    return;
  }
  if (next.strikeBack) { renderStrike(next.maxGuests); show('strike'); return; }
  finishRound();
}

function renderStrike(maxGuests) {
  $('strike-guest').value = '';
  const recent = $('strike-recent');
  recent.innerHTML = '';
  const names = [...new Set((snap().rounds ?? []).flatMap((r) => (r.strikeBack ?? []).map((g) => g.guest)))].slice(-6);
  for (const name of names) {
    const button = el('button', 'btn btn-ghost', name);
    button.addEventListener('click', () => { $('strike-guest').value = name; });
    recent.appendChild(button);
  }
  state.draft.maxGuests = maxGuests;
}

async function confirmStrike() {
  const d = state.draft;
  if (!d) return;
  const guest = $('strike-guest').value.trim().slice(0, 40);
  if (!guest) { finishRound(); return; }
  const updated = await commit([{
    type: 'round.strikeBack',
    payload: { roundId: d.roundId, guest },
    mutate: (snapshot) => {
      const round = snapshot.rounds.find((r) => r.id === d.roundId);
      if (!round) return;
      const max = outcome(round).maxGuests;
      round.strikeBack = round.strikeBack ?? [];
      if (round.strikeBack.length < max) round.strikeBack.push({ guest });
    },
  }], ['btn-strike-ok']);
  if (!updated) return;
  sync().catch(() => {});
  const round = updated.rounds.find((r) => r.id === d.roundId);
  const names = (round?.strikeBack ?? []).map((g) => g.guest);
  // A doubled correct answer may be handed to two guests: stay on the screen until they are named.
  if (round && names.length < outcome(round).maxGuests) {
    $('strike-guest').value = '';
    renderStrike(outcome(round).maxGuests);
    toast(t('round.strikeBackNames', { names: names.join(', ') }));
    return;
  }
  $('penalty-kicker').textContent = t('round.strikeBack');
  $('penalty-text').textContent = t('round.penaltyFor', { guest: names.join(', '), penalty: d.penalty.description });
  show('penalty');
}

export function finishRound() {
  state.draft = null;
  if (!pool().length) { renderScoreboard(); show('scoreboard'); return; }
  startRound();
}

/* ---------- scoreboard ---------- */

export function renderScoreboard() {
  const s = snap();
  const rounds = renumber([...(s.rounds ?? [])]);
  const score = tally(rounds);
  $('tally-correct').textContent = score.correct;
  $('tally-wrong').textContent = score.wrong;
  const body = $('results-body');
  body.innerHTML = '';
  const shown = rounds.filter((r) => filter === 'all' || r.result === filter);
  if (!shown.length) {
    const tr = el('tr');
    const td = el('td', 'empty', t('score.empty'));
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  for (const r of shown) {
    const tr = el('tr');
    const n = el('td', 'col-n', String(r.n)); n.dataset.label = '#'; tr.appendChild(n);
    const q = el('td', 'col-q', r.frozen.text); q.dataset.label = t('score.question'); tr.appendChild(q);
    const a = el('td', 'col-a', r.frozen.answer?.text || '—'); a.dataset.label = t('score.answer'); tr.appendChild(a);
    const p = el('td', 'col-p'); p.dataset.label = t('score.penalty');
    const pb = el('span', 'cell-body');
    pb.appendChild(el('span', 'pill pill-type', r.penalty.label || t('penalty.none')));
    pb.appendChild(document.createTextNode(r.penalty.description ? ` ${r.penalty.description}` : ''));
    if (r.doubled) pb.appendChild(el('span', 'badge badge-live', '×2'));
    for (const g of r.strikeBack ?? []) pb.appendChild(el('span', 'badge', g.guest));
    p.appendChild(pb); tr.appendChild(p);
    const res = el('td', 'col-r'); res.dataset.label = t('score.result');
    const rb = el('span', 'cell-body');
    rb.appendChild(el('span', `pill pill-${r.result}`, t(`result.${r.result}`)));
    res.appendChild(rb); tr.appendChild(res);
    body.appendChild(tr);
  }
  $('btn-finish').hidden = s.game?.status === 'finished';
}

async function shareSummary() {
  const s = snap();
  const text = summaryText(t, s.game?.title, renumber([...(s.rounds ?? [])]));
  const result = await share(text, t('summary.title'));
  if (result === 'copied') toast(t('action.copied'));
}

function downloadResults() {
  const s = snap();
  const rounds = renumber([...(s.rounds ?? [])]);
  downloadJson(`bachelor-questionnaire-${s.gameId}.json`, {
    exportedAt: new Date().toISOString(),
    title: s.game?.title, language: s.game?.language,
    totals: tally(rounds),
    rounds: rounds.map((r) => ({ n: r.n, question: r.frozen.text, answer: r.frozen.answer?.text ?? '', penalty: r.penalty, result: r.result, doubled: r.doubled, strikeBack: r.strikeBack })),
  });
}

async function finishGame() {
  const ok = await confirmModal(t, { title: t('score.finish'), body: t('score.finishConfirm'), confirmLabel: t('score.finish') });
  if (!ok) return;
  const updated = await commit([{
    type: 'game.finish',
    payload: {},
    mutate: (snapshot) => {
      snapshot.game = { ...snapshot.game, status: 'finished', finishedAt: new Date().toISOString() };
    },
  }], ['btn-finish']);
  if (!updated) return;
  toast(t('status.finished'));
  renderScoreboard();
  sync().catch(() => {});          // the party does not wait for the upload
  maybeInterstitial('scoreboard_closed', premium()).catch(() => {});
}

/* ---------- fix results ---------- */

export function renderFixup() {
  const s = snap();
  const list = $('fixup-list');
  list.innerHTML = '';
  const roundFor = (id) => (s.rounds ?? []).find((r) => r.questionId === id && r.result !== 'unplayed');
  for (const q of s.questions) {
    const round = roundFor(q.id);
    const card = el('div', 'card');
    card.appendChild(el('p', 'a-question', q.text));
    const answer = answerFor(q, s.answers ?? {});
    if (answer.text) card.appendChild(el('p', 'a-answer', answer.text));
    const seg = el('div', 'seg');
    for (const value of ['unplayed', 'correct', 'wrong']) {
      const button = el('button', 'seg-btn', t(`result.${value}`));
      button.type = 'button';
      if ((round?.result ?? 'unplayed') === value) button.classList.add('is-active');
      button.addEventListener('click', () => setResult(q, round, value));
      seg.appendChild(button);
    }
    card.appendChild(seg);
    list.appendChild(card);
  }
}

async function setResult(question, round, result) {
  const roundId = round?.id ?? uuid();
  const updated = await commit([{
    type: 'round.fixup',
    payload: { roundId, questionId: question.id, result },
    mutate: (snapshot) => {
    const existing = snapshot.rounds.find((r) => r.id === roundId);
    if (existing) {
      existing.result = result;
      // Voided: the question goes back into the queue; a merely started round still holds its question.
      existing.voided = result === 'unplayed';
      existing.markedAt = new Date().toISOString();
      return;
    }
    if (result === 'unplayed') return;
    snapshot.rounds.push({
      id: roundId, n: snapshot.rounds.length + 1, questionId: question.id,
      frozen: { questionRev: question.rev, text: question.text, theme: question.theme, answer: answerFor(question, snapshot.answers ?? {}), penaltyScheme: snapshot.game.settings.penaltyScheme, rules: { ...snapshot.game.settings.rules } },
      epoch: snapshot.epoch, penalty: { type: 'none', label: '', description: '' },
      result, started: true, doubled: false, strikeBack: [], startedAt: new Date().toISOString(), markedAt: new Date().toISOString(),
    });
    },
  }]);
  if (!updated) return;
  sync().catch(() => {});
  renderFixup();
}

export function wireRound() {
  on('penalty-input', 'input', refreshReveal);
  on('penalty-input', 'keydown', (e) => { if (e.key === 'Enter' && !$('btn-reveal').disabled) reveal(); });
  on('btn-reveal', 'click', reveal);
  on('btn-peek', 'click', () => {
    $('answer-box').hidden = false;
    $('btn-peek').hidden = true;
    recordReveal().catch(() => {});
  });
  on('btn-hide-answer', 'click', () => { $('answer-box').hidden = true; $('btn-peek').hidden = false; });
  on('btn-correct', 'click', () => judge('correct'));
  on('btn-wrong', 'click', () => judge('wrong'));
  on('btn-penalty-done', 'click', finishRound);
  on('btn-strike-ok', 'click', confirmStrike);
  on('btn-strike-skip', 'click', finishRound);
  on('btn-share', 'click', shareSummary);
  on('btn-download', 'click', downloadResults);
  on('btn-finish', 'click', finishGame);
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      for (const b of document.querySelectorAll('[data-filter]')) b.classList.toggle('is-active', b === button);
      renderScoreboard();
    });
  }
}

export const lastSyncLabel = () => timeAgo(t, state.lastSync);
