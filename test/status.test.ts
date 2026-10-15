import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { runCli } from '../src/cli.js';
import { prepareSourceScope } from '../src/source.js';
import { inspectRepositorySearchStatus } from '../src/status.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'localcode-status-'));
  temporaryDirectories.push(path);
  return path;
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

test('reports eligible source in an ordinary non-Git directory without invoking search', async () => {
  const root = await fixture();
  await writeFile(join(root, 'app.ts'), 'export const ready = true;\n');
  const output = captureStreams();
  let searchInvoked = false;

  const exitCode = await runCli(['repo', 'status', root], output.streams, {
    search: async () => { searchInvoked = true; throw new Error('model must not initialize'); },
    status: inspectRepositorySearchStatus,
  });

  assert.equal(exitCode, 0);
  assert.equal(searchInvoked, false);
  assert.equal(output.stderr(), '');
  assert.match(output.stdout(), /Directory: Accessible/);
  assert.match(output.stdout(), /Supported source files: 1/);
  assert.match(output.stdout(), /Source eligibility: Available/);
  assert.match(output.stdout(), /Preparation: On-demand; not performed by status/);
  assert.match(output.stdout(), /Persistent index: None/);
  assert.match(output.stdout(), /Model readiness: Not checked/);
  assert.match(output.stdout(), /Search execution: Not performed/);
});

test('reports empty and unsupported directories as having no eligible source', async () => {
  for (const withUnsupportedFile of [false, true]) {
    const root = await fixture();
    if (withUnsupportedFile) await writeFile(join(root, 'README.md'), '# no source\n');
    const output = captureStreams();
    const exitCode = await runCli(['repo', 'status', root], output.streams);
    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /Supported source files: 0/);
    assert.match(output.stdout(), /Source eligibility: None/);
    assert.match(output.stdout(), /Status: No supported searchable source content is available for search/);
  }
});

test('resolves a relative status path and reflects source changes on each invocation', async () => {
  const root = await fixture();
  const originalDirectory = process.cwd();
  process.chdir(root);
  try {
    const first = captureStreams();
    assert.equal(await runCli(['repo', 'status', '.'], first.streams), 0);
    assert.match(first.stdout(), /Supported source files: 0/);

    await writeFile(join(root, 'added.js'), 'export function added() { return true; }\n');
    const second = captureStreams();
    assert.equal(await runCli(['repo', 'status', '.'], second.streams), 0);
    assert.match(second.stdout(), /Supported source files: 1/);
    assert.match(second.stdout(), /Source eligibility: Available/);
  } finally {
    process.chdir(originalDirectory);
  }
});

test('reports partial coverage and exact warnings from shared source preparation', async () => {
  const root = await fixture();
  await writeFile(join(root, 'eligible.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'oversized.ts'), 'x'.repeat(40));

  const result = await inspectRepositorySearchStatus(root, {
    prepare: path => prepareSourceScope(path, {
      maxFiles: 10, maxFileBytes: 30, maxTotalBytes: 100,
      windowLines: 5, overlapLines: 1,
    }),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status.filesDiscovered, 2);
    assert.equal(result.status.filesProcessed, 1);
    assert.equal(result.status.eligible, true);
    assert.equal(result.status.coverage, 'partial');
    assert.match(result.status.warnings[0] ?? '', /Skipped oversized\.ts/);
  }
});

test('status converts source inspection failures into an unavailable result', async () => {
  const result = await inspectRepositorySearchStatus('/private', {
    prepare: async () => { throw new Error('permission denied'); },
  });
  assert.deepEqual(result, {
    ok: false,
    message: 'Repository status could not inspect the source scope: permission denied',
  });
});

test('status creates no persistent index or other repository files', async () => {
  const root = await fixture();
  await writeFile(join(root, 'source.ts'), 'export {};\n');
  const before = await import('node:fs/promises').then(fs => fs.readdir(root));
  const output = captureStreams();
  assert.equal(await runCli(['repo', 'status', root], output.streams), 0);
  const after = await import('node:fs/promises').then(fs => fs.readdir(root));
  assert.deepEqual(after, before);
});

test('status rejects invalid paths and regular files through repository validation', async () => {
  const root = await fixture();
  const file = join(root, 'source.ts');
  await writeFile(file, 'export {};\n');
  for (const path of [join(root, 'missing'), file]) {
    const output = captureStreams();
    assert.equal(await runCli(['repo', 'status', path], output.streams), 1);
    assert.equal(output.stdout(), '');
    assert.match(output.stderr(), /Repository cannot be used/);
  }
});
