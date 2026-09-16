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
let saveTimer = null;
let saving = new Map();       // questionId -> 'saving' | 'saved' | 'offline'
const revs = new Map();       // questionId -> answer revision we last saw

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
  return questions().filter((q) => (game.answers?.[q.id]?.text ?? '').trim() && game.answers[q.id].questionRev === q.rev).length;
}

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
  box.value = game.answers?.[q.id]?.text ?? '';
  box.disabled = Boolean(game.readOnly);
  $('q-count').textContent = String(box.value.length);
  $('save-state').textContent = stateLabel(q.id);
  $('save-state').className = `save-state save-${saving.get(q.id) ?? ''}`;
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
    input.value = game.answers?.[q.id]?.text ?? '';
    input.disabled = Boolean(game.readOnly);
    input.addEventListener('input', () => queueSave(q, input.value));
    input.addEventListener('blur', () => flush(q, input.value));
    card.appendChild(input);
    const status = el('p', `save-state save-${saving.get(q.id) ?? ''}`, stateLabel(q.id));
    status.id = `state-${q.id}`;
    card.appendChild(status);
    card.addEventListener('dblclick', () => { index = i; listView = false; render(); });
    box.appendChild(card);
  });
}

function stateLabel(id) {
  const s = saving.get(id);
  if (s === 'saving') return t('partner.saving');
  if (s === 'saved') return t('partner.saved');
  if (s === 'offline') return t('partner.offline');
  return '';
}

function setState(id, value) {
  saving.set(id, value);
  const node = listView ? $(`state-${id}`) : $('save-state');
  if (node) { node.textContent = stateLabel(id); node.className = `save-state save-${value}`; }
}

function queueSave(question, text) {
  if (game.readOnly) return;
  setState(question.id, 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush(question, text), 700);
}

async function flush(question, text) {
  if (game.readOnly) return;
  clearTimeout(saveTimer);
  const stored = game.answers?.[question.id];
  if ((stored?.text ?? '') === text && stored?.questionRev === question.rev) { setState(question.id, 'saved'); return; }
  setState(question.id, 'saving');
  try {
    const res = await api.put(`/p/answers/${question.id}`, { text, questionRev: question.rev, baseRev: revs.get(question.id) ?? 0 });
    game.answers = { ...game.answers, [question.id]: { text, rev: res.rev, questionRev: question.rev } };
    revs.set(question.id, res.rev);
    setState(question.id, 'saved');
    render();
  } catch (err) {
    if (err.offline) { setState(question.id, 'offline'); return; }
    if (err.code === 'answer_conflict') return resolveConflict(question, text, err.details?.current);
    if (err.code === 'question_changed') { toast(t('partner.conflict')); await reload(); return; }
    setState(question.id, 'offline');
  }
}

async function resolveConflict(question, mine, current) {
  const keepMine = await confirmModal(t, {
    title: t('partner.conflict'),
    body: `${t('partner.keepOther')}: "${current?.text ?? ''}"`,
    confirmLabel: t('partner.keepMine'),
  });
  revs.set(question.id, current?.rev ?? 0);
  if (keepMine) return flush(question, mine);
  game.answers = { ...game.answers, [question.id]: { text: current?.text ?? '', rev: current?.rev ?? 0, questionRev: question.rev } };
  setState(question.id, 'saved');
  render();
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
  const pending = [...saving.values()].some((v) => v === 'saving' || v === 'offline');
  if (pending) {
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
on('btn-prev', 'click', async () => { await flush(current(), $('q-answer').value); index = Math.max(0, index - 1); render(); });
on('btn-next', 'click', async () => { await flush(current(), $('q-answer').value); index = Math.min(questions().length - 1, index + 1); render(); });
on('btn-toggle-view', 'click', async () => { if (!listView) await flush(current(), $('q-answer').value); listView = !listView; render(); });
on('btn-done', 'click', done);
on('btn-report', 'click', async () => {
  const reason = globalThis.prompt(t('partner.report'));
  if (!reason) return;
  try { await api.post('/p/report', { reason: reason.slice(0, 500) }); toast(t('partner.saved')); } catch { toast(t('error.generic')); }
});
window.addEventListener('beforeunload', () => { const q = current(); if (q) navigator.sendBeacon?.(''); });

boot();
