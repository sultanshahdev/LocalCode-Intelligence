import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

import {
  LanguageRegistry,
  createDefaultLanguageRegistry,
  defaultLanguageRegistry,
  javaScriptTypeScriptAdapter,
  type LanguageAdapter,
} from '../src/languages/index.js';
import {
  discoverSourceFiles,
  prepareSourceScope,
  listNavigableSourceFiles,
  SOURCE_EXTENSIONS,
} from '../src/source.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'localcode-lang-test-'));
  roots.push(root);
  return root;
}

test('Scenario 1 & 2: default registry deterministically detects JS/TS extensions and rejects unsupported', () => {
  const registry = createDefaultLanguageRegistry();
  const supported = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

  for (const ext of supported) {
    assert.equal(registry.isSupported(`file${ext}`), true);
    const adapter = registry.getByPath(`src/module${ext}`);
    assert.ok(adapter, `expected adapter for ${ext}`);
    assert.equal(adapter.id, 'javascript-typescript');
  }

  // Unsupported extensions return undefined / false
  assert.equal(registry.isSupported('script.py'), false);
  assert.equal(registry.isSupported('main.go'), false);
  assert.equal(registry.isSupported('App.java'), false);
  assert.equal(registry.isSupported('README.md'), false);
  assert.equal(registry.getByPath('script.py'), undefined);
  assert.equal(registry.getByPath('no_extension'), undefined);

  // Extensions match case-insensitively
  assert.equal(registry.isSupported('component.TSX'), true);
  assert.equal(registry.getByPath('INDEX.JS')?.id, 'javascript-typescript');
});

test('Scenario 2: default registry capabilities for JS/TS declare full capabilities honestly', () => {
  assert.equal(javaScriptTypeScriptAdapter.capabilities.basic, true);
  assert.equal(javaScriptTypeScriptAdapter.capabilities.structural, true);
  assert.equal(javaScriptTypeScriptAdapter.capabilities.precise, true);
  assert.equal(typeof javaScriptTypeScriptAdapter.segmentSource, 'function');
  assert.equal(typeof javaScriptTypeScriptAdapter.extractSymbols, 'function');
  assert.equal(typeof javaScriptTypeScriptAdapter.findPossibleUsages, 'function');
  assert.equal(typeof javaScriptTypeScriptAdapter.resolveDefinition, 'function');
});

test('Scenario 3: isolated registry allows registering custom adapters and rejects conflicts', () => {
  const customRegistry = new LanguageRegistry();

  const mockPythonAdapter: LanguageAdapter = {
    id: 'python',
    name: 'Python',
    fileExtensions: ['.py', '.pyi'],
    capabilities: {
      basic: true,
      structural: false,
      precise: false,
    },
  };

  customRegistry.register(mockPythonAdapter);
  assert.equal(customRegistry.isSupported('main.py'), true);
  assert.equal(customRegistry.isSupported('stub.pyi'), true);
  assert.equal(customRegistry.getByPath('main.py')?.name, 'Python');
  assert.equal(customRegistry.isSupported('app.ts'), false);

  // Conflicting duplicate ID rejection
  assert.throws(() => {
    customRegistry.register({
      id: 'python',
      name: 'Another Python',
      fileExtensions: ['.py3'],
      capabilities: { basic: true, structural: false, precise: false },
    });
  }, /already registered/);

  // Conflicting extension rejection
  assert.throws(() => {
    customRegistry.register({
      id: 'cpython',
      name: 'CPython',
      fileExtensions: ['.py'],
      capabilities: { basic: true, structural: false, precise: false },
    });
  }, /already registered to language "python"/);
});

test('Scenario 4: capability evaluation reflects honest adapter boundaries without false claims', () => {
  const basicOnlyAdapter: LanguageAdapter = {
    id: 'basic-lang',
    name: 'Basic Lang',
    fileExtensions: ['.basic'],
    capabilities: {
      basic: true,
      structural: false,
      precise: false,
    },
  };

  assert.equal(basicOnlyAdapter.capabilities.precise, false);
  assert.equal(basicOnlyAdapter.capabilities.structural, false);
  assert.equal(basicOnlyAdapter.resolveDefinition, undefined);
  assert.equal(basicOnlyAdapter.extractSymbols, undefined);
  assert.equal(basicOnlyAdapter.findPossibleUsages, undefined);
});

test('Scenario 5: source discovery with custom registry discovers only adapter extensions while preserving guards', async () => {
  const root = await fixture();
  await writeFile(join(root, 'script.py'), 'print("hello")\n');
  await writeFile(join(root, 'index.ts'), 'export const x = 1;\n');
  await writeFile(join(root, 'notes.txt'), 'notes\n');

  // Using custom isolated registry with Python only
  const pythonRegistry = new LanguageRegistry([
    {
      id: 'python',
      name: 'Python',
      fileExtensions: ['.py'],
      capabilities: { basic: true, structural: false, precise: false },
    },
  ]);

  const pythonFiles = await discoverSourceFiles(root, 10, pythonRegistry);
  assert.equal(pythonFiles.length, 1);
  assert.match(pythonFiles[0]!, /script\.py$/);

  // Default registry discovers only JS/TS
  const defaultFiles = await discoverSourceFiles(root, 10);
  assert.equal(defaultFiles.length, 1);
  assert.match(defaultFiles[0]!, /index\.ts$/);

  // Navigable source files also respect custom registry
  const navListing = await listNavigableSourceFiles(root, 10, pythonRegistry);
  assert.deepEqual(navListing.files, ['script.py']);

  // Source preparation with custom registry segments source
  const scope = await prepareSourceScope(root, undefined, pythonRegistry);
  assert.equal(scope.filesProcessed, 1);
  assert.equal(scope.regions.length, 1);
  assert.equal(scope.regions[0]!.filePath, 'script.py');
  assert.match(scope.regions[0]!.text, /print\("hello"\)/);
});

test('Scenario 5: source discovery preserves symlink exclusions and ignored directories', async () => {
  const root = await fixture();
  await writeFile(join(root, 'valid.ts'), 'export const a = 1;\n');
  await symlink(join(root, 'valid.ts'), join(root, 'symlinked.ts'));
  const nodeModules = join(root, 'node_modules');
  await (await import('node:fs/promises')).mkdir(nodeModules);
  await writeFile(join(nodeModules, 'dep.ts'), 'export const b = 2;\n');

  const files = await discoverSourceFiles(root, 10);
  assert.equal(files.length, 1);
  assert.match(files[0]!, /valid\.ts$/);
});

test('Scenario 6: JS/TS adapter methods produce identical results to direct functions', async () => {
  const root = await fixture();
  await writeFile(join(root, 'auth.ts'), 'export function login(user: string) { return user; }\nlogin("alice");\n');

  const symbolsFromAdapter = await javaScriptTypeScriptAdapter.extractSymbols!(root);
  assert.equal(symbolsFromAdapter.symbols.length, 1);
  assert.equal(symbolsFromAdapter.symbols[0]?.name, 'login');

  const usages = await javaScriptTypeScriptAdapter.findPossibleUsages!(root, symbolsFromAdapter.symbols[0]!);
  assert.equal(usages.usages.length, 1);
  assert.equal(usages.usages[0]?.line, 2);

  const def = await javaScriptTypeScriptAdapter.resolveDefinition!(root, {
    filePath: 'auth.ts',
    line: 2,
    column: 1,
  });
  assert.equal(def.outcome, 'resolved');
  if (def.outcome === 'resolved') {
    assert.equal(def.definition.name, 'login');
    assert.equal(def.definition.startLine, 1);
  }
});
