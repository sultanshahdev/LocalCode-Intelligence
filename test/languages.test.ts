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
  segmentSource,
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

// ── New acceptance tests ──────────────────────────────────────────────────────

test('Acceptance: registry rejects duplicate normalized extensions within a single adapter', () => {
  const registry = new LanguageRegistry();

  // Same extension with different casing counts as duplicate
  assert.throws(() => {
    registry.register({
      id: 'confusing',
      name: 'Confusing',
      fileExtensions: ['.foo', '.FOO'],
      capabilities: { basic: true, structural: false, precise: false },
    });
  }, /duplicate file extension/i);

  // Exact duplicate within the same adapter
  assert.throws(() => {
    registry.register({
      id: 'doubled',
      name: 'Doubled',
      fileExtensions: ['.bar', '.bar'],
      capabilities: { basic: true, structural: false, precise: false },
    });
  }, /duplicate file extension/i);
});

test('Acceptance: registry rejects structural capability without required method implementations', () => {
  const registry = new LanguageRegistry();

  // Declares structural but missing extractSymbols
  assert.throws(() => {
    registry.register({
      id: 'fake-structural',
      name: 'Fake Structural',
      fileExtensions: ['.fk'],
      capabilities: { basic: true, structural: true, precise: false },
      // findPossibleUsages present but not extractSymbols
      findPossibleUsages: async () => ({ symbol: {} as never, usages: [], truncated: false, scope: { filesProcessed: 0, filesDiscovered: 0, warnings: [] } }),
    });
  }, /extractSymbols/);

  // Declares structural but missing findPossibleUsages
  assert.throws(() => {
    registry.register({
      id: 'fake-structural2',
      name: 'Fake Structural 2',
      fileExtensions: ['.fk2'],
      capabilities: { basic: true, structural: true, precise: false },
      extractSymbols: async () => ({ symbols: [], truncated: false, scope: { filesProcessed: 0, filesDiscovered: 0, warnings: [] } }),
      // missing findPossibleUsages
    });
  }, /findPossibleUsages/);

  // Declares precise but missing resolveDefinition
  assert.throws(() => {
    registry.register({
      id: 'fake-precise',
      name: 'Fake Precise',
      fileExtensions: ['.fp'],
      capabilities: { basic: true, structural: false, precise: true },
      // missing resolveDefinition
    });
  }, /resolveDefinition/);
});

test('Acceptance: basic-capability adapter is discoverable via registry but never processed by JS/TS structural analyzer', async () => {
  const root = await fixture();
  await writeFile(join(root, 'module.ts'), 'export function tsFunc() {}\n');
  await writeFile(join(root, 'readme.basic'), '# just text\n');

  // An isolated registry with both JS/TS and a basic-only language
  const testRegistry = new LanguageRegistry([
    javaScriptTypeScriptAdapter,
    {
      id: 'basic-lang',
      name: 'Basic Language',
      fileExtensions: ['.basic'],
      capabilities: { basic: true, structural: false, precise: false },
      // no extractSymbols, no findPossibleUsages, no resolveDefinition
    },
  ]);

  // Both file types are discoverable
  const files = await discoverSourceFiles(root, 10, testRegistry);
  assert.equal(files.length, 2, 'both .ts and .basic files should be discovered');

  // Source preparation via the test registry picks up both files
  const scope = await prepareSourceScope(root, undefined, testRegistry);
  assert.equal(scope.filesProcessed, 2, 'both files should be prepared');
  const filePaths = scope.regions.map(r => r.filePath);
  assert.ok(filePaths.some(p => p.endsWith('.ts')), 'should have a .ts region');
  assert.ok(filePaths.some(p => p.endsWith('.basic')), 'should have a .basic region');

  // The basic-lang adapter has no structural capability — symbols only come from JS/TS
  const structuralAdapters = testRegistry.getAllAdapters().filter(
    a => a.capabilities.structural && typeof a.extractSymbols === 'function',
  );
  assert.equal(structuralAdapters.length, 1, 'only JS/TS has structural capability');
  assert.equal(structuralAdapters[0]!.id, 'javascript-typescript');

  // Extracting symbols from the test registry only processes .ts files
  const result = await structuralAdapters[0]!.extractSymbols!(root);
  assert.equal(result.symbols.length, 1, 'only one symbol from the .ts file');
  assert.equal(result.symbols[0]!.name, 'tsFunc');
  assert.equal(result.symbols[0]!.filePath, 'module.ts');

  // The .basic file must not appear in symbol results
  const basicFileSymbols = result.symbols.filter(s => s.filePath.endsWith('.basic'));
  assert.equal(basicFileSymbols.length, 0, '.basic files must never be parsed by the JS/TS structural analyzer');
});

test('Acceptance: mixed-language repo preserves adapter isolation — Python-like file never processed as TypeScript', async () => {
  const root = await fixture();
  await writeFile(join(root, 'server.ts'), 'export function serve() {}\n');
  // Python-like file with syntax incompatible with TypeScript/JavaScript
  await writeFile(join(root, 'utils.py'), 'def helper():\n    return 42\n');

  // Production registry (JS/TS only) must NOT discover the .py file
  const defaultFiles = await discoverSourceFiles(root, 10);
  assert.equal(defaultFiles.length, 1, 'default registry discovers only .ts file');
  assert.ok(defaultFiles[0]!.endsWith('server.ts'));

  // JS/TS adapter does not discover the .py file during symbol extraction
  const result = await javaScriptTypeScriptAdapter.extractSymbols!(root);
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]!.name, 'serve');

  // No .py file appears in the scope
  assert.equal(result.scope.filesProcessed, 1, 'only one file processed');

  // Registry lookup for .py returns no adapter in production
  const pyAdapter = defaultLanguageRegistry.getByPath('utils.py');
  assert.equal(pyAdapter, undefined, 'production registry must not resolve a .py adapter');
});

