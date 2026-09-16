// Host app entry: sign-in, game list, game overview, wiring for every screen.
import { $, applyStatic, confirmModal, el, on, onScreenChange, show, timeAgo, toast } from './host/ui.js';
import { openGame, premium, refreshGame, refreshMe, setLanguage, state, sync } from './host/state.js';
import { pool, renderFixup, renderScoreboard, startRound, wireRound } from './host/round.js';
import { renderPremium, renderQuestions, renderSettings, wireEditors } from './host/editors.js';
import { readinessState, runReadiness } from './host/readiness.js';
import { currentUser, signIn, signOut } from './native/auth.js';
import { countUse, initAds, maybeInterstitial, syncBanner } from './native/ads.js';
import { copy, deviceId, deviceLabel, downloadJson, trackForeground } from './native/device.js';
import { divergentEvents, loadGame, saveGame } from './store/journal.js';
import { drainOutbox } from './store/sync.js';
import { deviceLanguage } from './i18n.js';

const t = (...a) => state.t(...a);
let links = { gameId: null, partner: null, spectator: null };
const linksFor = (gameId) => (links.gameId === gameId ? links : { gameId, partner: null, spectator: null });

/* ---------- boot ---------- */

async function boot() {
  await setLanguage(deviceLanguage());
  applyStatic(t);
  // Ad placement follows navigation, so a banner cannot survive on a screen that forbids it.
  onScreenChange((name) => { syncBanner(name, premium()).catch(() => {}); });
  wire();
  wireRound();
  wireEditors();
  initAds().catch(() => {});
  trackForeground((seconds) => countUse(seconds).catch(() => {}));
  window.addEventListener('online', () => { state.online = true; sync().catch(() => {}); drainOutbox(state.api).catch(() => {}); });
  window.addEventListener('offline', () => { state.online = false; });

  state.user = await currentUser();
  if (!state.user) { show('signin'); return; }
  await afterSignIn();
}

async function afterSignIn() {
  try { await refreshMe(); } catch { /* offline: the cached entitlement is used */ }
  await renderHome();
  show('home');
}

/* ---------- home ---------- */

async function renderHome() {
  const list = $('games-list');
  list.innerHTML = '';
  let games = [];
  try {
    games = (await state.api.get('/games')).games;
    state.online = true;
  } catch (err) {
    if (!err.offline) throw err;
    state.online = false;
    const local = await import('./store/journal.js').then((m) => m.listGames());
    games = local.filter((g) => g.game).map((g) => ({ ...g.game, counts: g.game.counts }));
  }
  $('games-empty').hidden = games.length > 0;
  for (const game of games) {
    const card = el('button', 'card card-tap');
    const head = el('div', 'row-between');
    head.appendChild(el('span', 'card-title', game.title || t('app.name')));
    head.appendChild(el('span', `badge ${game.status === 'ready' ? 'badge-ready' : game.status === 'in_progress' ? 'badge-live' : ''}`, t(`status.${game.status}`)));
    card.appendChild(head);
    const counts = game.counts ?? { answered: 0, questions: 0, correct: 0, wrong: 0 };
    card.appendChild(el('p', 'small muted', `${t('game.partnerStatus.progress', { answered: counts.answered, total: counts.questions })} · ${counts.correct}/${counts.wrong}`));
    if (game.retentionWarnedAt) card.appendChild(el('span', 'badge badge-warn', '90d'));
    card.addEventListener('click', () => openGameScreen(game.id));
    list.appendChild(card);
  }
  const notice = $('home-notice');
  notice.hidden = state.online;
  if (!state.online) notice.textContent = t('error.offline');
}

/* ---------- new game ---------- */

async function createGame() {
  $('new-error').textContent = '';
  try {
    const res = await state.api.post('/games', {
      language: $('new-language').value,
      title: $('new-title').value.trim() || undefined,
      source: $('new-blank').checked ? 'blank' : 'curated',
    });
    links = { gameId: res.game.id, partner: res.tokens.partner.url, spectator: res.tokens.spectator.url };
    await saveGame({
      gameId: res.game.id, deviceId: await deviceId(), localSeq: 0, rounds: [], answers: {},
      questions: res.questions, game: res.game, epoch: res.epoch, revision: res.game.revision,
      readOnly: false, readiness: null, links,
    });
    await openGameScreen(res.game.id);
  } catch (err) {
    $('new-error').textContent = err.offline ? t('error.offline')
      : err.code === 'active_game_limit' ? t('error.gameLimit')
      : err.code === 'premium_required' ? t('questions.editPremium') : t('error.generic');
  }
}

/* ---------- game overview ---------- */

