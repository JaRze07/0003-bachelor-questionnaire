import { beforeEach, describe, expect, it } from 'vitest';
import { append, listGames, loadGame, markAcked, moveToDivergent, pendingEvents, saveGame, divergentEvents } from '../src/store/journal.js';
import { closeDb, openDb, storageUsable, meta, setMeta } from '../src/store/idb.js';
import { pushEvents } from '../src/store/sync.js';

const snapshot = (over = {}) => ({
  gameId: 'g1', deviceId: 'dev-1', localSeq: 0, rounds: [], answers: {}, questions: [],
  game: { id: 'g1', status: 'in_progress', settings: { rules: {} } }, epoch: 1, revision: 1, ...over,
});

beforeEach(async () => {
  await closeDb();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('bq');
    req.onsuccess = resolve; req.onerror = () => reject(req.error); req.onblocked = resolve;
  });
  await openDb();
});

describe('journal', () => {
  it('appends an event and mutates the snapshot in one transaction', async () => {
    await saveGame(snapshot());
    const { snapshot: after, event } = await append('g1', 'round.start', { roundId: 'r1' }, (s) => { s.rounds.push({ id: 'r1', result: 'unplayed' }); });
    expect(after.localSeq).toBe(1);
    expect(after.rounds).toHaveLength(1);
    expect(event.type).toBe('round.start');
    expect(await pendingEvents('g1')).toHaveLength(1);
  });

  it('writes nothing when the mutation throws', async () => {
    await saveGame(snapshot());
    await expect(append('g1', 'round.start', {}, () => { throw new Error('boom'); })).rejects.toThrow();
    expect((await loadGame('g1')).localSeq).toBe(0);
    expect(await pendingEvents('g1')).toHaveLength(0);
  });

  it('refuses to append to a game that is not local', async () => {
    await expect(append('missing', 'round.start', {})).rejects.toThrow('game_not_local');
  });

  it('keeps events until they are acknowledged', async () => {
    await saveGame(snapshot());
    const { event } = await append('g1', 'round.mark', { result: 'correct' });
    await markAcked([event.id]);
    expect(await pendingEvents('g1')).toHaveLength(0);
  });

  it('moves rejected events to the divergent store', async () => {
    await saveGame(snapshot());
    const { event } = await append('g1', 'round.mark', {});
    await moveToDivergent('g1', [event]);
    expect(await pendingEvents('g1')).toHaveLength(0);
    expect(await divergentEvents()).toHaveLength(1);
  });

  it('reads and writes meta, and reports storage as usable', async () => {
    await setMeta('deviceId', 'dev-9');
    expect(await meta('deviceId')).toBe('dev-9');
    expect(await storageUsable()).toBe(true);
  });

  it('lists local games', async () => {
    await saveGame(snapshot());
    await saveGame(snapshot({ gameId: 'g2' }));
    expect((await listGames()).map((g) => g.gameId).sort()).toEqual(['g1', 'g2']);
  });
});

describe('sync', () => {
  const api = (impl) => ({ post: impl });

  it('acknowledges events and folds in partner answers', async () => {
    await saveGame(snapshot());
    const { event } = await append('g1', 'round.mark', { result: 'wrong' });
    const result = await pushEvents(api(async () => ({ acknowledged: [event.id], revision: 7, partnerAnswers: { q1: { text: 'late', rev: 1, questionRev: 1 } } })), await loadGame('g1'));
    expect(result.status).toBe('synced');
    expect(result.snapshot.answers.q1.text).toBe('late');
    expect(await pendingEvents('g1')).toHaveLength(0);
  });

  it('keeps events when offline', async () => {
    await saveGame(snapshot());
    await append('g1', 'round.mark', {});
    const err = Object.assign(new Error('offline'), { offline: true });
    const result = await pushEvents(api(async () => { throw err; }), await loadGame('g1'));
    expect(result.status).toBe('offline');
    expect(await pendingEvents('g1')).toHaveLength(1);
  });

  it('parks events and goes read-only after a takeover', async () => {
    await saveGame(snapshot());
    await append('g1', 'round.mark', {});
    const err = Object.assign(new Error('stale'), { code: 'stale_epoch', details: { epoch: 4 } });
    const result = await pushEvents(api(async () => { throw err; }), await loadGame('g1'));
    expect(result.status).toBe('stale_epoch');
    expect(result.snapshot.readOnly).toBe(true);
    expect(result.snapshot.epoch).toBe(4);
    expect(await pendingEvents('g1')).toHaveLength(0);
    expect(await divergentEvents()).toHaveLength(1);
  });
});

