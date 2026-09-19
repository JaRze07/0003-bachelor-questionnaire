// Questions editor, rules and penalties, premium screen. Free hosts may preview and hide, not edit.
import { $, confirmModal, el, on, show, toast } from './ui.js';
import { premium, premiumState, refreshMe, state } from './state.js';
import { saveGame } from '../store/journal.js';
import { answerFor } from '../logic/queue.js';
import { validateCustomList } from '../logic/penalties.js';
import { buy, productPrice, restore } from '../native/purchases.js';
import { isNative } from '../native/device.js';

const snap = () => state.snapshot;
const t = (...a) => state.t(...a);
const HIDDEN_FREE = 5;

/* ---------- questions ---------- */

export async function renderQuestions() {
  const s = snap();
  const list = $('questions-list');
  list.innerHTML = '';
  $('add-question-box').hidden = !premium();
  $('questions-note').textContent = premium() ? '' : t('questions.editPremium');
  const hidden = new Set(s.game.hiddenQuestionIds ?? []);

  for (const q of s.questions) {
    const card = el('div', 'card');
    const head = el('div', 'row-between');
    head.appendChild(el('span', 'badge', q.theme || '—'));
    const answer = answerFor(q, s.answers ?? {});
    head.appendChild(el('span', `badge ${answer.source === 'none' ? 'badge-warn' : 'badge-ready'}`,
      answer.source === 'none' ? t('questions.unanswered') : t('questions.answered')));
    card.appendChild(head);

    if (premium()) {
      const input = document.createElement('textarea');
      input.value = q.text; input.rows = 2; input.maxLength = 300;
      input.className = 'field';
      input.addEventListener('change', () => saveQuestionText(q, input.value.trim()));
      card.appendChild(input);
    } else {
      card.appendChild(el('p', 'a-question', q.text));
    }

    if (answer.text) card.appendChild(el('p', 'a-answer', answer.text));
    if (answer.source === 'none') {
      const host = document.createElement('input');
      host.type = 'text'; host.maxLength = 500; host.placeholder = t('questions.hostAnswer');
      host.value = q.hostAnswer ?? '';
      host.className = 'field';
      host.addEventListener('change', () => setHostAnswer(q, host.value.trim()));
      card.appendChild(host);
    }

    const row = el('div', 'row');
    const hide = el('button', 'btn btn-quiet', hidden.has(q.id) ? t('questions.unhide') : t('questions.hide'));
    hide.addEventListener('click', () => toggleHidden(q));
    row.appendChild(hide);
    if (premium()) {
      const remove = el('button', 'btn btn-quiet', t('questions.delete'));
      remove.addEventListener('click', () => deleteQuestion(q));
      row.appendChild(remove);
    }
    card.appendChild(row);
    if (hidden.has(q.id)) card.appendChild(el('span', 'badge', t('questions.hidden')));
    list.appendChild(card);
  }
}

async function patchGame(body) {
  const s = snap();
  if (s.readOnly) { toast(t('game.readOnly')); return false; }
  try {
    const res = await state.api.patch(`/games/${s.gameId}`, body);
    s.game = res.game;
    s.revision = res.game.revision;
    await saveGame(s);
    return true;
  } catch (err) {
    toast(err.offline ? t('error.offline') : (err.code === 'hidden_limit' ? t('questions.hiddenLimit') : t('error.generic')));
    return false;
  }
}

async function toggleHidden(question) {
  const s = snap();
  const hidden = new Set(s.game.hiddenQuestionIds ?? []);
  if (hidden.has(question.id)) hidden.delete(question.id);
  else {
    if (!premium() && hidden.size >= HIDDEN_FREE) { toast(t('questions.hiddenLimit')); return; }
    hidden.add(question.id);
  }
  if (await patchGame({ hiddenQuestionIds: [...hidden] })) renderQuestions();
}

async function saveQuestionText(question, text) {
  if (!text || text === question.text) return;
  const s = snap();
  const answered = answerFor(question, s.answers ?? {}).source === 'partner';
  if (answered) {
    const ok = await confirmModal(t, { title: t('questions.text'), body: t('questions.invalidate'), danger: true });
    if (!ok) { renderQuestions(); return; }
  }
  try {
    const res = await state.api.patch(`/games/${s.gameId}/questions/${question.id}`, { text, confirmInvalidate: true });
    Object.assign(question, res.question);
    await saveGame(s);
    renderQuestions();
  } catch (err) {
    toast(err.offline ? t('error.offline') : t('error.generic'));
  }
}

async function setHostAnswer(question, text) {
  const s = snap();
  try {
    await state.api.put(`/games/${s.gameId}/questions/${question.id}/host-answer`, { text });
    question.hostAnswer = text || undefined;
    await saveGame(s);
    renderQuestions();
  } catch (err) {
    toast(err.offline ? t('error.offline') : t('error.generic'));
  }
}

async function addQuestion() {
  const s = snap();
  const text = $('add-text').value.trim();
  if (!text) return;
  try {
    const res = await state.api.post(`/games/${s.gameId}/questions`, { text, theme: $('add-theme').value.trim() || undefined });
    s.questions.push(res.question);
    await saveGame(s);
    $('add-text').value = ''; $('add-theme').value = '';
    renderQuestions();
  } catch (err) {
    if (err.offline) toast(t('questions.notPublished'));
    else if (err.code === 'premium_required' || err.code === 'premium_revoked') toast(t('questions.editPremium'));
    else toast(t('error.generic'));
  }
}

