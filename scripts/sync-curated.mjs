// Copies web/curated/*.json (the master) into api/curated/ so the API can ship them in its Docker image.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
const src = new URL('../web/curated/', import.meta.url);
const dst = new URL('../api/curated/', import.meta.url);
await mkdir(dst, { recursive: true });
for (const f of await readdir(src)) if (f.endsWith('.json')) await copyFile(new URL(f, src), new URL(f, dst));
console.log('curated sets copied to api/curated/');
