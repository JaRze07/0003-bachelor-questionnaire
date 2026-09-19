import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { getRepo } from './repo/index.js';
import { createPlayVerifier } from './domain/play.js';
import { createGoogleVerifier } from './domain/google.js';

const repo = await getRepo();
const curatedDir = new URL('../curated/', import.meta.url);

const app = createApp({
  repo,
  play: createPlayVerifier(),
  google: createGoogleVerifier(),
  curated: async (lang) => {
    try { return JSON.parse(await readFile(new URL(`${lang}.json`, curatedDir), 'utf8')).questions; } catch { return null; }
  },
});

/* ---- housekeeping that used to need Cloud Scheduler: it now runs inside the one process ---- */
const HOUR = 3600_000;

async function housekeeping() {
  try {
    const { runRetention } = await import('./jobs/retention.js');
    const retention = await runRetention(repo);
    const sessions = await repo.sessions.deleteExpired(new Date().toISOString());
    console.log(JSON.stringify({ severity: 'INFO', message: 'housekeeping', ...retention, expiredSessions: sessions }));
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'housekeeping failed', error: String(err) }));
  }
}

/** Online backup of the database file: one per day, the newest BACKUP_KEEP (14) are kept. */
async function backup() {
  const store = repo as unknown as { backup?: (to: string) => Promise<void> };
  const dir = process.env.BACKUP_DIR;
  if (!store.backup || !dir) return;
  try {
    const { mkdir, readdir, unlink } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const name = `bachelor-${new Date().toISOString().slice(0, 10)}.db`;
    await store.backup(`${dir}/${name}`);
    const keep = Number(process.env.BACKUP_KEEP ?? 14);
    const files = (await readdir(dir)).filter((f) => /^bachelor-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse();
    for (const old of files.slice(keep)) await unlink(`${dir}/${old}`);
    console.log(JSON.stringify({ severity: 'INFO', message: 'backup written', file: name, kept: Math.min(files.length, keep) }));
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'backup failed', error: String(err) }));
  }
}

if (process.env.HOUSEKEEPING !== 'off') {
  setTimeout(() => { housekeeping(); backup(); }, 60_000).unref();
  setInterval(housekeeping, 6 * HOUR).unref();
  setInterval(backup, 24 * HOUR).unref();
}

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: `api listening on ${port}`, repo: process.env.REPO ?? 'sqlite', devAuth: process.env.DEV_AUTH === '1' }));
});
