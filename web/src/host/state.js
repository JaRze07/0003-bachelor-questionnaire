// Shared state for the host screens: API client, user, entitlement, the open game snapshot.
import { createApi } from '../api.js';
import { idToken } from '../native/auth.js';
import { makeTranslator, deviceLanguage } from '../i18n.js';
import { loadGame, saveGame } from '../store/journal.js';
import { pullGame, pushEvents } from '../store/sync.js';
import { deviceId } from '../native/device.js';

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

export async function refreshMe() {
  try {
    state.me = await state.api.get('/me');
    state.online = true;
  } catch (err) {
    if (!err.offline) throw err;
    state.online = false;
  }
  return state.me;
}

/** Load a game into `state.snapshot`: local copy first, then the server when online. */
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
  try {
    state.snapshot = await pullGame(state.api, snapshot);
    state.online = true;
  } catch (err) {
    if (!err.offline) throw err;
    state.online = false;
  }
  return state.snapshot;
}

/** Push pending events; updates syncStatus and returns it. */
export async function sync() {
  if (!state.snapshot) return 'idle';
  const { status, snapshot } = await pushEvents(state.api, state.snapshot);
  state.snapshot = snapshot;
  state.syncStatus = status;
  if (status === 'synced') state.lastSync = snapshot.lastServerSync;
  return status;
}

export function setSnapshot(snapshot) {
  state.snapshot = snapshot;
  return snapshot;
}
