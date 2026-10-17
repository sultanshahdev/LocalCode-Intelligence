# Code Buster

**Find the code behind the behavior.**

Code Buster is a **local-first repository investigation tool** that helps developers explore unfamiliar codebases, find implementations from natural-language questions, compare promising matches, and follow real source evidence.

Instead of requiring you to know a function name or file path, Code Buster lets you investigate questions like:

- *Where is a failed payment scheduled for another attempt?*
- *Where is an expired session rejected?*
- *Which function verifies incoming webhook signatures?*
- *Where are excessive API requests blocked?*

A search can surface several plausible functions. Code Buster ranks candidates and exposes their **repository-relative paths, line ranges, and source excerpts** so you can determine what each implementation actually does. **Ranking is evidence, not proof of functional correctness.**

## Highlights

| Capability | What you can do |
| --- | --- |
| **Semantic code search** | Search by behavior or intent without knowing an exact identifier; inspect ranked source candidates. |
| **Exact-text search** | Find literal identifiers, strings, and code fragments with optional case-sensitive and whole-word matching. |
| **Multilingual exploration** | Browse and search JavaScript, TypeScript, Python, Go, Java, Rust, C, C++, C#, Ruby, PHP, and Bash/Shell source through registered language adapters. |
| **Symbol Explorer** | Discover functions, classes, methods, and other declarations using syntax-aware parsers. |
| **Possible usages** | Explore potential references to a selected symbol; results are candidates, not guaranteed resolved references. |
| **Go to Definition** | Navigate to supported JS/TS definitions using bounded TypeScript compiler analysis; other languages may report unsupported or unresolved results. |
| **Repository map and file explorer** | Browse a real directory/file hierarchy, navigate to files, and inspect source directly. |
| **Source-grounded navigation** | Open actual file content with line numbers, contextual excerpts, coverage notices, and commit-pinned GitHub links where available. |
| **Local-first processing** | Run the search engine and embedding model locally, without sending repository content to a hosted AI inference service. |

The web experience includes the Code Buster landing page, illustrative code-investigation stories, and an interactive repository workspace. Marketing examples illustrate concepts and are **not live search outputs**.

## How it works

1. **Choose a repository.** Enter a path to a local folder, or a public GitHub repository URL. GitHub access requires a network connection and Git.
2. **Prepare the source.** Code Buster discovers eligible files within explicit read and size limits.
3. **Ask a question.** Use semantic search for behavior-oriented questions, or exact search for literal code.
4. **Compare candidates.** Review paths, excerpts, and ranking signals instead of assuming the first result is correct.
5. **Follow the evidence.** Open source lines, browse files and symbols, inspect possible usages, and navigate definitions where supported.

### Search vs. verification

Code Buster does **not** execute repository code or formally prove what a function does. Semantic scores are ranking signals rather than probabilities. Partial indexing coverage, unsupported language capabilities, and uncertain results should be evaluated alongside the source.

## Supported languages and capabilities

| Language | Semantic / exact search | Structural symbols and possible usages | Precise Go to Definition |
| --- | --- | --- | --- |
| JavaScript / TypeScript (including JSX / TSX) | Yes | Yes | Supported through TypeScript compiler analysis, subject to repository and resolution limits |
| Python | Yes | Yes, via Tree-sitter WASM | Not yet |
| Go | Yes | Yes, via Tree-sitter WASM | Not yet |
| Java | Yes | Yes, via Tree-sitter WASM | Not yet |
| Rust | Yes | Yes, via Tree-sitter WASM | Not yet |
| C / C++ | Yes | Yes, via Tree-sitter WASM | Not yet |
| C# | Yes | Yes, via Tree-sitter WASM | Not yet |
| Ruby | Yes | Yes, via Tree-sitter WASM | Not yet |
| PHP | Yes | Yes, via Tree-sitter WASM | Not yet |
| Bash / Shell | Yes | Yes, via Tree-sitter WASM | Not yet |

The registered parser capabilities differ by language. Structural usage lookup identifies **possible usages**, not necessarily type-resolved references. The source scanner assigns `.h` to C and `.hpp`, `.hh`, and `.hxx` to C++.

## Get started locally

### Requirements

- Node.js **20 or newer**
- npm
- Git when opening public GitHub repositories
- Internet access for the first embedding-model download (and GitHub repository acquisition)

### Install

```bash
git clone https://github.com/sultanshahdev/code-buster.git
cd code-buster
npm ci
npm ci --prefix web
```

### Run the web app in development

```bash
npm run dev
```

Open **http://localhost:5173**. The Vite frontend proxies `/api` requests to the localhost Node service at `127.0.0.1:4317`.

