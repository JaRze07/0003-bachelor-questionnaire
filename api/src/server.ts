import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { getRepo } from './repo/index.js';
import { createPlayVerifier } from './domain/play.js';

const repo = await getRepo();
const curatedDir = new URL('../curated/', import.meta.url);

const app = createApp({
  repo,
  play: createPlayVerifier(),
  curated: async (lang) => {
    try { return JSON.parse(await readFile(new URL(`${lang}.json`, curatedDir), 'utf8')).questions; } catch { return null; }
  },
});

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: `api listening on ${port}`, repo: process.env.REPO ?? 'firestore', devAuth: process.env.DEV_AUTH === '1' }));
});
