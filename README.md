# LocalCode Intelligence

A local-first semantic and exact-text code search tool for JavaScript and TypeScript repositories.
Runs entirely on your machine — no cloud, no telemetry, no authentication, no persistent index.

---

<!-- Screenshot placeholder: replace with an actual screenshot of the web UI -->
<!-- ![LocalCode Intelligence UI](docs/screenshot.png) -->

---

## What It Does

- Takes a natural-language query and a local repository path
- Discovers and segments `.js` / `.ts` source files (and variants)
- Embeds everything locally using `Xenova/all-MiniLM-L6-v2` via Transformers.js (quantized, ~23 MB)
- Returns ranked candidate code regions with cosine similarity scores and source excerpts
- Includes instant literal text search for identifiers, TODOs, and messages, with case-sensitive and whole-word options
- Includes a local Symbol Explorer for actual JS/TS declarations and class/interface members (not usages or type-aware Go to Definition)
- Provides a polished dark web UI for browsing results and inspecting source context in place

All embeddings and inference run in the same Node.js process that serves the UI.  
Nothing leaves your machine.

---

## Requirements

| | |
|---|---|
| **Node.js** | ≥ 20 |
| **Internet** | Required on first run only (downloads the embedding model, ~23 MB, then cached) |
| **Source type** | JavaScript and TypeScript only |

---

## Installation

```bash
git clone https://github.com/sultanshahdev/LocalCode-Intelligence.git
cd LocalCode-Intelligence

# Root dependencies (backend + CLI)
npm install

# Frontend dependencies
npm install --prefix web
```

---

## Running

### Development (hot-reload frontend + backend watch)

```bash
npm run dev
```

- **API + static server**: `http://127.0.0.1:4317`
- **Vite dev server** (frontend HMR): `http://localhost:5173`

The Vite dev server proxies all `/api/*` requests to the backend automatically.

### Production

```bash
npm run build    # compiles TypeScript backend + bundles Vite frontend
npm start        # serves everything from http://127.0.0.1:4317
```

Open **http://127.0.0.1:4317** in your browser.

---

## Using the Web UI

1. **Enter a repository path** — absolute path to a local JavaScript/TypeScript repository
2. **Click "Check Repository"** — validates the path and shows source file coverage
3. **Choose a search mode** — use **AI / Semantic** for a natural-language behavior or concept, or **Exact text** for a literal identifier, TODO, or message fragment
4. **Click "Search"** — semantic search runs local embedding inference (first run downloads the model); exact text scans the bounded local source scope immediately and never loads the model
5. **Review ranked results** — each card shows file, line range, similarity score, and a source excerpt
6. **Click "View Source"** — opens a panel showing the actual current file content with your candidate region highlighted
7. **Browse Files** — after preparation, use the collapsible Files navigator to filter supported JS/TS files and open them in the same source viewer

> **Results are unverified semantic candidates.** Similarity scores are ranking signals, not confidence scores.  
> A high score does not confirm the code does what your query describes.

---

## CLI

The original command-line interface is preserved:

```bash
# Build first
npm run build:backend

# Validate a repository path
node dist/src/cli.js repo check /path/to/repo

# Inspect repository source coverage
node dist/src/cli.js repo status /path/to/repo

# Run a semantic search
node dist/src/cli.js search "your query" --repo /path/to/repo
```

---

## API

### Repository sources

The UI accepts either an absolute local directory or a public `https://github.com/owner/repository` URL (optional `.git` suffix). GitHub repositories are shallow-cloned without submodules into private application-managed temporary storage and reused for the running session. Refresh stages and verifies a new checkout before publishing it, so a failed refresh leaves the prior prepared revision usable. Prepared GitHub results link to a commit-pinned GitHub blob URL. GitHub download needs network access and Git; embeddings, queries, ranking, and source inspection remain local. No source is sent to an AI service.

Checkouts are time-bounded and named with unpredictable IDs; they are temporary process resources, not a persistent repository index. Clone size cannot be hard-limited while Git is downloading, so avoid unusually large repositories.

