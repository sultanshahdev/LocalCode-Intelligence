#!/usr/bin/env node
/**
 * LocalCode Intelligence — localhost-only HTTP API server.
 * Binds to 127.0.0.1:4317 by default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, realpath, open } from 'node:fs/promises';
import { constants, existsSync, createReadStream } from 'node:fs';
import { resolve, relative, join, sep, extname, isAbsolute, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { validateRepositoryDirectory } from './repository.js';
import { inspectRepositorySearchStatus } from './status.js';
import { searchRepository } from './search.js';
import { CachingEmbedder, createLocalEmbedder, type Embedder } from './retrieval.js';
import { prepareSourceScope, DEFAULT_SOURCE_LIMITS } from './source.js';
import { SearchExecutionController, SearchOverloadedError, SearchQueueAbortedError } from './search-execution.js';
import { GitHubRepositoryAcquirer, GitHubRepositoryError } from './github-repository.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env['PORT'] ?? 4317);
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const JSON_CONTENT_TYPE = 'application/json';

// ── Cached embedder ───────────────────────────────────────────────────────────
let cachedEmbedder: Embedder | null = null;
let embedderInitialization: Promise<Embedder> | null = null;
const searchController = new SearchExecutionController(1, 2);
const githubAcquirer = new GitHubRepositoryAcquirer();
const preparedRepositories = new Map<string, { path: string; type: 'local' | 'github'; label: string; githubUrl: string | undefined; revision: string | undefined }>();
async function getEmbedder(): Promise<Embedder> {
  if (cachedEmbedder !== null) return cachedEmbedder;
  if (embedderInitialization === null) {
    embedderInitialization = createLocalEmbedder()
      .then(embedder => {
        cachedEmbedder = new CachingEmbedder(embedder);
        return cachedEmbedder;
      })
      .catch(error => {
        embedderInitialization = null;
        throw error;
      });
  }
  return embedderInitialization;
}

// ── CORS / origin guard ───────────────────────────────────────────────────────
function isSafeOrigin(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (origin === undefined) return true; // same-origin / non-browser
  // Allow only this app and the expected Vite development origin.
  // Any arbitrary localhost port would let unrelated local web apps read source.
  return [
    'http://localhost:' + PORT,
    'http://127.0.0.1:' + PORT,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].includes(origin);
}

function setCorsHeaders(res: ServerResponse, req: IncomingMessage): void {
  const origin = req.headers['origin'];
  if (origin !== undefined && isSafeOrigin(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

// ── Body reader ───────────────────────────────────────────────────────────────
class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

function requiresJson(req: IncomingMessage, res: ServerResponse): boolean {
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string' && contentType.toLowerCase().split(';', 1)[0] === JSON_CONTENT_TYPE) return true;
  sendError(res, 415, 'Content-Type must be application/json.');
  return false;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      req.removeListener('aborted', onAborted);
      req.removeListener('error', onError);
      callback();
    };
    const onAborted = () => finish(() => reject(new RequestBodyError(400, 'Request was aborted.')));
    const onError = () => finish(() => reject(new RequestBodyError(400, 'Request body could not be read.')));
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(() => reject(new RequestBodyError(413, 'Request body exceeds the 64 KiB limit.')));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finish(() => resolve(body));
      } catch {
        finish(() => reject(new RequestBodyError(400, 'Invalid JSON body.')));
      }
    });
    req.once('aborted', onAborted);
    req.once('error', onError);
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string, headers?: Record<string, string>): void {
  if (headers !== undefined) Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  sendJson(res, status, { error: message });
}

function sendBodyError(res: ServerResponse, error: unknown): void {
  const bodyError = error instanceof RequestBodyError ? error : new RequestBodyError(400, 'Invalid JSON body.');
  sendError(res, bodyError.status, bodyError.message);
}

// ── Source-view safety ────────────────────────────────────────────────────────
const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
]);
const IGNORED_SOURCE_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next',
  '.nuxt', 'out', 'vendor', 'generated', '.cache',
]);
const MAX_SOURCE_VIEW_LINES = 500;

interface SourceView {
  ok: true;
  lines: string[];
  totalLines: number;
  startLine: number;
  endLine: number;
}
type SourceViewResult = SourceView | { ok: false; message: string };

/** Read only a bounded, allowed source file within the selected repository. */
async function safeReadSourceLines(
  repositoryPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  context: number,
): Promise<SourceViewResult> {
  const parts = filePath.split('/');
  if (
    filePath.includes('\\') ||
    filePath.includes('\0') ||
    isAbsolute(filePath) ||
    win32.isAbsolute(filePath) ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    return { ok: false, message: 'Only repository-relative source paths are permitted.' };
  }
  if (parts.slice(0, -1).some((part) => IGNORED_SOURCE_DIRECTORIES.has(part))) {
    return { ok: false, message: 'Source file is in an excluded directory.' };
  }
  if (!SUPPORTED_SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return { ok: false, message: 'Unsupported source file extension.' };
  }

  let root: string;
  try {
    root = await realpath(repositoryPath);
  } catch {
    return { ok: false, message: 'Repository location is unavailable.' };
  }
  const target = resolve(root, ...parts);
  const relativePath = relative(root, target);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('..' + sep) ||
    isAbsolute(relativePath)
  ) {
    return { ok: false, message: 'File path escapes the repository boundary.' };
  }

  // Verify each parent, not just the final file: lstat(final) alone does not
  // detect a symlinked directory pointing outside the repository.
  let parent = root;
  try {
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        return { ok: false, message: 'Symlinked or invalid parent directory.' };
      }
    }
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      return { ok: false, message: 'Source location is not a regular file.' };
    }
    if (info.size > DEFAULT_SOURCE_LIMITS.maxFileBytes) {
      return { ok: false, message: 'Source file exceeds the 256 KiB read limit.' };
    }
    // Defense in depth against aliases; this remains a best-effort check
    // if another process concurrently changes directory entries.
    const canonicalTarget = await realpath(target);
    const canonicalRelative = relative(root, canonicalTarget);
    if (!canonicalRelative || canonicalRelative === '..' ||
        canonicalRelative.startsWith('..' + sep) || isAbsolute(canonicalRelative)) {
      return { ok: false, message: 'Source file resolves outside the repository.' };
    }
  } catch {
    return { ok: false, message: 'Cannot access the selected source file.' };
  }

  let content: string;
  try {
    // O_NOFOLLOW rejects replacement of the final file with a symlink.
    // Read at most maxFileBytes + 1 bytes, even if the file grows after lstat.
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(DEFAULT_SOURCE_LIMITS.maxFileBytes + 1);
      let count = 0;
      while (count < buffer.length) {
        const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
        if (bytesRead === 0) break;
        count += bytesRead;
      }
      if (count > DEFAULT_SOURCE_LIMITS.maxFileBytes) {
        return { ok: false, message: 'Source file exceeds the 256 KiB read limit.' };
      }
      content = buffer.subarray(0, count).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, message: 'Cannot read the selected source file.' };
  }

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const totalLines = lines.length;
  if (startLine < 1 || endLine < startLine || endLine > totalLines) {
    return {
      ok: false,
      message: 'Requested lines ' + startLine + '-' + endLine +
        ' are outside the current source (' + totalLines + ' lines).',
    };
  }

  const first = Math.max(1, startLine - context);
  const last = Math.min(totalLines, endLine + context);
  return { ok: true, lines: lines.slice(first - 1, last), totalLines, startLine: first, endLine: last };
}

