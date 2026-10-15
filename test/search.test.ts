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
  if (result.ok) {
    assert.equal(result.outcome, 'candidates');
    assert.equal(result.withheldCandidates, 0);
    assert.deepEqual(result.candidates[0], { ...scope.regions[0], score: 1 });
  }
});

test('keeps an exact identifier visible when its cosine similarity is negative', async () => {
  const result = await searchRepository('verifyToken', '/repo', {
    prepare: async () => ({ filesProcessed: 2, warnings: [], regions: [
      { filePath: 'src/noise.ts', startLine: 1, endLine: 1, text: 'export const unrelated = true;' },
      { filePath: 'src/auth.ts', startLine: 4, endLine: 4, text: 'export function verifyToken() {}' },
    ] }),
    createEmbedder: async () => ({ embed: async () => [[1, 0], [1, 0], [-1, 0]] }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, 'candidates');
    assert.equal(result.candidates[0]?.filePath, 'src/auth.ts');
    assert.equal(result.candidates[0]?.score, -1);
    assert.equal(result.candidates[0]?.lexicalEvidence, true);
  }
});

test('retains weak positive alignment as explicitly uncertain inspectable evidence', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => scope,
    createEmbedder: async () => ({ embed: async () => [[1, 0], [0.01, Math.sqrt(0.9999)]] }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, 'candidates');
    assert.ok((result.candidates[0]?.score ?? 1) > 0);
    assert.ok((result.candidates[0]?.score ?? 1) < 0.02);
  }
});

test('returns an honest no-supported-candidate outcome for non-positive alignment', async () => {
  const result = await searchRepository('query', '/repo', {
    prepare: async () => scope,
    createEmbedder: async () => ({ embed: async () => [[1, 0], [-1, 0]] }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, 'no-supported-candidate');
    assert.deepEqual(result.candidates, []);
    assert.equal(result.withheldCandidates, 1);
  }
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

test('preserves incomplete coverage warnings with candidate outcomes', async () => {
  const warning = 'File limit reached (1); some supported files were not processed.';
  const result = await searchRepository('query', '/repo', {
    prepare: async () => ({ ...scope, warnings: [warning] }),
    createEmbedder: async () => ({ embed: async () => [[1, 0], [1, 0]] }),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.scope.warnings, [warning]);
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
