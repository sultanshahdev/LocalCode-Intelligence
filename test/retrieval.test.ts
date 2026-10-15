import assert from 'node:assert/strict';
import test from 'node:test';

import { cosineSimilarity, retrieveCandidates, selectDisplayCandidates, type Embedder } from '../src/retrieval.js';

test('orders source candidates using supplied semantic vectors', async () => {
  const embedder: Embedder = { embed: async () => [[1, 0], [0, 1], [0.9, 0.1]] };
  const candidates = await retrieveCandidates('expired session', [
    { filePath: 'src/log.ts', startLine: 1, endLine: 1, text: 'write log' },
    { filePath: 'src/session.ts', startLine: 7, endLine: 9, text: 'deny stale credentials' },
  ], embedder);
  assert.equal(candidates[0]?.filePath, 'src/session.ts');
  assert.equal(candidates[0]?.startLine, 7);
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
