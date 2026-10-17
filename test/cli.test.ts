import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';

import { runCli as invokeCli } from '../src/cli.js';
import type { SearchResult } from '../src/search.js';

const executeFile = promisify(execFile);
const cliPath = join(process.cwd(), 'dist', 'src', 'cli.js');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'localcode-cli-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await executeFile(process.execPath, [cliPath, ...args], { cwd });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const failure = error as Error & {
      code: number;
      stdout: string;
      stderr: string;
    };
    return {
      exitCode: failure.code,
      stdout: failure.stdout,
      stderr: failure.stderr,
    };
  }
}

test('reports the exact validated absolute scope and no indexing claim', async () => {
  const directory = await createFixture();

  const result = await runCli(['repo', 'check', directory]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, new RegExp(`Validated repository scope: ${escapeRegex(directory)}`));
  assert.match(result.stdout, /indexing has not been performed/);
});

test('resolves a relative path including spaces against the working directory', async () => {
  const parent = await createFixture();
  const relativePath = 'non git project';
  await mkdir(join(parent, relativePath));

  const result = await runCli(['repo', 'check', relativePath], parent);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(escapeRegex(join(parent, relativePath))));
});

test('returns usage exit status when the repository argument is missing', async () => {
  const result = await runCli(['repo', 'check']);

  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Repository path is required/);
  assert.match(result.stderr, /Usage: codebuster repo check <path>/);
});

test('returns failure exit status for a nonexistent directory', async () => {
  const parent = await createFixture();

  const result = await runCli(['repo', 'check', join(parent, 'missing')]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /path does not exist/);
});

test('returns failure exit status when a file is supplied', async () => {
  const parent = await createFixture();
  const filePath = join(parent, 'README.md');
  await writeFile(filePath, '# fixture\n');

  const result = await runCli(['repo', 'check', filePath]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /a directory is required/);
});

