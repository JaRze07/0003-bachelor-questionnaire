import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Answer, Game, GameEvent, Projection, Purchase, Question, Repo, Round, Session, Snapshot, TokenDoc, User } from './types.js';

/**
 * SQLite repository: one file, one table. Every entity is a JSON document keyed by (kind, parent, id), where
 * `parent` is the game id for everything that belongs to a game. Expression indexes cover the few lookups that
 * are not by key. The API runs as a single process, so writes are serialised by an in-process mutex and wrapped
 * in real transactions (`tx`).
 */
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS docs (
    kind   TEXT NOT NULL,
    parent TEXT NOT NULL,
    id     TEXT NOT NULL,
    data   TEXT NOT NULL,
    PRIMARY KEY (kind, parent, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS docs_game_host ON docs (json_extract(data, '$.hostUid')) WHERE kind = 'games';
  CREATE INDEX IF NOT EXISTS docs_game_idle ON docs (json_extract(data, '$.lastActivityAt')) WHERE kind = 'games';
  CREATE INDEX IF NOT EXISTS docs_purchase_uid ON docs (json_extract(data, '$.uid')) WHERE kind = 'purchases';
  CREATE INDEX IF NOT EXISTS docs_token_game ON docs (json_extract(data, '$.gameId')) WHERE kind = 'tokens';
  CREATE INDEX IF NOT EXISTS docs_session_exp ON docs (json_extract(data, '$.expiresAt')) WHERE kind = 'sessions';
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

const GAME_KINDS = ['questions', 'answers', 'rounds', 'events', 'snapshots', 'projections', 'tokens'] as const;

export function createSqliteRepo(path = process.env.DB_PATH ?? './data/bachelor.db'): Repo & { close(): void; backup(to: string): Promise<void> } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Reads outside a transaction use their own read-only connection. In WAL mode it sees committed data only,
  // so a guest poll can never observe a half-applied request, whatever that request awaits. (An in-memory
  // database cannot be shared between connections; it is used by tests only and keeps the single connection.)
  const reader = path === ':memory:' ? db : new DatabaseSync(path, { readOnly: true });
  if (reader !== db) reader.exec('PRAGMA busy_timeout = 5000;');

  const READS = {
    get: 'SELECT data FROM docs WHERE kind = ? AND parent = ? AND id = ?',
    list: 'SELECT data FROM docs WHERE kind = ? AND parent = ?',
    exists: 'SELECT 1 AS one FROM docs WHERE kind = ? AND parent = ? AND id = ?',
    gamesByHost: "SELECT data FROM docs WHERE kind = 'games' AND json_extract(data, '$.hostUid') = ?",
    gamesIdle: "SELECT data FROM docs WHERE kind = 'games' AND json_extract(data, '$.lastActivityAt') < ? LIMIT 500",
    purchasesByUid: "SELECT data FROM docs WHERE kind = 'purchases' AND json_extract(data, '$.uid') = ?",
    snapshotsOf: "SELECT id, data FROM docs WHERE kind = 'snapshots' AND parent = ? ORDER BY json_extract(data, '$.createdAt') DESC",
  } as const;
  type ReadName = keyof typeof READS;
  const prepared = (conn: DatabaseSync) => Object.fromEntries(
    Object.entries(READS).map(([name, sql]) => [name, conn.prepare(sql)]),
  ) as Record<ReadName, ReturnType<DatabaseSync['prepare']>>;
  const onWriter = prepared(db);
  const onReader = reader === db ? onWriter : prepared(reader);

  const q = {
    get: db.prepare('SELECT data FROM docs WHERE kind = ? AND parent = ? AND id = ?'),
    put: db.prepare('INSERT INTO docs (kind, parent, id, data) VALUES (?, ?, ?, ?) ON CONFLICT (kind, parent, id) DO UPDATE SET data = excluded.data'),
    insert: db.prepare('INSERT INTO docs (kind, parent, id, data) VALUES (?, ?, ?, ?)'),
    del: db.prepare('DELETE FROM docs WHERE kind = ? AND parent = ? AND id = ?'),
    list: db.prepare('SELECT data FROM docs WHERE kind = ? AND parent = ?'),
    exists: db.prepare('SELECT 1 AS one FROM docs WHERE kind = ? AND parent = ? AND id = ?'),
    delParent: db.prepare('DELETE FROM docs WHERE kind = ? AND parent = ?'),
    gamesByHost: db.prepare("SELECT data FROM docs WHERE kind = 'games' AND json_extract(data, '$.hostUid') = ?"),
    gamesIdle: db.prepare("SELECT data FROM docs WHERE kind = 'games' AND json_extract(data, '$.lastActivityAt') < ? LIMIT 500"),
    purchasesByUid: db.prepare("SELECT data FROM docs WHERE kind = 'purchases' AND json_extract(data, '$.uid') = ?"),
    sessionsExpired: db.prepare("DELETE FROM docs WHERE kind = 'sessions' AND json_extract(data, '$.expiresAt') < ?"),
    tokensOfGame: db.prepare("DELETE FROM docs WHERE kind = 'tokens' AND json_extract(data, '$.gameId') = ?"),
    snapshotsOf: db.prepare("SELECT id, data FROM docs WHERE kind = 'snapshots' AND parent = ? ORDER BY json_extract(data, '$.createdAt') DESC"),
  };

  /* ---- transactions: one writer at a time, real BEGIN/COMMIT ---- */
  const inTx = new AsyncLocalStorage<true>();
  /** Inside a transaction read your own writes; outside, read committed data from the read-only connection. */
  const r = () => (inTx.getStore() ? onWriter : onReader);

  const parse = <T>(row: unknown): T | null => (row ? (JSON.parse((row as { data: string }).data) as T) : null);
  const rows = <T>(list: unknown[]): T[] => list.map((row) => JSON.parse((row as { data: string }).data) as T);
  const get = <T>(kind: string, parent: string, id: string) => parse<T>(r().get.get(kind, parent, id));
  const put = (kind: string, parent: string, id: string, value: unknown) => { q.put.run(kind, parent, id, JSON.stringify(value)); };
  const list = <T>(kind: string, parent: string) => rows<T>(r().list.all(kind, parent));
  let queue: Promise<unknown> = Promise.resolve();

  async function tx<T>(fn: () => Promise<T>): Promise<T> {
    if (inTx.getStore()) return fn();                       // nested: join the outer transaction
    const run = queue.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await inTx.run(true, fn);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    });
    queue = run.catch(() => undefined);                     // a failed transaction must not block the next one
    return run;
  }

  /** A single write outside a transaction still waits its turn, so it can never land inside someone else's. */
  const write = <T>(fn: () => T): Promise<T> => (inTx.getStore() ? Promise.resolve(fn()) : tx(async () => fn()));

  return {
    tx,
    close() { if (reader !== db) reader.close(); db.close(); },
    /** Online backup from the read connection: a committed snapshot, never in the way of the writer. */
    async backup(to: string) {
      const { backup } = await import('node:sqlite');
      await backup(reader, to);
    },

    sessions: {
      async get(id) { return get<Session>('sessions', '', id); },
      set: (s) => write(() => put('sessions', '', s.id, s)),
      delete: (id) => write(() => { q.del.run('sessions', '', id); }),
      deleteExpired: (now) => write(() => Number(q.sessionsExpired.run(now).changes)),
    },
    users: {
      async get(uid) { return get<User>('users', '', uid); },
      set: (u) => write(() => put('users', '', u.uid, u)),
      update: (uid, fields) => write(() => {
        const current = get<User>('users', '', uid);
        if (current) put('users', '', uid, { ...current, ...fields });
      }),
    },
    purchases: {
      async get(token) { return get<Purchase>('purchases', '', token); },
      set: (p) => write(() => put('purchases', '', p.token, p)),
      async listByUid(uid) { return rows<Purchase>(r().purchasesByUid.all(uid)); },
      claim: (token, uid) => write(() => {
        const existing = get<Purchase>('purchases', '', token);
        if (existing && existing.uid !== uid) return { ok: false as const, uid: existing.uid };
        if (!existing) {
          const now = new Date().toISOString();
          put('purchases', '', token, { token, uid, platform: 'play', productId: '', state: 'pending', boundAt: now, verifiedAt: now } satisfies Purchase);
        }
        return { ok: true as const };
      }),
      release: (token, uid) => write(() => {
        const existing = get<Purchase>('purchases', '', token);
        if (existing && existing.uid === uid && existing.productId === '') q.del.run('purchases', '', token);
      }),
    },
    games: {
      async get(id) { return get<Game>('games', '', id); },
      set: (g) => write(() => put('games', '', g.id, g)),
      update: (id, fields) => write(() => {
        const current = get<Game>('games', '', id);
        if (current) put('games', '', id, { ...current, ...fields });
      }),
      async listByHost(uid) { return rows<Game>(r().gamesByHost.all(uid)); },
      async listIdleBefore(iso) { return rows<Game>(r().gamesIdle.all(iso)); },
      deleteTree: (id) => write(() => {
        for (const kind of GAME_KINDS) q.delParent.run(kind, id);
        q.tokensOfGame.run(id);                              // link tokens are keyed by hash, not by game
        q.del.run('games', '', id);
      }),
    },
    questions: {
      async list(gameId) { return list<Question>('questions', gameId).sort((a, b) => a.order - b.order); },
      async get(gameId, id) { return get<Question>('questions', gameId, id); },
      set: (gameId, item) => write(() => put('questions', gameId, item.id, item)),
      setMany: (gameId, items) => write(() => { for (const item of items) put('questions', gameId, item.id, item); }),
      delete: (gameId, id) => write(() => { q.del.run('questions', gameId, id); }),
    },
    answers: {
      async list(gameId) { return list<Answer>('answers', gameId); },
      async get(gameId, questionId) { return get<Answer>('answers', gameId, questionId); },
      set: (gameId, a) => write(() => put('answers', gameId, a.questionId, a)),
      setIfRev: (gameId, a, expectedRev) => write(() => {
        const current = get<Answer>('answers', gameId, a.questionId);
        const currentRev = current && current.questionRev === a.questionRev ? current.rev : 0;
        if (currentRev !== expectedRev) return { ok: false as const, current };
        put('answers', gameId, a.questionId, a);
        return { ok: true as const };
      }),
      delete: (gameId, questionId) => write(() => { q.del.run('answers', gameId, questionId); }),
    },
    rounds: {
      async list(gameId) { return list<Round>('rounds', gameId).sort((a, b) => a.n - b.n); },
      async get(gameId, id) { return get<Round>('rounds', gameId, id); },
      set: (gameId, r) => write(() => put('rounds', gameId, r.id, r)),
      delete: (gameId, id) => write(() => { q.del.run('rounds', gameId, id); }),
    },
    events: {
      async has(gameId, id) { return Boolean(r().exists.get('events', gameId, id)); },
      add: (gameId, e) => write(() => { q.insert.run('events', gameId, e.id, JSON.stringify(e)); }),
      async list(gameId) { return list<GameEvent>('events', gameId).sort((a, b) => a.seq - b.seq); },
    },
    tokens: {
      // parent = game id would make the lookup by hash a scan, so tokens live at the top level
      async get(hash) { return get<TokenDoc>('tokens', '', hash); },
      set: (t) => write(() => put('tokens', '', t.hash, t)),
      delete: (hash) => write(() => { q.del.run('tokens', '', hash); }),
    },
    projections: {
      async get(gameId) { return get<Projection>('projections', gameId, 'summary'); },
      set: (p) => write(() => put('projections', p.gameId, 'summary', p)),
      delete: (gameId) => write(() => { q.del.run('projections', gameId, 'summary'); }),
    },
    snapshots: {
      add: (gameId, s, keep) => write(() => {
        put('snapshots', gameId, s.id, s);
        const all = onWriter.snapshotsOf.all(gameId) as { id: string }[];
        for (const old of all.slice(keep)) q.del.run('snapshots', gameId, old.id);
      }),
      async latest(gameId) {
        const all = r().snapshotsOf.all(gameId) as { data: string }[];
        return all.length ? (JSON.parse(all[0].data) as Snapshot) : null;
      },
    },
  };
}
