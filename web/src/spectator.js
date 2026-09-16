// Spectator page: score and played rounds only. Polls every 8 s while visible, with an ETag.
import { createApi } from './api.js';
import { makeTranslator } from './i18n.js';
import { $, el, timeAgo } from './host/ui.js';

const POLL_MS = 8000;
const STALE_MS = 20000;

const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? '';
const api = createApi({ gameToken: token });

let t = null;
let etag = null;
let lastOk = 0;
let timer = null;
let stopped = false;
let polling = false;
let lastRevision = -1;

/** Self-scheduling: the next poll starts only after this one settles, so requests never overlap. */
function schedule(ms = POLL_MS) {
  clearTimeout(timer);
  if (stopped) return;
  timer = setTimeout(() => { poll().catch(() => schedule()); }, ms);
}

async function poll(first = false) {
  if (stopped || polling) return;
  if (document.visibilityState !== 'visible' && !first) { schedule(); return; }
  polling = true;
  try {
    const res = await api.get('/s/summary', etag ? { 'If-None-Match': etag } : undefined);
    if (res.status === 304) { lastOk = Date.now(); markStale(); return; }
    // An older response must never replace a newer score.
    if (typeof res.revision === 'number' && res.revision < lastRevision) return;
    lastRevision = res.revision ?? lastRevision;
    etag = res.__etag ?? etag;
    lastOk = Date.now();
    if (!t) {
      t = await makeTranslator(res.language);
      document.documentElement.lang = res.language;
      document.title = t('spectator.title');
      $('correct-label').textContent = t('score.correct');
      $('wrong-label').textContent = t('score.wrong');
    }
    render(res);
  } catch (err) {
    if (err.status === 404 || err.status === 410) { gone(); return; }
    markStale();
  } finally {
    polling = false;
    schedule();
  }
}

function render(data) {
  $('title').textContent = data.title || t('spectator.title');
  $('board').hidden = false;
  $('correct').textContent = data.score.correct;
  $('wrong').textContent = data.score.wrong;
  $('waiting').hidden = data.rounds.length > 0;
  if (!data.rounds.length) $('waiting').textContent = t('spectator.waiting');
  const box = $('rounds');
  box.innerHTML = '';
  for (const round of [...data.rounds].reverse()) {
    const row = el('div', 'spec-round');
    row.appendChild(el('span', 'spec-n', `${round.n}`));
    row.appendChild(el('span', 'grow', round.question));
    if (round.doubled) row.appendChild(el('span', 'badge badge-live', '×2'));
    row.appendChild(el('span', `pill pill-${round.result}`, t(`result.${round.result}`)));
    box.appendChild(row);
  }
  $('updated').textContent = t('spectator.updated', { when: timeAgo(t, data.updatedAt) });
  markStale();
}

function markStale() {
  const stale = Date.now() - lastOk > STALE_MS;
  const node = $('stale');
  node.hidden = !stale;
  if (stale && t) node.textContent = t('spectator.stale');
}

function gone() {
  stopped = true;
  clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisible);
  $('board').hidden = true;
  const box = $('gone');
  box.hidden = false;
  box.textContent = t ? t('spectator.gone') : 'This link is no longer available.';
}

function onVisible() { if (document.visibilityState === 'visible') poll(true).catch(() => schedule()); }

if (!token) gone();
else {
  document.addEventListener('visibilitychange', onVisible);
  poll(true).catch(() => schedule());
}