// ── Route handlers ────────────────────────────────────────────────────────────
async function handleHealth(res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true, service: 'localcode-intelligence', version: '0.1.0' });
}

async function handleRepoStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requiresJson(req, res)) return;
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error: unknown) {
    sendBodyError(res, error);
    return;
  }

  if (typeof body !== 'object' || body === null || !('repositoryPath' in body)) {
    sendError(res, 400, 'Missing required field: repositoryPath');
    return;
  }

  const { repositoryPath } = body as { repositoryPath: unknown };
  if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
    sendError(res, 400, 'repositoryPath must be a non-empty string');
    return;
  }

  const validation = await validateRepositoryDirectory(repositoryPath.trim());
  if (!validation.ok) {
    sendJson(res, 200, { ok: false, message: validation.message });
    return;
  }

  const result = await inspectRepositorySearchStatus(validation.resolvedPath);
  if (!result.ok) {
    sendJson(res, 200, { ok: false, message: result.message });
    return;
  }

  sendJson(res, 200, { ok: true, resolvedPath: validation.resolvedPath, status: result.status });
}

async function handlePrepareRepository(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requiresJson(req, res)) return;
  let body: unknown;
  try { body = await readJsonBody(req); } catch (error) { sendBodyError(res, error); return; }
  const source = typeof body === 'object' && body !== null ? (body as { source?: { type?: unknown; value?: unknown }; refresh?: unknown }).source : undefined;
  if (source === undefined || typeof source !== 'object' || source === null || (source.type !== 'local' && source.type !== 'github') || typeof source.value !== 'string' || !source.value.trim()) {
    sendError(res, 400, 'source.type and source.value are required.'); return;
  }
  try {
    let path: string; let label: string; let githubUrl: string | undefined; let revision: string | undefined;
    if (source.type === 'local') {
      const validation = await validateRepositoryDirectory(source.value.trim());
      if (!validation.ok) { sendJson(res, 200, { ok: false, message: validation.message }); return; }
      path = validation.resolvedPath; label = path;
    } else {
      const acquired = await githubAcquirer.acquire(source.value, body !== null && typeof body === 'object' && (body as { refresh?: unknown }).refresh === true);
      path = acquired.path; label = `${acquired.repository.owner}/${acquired.repository.repository}`; githubUrl = acquired.repository.canonicalUrl; revision = acquired.revision;
    }
    const status = await inspectRepositorySearchStatus(path);
    if (!status.ok) { sendJson(res, 200, { ok: false, message: status.message }); return; }
    const repositoryId = randomUUID();
    preparedRepositories.set(repositoryId, { path, type: source.type, label, githubUrl, revision });
    sendJson(res, 200, { ok: true, repositoryId, source: { type: source.type, label, githubUrl, revision }, status: status.status });
  } catch (error: unknown) {
    const message = error instanceof GitHubRepositoryError ? error.message : 'Repository preparation failed.';
    sendJson(res, 200, { ok: false, message, code: error instanceof GitHubRepositoryError ? error.code : 'preparation-failed' });
  }
}