async function openGameScreen(gameId) {
  const snapshot = await openGame(gameId);
  await setLanguage(snapshot.game?.language ?? state.lang);
  applyStatic(t);
  // Links belong to one game; never carry another game's bearer token onto this screen.
  links = snapshot.links?.gameId === gameId ? snapshot.links : linksFor(gameId);
  if (snapshot.game) { await renderGame(); show('game'); }
  // Network work runs behind the screen: a bad connection must not block the party.
  (async () => {
    await claimLease(snapshot);
    const pulled = await refreshGame(gameId).catch(() => null);
    if (state.snapshot?.gameId !== gameId) return;
    if (!pulled && !snapshot.game) { toast(t('error.offline')); return; }
    await renderGame();
    if (!document.getElementById('screen-game').hidden) show('game');
    await sync().catch(() => {});
    await drainOutbox(state.api).catch(() => {});
    await renderGame();
  })().catch((err) => console.error('background open failed', err));
}

async function claimLease(snapshot) {
  try {
    const res = await state.api.post(`/games/${snapshot.gameId}/lease`, { deviceId: snapshot.deviceId, label: await deviceLabel() });
    const { mergeServer } = await import('./store/journal.js');
    const merged = await mergeServer(snapshot.gameId, { readOnly: !res.isHolder, epoch: res.epoch, leaseSyncAt: res.lastSyncAt });
    if (merged && state.snapshot?.gameId === snapshot.gameId) state.snapshot = merged;
  } catch (err) {
    // Offline keeps the cached epoch and keeps playing (spec §7); a refusal makes this device read-only.
    if (err.offline) return;
    const { mergeServer } = await import('./store/journal.js');
    const merged = await mergeServer(snapshot.gameId, { readOnly: true });
    if (merged && state.snapshot?.gameId === snapshot.gameId) state.snapshot = merged;
  }
}

async function renderGame() {
  const s = state.snapshot;
  const game = s?.game;
  if (!game) return;
  $('game-title').textContent = game.title || t('app.name');
  $('game-status').textContent = t(`status.${game.status}`);
  $('game-readonly').hidden = !s.readOnly;
  $('partner-url').textContent = links.partner ?? '—';
  $('spectator-url').textContent = links.spectator ?? '—';

  const counts = game.counts;
  const percent = counts.questions ? Math.round((counts.answered / counts.questions) * 100) : 0;
  $('partner-progress').style.width = `${percent}%`;
  $('partner-status').textContent = !game.partnerOpenedAt ? t('game.partnerStatus.notOpened')
    : counts.answered >= counts.questions ? t('game.partnerStatus.complete', { total: counts.questions })
    : t('game.partnerStatus.progress', { answered: counts.answered, total: counts.questions });

  const sync = $('game-sync');
  sync.textContent = state.online ? t('game.lastSync', { when: timeAgo(t, s.lastServerSync) }) : t('error.offline');
  sync.className = `notice ${state.online ? 'notice-info' : 'notice-warn'}`;

  const readiness = await readinessState(s);
  const box = $('readiness-box');
  box.hidden = readiness === 'unchecked';
  if (readiness === 'ready') { box.className = 'notice notice-ok'; box.textContent = t('game.ready'); }
  if (readiness === 'needs_refresh') { box.className = 'notice notice-warn'; box.textContent = t('game.needsRefresh'); }

  const playableCount = pool().length;
  const play = $('btn-play');
  play.disabled = Boolean(s.readOnly) || playableCount === 0;
  // A device without the lease may look, not write.
  for (const id of ['btn-questions', 'btn-settings', 'btn-fixup', 'btn-delete', 'btn-regen-partner', 'btn-regen-spectator']) {
    const node = $(id);
    if (node) node.disabled = Boolean(s.readOnly);
  }
  play.textContent = game.status === 'in_progress' ? t('round.next')
    : counts.answered < counts.questions ? t('game.startPartial', { answered: counts.answered, total: counts.questions })
    : t('game.start');

  const divergent = (await divergentEvents()).filter((row) => row.gameId === s.gameId);
  if (divergent.length) {
    sync.className = 'notice notice-warn';
    sync.textContent = `${sync.textContent} · ${divergent.length} actions could not be sent from this phone.`;
  }
}

async function checkReadiness() {
  const s = state.snapshot;
  const result = await runReadiness(s, Boolean(state.t));
  const box = $('readiness-box');
  box.hidden = false;
  if (result.state === 'ready') {
    s.readiness = { hash: result.hash, at: new Date().toISOString() };
    await saveGame(s);
    box.className = 'notice notice-ok';
    box.textContent = t('game.ready');
  } else {
    box.className = 'notice notice-warn';
    box.textContent = t('game.notReady', { reason: result.reason });
  }
}

