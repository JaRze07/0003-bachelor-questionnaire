import { AsyncLocalStorage } from 'node:async_hooks';
import type { Answer, Game, GameEvent, Projection, Purchase, Question, Repo, Round, Session, Snapshot, TokenDoc, User } from './types.js';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** In-memory repository: tests and `REPO=memory` local runs. Deep-copies on the way in and out. */
export function createMemoryRepo(): Repo & { dump(): unknown } {
  const users = new Map<string, User>();
  const purchases = new Map<string, Purchase>();
  const games = new Map<string, Game>();
  const sub = <T>() => new Map<string, Map<string, T>>();
  const questions = sub<Question>();
  const answers = sub<Answer>();
  const rounds = sub<Round>();
  const events = sub<GameEvent>();
  const tokens = new Map<string, TokenDoc>();
  const projections = new Map<string, Projection>();
  const snapshots = new Map<string, Snapshot[]>();
  const sessions = new Map<string, Session>();
  let queue: Promise<unknown> = Promise.resolve();
  const inTx = new AsyncLocalStorage<true>();
  const stores = () => ({ users, purchases, games, questions, answers, rounds, events, tokens, projections, snapshots, sessions }) as Record<string, Map<string, unknown>>;
  const copy = (m: Map<string, unknown>) => new Map([...m].map(([k, v]) => [k, v instanceof Map ? new Map([...v].map(([k2, v2]) => [k2, clone(v2)])) : clone(v)]));

  const bucket = <T>(m: Map<string, Map<string, T>>, gameId: string) => {
    let b = m.get(gameId);
    if (!b) { b = new Map(); m.set(gameId, b); }
    return b;
  };

  return {
    /** Same contract as the SQLite repository: serialised, nested calls join, a failure restores every map. */
    async tx(fn) {
      if (inTx.getStore()) return fn();
      const run = queue.then(async () => {
        const before = Object.fromEntries(Object.entries(stores()).map(([name, m]) => [name, copy(m)]));
        try {
          return await inTx.run(true, fn);
        } catch (err) {
          for (const [name, m] of Object.entries(stores())) { m.clear(); for (const [k, v] of before[name]) m.set(k, v); }
          throw err;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
    sessions: {
      async get(id) { return clone(sessions.get(id) ?? null); },
      async set(s) { sessions.set(s.id, clone(s)); },
      async delete(id) { sessions.delete(id); },
      async deleteExpired(now) {
        let n = 0;
        for (const [id, s] of sessions) if (s.expiresAt < now) { sessions.delete(id); n++; }
        return n;
      },
    },
    users: {
      async get(uid) { return clone(users.get(uid) ?? null); },
      async set(u) { users.set(u.uid, clone(u)); },
      async update(uid, fields) {
        const current = users.get(uid);
        if (current) users.set(uid, { ...current, ...clone(fields) });
      },
    },
    purchases: {
      async get(token) { return clone(purchases.get(token) ?? null); },
      async set(p) { purchases.set(p.token, clone(p)); },
      async listByUid(uid) { return clone([...purchases.values()].filter((p) => p.uid === uid)); },
      async release(token, uid) {
        const existing = purchases.get(token);
        if (existing && existing.uid === uid && existing.productId === '') purchases.delete(token);
      },
      async claim(token, uid) {
        const existing = purchases.get(token);
        if (existing && existing.uid !== uid) return { ok: false, uid: existing.uid };
        if (!existing) {
          purchases.set(token, { token, uid, platform: 'play', productId: '', state: 'pending', boundAt: new Date().toISOString(), verifiedAt: new Date().toISOString() });
        }
        return { ok: true };
      },
    },
    games: {
      async get(id) { return clone(games.get(id) ?? null); },
      async set(g) { games.set(g.id, clone(g)); },
      async update(id, fields) {
        const current = games.get(id);
        if (current) games.set(id, { ...current, ...clone(fields) });
      },
      async listByHost(uid) { return clone([...games.values()].filter((g) => g.hostUid === uid)); },
      async listIdleBefore(iso) { return clone([...games.values()].filter((g) => g.lastActivityAt < iso)); },
      async deleteTree(id) {
        games.delete(id); questions.delete(id); answers.delete(id); rounds.delete(id); events.delete(id);
        projections.delete(id); snapshots.delete(id);
        for (const [h, t] of tokens) if (t.gameId === id) tokens.delete(h);
      },
    },
    questions: {
      async list(gameId) { return clone([...bucket(questions, gameId).values()].sort((a, b) => a.order - b.order)); },
      async get(gameId, id) { return clone(bucket(questions, gameId).get(id) ?? null); },
      async set(gameId, q) { bucket(questions, gameId).set(q.id, clone(q)); },
      async setMany(gameId, qs) { for (const q of qs) bucket(questions, gameId).set(q.id, clone(q)); },
      async delete(gameId, id) { bucket(questions, gameId).delete(id); },
    },
    answers: {
      async list(gameId) { return clone([...bucket(answers, gameId).values()]); },
      async get(gameId, qid) { return clone(bucket(answers, gameId).get(qid) ?? null); },
      async set(gameId, a) { bucket(answers, gameId).set(a.questionId, clone(a)); },
      async setIfRev(gameId, a, expectedRev) {
        const b = bucket(answers, gameId);
        const current = b.get(a.questionId) ?? null;
        const currentRev = current && current.questionRev === a.questionRev ? current.rev : 0;
        if (currentRev !== expectedRev) return { ok: false, current: clone(current) };
        b.set(a.questionId, clone(a));
        return { ok: true };
      },
      async delete(gameId, qid) { bucket(answers, gameId).delete(qid); },
    },
    rounds: {
      async list(gameId) { return clone([...bucket(rounds, gameId).values()].sort((a, b) => a.n - b.n)); },
      async get(gameId, id) { return clone(bucket(rounds, gameId).get(id) ?? null); },
      async set(gameId, r) { bucket(rounds, gameId).set(r.id, clone(r)); },
      async delete(gameId, id) { bucket(rounds, gameId).delete(id); },
    },
    events: {
      async has(gameId, id) { return bucket(events, gameId).has(id); },
      async add(gameId, e) { bucket(events, gameId).set(e.id, clone(e)); },
      async list(gameId) { return clone([...bucket(events, gameId).values()].sort((a, b) => a.seq - b.seq)); },
    },
    tokens: {
      async get(hash) { return clone(tokens.get(hash) ?? null); },
      async set(t) { tokens.set(t.hash, clone(t)); },
      async delete(hash) { tokens.delete(hash); },
    },
    projections: {
      async get(gameId) { return clone(projections.get(gameId) ?? null); },
      async set(p) { projections.set(p.gameId, clone(p)); },
      async delete(gameId) { projections.delete(gameId); },
    },
    snapshots: {
      async add(gameId, s, keep) {
        const list = snapshots.get(gameId) ?? [];
        list.push(clone(s));
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        snapshots.set(gameId, list.slice(0, keep));
      },
      async latest(gameId) { return clone(snapshots.get(gameId)?.[0] ?? null); },
    },
    dump() { return { users: [...users.values()], games: [...games.values()] }; },
  };
}
