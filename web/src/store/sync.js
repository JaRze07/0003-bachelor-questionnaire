// Uploads the journal, drains the outbox, folds in partner answers. Never overwrites accepted local events.
import { dropOutbox, listOutbox, markAcked, mergeServer, moveToDivergent, pendingEvents, saveGame } from './journal.js';

export const OFFLINE = 'offline';

/**
 * Push local events for one game. Returns { status, snapshot }.
 * status: 'synced' | 'offline' | 'stale_epoch' | 'error'. 'stale_epoch' also covers 'not_lease_holder':
 * in both cases this device may not write until the host takes the game over here.
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
    // Events the server refused (too large, no longer applicable, game finished) are parked, not retried
    // forever, and reported so the host sees that a round did not reach the server.
    const rejected = (res.rejected ?? []).map((r) => r.id);
    if (rejected.length) await moveToDivergent(snapshot.gameId, events.filter((e) => rejected.includes(e.id)));
    // Merge into the row as it stands now: a round may have been played during the request.
    const merged = await mergeServer(snapshot.gameId, {
      answers: { ...snapshot.answers, ...(res.partnerAnswers ?? {}) },
      revision: res.revision ?? snapshot.revision,
      lastServerSync: new Date().toISOString(),
      rejectedEvents: rejected.length ? (snapshot.rejectedEvents ?? 0) + rejected.length : snapshot.rejectedEvents,
    });
    return { status: 'synced', snapshot: merged ?? snapshot, rejected };
  } catch (err) {
    if (err.offline) return { status: OFFLINE, snapshot };
    if (err.code === 'stale_epoch' || err.code === 'not_lease_holder') {
      await moveToDivergent(snapshot.gameId, events);
      const merged = await mergeServer(snapshot.gameId, { readOnly: true, epoch: err.details?.epoch ?? snapshot.epoch });
      return { status: 'stale_epoch', snapshot: merged ?? snapshot };
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
  const fields = {
    game: server.game,
    questions: server.questions,
    answers: server.answers,
    epoch: server.epoch,
    revision: server.revision,
    lastServerSync: new Date().toISOString(),
  };
  // Local rounds win while anything is still unsent: the party-time journal is the source of truth.
  if (!pending.length) fields.rounds = server.rounds;
  return (await mergeServer(snapshot.gameId, fields)) ?? { ...snapshot, ...fields };
}
