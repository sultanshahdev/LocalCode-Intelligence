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
    assert.deepEqual(await new PersistentCachingEmbedder(fake(first), 'model:q8', dir).embed(['File: private query', source], { sourceStartIndex: 1 }), [[1, 0], [2, 0]]);
    assert.deepEqual(await new PersistentCachingEmbedder(fake(second), 'model:q8', dir).embed(['File: another private query', source], { sourceStartIndex: 1 }), [[1, 0], [2, 0]]);
    assert.deepEqual(first, [['File: private query', source]]);
    assert.deepEqual(second, [['File: another private query']]);
    // Even a query beginning with the source prefix is never persisted.
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 1);
    assert.equal((await readFile(join(dir, (await readdir(dir)).find(name => name.endsWith('.json'))!), 'utf8')).includes('private query'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('changed inputs, incompatible models, corrupt entries, and concurrent writers recompute safely', async () => {
  const dir = await cacheDirectory(); const calls: string[][] = [];
  try {
    const cache = new PersistentCachingEmbedder(fake(calls), 'model:a', dir);
    await cache.embed([source], { sourceStartIndex: 0 });
    await cache.embed(['File: src/auth.ts\nexport const auth = false;'], { sourceStartIndex: 0 });
    await new PersistentCachingEmbedder(fake(calls), 'model:b', dir).embed([source], { sourceStartIndex: 0 });
    const record = (await readdir(dir)).find(name => name.endsWith('.json'))!;
    await writeFile(join(dir, record), '{broken');
    await new PersistentCachingEmbedder(fake(calls), 'model:a', dir).embed([source], { sourceStartIndex: 0 });
    await Promise.all([new PersistentCachingEmbedder(fake(calls), 'model:c', dir).embed([source], { sourceStartIndex: 0 }), new PersistentCachingEmbedder(fake(calls), 'model:c', dir).embed([source], { sourceStartIndex: 0 })]);
    assert.equal(calls.flat().filter(text => text === source).length >= 4, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid vectors and disabled persistence fall back to inference and cache clearing is scoped', async () => {
  const dir = await cacheDirectory(); const calls: string[][] = [];
  try {
    const cache = new PersistentCachingEmbedder(fake(calls), 'model:q8', dir);
    await cache.embed([source], { sourceStartIndex: 0 });
    const record = (await readdir(dir)).find(name => name.endsWith('.json'))!;
    await writeFile(join(dir, record), JSON.stringify({ format: 1, model: 'model:q8', vector: [NaN] }));
    await cache.embed([source], { sourceStartIndex: 0 });
    // A finite but wrong-dimensional cache vector must also be rejected.
    const callsBeforeDimensionCheck = calls.length;
    await writeFile(join(dir, record), JSON.stringify({ format: 1, model: 'model:q8', vector: [1, 2, 3] }));
    await new PersistentCachingEmbedder(fake(calls), 'model:q8', dir, 2)
      .embed([source], { sourceStartIndex: 0 });
    assert.equal(calls.length, callsBeforeDimensionCheck + 1);
    await writeFile(join(dir, 'unrelated.txt'), 'must survive');
    await cache.clear();
    assert.deepEqual(await readdir(dir).catch(() => []), ['unrelated.txt']);
    const previous = process.env['LOCALCODE_DISABLE_PERSISTENT_CACHE'];
    process.env['LOCALCODE_DISABLE_PERSISTENT_CACHE'] = '1';
    try {
      await new PersistentCachingEmbedder(fake(calls), 'disabled:model', dir).embed([source], { sourceStartIndex: 0 });
      assert.equal((await readdir(dir).catch(() => [])).some(name => name.endsWith('.json')), false);
    } finally {
      if (previous === undefined) delete process.env['LOCALCODE_DISABLE_PERSISTENT_CACHE']; else process.env['LOCALCODE_DISABLE_PERSISTENT_CACHE'] = previous;
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