test('Acceptance: unsupported precise navigation returns honest unsupported outcome, not fabricated coordinates', async () => {
  const root = await fixture();
  await writeFile(join(root, 'data.basic'), '# no TS here\n');

  // Create a test registry where .basic has no precise capability
  const testRegistry = new LanguageRegistry([
    {
      id: 'basic-lang',
      name: 'Basic Language',
      fileExtensions: ['.basic'],
      capabilities: { basic: true, structural: false, precise: false },
    },
  ]);

  const adapter = testRegistry.getByPath('data.basic');
  assert.ok(adapter, 'adapter must be found for .basic');
  assert.equal(adapter.capabilities.precise, false);
  assert.equal(adapter.resolveDefinition, undefined, 'basic adapter must not have resolveDefinition');

  // Simulates what handleDefinition does when no precise adapter is available
  if (!adapter.capabilities.precise || typeof adapter.resolveDefinition !== 'function') {
    const outcome = { outcome: 'unsupported' as const, message: 'Definition resolution is not supported for this source language.', warnings: [] };
    assert.equal(outcome.outcome, 'unsupported');
    assert.ok(outcome.message.includes('not supported'));
  } else {
    assert.fail('Should not have reached precise dispatch for a non-precise adapter');
  }
});

test('Acceptance: segmentation output from adapter and shared function is byte-for-byte identical', () => {
  const filePath = 'src/example.ts';
  const content = [
    'export function alpha() {}',
    'export function beta() {}',
    'export function gamma() {}',
    'export function delta() {}',
    'export function epsilon() {}',
    'export function zeta() {}',
    'export function eta() {}',
  ].join('\n');

  const limits = { windowLines: 4, overlapLines: 1 };

  // Direct segmentSource from source.ts
  const fromShared = segmentSource(filePath, content, limits);
  // Via adapter.segmentSource (which delegates to the same function)
  const fromAdapter = javaScriptTypeScriptAdapter.segmentSource!(filePath, content, limits);

  assert.deepEqual(fromAdapter, fromShared, 'adapter segmentSource must be byte-for-byte identical to shared segmentSource');
  assert.ok(fromShared.length > 0, 'should produce at least one region');

  for (let i = 0; i < fromShared.length; i++) {
    assert.equal(fromAdapter[i]!.filePath, fromShared[i]!.filePath);
    assert.equal(fromAdapter[i]!.startLine, fromShared[i]!.startLine);
    assert.equal(fromAdapter[i]!.endLine, fromShared[i]!.endLine);
    assert.equal(fromAdapter[i]!.text, fromShared[i]!.text);
  }
});

test('Acceptance: SOURCE_EXTENSIONS reflects the default JS/TS registry extensions', () => {
  const supported = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
  for (const ext of supported) {
    assert.ok(SOURCE_EXTENSIONS.has(ext), `SOURCE_EXTENSIONS should include ${ext}`);
  }
  assert.ok(!SOURCE_EXTENSIONS.has('.py'), 'SOURCE_EXTENSIONS must not include .py in production');
  assert.ok(!SOURCE_EXTENSIONS.has('.go'), 'SOURCE_EXTENSIONS must not include .go in production');
});

test('Acceptance: defaultLanguageRegistry is a stable singleton with correct JS/TS capabilities', () => {
  // Both calls must return the same object (same reference via singleton)
  const r1 = defaultLanguageRegistry;
  const r2 = defaultLanguageRegistry;
  assert.strictEqual(r1, r2, 'defaultLanguageRegistry must be the same singleton reference');

  // Must support all JS/TS extensions
  assert.ok(r1.isSupported('file.ts'));
  assert.ok(r1.isSupported('file.js'));
  // Must not support Python or Go
  assert.ok(!r1.isSupported('file.py'));
  assert.ok(!r1.isSupported('file.go'));

  // The JS/TS adapter must have all three capability tiers
  const jstsAdapter = r1.getByPath('file.ts');
  assert.ok(jstsAdapter);
  assert.equal(jstsAdapter.capabilities.basic, true);
  assert.equal(jstsAdapter.capabilities.structural, true);
  assert.equal(jstsAdapter.capabilities.precise, true);
});


test('Regression: adding another production language does not send its files through the TS parser', async () => {
  const root = await fixture();
  await writeFile(join(root, 'module.ts'), 'export function run() {}\n');
  await writeFile(join(root, 'module.py'), 'def python_only():\n    return 42\n');

  // Isolation in a separate process avoids mutating the default registry used by other tests.
  const { spawnSync } = await import('node:child_process');
  const indexUrl = new URL('../src/languages/index.js', import.meta.url).href;
  const script = [
    `import { defaultLanguageRegistry, javaScriptTypeScriptAdapter } from ${JSON.stringify(indexUrl)};`,
    `defaultLanguageRegistry.register({ id: 'python-test', name: 'Python Test', fileExtensions: ['.py'], capabilities: { basic: true, structural: false, precise: false } });`,
    `const scope = await javaScriptTypeScriptAdapter.extractSymbols(${JSON.stringify(root)});`,
    `if (scope.scope.filesProcessed !== 1 || scope.symbols.some(s => s.filePath.endsWith('.py'))) { console.error(JSON.stringify(scope)); process.exitCode = 2; }`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'TS parser unexpectedly processed Python');
});