### Run the built app

```bash
npm run build
npm start
```

Open **http://127.0.0.1:4317**. This serves the built React frontend and API from the same local Node process.

### CLI

The preferred command is `codebuster`; `localcode` remains a compatibility alias.

From a checkout, use the npm script without global installation:

```bash
npm run codebuster -- repo check .
npm run codebuster -- repo status .
npm run codebuster -- search "where is an expired session rejected?" --repo .
```

For a separately installed CLI binary, the corresponding syntax is `codebuster repo check <path>`, `codebuster repo status <path>`, and `codebuster search "<question>" --repo <path>`.

## Architecture

```text
web/                  React + TypeScript + Vite
  src/landing/        Product website and illustrative demos
  src/workspace/      Repository investigation UI
  src/api.ts          Typed client for the local Node API
src/                  Node.js + TypeScript backend and CLI
  server.ts           Localhost-only API and static web serving
  source.ts           Bounded discovery, source snapshots, segmentation
  retrieval.ts        Local embeddings and candidate ranking
  search.ts           Semantic search orchestration
  symbols.ts          Source symbols, usages and definitions
  languages/          JS/TS and Tree-sitter WASM language adapters
test/                 Deterministic and acceptance tests
scripts/              Browser smoke tests
```

Semantic retrieval uses the locally executed `Xenova/all-MiniLM-L6-v2` model through Transformers.js, together with lexical/code-aware ranking signals. Source-region embedding vectors may be persisted in a private local cache across restarts; the tool does not maintain an unrestricted permanent copy of indexed repository source. First-use model initialization and repository embedding can take time.

### Safety and scope

- The API intentionally binds to **127.0.0.1**, not to a public interface.
- Repository source is inspected read-only; application code is not executed.
- Source snapshots are bounded to **500 files**, **256 KiB per file**, and **5 MiB aggregate**; incomplete coverage is reported.
- Traversal excludes ignored paths and symlinks and validates repository-relative reads.
- GitHub repositories are acquired into application-managed temporary local checkouts. Public GitHub retrieval sends the requested repository to GitHub; model inference itself stays local.
- The API is designed for a **single trusted local user**, not untrusted internet traffic.

## HTTP API

The local app exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/languages` | Registered language and capability manifest |
| `POST /api/repositories/prepare` | Prepare a local or public GitHub repository |
| `POST /api/repo/status` | Repository eligibility and coverage |
| `POST /api/search` | Semantic search |
| `POST /api/search/exact` | Literal text search |
| `POST /api/repositories/files` | Supported navigable files |
| `POST /api/repository/map` | Repository hierarchy metadata |
| `POST /api/symbols` | Declaration discovery |
| `POST /api/symbols/usages` | Possible usage lookup |
| `POST /api/symbols/definition` | Supported definition navigation |
| `POST /api/source` | Source line inspection |

Requests are JSON and repository-dependent routes require a prepared repository ID or an appropriate validated repository path.

## Free website deployment — Cloudflare Pages

The **landing page and illustrative product demos** can be hosted on Cloudflare Pages using this repository:

| Setting | Value |
| --- | --- |
| Framework | React (Vite) |
| Production branch | `main` |
| Root directory | `web` |
| Build command | `npm run build` |
| Output directory | `dist` |

**Important:** Deploying only `web/dist` publishes a static frontend. The current repository loading, source reading, symbol navigation, and semantic/exact search features call the Node server's `/api` routes, which **do not run on static Cloudflare Pages**.

A future browser-native engine (for example, browser-side repository acquisition, WASM parsing, and Transformers.js inference) would be required before the complete workspace can run on static hosting at no server cost. Until implemented and verified, treat a Pages deployment as a **product website/demo, not a working public repository-search service**. Do not expose the existing localhost API to the internet as a workaround.

## Development checks

```bash
npm run build
npm test
node scripts/browser-smoke.mjs
```

Tests may require Playwright Chromium to be installed. See the CI workflow for its browser setup.

## Roadmap and limitations

- Browser-native, server-free repository exploration is a **future milestone**, not an implemented deployment mode.
- A public multi-user server would need a separate security and resource-isolation design.
- Go to Definition is currently compiler-backed for JS/TS; other language adapters provide syntax-aware structural capabilities, not equivalent precise resolution.
- Semantic retrieval can miss relevant regions or rank an unrelated result; always inspect evidence.
- Resource budgets deliberately limit large repositories and may produce partial results.
- Initial model download and inference require enough local CPU/RAM and can be slower on modest machines.

---

**Code Buster** — *Find the code behind the behavior.*
