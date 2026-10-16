import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import { listRepositorySymbols } from '../src/symbols.js';

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