function resolvePrepared(body: { repositoryId?: unknown; repositoryPath?: unknown }): string | null {
  if (typeof body.repositoryId === 'string') return preparedRepositories.get(body.repositoryId)?.path ?? null;
  return typeof body.repositoryPath === 'string' ? body.repositoryPath : null;
}

async function handleSearch(req: IncomingMessage, res: ServerResponse, performSearch: typeof searchRepository = searchRepository): Promise<void> {
  if (!requiresJson(req, res)) return;
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error: unknown) {
    sendBodyError(res, error);
    return;
  }

  if (typeof body !== 'object' || body === null) {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  const { query } = body as { query?: unknown; repositoryPath?: unknown; repositoryId?: unknown };
  const repositoryPath = resolvePrepared(body as { repositoryId?: unknown; repositoryPath?: unknown });
  if (typeof query !== 'string' || query.trim().length === 0) {
    sendError(res, 400, 'query must be a non-empty string');
    return;
  }
  if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
    sendError(res, 400, 'A prepared repository reference is required.');
    return;
  }

  const validation = await validateRepositoryDirectory(repositoryPath.trim());
  if (!validation.ok) {
    sendJson(res, 200, { ok: false, message: validation.message });
    return;
  }

  const abortController = new AbortController();
  const abort = () => abortController.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  let result;
  try {
    result = await searchController.execute(() => performSearch(query.trim(), validation.resolvedPath, {
      prepare: prepareSourceScope,
      createEmbedder: getEmbedder,
    }), abortController.signal);
  } catch (error: unknown) {
    if (abortController.signal.aborted || res.destroyed) return;
    if (error instanceof SearchOverloadedError) {
      sendError(res, 503, error.message, { 'Retry-After': '5' });
      return;
    }
    if (error instanceof SearchQueueAbortedError) return;
    sendError(res, 500, 'Search could not be scheduled.');
    return;
  } finally {
    req.removeListener('aborted', abort);
    res.removeListener('close', abort);
  }

  // IncomingMessage.destroyed can become true after a normal, fully-read request body.
  // Only the response lifecycle (or our abort signal) tells us whether replying is safe.
  if (abortController.signal.aborted || res.destroyed) return;

  if (!result.ok) {
    sendJson(res, 200, { ok: false, reason: result.reason, message: result.message });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    outcome: result.outcome,
    candidates: result.candidates,
    withheldCandidates: result.withheldCandidates,
    scope: {
      filesProcessed: result.scope.filesProcessed,
      filesDiscovered: result.scope.filesDiscovered ?? result.scope.filesProcessed,
      warnings: result.scope.warnings,
    },
  });
}

