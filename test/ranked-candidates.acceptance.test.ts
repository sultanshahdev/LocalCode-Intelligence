import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import type { Embedder } from '../src/retrieval.js';
import { searchRepository } from '../src/search.js';
import { prepareSourceScope } from '../src/source.js';

const query = 'where is an incoming request authorized?';
const repository = join(process.cwd(), 'test', 'fixtures', 'ranked-candidates');

test('presents three labeled implementations in ranked, location-distinct order without claiming proof', async () => {
  const output = captureStreams();
  const exitCode = await runCli(['search', query, '--repo', repository], output.streams, {
    search: (submittedQuery, repositoryPath) => searchRepository(submittedQuery, repositoryPath, {
      prepare: prepareSourceScope,
      createEmbedder: async () => controlledEmbedder,
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(output.stderr(), '');

  const stdout = output.stdout();
  const expected = [
    { number: 1, file: 'src/http-authorization.ts', lines: '1-4', score: '0.9500' },
    { number: 2, file: 'src/admin-authorization.ts', lines: '1-3', score: '0.8000' },
    { number: 3, file: 'src/socket-authorization.ts', lines: '1-3', score: '0.6000' },
  ];

  let previousPosition = -1;
  for (const candidate of expected) {
    const block = `Candidate ${candidate.number}\nFile: ${candidate.file}\nLines: ${candidate.lines}\nSimilarity: ${candidate.score}`;
    const position = stdout.indexOf(block);
    assert.ok(position > previousPosition, `${candidate.file} must appear in ranked presentation order`);
    previousPosition = position;
  }

  assert.doesNotMatch(stdout, /File: src\/date-format\.ts/);
  assert.match(stdout, /Withheld candidates: 1 with non-positive cosine alignment/);
  assert.equal(stdout.match(/Evidence: Unverified semantic candidate; relevance is uncertain\./g)?.length, 3);
  assert.match(stdout, /Similarity is a ranking signal, not a probability or verified behavioral guarantee/);
});

const controlledEmbedder: Embedder = {
  async embed(texts) {
    assert.equal(texts[0], query);
    return [[1, 0], ...texts.slice(1).map(vectorForRegion)];
  },
};

function vectorForRegion(text: string): number[] {
  if (text.includes('http-authorization.ts')) return unitVector(0.95);
  if (text.includes('admin-authorization.ts')) return unitVector(0.8);
  if (text.includes('socket-authorization.ts')) return unitVector(0.6);
  if (text.includes('date-format.ts')) return [-1, 0];
  throw new Error(`Unexpected fixture region: ${text}`);
}

function unitVector(cosine: number): number[] {
  return [cosine, Math.sqrt(1 - cosine ** 2)];
}

function captureStreams() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      stdout: { write: (value: string | Uint8Array) => { stdout += value.toString(); return true; } },
      stderr: { write: (value: string | Uint8Array) => { stderr += value.toString(); return true; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
