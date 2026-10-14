import assert from 'node:assert/strict';
import test from 'node:test';

import { searchRepository, type SearchDependencies } from '../src/search.js';

const scope = {
  filesProcessed: 1,
  warnings: [],
  regions: [{ filePath: 'src/auth.ts', startLine: 2, endLine: 4, text: 'throw new Error("expired")' }],
};

test('returns real region metadata from a successful retrieval', async () => {
  const dependencies: SearchDependencies = {
    prepare: async () => scope,
    createEmbedder: async () => ({ embed: async () => [[1, 0], [1, 0]] }),
  };
  const result = await searchRepository('reject old sessions', '/repo', dependencies);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.candidates[0], { ...scope.regions[0], score: 1 });
});

test('distinguishes an unsupported empty source scope', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => ({ filesProcessed: 0, warnings: [], regions: [] }),
    createEmbedder: async () => { throw new Error('must not load'); },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: 'unsupported-source-scope',
    message: 'No supported JavaScript or TypeScript source content was found.',
  });
});

test('reports retrieval failure without claiming relevant code is absent', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => scope,
    createEmbedder: async () => { throw new Error('model unavailable'); },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'processing-failed');
    assert.match(result.message, /does not mean relevant code is absent/);
  }
});

test('makes limiting warnings visible when no source region can be searched', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => ({ filesProcessed: 0, warnings: ['Skipped huge.ts: exceeds limit.'], regions: [] }),
    createEmbedder: async () => { throw new Error('must not load'); },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Coverage warnings: Skipped huge\.ts/);
});

test('reports source processing failures as operational errors', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => { throw new Error('read denied'); },
    createEmbedder: async () => { throw new Error('must not load'); },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /could not process.*read denied/i);
});
