import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CachingEmbedder,
  retrieveHybridCandidates,
  retrieveLexicalCandidates,
  cosineSimilarity,
  retrieveCandidates,
  selectDisplayCandidates,
  type Embedder,
} from '../src/retrieval.js';

test('orders source candidates using supplied semantic vectors', async () => {
  const embedder: Embedder = { embed: async () => [[1, 0], [0, 1], [0.9, 0.1]] };
  const candidates = await retrieveCandidates('expired session', [
    { filePath: 'src/log.ts', startLine: 1, endLine: 1, text: 'write log' },
    { filePath: 'src/session.ts', startLine: 7, endLine: 9, text: 'deny stale credentials' },
  ], embedder);
  assert.equal(candidates[0]?.filePath, 'src/session.ts');
  assert.equal(candidates[0]?.startLine, 7);
});

test('lexical and hybrid retrieval retain exact camelCase identifiers when semantic ranking misses', async () => {
  const regions = [
    { filePath: 'src/noise.ts', startLine: 1, endLine: 1, text: 'export const unrelated = true;' },
    { filePath: 'src/auth.ts', startLine: 3, endLine: 3, text: 'export function verifyToken() {}' },
  ];
  assert.equal(retrieveLexicalCandidates('verify token', regions)[0]?.filePath, 'src/auth.ts');
  const result = await retrieveHybridCandidates('verifyToken', regions, { embed: async () => [[1, 0], [1, 0], [0, 1]] });
  assert.equal(result[0]?.filePath, 'src/auth.ts');
});

test('rejects malformed vectors instead of fabricating a score', () => {
  assert.throws(() => cosineSimilarity([1], [1, 2]), /same non-zero length/);
});

test('display policy withholds only non-positive alignment without claiming relevance', () => {
  const selection = selectDisplayCandidates([
    { filePath: 'positive.ts', startLine: 1, endLine: 1, text: 'positive', score: 0.01 },
    { filePath: 'orthogonal.ts', startLine: 1, endLine: 1, text: 'zero', score: 0 },
    { filePath: 'negative.ts', startLine: 1, endLine: 1, text: 'negative', score: -0.2 },
  ]);
  assert.deepEqual(selection.candidates.map(candidate => candidate.filePath), ['positive.ts']);
  assert.equal(selection.withheldCount, 2);
});

test('reuses exact embedding inputs and re-embeds only changed regions', async () => {
  const embedded: string[][] = [];
  const cache = new CachingEmbedder({
    embed: async texts => {
      embedded.push([...texts]);
      return texts.map((_, index) => [index + 1, 0]);
    },
  });
  const original = { filePath: 'src/auth.ts', startLine: 1, endLine: 1, text: 'allow user' };

  await retrieveCandidates('find auth', [original], cache);
  await retrieveCandidates('find auth', [original], cache);
  await retrieveCandidates('find auth', [{ ...original, text: 'deny user' }], cache);

  assert.deepEqual(embedded, [
    ['find auth', 'File: src/auth.ts\nallow user'],
    ['File: src/auth.ts\ndeny user'],
  ]);
  assert.deepEqual(cache.getStats(), { hits: 3, misses: 3, entries: 3 });
});

test('shares in-flight embedding work and recovers after an embedding failure', async () => {
  let calls = 0;
  let rejectFirst: ((error: Error) => void) | undefined;
  const cache = new CachingEmbedder({
    embed: async texts => {
      calls += 1;
      if (calls === 1) return new Promise<number[][]>((_, reject) => { rejectFirst = reject; });
      return texts.map(() => [1, 0]);
    },
  });

  const first = cache.embed(['same text']);
  const second = cache.embed(['same text']);
  assert.equal(calls, 1);
  rejectFirst?.(new Error('temporary failure'));
  await assert.rejects(first, /temporary failure/);
  await assert.rejects(second, /temporary failure/);

  assert.deepEqual(await cache.embed(['same text']), [[1, 0]]);
  assert.equal(calls, 2);
});