async function handleSource(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requiresJson(req, res)) return;
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error: unknown) {
    sendBodyError(res, error);
    return;
  }

  if (typeof body !== 'object' || body === null) {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  const { filePath, startLine, endLine, context } = body as {
    repositoryPath?: unknown;
    filePath?: unknown;
    startLine?: unknown;
    endLine?: unknown;
    context?: unknown;
  };

  const repositoryPath = resolvePrepared(body as { repositoryId?: unknown; repositoryPath?: unknown });
  if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
    sendError(res, 400, 'A prepared repository reference is required.');
    return;
  }
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    sendError(res, 400, 'filePath must be a non-empty string');
    return;
  }
  const sl = typeof startLine === 'number' ? startLine : Number(startLine);
  const el = typeof endLine === 'number' ? endLine : Number(endLine);
  if (!Number.isInteger(sl) || sl < 1) {
    sendError(res, 400, 'startLine must be a positive integer');
    return;
  }
  if (!Number.isInteger(el) || el < sl) {
    sendError(res, 400, 'endLine must be >= startLine');
    return;
  }
  if (el - sl + 1 > MAX_SOURCE_VIEW_LINES) {
    sendError(res, 400, 'Source view is limited to 500 requested lines');
    return;
  }
  const viewContext = context === undefined ? 0 : context;
  if (typeof viewContext !== 'number' || !Number.isInteger(viewContext) ||
      viewContext < 0 || viewContext > 50) {
    sendError(res, 400, 'context must be an integer from 0 to 50');
    return;
  }

  const validation = await validateRepositoryDirectory(repositoryPath.trim());
  if (!validation.ok) {
    sendJson(res, 200, { ok: false, message: validation.message });
    return;
  }

  const result = await safeReadSourceLines(validation.resolvedPath, filePath.trim(), sl, el, viewContext);
  if (!result.ok) {
    sendJson(res, 200, { ok: false, message: result.message });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    filePath: filePath.trim(),
    startLine: result.startLine,
    endLine: result.endLine,
    totalLines: result.totalLines,
    lines: result.lines,
    notice: 'Current file content. May differ from the search snapshot if the file was modified.',
  });
}

// ── Static frontend serving ───────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = join(__dirname, '..', '..', 'web', 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function extOf(p: string): string {
  const dot = p.lastIndexOf('.');
  return dot >= 0 ? p.slice(dot) : '';
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!existsSync(STATIC_DIR)) return false;
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
  let filePath = join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // Prevent traversal
  const relativeAsset = relative(resolve(STATIC_DIR), resolve(filePath));
  if (relativeAsset === '..' || relativeAsset.startsWith('..' + sep) || isAbsolute(relativeAsset)) {
    sendError(res, 403, 'Forbidden');
    return true;
  }

  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(STATIC_DIR, 'index.html');
  }

  if (!existsSync(filePath)) return false;

  const ext = extOf(filePath);
  const mime = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(filePath).pipe(res);
  return true;
}

// ── Main router ───────────────────────────────────────────────────────────────
async function handleRequest(req: IncomingMessage, res: ServerResponse, performSearch: typeof searchRepository = searchRepository): Promise<void> {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isSafeOrigin(req)) {
    sendError(res, 403, 'Cross-origin requests from external origins are not permitted.');
    return;
  }

  const url = req.url?.split('?')[0] ?? '/';

  try {
    if (req.method === 'GET' && url === '/api/health') {
      await handleHealth(res);
      return;
    }
    if (req.method === 'POST' && url === '/api/repo/status') {
      await handleRepoStatus(req, res);
      return;
    }
    if (req.method === 'POST' && url === '/api/repositories/prepare') {
      await handlePrepareRepository(req, res);
      return;
    }
    if (req.method === 'POST' && url === '/api/search') {
      await handleSearch(req, res, performSearch);
      return;
    }
    if (req.method === 'POST' && url === '/api/source') {
      await handleSource(req, res);
      return;
    }

    // Unknown /api/* routes — return JSON, not the SPA fallback
    if (url.startsWith('/api/')) {
      sendError(res, 404, `Unknown API route: ${url}`);
      return;
    }

    // Serve static frontend (SPA fallback for unknown non-API paths)
    const served = await serveStatic(req, res);
    if (!served) {
      sendError(res, 404, 'Not found');
    }
  } catch (err) {
    console.error('[server] Unhandled error:', err);
    if (!res.headersSent) sendError(res, 500, 'Internal server error');
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
/** Optional search injection enables realistic HTTP contract tests without loading the ML model. */
export function createLocalcodeServer(options: { performSearch?: typeof searchRepository } = {}) {
  return createServer((req, res) => handleRequest(req, res, options.performSearch ?? searchRepository));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createLocalcodeServer();
  server.listen(PORT, HOST, () => {
    console.log(`LocalCode Intelligence API listening on http://${HOST}:${PORT}`);
  });
}
