# Multilingual Code Intelligence Architecture

## 1. Overview and Product Vision

LocalCode Intelligence is designed as a **privacy-first, local-first, multilingual code intelligence platform** for semantic repository search, structural understanding, and source-grounded navigation.

All source parsing, embedding inference, and navigation remain strictly local, preserving read-only analysis without executing repository code.

Supported languages transition across three capability levels:
- **Basic:** exact-text search, semantic vector search, bounded source viewing
- **Structural:** syntax-aware segmentation, symbol/declaration extraction, possible-usage lookup
- **Precise:** compiler-proven or reliably resolved definition navigation

Languages must never advertise capabilities that have not been implemented.

---

## 2. Pluggable Language Adapter Design

The core system introduces an extensible adapter boundary located in `src/languages/`:

```
src/languages/
  types.ts                  # LanguageAdapter and capability contract
  registry.ts               # LanguageRegistry class for extension matching
  javascript-typescript.ts   # Existing TS Compiler API implementation wrapped as adapter
  index.ts                  # Public exports and defaultLanguageRegistry singleton
```

### Capability Contract

Each adapter declares its identity, supported extensions, and explicit capability flags:

```typescript
export interface LanguageCapabilities {
  basic: boolean;
  structural: boolean;
  precise: boolean;
}

export interface LanguageAdapter {
  readonly id: LanguageId;
  readonly name: string;
  readonly fileExtensions: readonly string[];
  readonly capabilities: Readonly<LanguageCapabilities>;

  segmentSource?(filePath: string, content: string, limits?: SourceLimits): SourceRegion[];
  extractSymbols?(repositoryPath: string, limits?: SourceLimits): Promise<SymbolResult>;
  findPossibleUsages?(repositoryPath: string, selected: SourceSymbol, limits?: SourceLimits): Promise<UsageResult>;
  resolveDefinition?(repositoryPath: string, request: PositionRequest, limits?: SourceLimits): Promise<DefinitionResult>;
}
```

Optional methods reflect unimplemented capabilities clearly rather than fabricating results or returning empty success.

---

## 3. Language Registry Mechanics

`LanguageRegistry` provides deterministic mapping from file paths and extensions to their registered adapters:

- **Deterministic extension matching:** Normalizes extensions to lowercase with leading dot.
- **Safety against conflicting registrations:** Throws descriptive errors if duplicate language IDs or colliding file extensions are registered.
- **Zero side-effects:** Constructing a registry or looking up adapters does not trigger model downloads, embedding initialization, or filesystem I/O.
- **Extensible:** Isolated registry instances can be created for tests or future plugins via `new LanguageRegistry([...adapters])` or `createDefaultLanguageRegistry()`.

---

## 4. Source Discovery Integration

Source file discovery in `src/source.ts` derives supported extensions directly from the language registry:

```typescript
export const SOURCE_EXTENSIONS = defaultLanguageRegistry.getSupportedExtensions();
```

`discoverSourceFiles`, `prepareSourceScope`, and `listNavigableSourceFiles` accept an optional `LanguageRegistry` parameter (defaulting to `defaultLanguageRegistry`).

All core safety and security constraints remain strictly enforced:
- **No symlinks:** Symlinks are rejected during filesystem traversal and file reading.
- **Ignored directories:** `.git`, `node_modules`, `dist`, `build`, etc., are excluded before traversal.
- **Source bounds:** Bounded to 500 files, 256 KiB per file, and 5 MiB total per scope.
- **Read limits:** Files exceeding size limits are skipped before reading, with explicit coverage warnings.

---

## 5. Current Implementation Status

| Language | Extensions | Basic | Structural | Precise | Engine |
|----------|------------|-------|------------|---------|--------|
| **JavaScript / TypeScript** | `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts` | Yes | Yes | Yes | TypeScript Compiler API |
| *Python (Planned)* | `.py`, `.pyi` | Planned | Planned | Planned | Tree-sitter / AST |
| *Go (Planned)* | `.go` | Planned | Planned | Planned | Tree-sitter / Compiler |
| *Java (Planned)* | `.java` | Planned | Planned | Planned | Tree-sitter / Compiler |
| *Rust (Planned)* | `.rs` | Planned | Planned | Planned | Tree-sitter / Compiler |
| *C / C++ (Planned)* | `.c`, `.cc`, `.cpp`, `.h`, `.hpp` | Planned | Planned | Planned | Tree-sitter / Clang |

---

## 6. How to Implement a New Language Adapter

To add support for a future language (e.g., Python):

1. **Implement `LanguageAdapter`** in `src/languages/python.ts`:
   - Declare `id: 'python'`, `fileExtensions: ['.py', '.pyi']`.
   - Specify accurate capability flags (e.g. `basic: true, structural: false, precise: false` if only search is implemented initially).
   - Implement `segmentSource` if language-specific syntax boundaries are available.
   - Implement `extractSymbols`, `findPossibleUsages`, and `resolveDefinition` as structural and precise tooling is developed.

2. **Register the adapter** in `src/languages/index.ts`:
   - Add `pythonAdapter` to `createDefaultLanguageRegistry()`.

3. **Verify invariant preservation:**
   - Source discovery automatically scans Python files.
   - Exact text search and semantic search index the new language without changing the embedding model or ranking pipeline.
   - Symbol exploration and Go to Definition will only be active if the adapter implements and declares the corresponding capabilities.
