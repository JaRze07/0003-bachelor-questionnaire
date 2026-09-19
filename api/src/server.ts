import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { getRepo } from './repo/index.js';
import { createPlayVerifier } from './domain/play.js';
import { createGoogleVerifier } from './domain/google.js';

// A production container must never accept development sign-in or fake purchases.
if (process.env.NODE_ENV === 'production' && (process.env.DEV_AUTH === '1' || process.env.PLAY_FAKE === '1')) {
  console.error(JSON.stringify({ severity: 'CRITICAL', message: 'DEV_AUTH and PLAY_FAKE are not allowed in production' }));
  process.exit(1);
}

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
  setTimeout(async () => { await housekeeping(); await backup(); }, 60_000).unref();
  setInterval(housekeeping, 6 * HOUR).unref();
  setInterval(backup, 24 * HOUR).unref();
}

/* ---- the pages: host app, partner form and guest page come from the same origin as the API ---- */
const webDir = process.env.WEB_DIR;
if (webDir) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "frame-src https://accounts.google.com/gsi/",
    "connect-src 'self' https://accounts.google.com/gsi/",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    "img-src 'self' data: https://*.googleusercontent.com",
    "frame-ancestors 'none'",
  ].join('; ');

  // Runtime configuration comes from the environment, so a deploy never rewrites a file in the image.
  app.get('/config.js', (c) => {
    const config = {
      API_BASE: '',                                   // same origin
      GOOGLE_CLIENT_ID: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
      AD_UNIT_BANNER: process.env.AD_UNIT_BANNER ?? '',
      AD_UNIT_INTERSTITIAL: process.env.AD_UNIT_INTERSTITIAL ?? '',
    };
    const body = Object.entries(config).map(([k, v]) => `globalThis.${k} = ${JSON.stringify(v)};`).join('\n')
      + '\nglobalThis.API_BASE = globalThis.API_BASE || location.origin;\n';
    return c.body(body, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  });

  app.use('/*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/v1/')) return;
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', csp);
    // Pages that carry a bearer link must never be cached or indexed; the rest may be revalidated.
    const linkPage = /\/(partner|spectator)(\.html)?$/.test(c.req.path);
    c.header('Cache-Control', linkPage ? 'no-store' : 'no-cache');
    if (linkPage) c.header('X-Robots-Tag', 'noindex, nofollow');
  });
  app.use('/*', serveStatic({ root: webDir }));
}

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: `api listening on ${port}`, repo: process.env.REPO ?? 'sqlite', devAuth: process.env.DEV_AUTH === '1' }));
});
