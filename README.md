# LocalCode Intelligence

Local-first semantic code search for JavaScript and TypeScript repositories.  
Runs entirely on your machine — no cloud, no indexing, no authentication.

---

## What It Does

- Accepts a natural-language query and a local repository path
- Discovers and segments `.js`/`.ts` source files
- Embeds them locally using `Xenova/all-MiniLM-L6-v2` (Transformers.js, quantized)
- Returns ranked candidate regions with similarity scores and source excerpts
- Provides a polished dark web UI for browsing results and viewing source context

---

## Requirements

- **Node.js ≥ 20**
- Internet access on first run (downloads the embedding model ~25 MB, cached after)

---

## Installation

```bash
git clone https://github.com/sultanshahdev/LocalCode-Intelligence.git
cd LocalCode-Intelligence
npm install
npm install --prefix web
```

---

## Running

### Development (hot-reload frontend + backend)

```bash
npm run dev
```

- Backend API: `http://127.0.0.1:4317`
- Frontend (Vite dev): `http://localhost:5173`

### Production

```bash
npm run build      # compile TypeScript + bundle Vite frontend
npm start          # serve everything from http://127.0.0.1:4317
```

Open **http://127.0.0.1:4317** in your browser.

---

## CLI (preserved)

```bash
# Repository validation
node dist/src/cli.js repo check /path/to/repo

# Repository status
node dist/src/cli.js repo status /path/to/repo

# Semantic search
node dist/src/cli.js search "your query" --repo /path/to/repo
```

---

## API

All routes are bound to `127.0.0.1` only (localhost).

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Service health |
| POST | `/api/repo/status` | Inspect repository source scope |
| POST | `/api/search` | Semantic search |
| POST | `/api/source` | Read source lines (read-only, path-safe) |

### POST /api/repo/status
```json
{ "repositoryPath": "/absolute/path/to/repo" }
```

### POST /api/search
```json
{ "query": "your natural language query", "repositoryPath": "/path/to/repo" }
```

### POST /api/source
```json
{ "repositoryPath": "/path/to/repo", "filePath": "src/foo.ts", "startLine": 10, "endLine": 50 }
```

---

## Limitations

- **JavaScript and TypeScript only** — `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`
- **File limits**: max 500 files, 256 KB per file, 5 MB total scope per search
- **First search is slow**: model download (~25 MB) + embedding all files takes time. Subsequent searches in the same server session reuse the cached model.
- **No persistent index**: the repository is re-embedded on every search request
- **Similarity is not verified relevance**: results are unverified semantic candidates; the model may surface irrelevant code
- **Localhost only**: the server binds to `127.0.0.1` and rejects cross-origin requests from external origins
- **No authentication, no database, no cloud**

---

## Security

- API binds exclusively to `127.0.0.1:4317`
- Source viewer validates all file paths: rejects absolute paths, traversal (`../`), and symlinks
- JSON request bodies are bounded at 64 KB
- Browser origin is checked; external origins are rejected

---

## Project Structure

```
src/           Backend TypeScript (CLI + API server + search engine)
  cli.ts       Command-line interface
  server.ts    HTTP API server
  search.ts    Search orchestration
  retrieval.ts Embedding + cosine similarity
  source.ts    Source discovery and segmentation
  status.ts    Repository status inspection
  repository.ts Repository path validation
web/           Frontend (React + TypeScript + Vite)
  src/App.tsx  Main application
  src/api.ts   API client
  src/index.css Dark developer stylesheet
dist/          Compiled backend (after npm run build)
web/dist/      Bundled frontend (after npm run build)
```
