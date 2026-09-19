// Partner form: one question at a time or a list, saved as you type, conflict-aware. No account.
import { createApi } from './api.js';
import { makeTranslator } from './i18n.js';
import { $, confirmModal, el, on, toast } from './host/ui.js';

const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? '';
const api = createApi({ gameToken: token });

let t = null;
let game = null;
let index = 0;
let listView = false;

/**
 * One record per question: the text the partner typed (`draft`, which survives a failed save), the debounce
 * timer, whether a request is in flight and a generation counter so a slow response cannot overwrite newer
 * typing. Saves for a question are serialised; the latest draft is sent after the current request finishes.
 */
const saves = new Map();      // questionId -> { draft, timer, inFlight, generation, state }
const revs = new Map();       // questionId -> answer revision we last saw

function record(id) {
  let r = saves.get(id);
  if (!r) { r = { draft: null, timer: null, inFlight: false, generation: 0, state: '' }; saves.set(id, r); }
  return r;
}
const draftOf = (q) => {
  const r = saves.get(q.id);
  return r && r.draft !== null ? r.draft : (game.answers?.[q.id]?.text ?? '');
};

const questions = () => game?.questions ?? [];
const current = () => questions()[index];

async function boot() {
  if (!token) return gone('partner.gone');
  try {
    game = await api.get('/p/game');
  } catch (err) {
    return gone(err.status === 410 || err.status === 404 ? 'partner.gone' : 'error.generic');
  }
  t = await makeTranslator(game.language);
  document.documentElement.lang = game.language;
  for (const [id, answer] of Object.entries(game.answers ?? {})) revs.set(id, answer.rev);
  const newCount = questions().filter((q) => q.isNew).length;
  if (newCount) index = questions().findIndex((q) => q.isNew);
  applyLabels(newCount);
  $('loading').hidden = true;
  $('form').hidden = false;
  render();
}

function applyLabels(newCount) {
  document.title = t('partner.title');
  $('title').textContent = t('partner.title');
  $('intro').textContent = t('partner.intro');
  $('disclosure').textContent = t('partner.disclosure');
  $('btn-prev').textContent = t('partner.prev');
  $('btn-next').textContent = t('partner.next');
  $('btn-done').textContent = t('partner.done');
  $('btn-report').textContent = t('partner.report');
  $('btn-toggle-view').textContent = t('partner.listView');
  if (newCount) {
    $('new-banner').hidden = false;
    $('new-banner').textContent = t('partner.new', { count: newCount });
  }
  if (game.readOnly) {
    $('readonly-banner').hidden = false;
    $('readonly-banner').textContent = t('partner.readOnly');
  }
}

function answeredCount() {
  return questions().filter((q) => {
    const stored = game.answers?.[q.id];
    return Boolean(stored && stored.questionRev === q.rev && (stored.text ?? '').trim());
  }).length;
}

const pendingSaves = () => [...saves.values()].some((r) => r.timer || r.inFlight || r.state === 'offline');

function render() {
  const total = questions().length;
  const answered = answeredCount();
  $('progress').style.width = total ? `${Math.round((answered / total) * 100)}%` : '0%';
  $('counter').textContent = t('partner.progress', { answered, total });
  $('one-view').hidden = listView;
  $('list-view').hidden = !listView;
  $('btn-toggle-view').textContent = listView ? t('partner.oneView') : t('partner.listView');
  if (listView) renderList();
  else renderOne();
}

function renderOne() {
  const q = current();
  if (!q) return;
  $('q-theme').textContent = q.theme ?? '';
  $('q-text').textContent = q.text;
  const box = $('q-answer');
  // Never replace what the partner is typing: the draft wins over the stored answer.
  const wanted = draftOf(q);
  if (document.activeElement !== box || box.value !== wanted) box.value = wanted;
  box.disabled = Boolean(game.readOnly);
  $('q-count').textContent = String(box.value.length);
  $('save-state').textContent = stateLabel(q.id);
  $('save-state').className = `save-state save-${record(q.id).state}`;
  $('btn-prev').disabled = index === 0;
  $('btn-next').disabled = index >= questions().length - 1;
}

function renderList() {
  const box = $('list-view');
  box.innerHTML = '';
  questions().forEach((q, i) => {
    const card = el('div', 'card');
    if (q.isNew) card.appendChild(el('span', 'badge badge-live', t('partner.new', { count: 1 })));
    card.appendChild(el('p', 'a-question', q.text));
    const input = document.createElement('textarea');
    input.rows = 2; input.maxLength = 500; input.className = 'field';
    input.value = draftOf(q);
    input.disabled = Boolean(game.readOnly);
    input.addEventListener('input', () => queueSave(q, input.value));
    input.addEventListener('blur', () => { flush(q, input.value).catch(() => {}); });
    card.appendChild(input);
    const status = el('p', `save-state save-${record(q.id).state}`, stateLabel(q.id));
    status.id = `state-${q.id}`;
    card.appendChild(status);
    card.addEventListener('dblclick', () => { index = i; listView = false; render(); });
    box.appendChild(card);
  });
}

