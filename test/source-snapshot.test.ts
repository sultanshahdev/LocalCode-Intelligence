import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import { prepareRepositorySourceSnapshot } from '../src/source.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
test('shared snapshot applies global file and aggregate byte budgets deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcode-snapshot-')); roots.push(root);
  for (let index = 0; index < 501; index++) await writeFile(join(root, `${String(index).padStart(3, '0')}.py`), 'def item(): pass\n');
  const fileLimited = await prepareRepositorySourceSnapshot(root);
  assert.equal(fileLimited.files.length, 500); assert.equal(fileLimited.scope.truncated, true); assert.match(fileLimited.scope.warnings.join(' '), /File limit/);
  const byteLimited = await prepareRepositorySourceSnapshot(root, { maxFiles: 500, maxFileBytes: 256 * 1024, maxTotalBytes: 100, windowLines: 40, overlapLines: 10 });
  assert.ok(byteLimited.scope.totalBytes <= 100); assert.equal(byteLimited.scope.truncated, true); assert.match(byteLimited.scope.warnings.join(' '), /byte limit/);
});