describe('sync hardening', () => {
  const api = (impl) => ({ post: impl });

  it('parks events the server rejected', async () => {
    await saveGame(snapshot());
    const { event } = await append('g1', 'round.mark', {});
    const result = await pushEvents(api(async () => ({ acknowledged: [], rejected: [{ id: event.id, reason: 'too_large' }] })), await loadGame('g1'));
    expect(result.status).toBe('synced');
    expect(await pendingEvents('g1')).toHaveLength(0);
    expect(await divergentEvents()).toHaveLength(1);
  });

  it('goes read-only when another device holds the lease', async () => {
    await saveGame(snapshot());
    await append('g1', 'round.mark', {});
    const err = Object.assign(new Error('holder'), { code: 'not_lease_holder', details: { epoch: 1 } });
    const result = await pushEvents(api(async () => { throw err; }), await loadGame('g1'));
    expect(result.status).toBe('stale_epoch');
    expect(result.snapshot.readOnly).toBe(true);
  });
});

describe('journal hardening', () => {
  it('writes both events of one action in a single transaction', async () => {
    const { appendMany } = await import('../src/store/journal.js');
    await saveGame(snapshot());
    const { snapshot: after, events } = await appendMany('g1', [
      { type: 'round.start', payload: { roundId: 'r1' }, mutate: (s) => { s.rounds.push({ id: 'r1', result: 'unplayed', started: true }); } },
      { type: 'round.double', payload: { roundId: 'r1' }, mutate: (s) => { s.rounds[0].doubled = true; } },
    ]);
    expect(events).toHaveLength(2);
    expect(after.rounds[0].doubled).toBe(true);
    expect(after.localSeq).toBe(2);
    expect((await loadGame('g1')).rounds[0].doubled).toBe(true);
  });

  it('refuses to write while the device is read-only', async () => {
    await saveGame(snapshot({ readOnly: true }));
    await expect(append('g1', 'round.mark', {})).rejects.toThrow('read_only');
    expect(await pendingEvents('g1')).toHaveLength(0);
  });

  it('merges server fields into the row as it stands now', async () => {
    const { mergeServer } = await import('../src/store/journal.js');
    await saveGame(snapshot());
    const stale = await loadGame('g1');
    await append('g1', 'round.start', {}, (s) => { s.rounds.push({ id: 'late', result: 'unplayed' }); });
    // a response built from the stale copy must not drop the round committed meanwhile
    const merged = await mergeServer('g1', { revision: 9, answers: stale.answers });
    expect(merged.revision).toBe(9);
    expect(merged.rounds).toHaveLength(1);
  });
});

describe('merge rules from the second review', () => {
  it('keeps the newer answer per question', async () => {
    const { mergeAnswers } = await import('../src/store/journal.js');
    const current = { q1: { text: 'new', rev: 3, questionRev: 2 }, q2: { text: 'mine', rev: 1, questionRev: 1 } };
    const incoming = { q1: { text: 'old', rev: 1, questionRev: 1 }, q2: { text: 'theirs', rev: 2, questionRev: 1 } };
    const merged = mergeAnswers(current, incoming);
    expect(merged.q1.text).toBe('new');
    expect(merged.q2.text).toBe('theirs');
  });

  it('drops a pull older than what is already stored', async () => {
    const { pullGame } = await import('../src/store/sync.js');
    await saveGame(snapshot({ revision: 10, game: { id: 'g1', status: 'in_progress', settings: { rules: {} } } }));
    const api = { get: async () => ({ game: { id: 'g1', status: 'draft' }, questions: [], answers: {}, rounds: [], epoch: 1, revision: 4 }) };
    const after = await pullGame(api, await loadGame('g1'));
    expect(after.revision).toBe(10);
    expect(after.game.status).toBe('in_progress');
  });
});