test('search validates a natural-language query and formats inspectable evidence', async () => {
  const directory = await createFixture();
  const output = captureStreams();
  let received: { query: string; repository: string } | undefined;
  const searchResult: SearchResult = {
    ok: true,
    outcome: 'candidates',
    withheldCandidates: 0,
    scope: { filesProcessed: 1, warnings: [], regions: [] },
    candidates: [{
      filePath: 'src/session.ts', startLine: 4, endLine: 6,
      text: 'if (expired) throw new Error();', score: 0.82,
    }],
  };

  const exitCode = await invokeCli(
    ['search', 'where is an expired session rejected?', '--repo', directory],
    output.streams,
    { search: async (query, repository) => {
      received = { query, repository };
      return searchResult;
    } },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(received, { query: 'where is an expired session rejected?', repository: directory });
  assert.match(output.stdout(), /File: src\/session\.ts/);
  assert.match(output.stdout(), /Lines: 4-6/);
  assert.match(output.stdout(), /not a probability or verified behavioral guarantee/);
  assert.equal(output.stderr(), '');
});

test('search rejects an empty query before invoking retrieval', async () => {
  const directory = await createFixture();
  const output = captureStreams();
  let invoked = false;
  const exitCode = await invokeCli(['search', '   ', '--repo', directory], output.streams, {
    search: async () => { invoked = true; throw new Error('unexpected'); },
  });
  assert.equal(exitCode, 2);
  assert.equal(invoked, false);
  assert.match(output.stderr(), /Search query is required/);
});

test('search accepts a relative non-Git path containing spaces', async () => {
  const parent = await createFixture();
  const relativePath = 'plain source project';
  await mkdir(join(parent, relativePath));
  const output = captureStreams();
  const originalDirectory = process.cwd();
  process.chdir(parent);
  try {
    const exitCode = await invokeCli(['search', 'find behavior', '--repo', relativePath], output.streams, {
      search: async () => ({ ok: true, outcome: 'no-supported-candidate', withheldCandidates: 0, scope: { filesProcessed: 1, warnings: [], regions: [] }, candidates: [] }),
    });
    assert.equal(exitCode, 0);
    assert.match(output.stdout(), new RegExp(escapeRegex(join(parent, relativePath))));
  } finally {
    process.chdir(originalDirectory);
  }
});

test('search labels weak candidates as uncertain and preserves source locations', async () => {
  const directory = await createFixture();
  const output = captureStreams();
  const exitCode = await invokeCli(['search', 'uncertain behavior', '--repo', directory], output.streams, {
    search: async () => ({
      ok: true,
      outcome: 'candidates',
      withheldCandidates: 1,
      scope: { filesProcessed: 1, warnings: ['File limit reached; coverage is incomplete.'], regions: [] },
      candidates: [{ filePath: 'src/weak.ts', startLine: 8, endLine: 12, text: 'maybeRelated();', score: 0.01 }],
    }),
  });
  assert.equal(exitCode, 0);
  assert.match(output.stdout(), /Warning: File limit reached; coverage is incomplete/);
  assert.match(output.stdout(), /File: src\/weak\.ts/);
  assert.match(output.stdout(), /Lines: 8-12/);
  assert.match(output.stdout(), /relevance is uncertain/);
  assert.match(output.stdout(), /not a probability/);
  assert.match(output.stdout(), /Withheld candidates: 1/);
});

test('search distinguishes no supported candidate from operational failure', async () => {
  const directory = await createFixture();
  const noResultOutput = captureStreams();
  const noResultExit = await invokeCli(['search', 'absent evidence', '--repo', directory], noResultOutput.streams, {
    search: async () => ({
      ok: true,
      outcome: 'no-supported-candidate',
      withheldCandidates: 2,
      scope: { filesProcessed: 1, warnings: [], regions: [] },
      candidates: [],
    }),
  });
  assert.equal(noResultExit, 0);
  assert.match(noResultOutput.stdout(), /No sufficiently supported candidate/);
  assert.match(noResultOutput.stdout(), /does not establish.*absent/i);
  assert.equal(noResultOutput.stderr(), '');

  const failureOutput = captureStreams();
  const failureExit = await invokeCli(['search', 'failed search', '--repo', directory], failureOutput.streams, {
    search: async () => ({ ok: false, reason: 'processing-failed', message: 'Search processing failed.' }),
  });
  assert.equal(failureExit, 1);
  assert.equal(failureOutput.stdout(), '');
  assert.match(failureOutput.stderr(), /Search processing failed/);
});

test('diagnose output reproduces production search parity and serializes candidate metadata', async () => {
  const directory = await createFixture();
  const file = join(directory, 'auth.ts');
  await writeFile(file, 'export function verifyToken(token: string): boolean { return token.length > 0; }\n');

  const diagOutput = captureStreams();
  const diagExit = await invokeCli(['diagnose', 'verifyToken', '--repo', directory], diagOutput.streams);
  assert.equal(diagExit, 0);

  const diagJson = JSON.parse(diagOutput.stdout());
  assert.ok(Array.isArray(diagJson.productionFinalTop5));
  assert.ok(Array.isArray(diagJson.semanticTop20));
  assert.ok(Array.isArray(diagJson.lexicalTop20));
  assert.ok(Array.isArray(diagJson.fusedTop20));
  assert.ok(diagJson.sourceCoverage);
  assert.equal(diagJson.sourceCoverage.filesProcessed, 1);
  assert.equal(diagJson.productionFinalTop5.length, 1);
  assert.equal(diagJson.productionFinalTop5[0].filePath, 'auth.ts');
  assert.equal(diagJson.productionFinalTop5[0].finalVisibility, true);
  assert.equal(diagJson.productionFinalTop5[0].evidenceClass, 'exact-identifier');
  assert.equal(diagJson.productionOutcome, 'candidates');

  // Verify non-relevant query parity
  const bananaOutput = captureStreams();
  const bananaExit = await invokeCli(['diagnose', 'find banana', '--repo', directory], bananaOutput.streams);
  assert.equal(bananaExit, 0);

  const bananaJson = JSON.parse(bananaOutput.stdout());
  assert.equal(bananaJson.productionOutcome, 'no-relevant-results');
  assert.equal(bananaJson.productionFinalTop5.length, 0);
  assert.ok(bananaJson.discardedCandidates.length > 0);
  assert.equal(bananaJson.discardedCandidates[0].finalVisibility, false);
  assert.equal(bananaJson.discardedCandidates[0].discardReason, 'relevance-assessment-insufficient-evidence');
});

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
