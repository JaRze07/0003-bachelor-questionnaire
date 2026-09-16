// Shared state for the host screens: API client, user, entitlement, the open game snapshot.
import { createApi } from '../api.js';
import { idToken } from '../native/auth.js';
import { makeTranslator, deviceLanguage } from '../i18n.js';
import { loadGame, saveGame } from '../store/journal.js';
import { pullGame, pushEvents } from '../store/sync.js';
import { deviceId } from '../native/device.js';
import { meta, setMeta } from '../store/idb.js';

export const state = {
  api: createApi({ getToken: idToken }),
  user: null,
  me: null,          // GET /me payload
  t: null,           // translator for the current surface
  lang: deviceLanguage(),
  snapshot: null,    // open game
  draft: null,       // round being played
  online: navigator.onLine !== false,
  lastSync: null,
  syncStatus: 'idle', // idle | synced | offline | stale_epoch | error
};

export const premium = () => Boolean(state.me?.premium?.active);
export const premiumState = () => state.me?.premium?.state ?? 'none';

export async function setLanguage(lang) {
  state.lang = lang;
  state.t = await makeTranslator(lang);
  return state.t;
}

/**
 * Entitlement: the cached copy is loaded first so a cold offline start still knows the host is premium;
 * it is replaced only by a successful answer from the server.
 */
export async function refreshMe() {
  if (!state.me) state.me = await meta('entitlement');
  try {
    state.me = await state.api.get('/me');
    state.online = true;
    await setMeta('entitlement', { ...state.me, cachedAt: new Date().toISOString() });
  } catch (err) {
    if (!err.offline) throw err;
    state.online = false;
  }
  return state.me;
}

/**
 * Load a game into `state.snapshot`. The local copy is returned at once so the party is never gated on the
 * network; `refresh` pulls the server copy and reports whether anything changed.
 */
export async function openGame(gameId) {
  let snapshot = await loadGame(gameId);
  if (!snapshot) {
    snapshot = {
      gameId, deviceId: await deviceId(), localSeq: 0, rounds: [], answers: {}, questions: [],
      game: null, epoch: 1, revision: 0, readOnly: false, readiness: null,
    };
    await saveGame(snapshot);
  }
  state.snapshot = snapshot;
  return snapshot;
}

/** Background pull. Applies only while the same game is still open. */
export async function refreshGame(gameId) {
  const local = await loadGame(gameId);
  if (!local) return null;
  try {
    const pulled = await pullGame(state.api, local);
    state.online = true;
    if (state.snapshot?.gameId === gameId) state.snapshot = pulled;
    return pulled;
  } catch (err) {
    if (!err.offline) throw err;
    state.online = false;
    return null;
  }
}

let syncing = null;

/** Push pending events. One run at a time; a late answer never lands on another game's snapshot. */
export async function sync() {
  if (!state.snapshot) return 'idle';
  if (syncing) return syncing;
  const gameId = state.snapshot.gameId;
  syncing = (async () => {
    try {
      const { status, snapshot } = await pushEvents(state.api, state.snapshot);
      if (state.snapshot?.gameId === gameId) {
        state.snapshot = snapshot;
        state.syncStatus = status;
        if (status === 'synced') state.lastSync = snapshot.lastServerSync;
      }
      return status;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function setSnapshot(snapshot) {
  state.snapshot = snapshot;
  return snapshot;
}