Repository preparation is available through `POST /api/repositories/prepare` with `{ "source": { "type": "local" | "github", "value": "..." } }`; it returns an opaque `repositoryId` that may be passed to `/api/search` and `/api/source`. Existing path-based API and CLI use remain supported.

Search uses evidence-aware relevance assessment after vector ranking. Similarity remains a ranking signal, never a probability. Clearly unrelated or nonsense queries return `no-relevant-results`; this means no defensible evidence was found, not that a feature is absent.

`POST /api/search/exact` performs literal substring search only—no regex or embedding inference—with `{ "query", "repositoryPath" | "repositoryId", "caseSensitive"?, "wholeWord"? }`. It returns repository-relative file paths, one-based line numbers, bounded line snippets, character spans for highlighting, file/match counts, truncation, and source-coverage warnings. Exact search is capped at 256 query characters and 200 matching lines; it shares the 500-file, 256 KiB-per-file, 5 MiB total source safeguards used by semantic preparation.

`POST /api/symbols` uses the TypeScript compiler parser locally to list bounded declarations for a validated `repositoryPath` or prepared `repositoryId`. It never executes repository code or initializes the embedding model. It covers functions, classes, class/interface methods, interfaces, type aliases, enums, and named arrow/function-expression variables in supported JS/TS and JSX/TSX files.

Search combines local MiniLM semantic ranking with identifier-aware lexical retrieval (camelCase, snake_case, paths, and code tokens) using reciprocal-rank fusion. Exact symbols are therefore not dependent on sentence-embedding similarity alone. Results remain unverified evidence, and source coverage limits can still exclude code outside the configured scope.

JSON API requests must use `Content-Type: application/json` and are limited to 64 KiB. Invalid JSON returns `400`, oversized bodies return `413`, and unsupported content types return `415`, each with a JSON error body. Semantic searches are intentionally serialized because inference is CPU-intensive: one search runs, up to two wait for at most 30 seconds, and further requests receive `503` with `Retry-After: 5`. Health, repository-status, source-view, and static requests are not queued.

