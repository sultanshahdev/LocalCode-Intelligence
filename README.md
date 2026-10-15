# LocalCode Intelligence

LocalCode Intelligence is a local-first CLI for finding inspectable source-code
candidates from a natural-language description. It supports on-demand semantic
search over JavaScript and TypeScript, plus repository-scope validation and search-readiness reporting.

## Requirements

- Node.js 20 or newer
- npm

## Install

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install
npm run build
npm link
```

The environment variable prevents ONNX Runtime's Linux installer from fetching
optional CUDA libraries. LocalCode uses CPU inference and does not require them.

`npm link` makes the `localcode` executable available from your shell. During
development, you can run the same command without linking via `npm run localcode --`.

## Search by behavior

```sh
localcode search "where is an expired session rejected?" --repo ./path/to/source
```

Or, without `npm link`:

```sh
npm run localcode -- search "where is an expired session rejected?" --repo ./path/to/source
```

The first search downloads the quantized `Xenova/all-MiniLM-L6-v2` ONNX model
(about 23 MB, plus tokenizer/configuration files) from Hugging Face. Transformers.js
caches it under `node_modules/@huggingface/transformers/.cache/`; later searches
reuse that cache and can run offline. Model acquisition is separate from search:
repository paths, source text, and embeddings are processed locally and are not
sent to Hugging Face or any inference API. LocalCode contains no telemetry.

Semantic search uses the bundled CPU execution provider. Security overrides
keep `sharp` at 0.35.5 (patched native image
libraries) and `global-agent` at 4.1.3 (removing the vulnerable legacy logging
chain used only by ONNX Runtime's installer). These overrides are recorded in
the lockfile and covered by the real-model integration test.

Search results include the relative file path, exact one-based line range,
cosine similarity score, and actual source excerpt. Similarity orders candidates
for inspection; it is not proof that a candidate implements the requested behavior.
Every displayed match is labeled as unverified and uncertain. A score is a ranking
signal, not a probability of correctness. Git metadata is not required.

LocalCode displays only retrieved candidates with positive cosine alignment. Zero
is used as a mathematical display floor: zero or negative alignment means the
vectors are orthogonal or point in opposing directions. This is not a calibrated
relevance threshold, and even a positive score can be unrelated. When every
retrieved candidate is non-positive, the command reports a successful search with
no sufficiently supported candidate and explicitly avoids claiming that the
behavior is absent. Model or processing failures remain errors, and source-coverage
warnings remain visible for both candidate and no-candidate outcomes.

## Check repository search readiness

```sh
localcode repo status ./path/to/source
```

This read-only command validates the directory with the same rules as `repo check`,
then runs the same bounded JavaScript/TypeScript discovery and source preparation
used by search. It reports the resolved path, supported files found, files processed,
source eligibility, and whether concrete size or count limits made coverage partial.
Git metadata is not required.

Status is a current inspection, not a stored result: each invocation scans the scope
again. `Source eligibility: Available` means at least one non-empty source region can
be prepared under the configured rules. It does not mean the whole repository is
covered. Empty files and files skipped by limits do not provide eligible content.

The command does not initialize or download the embedding model, execute semantic
retrieval, create an index, or modify the inspected repository. The explicit
preparation, persistent-index, model-readiness, and search-execution fields make
these boundaries clear. A successful search is the only current way to verify
model readiness and retrieval execution.

## Check a repository scope

```sh
localcode repo check ./path/to/source
```

Or, without `npm link`:

```sh
npm run localcode -- repo check ./path/to/source
```

On success, LocalCode reports the resolved absolute directory:

```text
Validated repository scope: /absolute/path/to/source
Status: directory is readable; indexing has not been performed.
```

The path may be relative or absolute and may contain spaces. It must exist, be
a directory, and permit read-only access (including directory traversal where
the operating system requires it). Git metadata is not required.

Exit statuses are `0` for successful validation, `1` when the path cannot be
used, and `2` for command or argument usage errors. Errors are written to
standard error.

## Tests

```sh
npm test
```

Ordinary tests are deterministic and do not load or download a model. To run the
real local-model integration test after installing dependencies:

```sh
npm run build
LOCALCODE_RUN_MODEL_TEST=1 node --test dist/test/model.integration.test.js
```

The controlled fixture and its human label are in
`test/fixtures/semantic-repository`. A reproducible end-to-end demonstration is:

```sh
npm run localcode -- search \
  "where is an expired session rejected?" \
  --repo test/fixtures/semantic-repository
```

Tests create isolated fixtures in the operating system's temporary directory;
they do not modify the repository being checked.

## Search scope and limits

- Supported extensions are `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`,
  `.mts`, and `.cts`.
- Symlinks are not followed. Common dependency, cache, generated, and build
  directories are skipped, including `.git`, `node_modules`, `dist`, `build`,
  `coverage`, `.next`, `.nuxt`, `out`, `vendor`, `generated`, and `.cache`.
- Search processes at most 500 files, 256 KiB per file, and 5 MiB total source
  per invocation. Output warnings identify when these limits reduce coverage.
- Source is segmented into overlapping 40-line windows (10-line overlap), not
  parsed functions or symbols. Consequently, a candidate can span multiple
  functions or omit nearby context.
- Preparation and embeddings are on demand; there is no persistent repository
  index, incremental update, background service, or file watcher.
- The compact general text embedding model understands many intent/code
  relationships but is not a code-analysis engine. Ranking quality can vary,
  especially for domain-specific vocabulary and behavior that requires tracing
  calls across files.
- Validation is not persisted between CLI invocations, and searching requires
  readable supported source content.
- Access-denied behavior is tested with deterministic filesystem substitutes,
  because permission-bit integration tests are unreliable when tests run with
  elevated privileges or on platforms with different permission models.