async function deleteQuestion(question) {
  const s = snap();
  const ok = await confirmModal(t, { title: t('questions.delete'), body: question.text, danger: true });
  if (!ok) return;
  try {
    await state.api.del(`/games/${s.gameId}/questions/${question.id}`);
    s.questions = s.questions.filter((q) => q.id !== question.id);
    await saveGame(s);
    renderQuestions();
  } catch (err) {
    toast(err.offline ? t('error.offline') : t('error.generic'));
  }
}

/* ---------- rules and penalties ---------- */

const SCHEMES = ['drink_or_dare', 'drink', 'dare', 'custom'];

export function renderSettings() {
  const s = snap();
  const locked = !premium();
  $('settings-note').textContent = locked ? t('questions.editPremium') : '';
  const row = $('scheme-row');
  row.innerHTML = '';
  for (const scheme of SCHEMES) {
    const button = el('button', 'seg-btn', t(`settings.scheme.${scheme}`));
    button.type = 'button';
    if (s.game.settings.penaltyScheme === scheme) button.classList.add('is-active');
    button.disabled = locked && scheme !== 'drink_or_dare';
    button.addEventListener('click', () => saveSettings({ penaltyScheme: scheme }));
    row.appendChild(button);
  }
  const custom = s.game.settings.penaltyScheme === 'custom';
  $('custom-penalties').hidden = !custom;
  $('btn-add-penalty').hidden = !custom || locked;
  renderCustomPenalties();
  $('rule-strike').checked = Boolean(s.game.settings.rules?.strikeBack);
  $('rule-double').checked = Boolean(s.game.settings.rules?.doubleOrNothing);
  $('rule-random').checked = Boolean(s.game.settings.randomOrder);
  for (const id of ['rule-strike', 'rule-double']) $(id).disabled = locked;
}

function renderCustomPenalties() {
  const s = snap();
  const box = $('custom-penalties');
  box.innerHTML = '';
  (s.game.settings.customPenalties ?? []).forEach((penalty, index) => {
    const card = el('div', 'card');
    const label = document.createElement('input');
    label.type = 'text'; label.maxLength = 40; label.value = penalty.label; label.className = 'field';
    label.addEventListener('change', () => {
      const list = [...s.game.settings.customPenalties];
      list[index] = { ...list[index], label: label.value.trim() };
      saveSettings({ customPenalties: list.filter((p) => p.label) });
    });
    card.appendChild(label);
    const remove = el('button', 'btn btn-quiet', t('questions.delete'));
    remove.addEventListener('click', () => saveSettings({ customPenalties: s.game.settings.customPenalties.filter((_, i) => i !== index) }));
    card.appendChild(remove);
    box.appendChild(card);
  });
}

async function saveSettings(partial) {
  const s = snap();
  if (!premium() && ('penaltyScheme' in partial || 'rules' in partial)) { toast(t('questions.editPremium')); renderSettings(); return; }
  const settings = { ...s.game.settings, ...partial };
  if (!validateCustomList(settings.customPenalties ?? [])) { toast(t('error.generic')); return; }
  if (await patchGame({ settings })) renderSettings();
}

/* ---------- premium ---------- */

export async function renderPremium() {
  const price = await productPrice();
  $('btn-buy').textContent = price ? `${t('premium.buy')} · ${price}` : t('premium.buy');
  const box = $('premium-state');
  const map = { active: 'premium.active', pending: 'premium.pending', revoked: 'premium.revoked' };
  const key = map[premiumState()];
  box.hidden = !key;
  if (key) box.textContent = t(key);
  // Store billing exists only inside the app; on the web premium simply follows the account.
  const web = !isNative() && Boolean(globalThis.GOOGLE_CLIENT_ID);
  $('premium-web').hidden = !web || premiumState() === 'active';
  $('btn-buy').hidden = premiumState() === 'active' || web;
  $('btn-restore').hidden = web;
  $('premium-error').textContent = '';
}

async function doBuy() {
  const res = await buy(state.api);
  if (res?.error) {
    const messages = { offline: 'premium.offline', unavailable: 'premium.unavailable', bound_elsewhere: 'premium.boundElsewhere', cancelled: null, failed: 'error.generic' };
    const key = messages[res.error];
    $('premium-error').textContent = key ? t(key) : '';
    return;
  }
  state.me = res;
  toast(t('premium.active'));
  renderPremium();
}

async function doRestore() {
  const res = await restore(state.api);
  if (res?.error) {
    $('premium-error').textContent = res.error === 'offline' ? t('premium.offline') : t('error.generic');
    await refreshMe();
  } else {
    state.me = res;
  }
  renderPremium();
}

export function wireEditors() {
  on('btn-add-question', 'click', addQuestion);
  on('btn-add-penalty', 'click', () => saveSettings({ customPenalties: [...(snap().game.settings.customPenalties ?? []), { label: t('penalty.drink') }] }));
  on('rule-strike', 'change', (e) => saveSettings({ rules: { ...snap().game.settings.rules, strikeBack: e.target.checked } }));
  on('rule-double', 'change', (e) => saveSettings({ rules: { ...snap().game.settings.rules, doubleOrNothing: e.target.checked } }));
  on('rule-random', 'change', (e) => saveSettings({ randomOrder: e.target.checked }));
  on('btn-buy', 'click', doBuy);
  on('btn-restore', 'click', doRestore);
  on('btn-premium', 'click', async () => { await renderPremium(); show('premium'); });
}
