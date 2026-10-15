import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import type { Embedder } from '../src/retrieval.js';
import { searchRepository } from '../src/search.js';
import { prepareSourceScope } from '../src/source.js';

const query = 'where is an expired session rejected?';
const repository = join(process.cwd(), 'test', 'fixtures', 'semantic-repository');

test('AC-010A displays the exact fixture source identified by the candidate path and range', async () => {
  const output = captureStreams();
  const exitCode = await runCli(['search', query, '--repo', repository], output.streams, {
    search: (submittedQuery, repositoryPath) => searchRepository(submittedQuery, repositoryPath, {
      prepare: prepareSourceScope,
      createEmbedder: async () => controlledEmbedder,
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(output.stderr(), '');

  const candidate = output.stdout().match(
    /Candidate 1\nFile: ([^\n]+)\nLines: (\d+)-(\d+)\nSimilarity: [^\n]+\n\nEvidence: Unverified semantic candidate; relevance is uncertain\.\n\nCandidate source excerpt:\n([\s\S]*?)\n\nWithheld candidates:/,
  );
  assert.ok(candidate, 'expected one inspectable candidate block in CLI output');

  const [, filePath, startText, endText, displayedExcerpt] = candidate;
  assert.equal(filePath, 'src/session.js');
  assert.equal(startText, '1');
  assert.equal(endText, '7');

  const source = await readFile(join(repository, filePath), 'utf8');
  const sourceLines = source.split(/\r?\n/);
  if (sourceLines.at(-1) === '') sourceLines.pop();
  const startLine = Number(startText);
  const endLine = Number(endText);
  const actualFixtureExcerpt = sourceLines.slice(startLine - 1, endLine).join('\n');

  assert.equal(displayedExcerpt, actualFixtureExcerpt);
});

test.skip(
  'AC-010B is deferred until LocalCode has a retained-result inspection workflow and source-state policy',
  () => {},
);

const controlledEmbedder: Embedder = {
  async embed(texts) {
    assert.equal(texts[0], query);
    return [[1, 0], ...texts.slice(1).map(vectorForRegion)];
  },
};

function vectorForRegion(text: string): number[] {
  if (text.includes('src/session.js')) return [1, 0];
  if (text.includes('src/profile.js') || text.includes('src/report.js')) return [-1, 0];
  throw new Error(`Unexpected fixture region: ${text}`);
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
