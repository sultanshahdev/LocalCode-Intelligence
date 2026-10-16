import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import { searchExactText } from '../src/exact-search.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'localcode-exact-')); roots.push(root); return root; }

test('finds literal occurrences with exact one-based lines and duplicate highlights', async () => {
  const root = await fixture();
  await writeFile(join(root, 'app.ts'), 'const VerifyToken = 1;\nverifyToken(verifyToken);\n');
  const result = await searchExactText('verifyToken', root);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches[0], { filePath: 'app.ts', line: 1, text: 'const VerifyToken = 1;', occurrences: [{ start: 6, end: 17 }] });
  assert.deepEqual(result.matches[1]?.occurrences, [{ start: 0, end: 11 }, { start: 12, end: 23 }]);
});

test('supports case-sensitive and whole-word literal matching', async () => {
  const root = await fixture();
  await writeFile(join(root, 'app.ts'), 'token tokenized TOKEN token_value\n');
  assert.equal((await searchExactText('token', root, { caseSensitive: true })).matches.length, 1);
  assert.equal((await searchExactText('token', root, { wholeWord: true })).matches[0]?.occurrences.length, 2);
});

test('reports bounded coverage, skips symlinks, and truncates results', async () => {
  const root = await fixture();
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules', 'ignored.ts'), 'needle');
  await writeFile(join(root, 'real.ts'), Array.from({ length: 201 }, () => 'needle').join('\n'));
  await symlink(join(root, 'real.ts'), join(root, 'linked.ts'));
  const result = await searchExactText('needle', root);
  assert.equal(result.matches.length, 200);
  assert.equal(result.truncated, true);
  assert.equal(result.filesWithMatches, 1);
  assert.match(result.scope.warnings.join('\n'), /Match limit/);
});
