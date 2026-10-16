import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';
import { defaultLanguageRegistry } from '../src/languages/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

test('WASM grammars load offline and extract declarations and AST identifier usages for every structural language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localcode-wasm-')); roots.push(root);
  const fixtures: Array<[string, string, string, string]> = [
    ['sample.py', 'class Box:\n  def use(self): return target\ndef target(): pass\ntarget()\n', 'Box', 'target'],
    ['sample.go', 'type Box struct{}\nfunc target() {}\nfunc use() { target() }\n', 'Box', 'target'],
    ['Sample.java', 'class Box { void target() {} void use() { target(); } }', 'Box', 'target'],
    ['sample.rs', 'struct Box;\nfn target() {}\nfn use() { target(); }', 'Box', 'target'],
    ['sample.c', 'struct Box {};\nvoid target() {}\nvoid use() { target(); }', 'Box', 'target'],
    ['sample.cpp', 'class Box { void target() {} void use() { target(); } };', 'Box', 'target'],
    ['Sample.cs', 'class Box { void Target() {} void Use() { Target(); } }', 'Box', 'Target'],
    ['sample.rb', 'class Box\n def target; end\n def use; target; end\nend', 'Box', 'target'],
    ['sample.php', '<?php class Box { function target() {} function use() { target(); } }', 'Box', 'target'],
    ['sample.sh', 'target() { :; }\nuse() { target; }', 'target', 'target'],
  ];
  for (const [file, source] of fixtures) await writeFile(join(root, file), source);
  for (const [file, , declaration, usage] of fixtures) {
    const adapter = defaultLanguageRegistry.getByPath(file);
    assert.ok(adapter?.capabilities.structural, `${file} must have a structural adapter`);
    const result = await adapter.extractSymbols!(root);
    const symbol = result.symbols.find(item => item.name === declaration);
    assert.ok(symbol, `${file} must expose ${declaration}`);
    assert.ok(symbol.startLine >= 1 && symbol.endLine >= symbol.startLine);
    const selected = result.symbols.find(item => item.name === usage);
    assert.ok(selected, `${file} must expose ${usage}`);
    const usages = await adapter.findPossibleUsages!(root, selected);
    assert.ok(usages.usages.some(item => item.filePath === file), `${file} must return AST usage nodes`);
  }
});