async function startPlay() {
  const s = state.snapshot;
  if (s.readOnly) { toast(t('game.readOnly')); return; }
  // Start locally first: the round must begin even with no connection. The server learns from the
  // first uploaded event, which moves the game to in_progress there too.
  if (s.game.status !== 'in_progress') {
    const { mergeServer } = await import('./store/journal.js');
    const merged = await mergeServer(s.gameId, { game: { ...s.game, status: 'in_progress' } });
    if (merged) state.snapshot = merged;
    state.api.post(`/games/${s.gameId}/transition`, { to: 'in_progress', allowPartial: true })
      .catch((err) => { if (!err.offline) console.warn('transition rejected', err.code); });
  }
  startRound();
}

async function regenerate(role) {
  try {
    const res = await state.api.post(`/games/${state.snapshot.gameId}/tokens/${role}/regenerate`, {});
    links = { ...linksFor(state.snapshot.gameId), [role]: res.url };
    const { mergeServer } = await import('./store/journal.js');
    const merged = await mergeServer(state.snapshot.gameId, { links });
    if (merged) state.snapshot = merged;
    await renderGame();
    toast(t('game.regenerate'));
  } catch (err) {
    toast(err.offline ? t('error.offline') : t('error.generic'));
  }
}

async function takeOver() {
  const ok = await confirmModal(t, { title: t('game.takeOver'), body: t('game.takeOverWarn'), confirmLabel: t('game.takeOver') });
  if (!ok) return;
  try {
    const res = await state.api.post(`/games/${state.snapshot.gameId}/lease/takeover`, { deviceId: state.snapshot.deviceId, label: await deviceLabel(), confirm: true });
    const { mergeServer } = await import('./store/journal.js');
    const merged = await mergeServer(state.snapshot.gameId, { epoch: res.epoch, readOnly: false });
    if (merged) state.snapshot = merged;
    await openGameScreen(state.snapshot.gameId);
  } catch (err) {
    toast(err.offline ? t('error.offline') : t('error.generic'));
  }
}

async function exportGame() {
  const s = state.snapshot;
  try {
    const data = await state.api.get(`/games/${s.gameId}/export`);
    downloadJson(`bachelor-questionnaire-${s.gameId}.json`, data);
  } catch {
    downloadJson(`bachelor-questionnaire-${s.gameId}-local.json`, { local: true, ...s });
  }
}

async function deleteGame() {
  const s = state.snapshot;
  const ok = await confirmModal(t, { title: t('game.delete'), body: t('game.deleteConfirm'), danger: true, confirmLabel: t('game.delete') });
  if (!ok) return;
  try {
    await state.api.del(`/games/${s.gameId}`);
  } catch (err) {
    if (err.offline) {
      const { queueOutbox } = await import('./store/journal.js');
      await queueOutbox(s.gameId, { method: 'DELETE', path: `/games/${s.gameId}` }, undefined);
      toast(t('game.deletePending'));
    } else { toast(t('error.generic')); return; }
  }
  const { del } = await import('./store/idb.js');
  await del('games', s.gameId);
  state.snapshot = null;
  await renderHome();
  show('home');
}

/* ---------- wiring ---------- */

function wire() {
  on('btn-signin', 'click', async () => {
    state.user = await signIn();
    if (state.user) await afterSignIn();
  });
  on('btn-signout', 'click', async () => { await signOut(); state.user = null; show('signin'); });
  on('btn-new-game', 'click', async () => {
    $('new-blank-row').hidden = !premium();
    show('new');
    maybeInterstitial('before_new_game', premium()).catch(() => {});
  });
  on('btn-create', 'click', createGame);
  on('btn-copy-partner', 'click', async () => { if (await copy(links.partner)) toast(t('action.copied')); });
  on('btn-copy-spectator', 'click', async () => { if (await copy(links.spectator)) toast(t('action.copied')); });
  on('btn-regen-partner', 'click', () => regenerate('partner'));
  on('btn-regen-spectator', 'click', () => regenerate('spectator'));
  on('btn-readiness', 'click', checkReadiness);
  on('btn-play', 'click', startPlay);
  on('btn-takeover', 'click', takeOver);
  on('btn-questions', 'click', async () => { await renderQuestions(); show('questions'); });
  on('btn-settings', 'click', () => { renderSettings(); show('settings'); });
  on('btn-fixup', 'click', () => { renderFixup(); show('fixup'); });
  on('btn-scoreboard', 'click', () => { renderScoreboard(); show('scoreboard'); });
  on('btn-export', 'click', exportGame);
  on('btn-delete', 'click', deleteGame);
  for (const button of document.querySelectorAll('[data-goto]')) {
    button.addEventListener('click', async () => {
      const target = button.dataset.goto;
      if (target === 'home') { await renderHome(); show('home'); return; }
      if (target === 'game' && state.snapshot) { await renderGame(); show('game'); }
    });
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<p style="padding:24px">Could not start. Reopen the app.</p>';
});
