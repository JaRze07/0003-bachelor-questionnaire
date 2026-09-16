// Append-only event journal plus the local game snapshot. One transaction per user action:
// the UI may only advance after it commits (spec §7).
import { tx, get, getAll, put, del } from './idb.js';

export const uuid = () => (globalThis.crypto?.randomUUID
  ? crypto.randomUUID()
  : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const loadGame = (gameId) => get('games', gameId);
export const listGames = () => getAll('games');

export async function saveGame(snapshot) {
  await put('games', snapshot);
  return snapshot;
}

/**
 * Append one or more events and apply their mutations in a single transaction, always against the row as it
 * is stored right now. Returns { snapshot, events }: the caller MUST adopt the returned snapshot, it is the
 * only correct copy. Throws and writes nothing if IndexedDB refuses or the device is read-only.
 *
 * `entries` = [{ type, payload, mutate }]. `append` keeps the one-event shape for readability.
 */
export async function appendMany(gameId, entries) {
  return tx(['games', 'events'], 'readwrite', async (s, _t, w) => {
    const snapshot = await w(s.games.get(gameId));
    if (!snapshot) throw new Error('game_not_local');
    if (snapshot.readOnly) throw new Error('read_only');
    const events = [];
    for (const entry of entries) {
      const seq = (snapshot.localSeq ?? 0) + 1;
      const event = {
        id: uuid(), gameId, seq, epoch: snapshot.epoch ?? 1, type: entry.type,
        at: new Date().toISOString(), payload: entry.payload ?? {}, acked: 0,
      };
      snapshot.localSeq = seq;
      if (entry.mutate) entry.mutate(snapshot, event);
      snapshot.updatedLocallyAt = event.at;
      await w(s.events.put(event));
      events.push(event);
    }
    await w(s.games.put(snapshot));
    return { snapshot, events };
  });
}

export async function append(gameId, type, payload, mutate) {
  const { snapshot, events } = await appendMany(gameId, [{ type, payload, mutate }]);
  return { snapshot, event: events[0] };
}

/**
 * Merge server-owned fields into the stored row inside one transaction, so a round committed during the
 * request is never overwritten by a snapshot captured before it.
 */
export async function mergeServer(gameId, fields) {
  return tx('games', 'readwrite', async (s, _t, w) => {
    const current = await w(s.games.get(gameId));
    if (!current) return null;
    const merged = { ...current, ...fields };
    await w(s.games.put(merged));
    return merged;
  });
}

export async function pendingEvents(gameId, limit = 200) {
  const all = await getAll('events');
  return all.filter((e) => e.gameId === gameId && !e.acked).sort((a, b) => a.seq - b.seq).slice(0, limit);
}

export async function markAcked(ids) {
  if (!ids.length) return;
  await tx('events', 'readwrite', async (s, _t, w) => {
    for (const id of ids) {
      const row = await w(s.events.get(id));
      if (row) { row.acked = 1; await w(s.events.put(row)); }
    }
  });
}

/** Events rejected because another device took over: kept for a recoverable export (spec §7). */
export async function moveToDivergent(gameId, events) {
  if (!events.length) return;
  await tx(['events', 'divergent'], 'readwrite', async (s, _t, w) => {
    for (const e of events) {
      await w(s.divergent.put({ gameId, event: e, storedAt: new Date().toISOString() }));
      await w(s.events.delete(e.id));
    }
  });
}

export const divergentEvents = () => getAll('divergent');

export const queueOutbox = (gameId, op, payload) => put('outbox', { gameId, op, payload, createdAt: new Date().toISOString() });
export const listOutbox = () => getAll('outbox');
export const dropOutbox = (key) => del('outbox', key);
