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

test('qualified symbol queries prefer implementations over example calls', async () => {
  const regions = [
    { filePath: 'test/app.listen.js', startLine: 1, endLine: 2, text: 'const app = createApp(); app.listen(3000);' },
    { filePath: 'examples/demo.js', startLine: 1, endLine: 2, text: 'app.listen(5000);' },
    { filePath: 'lib/application.js', startLine: 15, endLine: 20, text: 'app.listen = function listen() { return server.listen(); };' },
  ];
  const lexical = retrieveLexicalCandidates('app.listen', regions);
  assert.equal(lexical[0]?.filePath, 'lib/application.js');
  assert.equal(lexical[0]?.evidenceClass, 'exact-identifier');

  const hybrid = await retrieveHybridCandidates('app.listen', regions, {
    embed: async () => [[1, 0], [1, 0], [1, 0], [-1, 0]],
  });
  assert.equal(hybrid[0]?.filePath, 'lib/application.js');
  assert.equal(hybrid[0]?.score, -1);

  const incidental = retrieveLexicalCandidates('app.listen', [
    { filePath: 'other.ts', startLine: 1, endLine: 1, text: 'const app = {}; const listen = true;' },
  ]);
  assert.notEqual(incidental[0]?.evidenceClass, 'exact-identifier');
});

test('anonymous default-export implementation beats a named importer for a basename query', async () => {
  const regions = [
    { filePath: 'lib/core/HeaderCollection.js', startLine: 1, endLine: 3,
      text: "import parseResponseHeaders from '../helpers/parseResponseHeaders.js'; export const use = () => parseResponseHeaders('');" },
    { filePath: 'lib/helpers/parseResponseHeaders.js', startLine: 1, endLine: 5,
      text: "export default (rawHeaders) => { if (!rawHeaders) return {}; return { rawHeaders }; }" },
  ];
  const query = 'parseResponseHeaders';
  const embedder: Embedder = { embed: async () => [[1, 0], [1, 0], [1, 0]] };
  assert.equal((await retrieveHybridCandidates(query, regions, embedder))[0]?.filePath, 'lib/helpers/parseResponseHeaders.js');
});

test('CommonJS require aliases are references, not function definitions', async () => {
  const regions = [
    { filePath: 'lib/fallback.js', startLine: 1, endLine: 6,
      text: "const Response = require('./response'); function fallback() { return new Response(); }" },
    { filePath: 'lib/response.js', startLine: 1, endLine: 6,
      text: 'function Response(raw) { this.raw = raw; } module.exports = Response;' },
  ];
  const embedder: Embedder = { embed: async () => [[1, 0], [1, 0], [1, 0]] };
  assert.equal((await retrieveHybridCandidates('Response', regions, embedder))[0]?.filePath, 'lib/response.js');
});

test('named Symbol object properties are definitions rather than imported references', async () => {
  const regions = [
    { filePath: 'lib/handler.js', startLine: 1, endLine: 4,
      text: "const {kRouteState} = require('./symbols'); function run(request) { return request[kRouteState]; }" },
    { filePath: 'lib/symbols.js', startLine: 1, endLine: 3,
      text: "const keys = { kRouteState: Symbol('server.routeState') }; module.exports = keys;" },
  ];
  const embedder: Embedder = { embed: async () => [[1, 0], [1, 0], [1, 0]] };
  assert.equal((await retrieveHybridCandidates('kRouteState', regions, embedder))[0]?.filePath, 'lib/symbols.js');
});

test('behavioral implementation intent ranks defining logic above an incidental test', async () => {
  const regions = [
    { filePath: 'test/reliability.test.ts', startLine: 1, endLine: 4, text: "test('search concurrency is bounded', () => expect(controller).toBeDefined());" },
    { filePath: 'src/search-execution.ts', startLine: 10, endLine: 18, text: 'export class SearchExecutionController { async run() { if (this.active >= this.maximum) return; await this.execute(); } }' },
  ];
  const result = await retrieveHybridCandidates('Where is search concurrency bounded to prevent overload?', regions, {
    embed: async () => [[1, 0], [1, 0], [1, 0]],
  });
  assert.equal(result[0]?.filePath, 'src/search-execution.ts');
});

test('benchmark can compare merged ranking with intent-aware ranking using identical vectors', async () => {
  const regions = [
    { filePath: 'src/concurrency-notes.ts', startLine: 1, endLine: 2,
      text: '// Where search concurrency is bounded to prevent overload' },
    { filePath: 'src/unrelated-handler.ts', startLine: 1, endLine: 3,
      text: 'export function calculatePrice() { if (true) return 42; }' },
  ];
  const embedder = { embed: async () => [[1, 0], [1, 0], [0, 1]] };
  const query = 'Where is search concurrency bounded to prevent overload?';

  const mergedBaseline = await retrieveHybridCandidates(query, regions, embedder, 5, { intentReranking: false });
  const proposal = await retrieveHybridCandidates(query, regions, embedder);
  assert.equal(mergedBaseline[0]?.filePath, 'src/concurrency-notes.ts');
  assert.equal(proposal[0]?.filePath, 'src/unrelated-handler.ts');
  // The experimental preference can overwhelm retrieval evidence, so this
  // flag must remain available for a fair benchmark before release.
});

test('explicit test and example intents retain their matching file roles', async () => {
  const regions = [
    { filePath: 'src/validation.ts', startLine: 1, endLine: 3, text: 'export function validateRequest() { if (!request) throw new Error(); }' },
    { filePath: 'test/validation.test.ts', startLine: 1, endLine: 3, text: "test('request validation', () => expect(validateRequest).toThrow());" },
    { filePath: 'examples/request.ts', startLine: 1, endLine: 2, text: 'validateRequest(request);' },
  ];
  const embedder = { embed: async () => [[1, 0], [1, 0], [1, 0], [1, 0]] };
  assert.equal((await retrieveHybridCandidates('Where is request validation tested?', regions, embedder))[0]?.filePath, 'test/validation.test.ts');
  assert.equal((await retrieveHybridCandidates('Show an example of request validation', regions, embedder))[0]?.filePath, 'examples/request.ts');
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
