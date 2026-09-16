import { Firestore } from '@google-cloud/firestore';
import { createHash } from 'node:crypto';
import type { Answer, Game, GameEvent, Projection, Purchase, Question, Repo, Round, Snapshot, TokenDoc, User } from './types.js';

/**
 * Firestore repository. Layout (see specs/001-bachelor-questionnaire/data-model.md):
 * users/{uid}, purchases/{token}, games/{id}/{questions,answers,rounds,events,snapshots}/*,
 * games/{id}/public/summary, tokens/{sha256}.
 * Undefined fields are stripped (Firestore rejects them).
 */
/** Purchase tokens can exceed the 1500-byte document-id limit and may contain '/', so they are hashed. */
const purchaseKey = (token: string) => createHash('sha256').update(token).digest('hex');

export function createFirestoreRepo(db = new Firestore({ ignoreUndefinedProperties: true })): Repo {
  const games = db.collection('games');
  const col = (gameId: string, name: string) => games.doc(gameId).collection(name);
  const data = <T>(snap: FirebaseFirestore.DocumentSnapshot): T | null => (snap.exists ? (snap.data() as T) : null);
  const all = async <T>(q: FirebaseFirestore.Query): Promise<T[]> => (await q.get()).docs.map((d) => d.data() as T);

  async function deleteCollection(ref: FirebaseFirestore.CollectionReference) {
    let snap = await ref.limit(200).get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      snap = await ref.limit(200).get();
    }
  }

  return {
    users: {
      async get(uid) { return data<User>(await db.collection('users').doc(uid).get()); },
      async set(u) { await db.collection('users').doc(u.uid).set(u); },
      async update(uid, fields) { await db.collection('users').doc(uid).set(fields, { merge: true }); },
    },
    purchases: {
      async get(token) { return data<Purchase>(await db.collection('purchases').doc(purchaseKey(token)).get()); },
      async set(p) { await db.collection('purchases').doc(purchaseKey(p.token)).set(p); },
      async listByUid(uid) { return all<Purchase>(db.collection('purchases').where('uid', '==', uid).limit(500)); },
      async claim(token, uid) {
        const ref = db.collection('purchases').doc(purchaseKey(token));
        return db.runTransaction(async (trx) => {
          const snap = await trx.get(ref);
          const existing = snap.exists ? (snap.data() as Purchase) : null;
          if (existing && existing.uid !== uid) return { ok: false as const, uid: existing.uid };
          if (!existing) {
            const now = new Date().toISOString();
            trx.create(ref, { token, uid, platform: 'play', productId: '', state: 'pending', boundAt: now, verifiedAt: now } satisfies Purchase);
          }
          return { ok: true as const };
        });
      },
      async release(token, uid) {
        const ref = db.collection('purchases').doc(purchaseKey(token));
        await db.runTransaction(async (trx) => {
          const snap = await trx.get(ref);
          const existing = snap.exists ? (snap.data() as Purchase) : null;
          if (existing && existing.uid === uid && existing.productId === '') trx.delete(ref);
        });
      },
    },
    games: {
      async get(id) { return data<Game>(await games.doc(id).get()); },
      async set(g) { await games.doc(g.id).set(g); },
      async update(id, fields) { await games.doc(id).set(fields, { merge: true }); },
      async listByHost(uid) { return all<Game>(games.where('hostUid', '==', uid)); },
      async listIdleBefore(iso) { return all<Game>(games.where('lastActivityAt', '<', iso).limit(500)); },
      async deleteTree(id) {
        const tokenSnap = await db.collection('tokens').where('gameId', '==', id).get();
        for (const d of tokenSnap.docs) await d.ref.delete();
        for (const name of ['questions', 'answers', 'rounds', 'events', 'snapshots', 'public']) await deleteCollection(col(id, name));
        await games.doc(id).delete();
      },
    },
    questions: {
      async list(gameId) { return all<Question>(col(gameId, 'questions').orderBy('order')); },
      async get(gameId, id) { return data<Question>(await col(gameId, 'questions').doc(id).get()); },
      async set(gameId, q) { await col(gameId, 'questions').doc(q.id).set(q); },
      async setMany(gameId, qs) {
        for (let i = 0; i < qs.length; i += 400) {
          const batch = db.batch();
          qs.slice(i, i + 400).forEach((q) => batch.set(col(gameId, 'questions').doc(q.id), q));
          await batch.commit();
        }
      },
      async delete(gameId, id) { await col(gameId, 'questions').doc(id).delete(); },
    },
    answers: {
      async list(gameId) { return all<Answer>(col(gameId, 'answers')); },
      async get(gameId, qid) { return data<Answer>(await col(gameId, 'answers').doc(qid).get()); },
      async set(gameId, a) { await col(gameId, 'answers').doc(a.questionId).set(a); },
      async setIfRev(gameId, a, expectedRev) {
        const ref = col(gameId, 'answers').doc(a.questionId);
        return db.runTransaction(async (trx) => {
          const snap = await trx.get(ref);
          const current = snap.exists ? (snap.data() as Answer) : null;
          const currentRev = current && current.questionRev === a.questionRev ? current.rev : 0;
          if (currentRev !== expectedRev) return { ok: false as const, current };
          trx.set(ref, a);
          return { ok: true as const };
        });
      },
      async release(token, uid) {
        const ref = db.collection('purchases').doc(purchaseKey(token));
        await db.runTransaction(async (trx) => {
          const snap = await trx.get(ref);
          const existing = snap.exists ? (snap.data() as Purchase) : null;
          if (existing && existing.uid === uid && existing.productId === '') trx.delete(ref);
        });
      },
      async delete(gameId, qid) { await col(gameId, 'answers').doc(qid).delete(); },
    },
    rounds: {
      async list(gameId) { return all<Round>(col(gameId, 'rounds').orderBy('n')); },
      async get(gameId, id) { return data<Round>(await col(gameId, 'rounds').doc(id).get()); },
      async set(gameId, r) { await col(gameId, 'rounds').doc(r.id).set(r); },
      async delete(gameId, id) { await col(gameId, 'rounds').doc(id).delete(); },
    },
    events: {
      async has(gameId, id) { return (await col(gameId, 'events').doc(id).get()).exists; },
      async add(gameId, e) { await col(gameId, 'events').doc(e.id).set(e); },
      async list(gameId) { return all<GameEvent>(col(gameId, 'events').orderBy('seq')); },
    },
    tokens: {
      async get(hash) { return data<TokenDoc>(await db.collection('tokens').doc(hash).get()); },
      async set(t) { await db.collection('tokens').doc(t.hash).set(t); },
      async delete(hash) { await db.collection('tokens').doc(hash).delete(); },
    },
    projections: {
      async get(gameId) { return data<Projection>(await col(gameId, 'public').doc('summary').get()); },
      async set(p) { await col(p.gameId, 'public').doc('summary').set(p); },
      async delete(gameId) { await col(gameId, 'public').doc('summary').delete(); },
    },
    snapshots: {
      async add(gameId, s, keep) {
        await col(gameId, 'snapshots').doc(s.id).set(s);
        const old = await col(gameId, 'snapshots').orderBy('createdAt', 'desc').offset(keep).get();
        for (const d of old.docs) await d.ref.delete();
      },
      async latest(gameId) {
        const snap = await col(gameId, 'snapshots').orderBy('createdAt', 'desc').limit(1).get();
        return snap.empty ? null : (snap.docs[0].data() as Snapshot);
      },
    },
  };
}
