import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { discoverSourceFiles, prepareSourceScope, segmentSource } from '../src/source.js';

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'localcode-source-'));
  temporaryDirectories.push(path);
  return path;
}

test('discovers supported source while excluding dependencies, output, and symlinks', async () => {
  const root = await fixture();
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'src', 'app.ts'), 'export const app = true;\n');
  await writeFile(join(root, 'src', 'view.jsx'), 'export const View = () => null;\n');
  await writeFile(join(root, 'src', 'notes.md'), 'not source\n');
  await writeFile(join(root, 'node_modules', 'package.js'), 'ignored\n');
  await writeFile(join(root, 'dist', 'bundle.js'), 'ignored\n');
  await symlink(join(root, 'src', 'app.ts'), join(root, 'linked.ts'));

  const files = await discoverSourceFiles(root);
  assert.deepEqual(files.map(path => path.slice(root.length + 1)), ['src/app.ts', 'src/view.jsx']);
});

test('segments source into accurate overlapping one-based ranges', () => {
  const content = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n');
  const regions = segmentSource('src/example.ts', content, { windowLines: 5, overlapLines: 2 });
  assert.deepEqual(regions.map(({ startLine, endLine }) => [startLine, endLine]), [[1, 5], [4, 8]]);
  assert.equal(regions[1]?.text.split('\n')[0], 'line 4');
});

test('reports explicit coverage warnings for skipped oversized files', async () => {
  const root = await fixture();
  await writeFile(join(root, 'large.ts'), 'x'.repeat(20));
  const scope = await prepareSourceScope(root, {
    maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 100, windowLines: 5, overlapLines: 1,
  });
  assert.equal(scope.filesProcessed, 0);
  assert.equal(scope.regions.length, 0);
  assert.match(scope.warnings[0] ?? '', /Skipped large\.ts/);
});
