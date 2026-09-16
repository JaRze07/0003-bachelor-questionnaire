// Versioned readiness check (spec §7): bound to the app build and the game revision.
import { storageUsable } from '../store/idb.js';
import { playable } from '../logic/queue.js';

export const APP_BUILD = '0.1.0';

export async function readinessHash(snapshot) {
  const material = JSON.stringify({
    build: APP_BUILD,
    revision: snapshot.revision,
    language: snapshot.game.language,
    rules: snapshot.game.settings,
    questions: snapshot.questions.map((q) => [q.id, q.rev]),
    answers: Object.entries(snapshot.answers ?? {}).map(([id, a]) => [id, a.rev, a.questionRev]),
  });
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
    return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0;
  for (let i = 0; i < material.length; i++) hash = (hash * 31 + material.charCodeAt(i)) | 0;
  return String(hash);
}

/**
 * Run the full check. Returns { state: 'ready'|'failed', reason?, hash }.
 * 'needs_refresh' is decided later by comparing the stored hash (see readinessState).
 */
export async function runReadiness(snapshot, catalogueLoaded) {
  const hash = await readinessHash(snapshot);
  if (!(await storageUsable())) return { state: 'failed', reason: 'storage', hash };
  if (!catalogueLoaded) return { state: 'failed', reason: 'language', hash };
  const pool = playable(snapshot.questions, snapshot.rounds ?? [], snapshot.answers ?? {}, snapshot.game.hiddenQuestionIds ?? []);
  if (!pool.length) return { state: 'failed', reason: 'no_answers', hash };
  return { state: 'ready', hash, playable: pool.length };
}

/** 'ready' | 'needs_refresh' | 'unchecked' for the badge on the game screen. */
export async function readinessState(snapshot) {
  if (!snapshot.readiness) return 'unchecked';
  const hash = await readinessHash(snapshot);
  return hash === snapshot.readiness.hash ? 'ready' : 'needs_refresh';
}
