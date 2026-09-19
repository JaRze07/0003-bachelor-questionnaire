import type { Repo } from './types.js';
import { createMemoryRepo } from './memory.js';

let cached: Repo | null = null;

/** REPO=memory for tests and quick local runs; otherwise SQLite at DB_PATH (default ./data/bachelor.db). */
export async function getRepo(): Promise<Repo> {
  if (cached) return cached;
  if ((process.env.REPO ?? 'sqlite') === 'memory') {
    cached = createMemoryRepo();
  } else {
    const { createSqliteRepo } = await import('./sqlite.js');
    cached = createSqliteRepo();
  }
  return cached;
}

export function setRepo(repo: Repo) { cached = repo; }
