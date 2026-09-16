// Uploads the journal, drains the outbox, folds in partner answers. Never overwrites accepted local events.
import { dropOutbox, listOutbox, markAcked, moveToDivergent, pendingEvents, saveGame } from './journal.js';

export const OFFLINE = 'offline';

/**
 * Push local events for one game. Returns { status, snapshot }.
 * status: 'synced' | 'offline' | 'stale_epoch' | 'error'
 */
export async function pushEvents(api, snapshot) {
  const events = await pendingEvents(snapshot.gameId);
  if (!events.length) return { status: 'synced', snapshot };
  try {
    const res = await api.post(`/games/${snapshot.gameId}/events`, {
      epoch: snapshot.epoch ?? 1,
      deviceId: snapshot.deviceId,
      events: events.map((e) => ({ id: e.id, seq: e.seq, type: e.type, at: e.at, payload: e.payload })),
    });
    await markAcked(res.acknowledged ?? []);
    snapshot.answers = { ...snapshot.answers, ...(res.partnerAnswers ?? {}) };
    snapshot.revision = res.revision ?? snapshot.revision;
    snapshot.lastServerSync = new Date().toISOString();
    await saveGame(snapshot);
    return { status: 'synced', snapshot };
  } catch (err) {
    if (err.offline) return { status: OFFLINE, snapshot };
    if (err.code === 'stale_epoch') {
      await moveToDivergent(snapshot.gameId, events);
      snapshot.readOnly = true;
      snapshot.epoch = err.details?.epoch ?? snapshot.epoch;
      await saveGame(snapshot);
      return { status: 'stale_epoch', snapshot };
    }
    return { status: 'error', snapshot, error: err };
  }
}

/** Non-event mutations queued while offline (question edits, deletions, snapshots). */
export async function drainOutbox(api) {
  const rows = await listOutbox();
  for (const row of rows) {
    try {
      await api.request(row.op.method, row.op.path, row.payload);
      await dropOutbox(row.key);
    } catch (err) {
      if (err.offline) return false;
      await dropOutbox(row.key); // a rejected mutation is dropped; the server state wins
    }
  }
  return true;
}

/** Pull the server copy into the local snapshot without discarding unsynced local rounds. */
export async function pullGame(api, snapshot) {
  const server = await api.get(`/games/${snapshot.gameId}`);
  const pending = await pendingEvents(snapshot.gameId);
  const merged = {
    ...snapshot,
    game: server.game,
    questions: server.questions,
    answers: server.answers,
    epoch: server.epoch,
    revision: server.revision,
    lastServerSync: new Date().toISOString(),
  };
  if (!pending.length) merged.rounds = server.rounds;
  await saveGame(merged);
  return merged;
}
