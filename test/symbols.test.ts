import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import { listRepositorySymbols, findPossibleUsages } from '../src/symbols.js';

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'localcode-symbols-')); roots.push(root); return root; }
test('extracts declarations and nested members with source-accurate locations', async () => {
  const root = await fixture(); await writeFile(join(root, 'types.ts'), 'export function authenticateUser() {}\nclass SomeService { run() {} }\ninterface Shape { draw(): void }\ntype ID = string;\nenum Mode { On }\nconst handler = () => {};\n');
  const result = await listRepositorySymbols(root); const names = result.symbols.map(s => `${s.kind}:${s.containerName ?? ''}:${s.name}:${s.startLine}`);
  assert.deepEqual(names, ['function::authenticateUser:1', 'class::SomeService:2', 'method:SomeService:run:2', 'interface::Shape:3', 'method:Shape:draw:3', 'type alias::ID:4', 'enum::Mode:5', 'variable::handler:6']);
});
test('parses JSX/TSX, preserves duplicate names, warns for malformed syntax, and skips symlinks', async () => {
  const root = await fixture(); await writeFile(join(root, 'view.tsx'), 'const Card = () => <div/>;\nfunction Card() { return <span/> }\nfunction broken( {\n'); await symlink(join(root, 'view.tsx'), join(root, 'linked.tsx'));
  const result = await listRepositorySymbols(root); assert.equal(result.symbols.filter(s => s.name === 'Card').length, 2); assert.match(result.scope.warnings.join('\n'), /syntax error/); assert.equal(result.scope.filesProcessed, 1);
});


test('possible usages exclude the declaration, strings and comments but retain AST identifiers', async () => {
  const root = await fixture();
  await writeFile(join(root, 'sample.ts'), [
    'export function authorize() { return authorize(); }',
    'const value = "authorize"; // authorize',
    'const object = { authorize };',
    '/* authorize */',
    'function other(authorize: number) { return authorize; }',
  ].join('\n'));
  const symbols = await listRepositorySymbols(root);
  const selected = symbols.symbols.find(s => s.name === 'authorize' && s.kind === 'function');
  assert.ok(selected, 'expected the function declaration');
  const result = await findPossibleUsages(root, selected);
  assert.deepEqual(result.usages.map(u => u.line), [1, 3, 5, 5]);
  assert.equal(result.truncated, false);
  assert.ok(result.usages.every(u => u.filePath === 'sample.ts'));
  assert.ok(result.usages.every(u => u.column > 0));
});

test('possible usages are bounded to 200 and stale declaration selections fail', async () => {
  const root = await fixture();
  const path = join(root, 'usage.ts');
  await writeFile(path, ['function target() {}', ...Array.from({ length: 250 }, () => 'target();')].join('\n'));
  const declaration = (await listRepositorySymbols(root)).symbols.find(s => s.name === 'target');
  assert.ok(declaration);
  const matched = await findPossibleUsages(root, declaration);
  assert.equal(matched.usages.length, 200);
  assert.equal(matched.truncated, true);
  assert.match(matched.scope.warnings.join(' '), /Usage limit reached/);
  assert.equal(matched.usages[0]?.line, 2);
  await writeFile(path, 'function renamed() {}\n');
  await assert.rejects(() => findPossibleUsages(root, declaration), /no longer exists/);
});

test('possible usages respect symlink exclusions and partial source coverage', async () => {
  const root = await fixture();
  await writeFile(join(root, 'entry.ts'), 'function handler() {}\nhandler();\n');
  await writeFile(join(root, 'hidden.ts'), 'handler();\n');
  await symlink(join(root, 'hidden.ts'), join(root, 'symlink.ts'));
  const selected = (await listRepositorySymbols(root)).symbols.find(s => s.name === 'handler');
  assert.ok(selected);
  const result = await findPossibleUsages(root, selected, {
    maxFiles: 1, maxFileBytes: 256 * 1024, maxTotalBytes: 5 * 1024 * 1024,
    windowLines: 40, overlapLines: 10,
  });
  assert.equal(result.usages.length, 1);
  assert.equal(result.usages[0]?.filePath, 'entry.ts');
  assert.ok(result.scope.warnings.some(w => w.includes('File limit reached')));
});
