import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  type FileSystemOperations,
  validateRepositoryDirectory,
} from '../src/repository.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'localcode-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

test('accepts an existing absolute directory without Git metadata', async () => {
  const directory = await createFixture();

  const result = await validateRepositoryDirectory(directory);

  assert.deepEqual(result, { ok: true, resolvedPath: directory });
});

test('resolves and accepts a relative directory path', async () => {
  const parent = await createFixture();
  const relativePath = 'source directory';
  const directory = join(parent, relativePath);
  await mkdir(directory);

  const result = await validateRepositoryDirectory(relativePath, parent);

  assert.deepEqual(result, { ok: true, resolvedPath: directory });
});

test('accepts a directory whose name contains spaces', async () => {
  const parent = await createFixture();
  const directory = join(parent, 'project with spaces');
  await mkdir(directory);

  const result = await validateRepositoryDirectory(directory);

  assert.equal(result.ok, true);
});

test('rejects a nonexistent path', async () => {
  const parent = await createFixture();
  const missingPath = join(parent, 'missing');

  const result = await validateRepositoryDirectory(missingPath);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'not-found');
    assert.match(result.message, /path does not exist/);
  }
});

test('rejects a regular file because a directory is required', async () => {
  const parent = await createFixture();
  const filePath = join(parent, 'source.ts');
  await writeFile(filePath, 'export {};\n');

  const result = await validateRepositoryDirectory(filePath);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'not-directory');
    assert.match(result.message, /a directory is required/);
  }
});

test('reports a filesystem inspection failure as inaccessible', async () => {
  const inaccessibleFileSystem: FileSystemOperations = {
    stat: async () => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    },
    access: async () => undefined,
  };

  const result = await validateRepositoryDirectory(
    'private',
    '/workspace',
    inaccessibleFileSystem,
  );

  assert.deepEqual(result, {
    ok: false,
    reason: 'inaccessible',
    resolvedPath: resolve('/workspace/private'),
    message:
      'Repository cannot be used: unable to inspect directory: /workspace/private',
  });
});

test('reports a failed readability check as inaccessible', async () => {
  const inaccessibleFileSystem: FileSystemOperations = {
    stat: async () => ({ isDirectory: () => true }),
    access: async () => {
      throw new Error('permission denied');
    },
  };

  const result = await validateRepositoryDirectory(
    'private',
    '/workspace',
    inaccessibleFileSystem,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'inaccessible');
    assert.match(result.message, /directory is not readable/);
  }
});
