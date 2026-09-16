// Minimal IndexedDB wrapper (constitution V: no dependency). Database `bq`, schema version 1.
// Stores: games (snapshot per game), events (append-only journal), outbox, divergent, meta.

export const DB_NAME = 'bq';
export const DB_VERSION = 1;

let dbPromise = null;

export function openDb(name = DB_NAME) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const from = e.oldVersion;
      if (from < 1) {
        db.createObjectStore('games', { keyPath: 'gameId' });
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('byGameSeq', ['gameId', 'seq']);
        db.createObjectStore('outbox', { keyPath: 'key', autoIncrement: true });
        db.createObjectStore('divergent', { keyPath: 'key', autoIncrement: true });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // Future versions add their migration here; never drop a store that holds a game.
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexeddb_blocked'));
  });
  return dbPromise;
}

export function resetDbHandle() { dbPromise = null; }

/** Close the open connection (tests, and before a schema upgrade in another tab). */
export async function closeDb() {
  if (!dbPromise) return;
  try { (await dbPromise).close(); } catch { /* already closed */ }
  dbPromise = null;
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Run `fn(stores, tx, wrap)` in one transaction and resolve only after it commits (spec §7). */
export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    try {
      transaction = db.transaction(names, mode);
    } catch (err) { reject(err); return; }
    const stores = Object.fromEntries(names.map((n) => [n, transaction.objectStore(n)]));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction_aborted'));
    Promise.resolve(fn(stores, transaction, wrap))
      .then((r) => { result = r; })
      .catch((err) => { try { transaction.abort(); } catch { /* already gone */ } reject(err); });
  });
}

export const get = (store, key) => tx(store, 'readonly', (s, _t, w) => w(s[store].get(key)));
export const getAll = (store) => tx(store, 'readonly', (s, _t, w) => w(s[store].getAll()));
export const put = (store, value) => tx(store, 'readwrite', (s, _t, w) => w(s[store].put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s, _t, w) => w(s[store].delete(key)));

export async function meta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

/** Writable check with read-back, used by the readiness check. */
export async function storageUsable() {
  try {
    const probe = `probe-${Date.now()}`;
    await setMeta('probe', probe);
    const back = await meta('probe');
    await del('meta', 'probe');
    return back === probe;
  } catch {
    return false;
  }
}
