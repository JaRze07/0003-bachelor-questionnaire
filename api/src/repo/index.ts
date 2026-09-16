import type { Repo } from './types.js';
import { createMemoryRepo } from './memory.js';

let cached: Repo | null = null;

/** REPO=memory → in-memory; otherwise Firestore (ADC credentials on Cloud Run, emulator via FIRESTORE_EMULATOR_HOST). */
export async function getRepo(): Promise<Repo> {
  if (cached) return cached;
  if ((process.env.REPO ?? 'firestore') === 'memory') {
    cached = createMemoryRepo();
  } else {
    const { createFirestoreRepo } = await import('./firestore.js');
    cached = createFirestoreRepo();
  }
  return cached;
}

export function setRepo(repo: Repo) { cached = repo; }
