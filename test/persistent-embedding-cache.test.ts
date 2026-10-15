import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentCachingEmbedder } from '../src/persistent-embedding-cache.js';

const source = 'File: src/auth.ts\nexport const auth = true;';

async function cacheDirectory(): Promise<string> { return mkdtemp(join(tmpdir(), 'localcode-embedding-cache-')); }
function fake(calls: string[][]) { return { embed: async (texts: readonly string[]) => { calls.push([...texts]); return texts.map((_, i) => [i + 1, 0]); } }; }

test('persistent cache reuses source embeddings after restart without persisting queries', async () => {
  const dir = await cacheDirectory(); const first: string[][] = []; const second: string[][] = [];
  try {
    assert.deepEqual(await new PersistentCachingEmbedder(fake(first), 'model:q8', dir).embed(['private query', source]), [[1, 0], [2, 0]]);
    assert.deepEqual(await new PersistentCachingEmbedder(fake(second), 'model:q8', dir).embed(['another private query', source]), [[1, 0], [2, 0]]);
    assert.deepEqual(first, [['private query', source]]);
    assert.deepEqual(second, [['another private query']]);
    assert.equal((await readFile(join(dir, (await readdir(dir)).find(name => name.endsWith('.json'))!), 'utf8')).includes('private query'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('changed inputs, incompatible models, corrupt entries, and concurrent writers recompute safely', async () => {
  const dir = await cacheDirectory(); const calls: string[][] = [];
  try {
    const cache = new PersistentCachingEmbedder(fake(calls), 'model:a', dir);
    await cache.embed([source]);
    await cache.embed(['File: src/auth.ts\nexport const auth = false;']);
    await new PersistentCachingEmbedder(fake(calls), 'model:b', dir).embed([source]);
    const record = (await readdir(dir)).find(name => name.endsWith('.json'))!;
    await writeFile(join(dir, record), '{broken');
    await new PersistentCachingEmbedder(fake(calls), 'model:a', dir).embed([source]);
    await Promise.all([new PersistentCachingEmbedder(fake(calls), 'model:c', dir).embed([source]), new PersistentCachingEmbedder(fake(calls), 'model:c', dir).embed([source])]);
    assert.equal(calls.flat().filter(text => text === source).length >= 4, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid vectors and disabled persistence fall back to inference and cache clearing is scoped', async () => {
  const dir = await cacheDirectory(); const calls: string[][] = [];
  try {
    const cache = new PersistentCachingEmbedder(fake(calls), 'model:q8', dir);
    await cache.embed([source]);
    const record = (await readdir(dir)).find(name => name.endsWith('.json'))!;
    await writeFile(join(dir, record), JSON.stringify({ format: 1, model: 'model:q8', vector: [NaN] }));
    await cache.embed([source]);
    await cache.clear();
    assert.deepEqual(await readdir(dir).catch(() => []), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
