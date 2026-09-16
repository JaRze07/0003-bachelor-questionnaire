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
 * Append one event and apply `mutate(snapshot, event)` in the same transaction.
 * Returns { snapshot, event }; throws (and writes nothing) if IndexedDB refuses.
 */
export async function append(gameId, type, payload, mutate) {
  return tx(['games', 'events'], 'readwrite', async (s, _t, w) => {
    const snapshot = await w(s.games.get(gameId));
    if (!snapshot) throw new Error('game_not_local');
    const seq = (snapshot.localSeq ?? 0) + 1;
    const event = {
      id: uuid(), gameId, seq, epoch: snapshot.epoch ?? 1, type,
      at: new Date().toISOString(), payload, acked: 0,
    };
    snapshot.localSeq = seq;
    if (mutate) mutate(snapshot, event);
    snapshot.updatedLocallyAt = event.at;
    await w(s.events.put(event));
    await w(s.games.put(snapshot));
    return { snapshot, event };
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