function stateLabel(id) {
  const s = record(id).state;
  if (s === 'saving') return t('partner.saving');
  if (s === 'saved') return t('partner.saved');
  if (s === 'offline') return t('partner.offline');
  return '';
}

function setState(id, value) {
  record(id).state = value;
  const node = listView ? $(`state-${id}`) : $('save-state');
  if (node) { node.textContent = stateLabel(id); node.className = `save-state save-${value}`; }
}

function queueSave(question, text) {
  if (game.readOnly) return;
  const r = record(question.id);
  r.draft = text;
  setState(question.id, 'saving');
  clearTimeout(r.timer);
  r.timer = setTimeout(() => { r.timer = null; flush(question, text).catch(() => {}); }, 700);
}

/** Returns true when the text is safely on the server. Per question: one request at a time. */
async function flush(question, text) {
  if (game.readOnly) return true;
  const r = record(question.id);
  clearTimeout(r.timer); r.timer = null;
  r.draft = text;
  const stored = game.answers?.[question.id];
  if ((stored?.text ?? '') === text && stored?.questionRev === question.rev) { setState(question.id, 'saved'); return true; }
  if (r.inFlight) return false;                 // the running request will pick up the newest draft
  r.inFlight = true;
  const generation = ++r.generation;
  setState(question.id, 'saving');
  try {
    const sent = r.draft;
    const res = await api.put(`/p/answers/${question.id}`, { text: sent, questionRev: question.rev, baseRev: revs.get(question.id) ?? 0 });
    revs.set(question.id, res.rev);
    game.answers = { ...game.answers, [question.id]: { text: sent, rev: res.rev, questionRev: question.rev } };
    if (r.generation === generation && r.draft === sent) { r.draft = null; setState(question.id, 'saved'); }
    render();
    return true;
  } catch (err) {
    if (err.offline) { setState(question.id, 'offline'); return false; }
    // The lock stays held through the dialog, so no second request starts behind it.
    if (err.code === 'answer_conflict') return resolveConflict(question, r.draft ?? text, err.details?.current);
    if (err.code === 'question_changed') { toast(t('partner.conflict')); await reload(); return false; }
    setState(question.id, 'offline');
    return false;
  } finally {
    r.inFlight = false;
    // Typing continued while the request was in flight: send the newest text, once.
    const newest = r.draft;
    if (newest !== null && newest !== (game.answers?.[question.id]?.text ?? '') && !r.timer) {
      queueSave(question, newest);
    }
  }
}

async function resolveConflict(question, mine, current) {
  const keepMine = await confirmModal(t, {
    title: t('partner.conflict'),
    body: `${t('partner.keepOther')}: "${current?.text ?? ''}"`,
    confirmLabel: t('partner.keepMine'),
  });
  revs.set(question.id, current?.rev ?? 0);
  const r = record(question.id);
  if (keepMine) {
    r.inFlight = false;                 // released only now: one retry, with the newest text
    return flush(question, r.draft ?? mine);
  }
  game.answers = { ...game.answers, [question.id]: { text: current?.text ?? '', rev: current?.rev ?? 0, questionRev: question.rev } };
  record(question.id).draft = null;
  setState(question.id, 'saved');
  render();
  return true;
}

async function reload() {
  game = await api.get('/p/game');
  for (const [id, answer] of Object.entries(game.answers ?? {})) revs.set(id, answer.rev);
  render();
}

function gone(key) {
  const box = $('gone');
  box.hidden = false;
  box.textContent = key === 'partner.gone' ? 'This link is no longer available.' : 'Something went wrong.';
  $('loading').hidden = true;
}

async function done() {
  const q = current();
  if (q) await flush(q, $('q-answer').value);
  if (pendingSaves()) {
    const leave = await confirmModal(t, { title: t('partner.done'), body: t('partner.offline'), danger: true });
    if (!leave) return;
  }
  $('form').hidden = true;
  const box = $('gone');
  box.className = 'notice notice-ok';
  box.hidden = false;
  box.textContent = t('partner.doneMessage');
}

on('q-answer', 'input', (e) => { $('q-count').textContent = String(e.target.value.length); queueSave(current(), e.target.value); });
on('q-answer', 'blur', (e) => flush(current(), e.target.value));
// Navigation keeps the draft even when the save failed, so nothing typed is lost offline.
on('btn-prev', 'click', async () => { await flush(current(), $('q-answer').value); index = Math.max(0, index - 1); render(); });
on('btn-next', 'click', async () => { await flush(current(), $('q-answer').value); index = Math.min(questions().length - 1, index + 1); render(); });
on('btn-toggle-view', 'click', async () => { if (!listView) await flush(current(), $('q-answer').value); listView = !listView; render(); });
on('btn-done', 'click', done);
on('btn-report', 'click', async () => {
  const reason = globalThis.prompt(t('partner.report'));
  if (!reason) return;
  try { await api.post('/p/report', { reason: reason.slice(0, 500) }); toast(t('partner.saved')); } catch { toast(t('error.generic')); }
});
// A pending save is flushed on blur and on every navigation button, so there is nothing to do on unload.

boot();
