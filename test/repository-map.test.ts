import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { afterEach } from 'node:test';
import { buildRepositoryMap } from '../src/repository-map.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

test('repository map is deterministic, metadata-only, and excludes ignored and symlinked entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcode-map-')); roots.push(root);
  await mkdir(join(root, 'src')); await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'main.ts'), 'export const main = 1;\n');
  await writeFile(join(root, 'README.md'), '# demo\n');
  await writeFile(join(root, 'node_modules', 'hidden.ts'), 'throw new Error();\n');
  await symlink(join(root, 'src'), join(root, 'linked-src'));
  const map = await buildRepositoryMap(root);
  assert.deepEqual(map.nodes.map(node => [node.path, node.type]), [
    ['.', 'directory'], ['README.md', 'file'], ['src', 'directory'], ['src/main.ts', 'file'],
  ]);
  assert.equal(map.nodes.find(node => node.path === 'src/main.ts')?.language, 'javascript-typescript');
  assert.equal(map.nodes.some(node => node.path.includes('node_modules') || node.path.includes('linked-src')), false);
  assert.equal(map.truncated, false);
});

test('repository map reports a bounded partial manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcode-map-limit-')); roots.push(root);
  await writeFile(join(root, 'a.ts'), ''); await writeFile(join(root, 'b.ts'), '');
  const map = await buildRepositoryMap(root, undefined, { maxNodes: 2, maxDepth: 32 });
  assert.equal(map.nodes.length, 2);
  assert.equal(map.truncated, true);
  assert.match(map.warnings.join(' '), /node limit/i);
});
