import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import { listRepositorySymbols, findPossibleUsages, resolveDefinition } from '../src/symbols.js';

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

test('resolves lexical bindings, imports, and rejects stale coordinates without guessing', async () => {
  const root = await fixture();
  await writeFile(join(root, 'dep.ts'), 'export default function defaultFn() {}\nexport function named() {}\n');
  await writeFile(join(root, 'main.ts'), 'import localDefault, { named as localNamed } from "./dep";\nfunction outer() {}\nfunction scoped() { const outer = 1; return outer; }\nlocalDefault(); localNamed(); outer();\n');
  const resolved = await resolveDefinition(root, { filePath: 'main.ts', line: 4, column: 31 });
  assert.equal(resolved.outcome, 'resolved');
  if (resolved.outcome === 'resolved') {
    assert.equal(resolved.definition.filePath, 'main.ts');
    assert.equal(resolved.definition.name, 'outer');
    assert.equal(resolved.definition.kind, 'function');
    assert.equal(resolved.definition.startLine, 2);
    assert.equal(resolved.definition.endLine, 2);
  }
  const importResolved = await resolveDefinition(root, { filePath: 'main.ts', line: 4, column: 1 });
  assert.equal(importResolved.outcome, 'resolved');
  if (importResolved.outcome === 'resolved') {
    assert.equal(importResolved.definition.filePath, 'dep.ts');
    assert.equal(importResolved.definition.name, 'default');
    assert.equal(importResolved.definition.startLine, 1);
    assert.equal(importResolved.definition.endLine, 1);
  }
  const namedImportResolved = await resolveDefinition(root, { filePath: 'main.ts', line: 4, column: 17 });
  assert.equal(namedImportResolved.outcome, 'resolved');
  if (namedImportResolved.outcome === 'resolved') {
    assert.equal(namedImportResolved.definition.filePath, 'dep.ts');
    assert.equal(namedImportResolved.definition.name, 'named');
    assert.equal(namedImportResolved.definition.startLine, 2);
    assert.equal(namedImportResolved.definition.endLine, 2);
  }
  const shadowed = await resolveDefinition(root, { filePath: 'main.ts', line: 3, column: 47 });
  assert.equal(shadowed.outcome, 'resolved');
  if (shadowed.outcome === 'resolved') {
    assert.equal(shadowed.definition.filePath, 'main.ts');
    assert.equal(shadowed.definition.name, 'outer');
    assert.equal(shadowed.definition.kind, 'variable');
    assert.equal(shadowed.definition.startLine, 3);
    assert.equal(shadowed.definition.endLine, 3);
  }
  assert.equal((await resolveDefinition(root, { filePath: 'main.ts', line: 99, column: 1 })).outcome, 'unsupported');
  assert.equal((await resolveDefinition(root, { filePath: '../main.ts', line: 1, column: 1 })).outcome, 'unsupported');
  assert.equal((await resolveDefinition(root, { filePath: 'main.ts/../outside.ts', line: 1, column: 1 })).outcome, 'unsupported');
  assert.equal((await resolveDefinition(root, { filePath: '/main.ts', line: 1, column: 1 })).outcome, 'unsupported');
});

test('definition resolution skips symlinks and enforces bounded source limits', async () => {
  const root = await fixture();
  await writeFile(join(root, 'source.ts'), 'export const secret = 42;\n');
  await symlink(join(root, 'source.ts'), join(root, 'symlinked.ts'));
  // Symlinked file should be rejected as not part of the discovered source scope
  const symlinkResult = await resolveDefinition(root, { filePath: 'symlinked.ts', line: 1, column: 14 });
  assert.equal(symlinkResult.outcome, 'unsupported');

  // Bounded source limits skip files that exceed byte or count limits
  await writeFile(join(root, 'consumer.ts'), 'import { secret } from "./source";\nconst val = secret;\n');
  const limitedResult = await resolveDefinition(root, { filePath: 'consumer.ts', line: 2, column: 13 }, {
    maxFiles: 1, maxFileBytes: 256 * 1024, maxTotalBytes: 5 * 1024 * 1024,
    windowLines: 40, overlapLines: 10,
  });
  // Since maxFiles is 1, consumer.ts or source.ts is excluded; consumer or target won't both be resolved
  assert.ok(limitedResult.outcome === 'unsupported' || limitedResult.outcome === 'unresolved');
  assert.ok(limitedResult.warnings.some(w => w.includes('File limit reached') || w.includes('Skipped')));
});