The server binds exclusively to `127.0.0.1:4317` (localhost only).

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/api/health` | Service health check |
| `POST` | `/api/repo/status` | Inspect repository source scope and file coverage |
| `POST` | `/api/search` | Run semantic search (loads model on first call) |
| `POST` | `/api/search/exact` | Run instant literal text search (never loads model) |
| `POST` | `/api/symbols` | List parsed source declarations (never loads model) |
| `POST` | `/api/repositories/files` | List up to 500 safe, repository-relative source paths for navigation |
| `POST` | `/api/source` | Read source file lines (read-only, path-safe) |

### POST /api/repo/status
```json
{ "repositoryPath": "/absolute/path/to/repo" }
```

### POST /api/search
```json
{ "query": "natural language description", "repositoryPath": "/absolute/path/to/repo" }
```

### POST /api/source
```json
{
  "repositoryPath": "/absolute/path/to/repo",
  "filePath": "src/foo.ts",
  "startLine": 10,
  "endLine": 50
}
```

### POST /api/search/exact
```json
{ "query": "verifyToken", "repositoryPath": "/absolute/path/to/repo", "caseSensitive": false, "wholeWord": true }
```

---

## Supported Source Languages

| Extension | Included |
|-----------|----------|
| `.js`, `.jsx`, `.mjs`, `.cjs` | ✅ |
| `.ts`, `.tsx`, `.mts`, `.cts` | ✅ |
| Python, Go, Rust, Java, etc.  | ❌ Not currently supported |

---

## Privacy

- The server binds to `127.0.0.1` only — not accessible from other machines
- No data is sent to any external service
- The embedding model is downloaded once from Hugging Face and cached locally (`~/.cache/huggingface/`)
- All inference runs locally in-process
- Cross-origin requests from non-localhost origins are rejected

---

## Embedding Model

**Model:** `Xenova/all-MiniLM-L6-v2` (quantized `q8`, ~23 MB)  
**Source:** [Hugging Face Hub](https://huggingface.co/Xenova/all-MiniLM-L6-v2)  
**Cache:** `~/.cache/huggingface/hub/` (downloaded model files), a bounded in-memory LRU, and a private persistent source-vector cache. On Linux the persistent cache defaults to `$XDG_CACHE_HOME/localcode-intelligence/embeddings`, or `~/.cache/localcode-intelligence/embeddings`. Set `LOCALCODE_EMBEDDING_CACHE_DIR` to use another private cache location.

Only source-region vectors are persisted. Each record is keyed by SHA-256 of the cache format, model/quantization identity, and the exact existing source embedding input; it contains a vector and compatibility metadata, never source text, repository paths, or query text/vectors. Renames therefore invalidate path-prefixed inputs, while content-identical GitHub temporary checkouts can reuse entries. Records use restrictive permissions and atomic replacement; malformed or unavailable records are treated as misses without blocking search. The cache is bounded to 2,000 vector records and evicts oldest modified records on writes.

Set `LOCALCODE_DISABLE_PERSISTENT_CACHE=1` to keep all embedding caching in memory for a process. To clear the default cache safely, stop LocalCode and remove only `$XDG_CACHE_HOME/localcode-intelligence/embeddings` (or `~/.cache/localcode-intelligence/embeddings` when `XDG_CACHE_HOME` is unset). Do not use a broad cache-directory deletion command. A custom `LOCALCODE_EMBEDDING_CACHE_DIR` is private application data and must be cleared only by removing that exact directory.

**First search:** slow (download + embed all files). After restart, unchanged source regions can load from the persistent cache; the model still initializes and each new query still embeds locally. Source discovery remains non-persistent and changed source inputs are recomputed.

On the included three-region fixture with the local quantized model already initialized, a measured cold retrieval took 96 ms and the identical warm retrieval took 2 ms: 4 texts embedded initially, then 4 cache hits and 0 new texts. After editing one source file, the next retrieval embedded only its changed region (1 miss, 3 hits) in 23 ms.

On a temporary 60-file TypeScript fixture (120 regions) with the model already initialized, cold retrieval was 15,465 ms for 121 embeddings; the identical warm retrieval was 82 ms (121 hits); a different query was 56 ms (120 region hits and one query miss). The benchmark process RSS was approximately 1,180 MiB after inference. These are development-laptop measurements, not API end-to-end latency or a memory guarantee.

---

## Current Limitations

- **JavaScript/TypeScript only** — no support for other languages
- **No persistent index** — source is still discovered on every request, so deleted files cannot be returned; persistent caching stores only derived source vectors, not a repository index
- **Scope limits**: max 500 files, 256 KB per file, 5 MB total source per search
- **Bounded reads**: files over 256 KB are skipped from filesystem metadata before their contents are allocated; files changing during scanning are skipped with a coverage warning
- **First search is slow** — model download + full-repo embedding can take 30–90 seconds on first run
- **Exact text is literal** — it does not support regex, symbols in unsupported languages, or results beyond its stated source and match limits
- **Unverified candidates** — semantic similarity is not functional correctness; results require manual review
- **Localhost only** — not designed for multi-user or networked deployment
- **No authentication** — anyone with access to localhost can use the API

---

## Project Structure

```
src/              Backend TypeScript
  cli.ts          Command-line interface
  server.ts       HTTP API + static frontend server (127.0.0.1:4317)
  search.ts       Search orchestration
  retrieval.ts    Embedder creation, cosine similarity, candidate retrieval
  source.ts       Source file discovery and segmentation
  status.ts       Repository status inspection
  repository.ts   Repository path validation

web/              Frontend (React + TypeScript + Vite)
  src/App.tsx     Application UI
  src/api.ts      Typed API client
  src/index.css   Design system stylesheet

dist/             Compiled backend (generated by npm run build)
web/dist/         Bundled frontend (generated by npm run build)
test/             Acceptance and unit tests (existing, not modified in this run)
```

---

## Development Notes

- `npm run dev` requires both backend and frontend to be installed
- The backend must be built (`npm run build:backend`) before `npm run dev` starts the watch server
- `concurrently` is used to run backend watch + Vite dev server in parallel
- Vite proxies `/api/*` to `http://127.0.0.1:4317` during development
- The production server serves the Vite build from `web/dist/` at `/`
