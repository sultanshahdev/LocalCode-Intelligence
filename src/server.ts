#!/usr/bin/env node
/**
 * LocalCode Intelligence — localhost-only HTTP API server.
 * Binds to 127.0.0.1:4317 by default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, realpath, open } from 'node:fs/promises';
import { constants, existsSync, createReadStream } from 'node:fs';
import { resolve, relative, join, sep, extname, isAbsolute, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRepositoryDirectory } from './repository.js';
import { inspectRepositorySearchStatus } from './status.js';
import { searchRepository } from './search.js';
import { createLocalEmbedder, type Embedder } from './retrieval.js';
import { prepareSourceScope, DEFAULT_SOURCE_LIMITS } from './source.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env['PORT'] ?? 4317);
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

// ── Cached embedder ───────────────────────────────────────────────────────────
let cachedEmbedder: Embedder | null = null;
async function getEmbedder(): Promise<Embedder> {
  if (cachedEmbedder === null) {
    cachedEmbedder = await createLocalEmbedder();
  }
  return cachedEmbedder;
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
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
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
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : 'Bad request');
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

async function handleSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : 'Bad request');
    return;
  }

  if (typeof body !== 'object' || body === null) {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  const { query, repositoryPath } = body as { query?: unknown; repositoryPath?: unknown };
  if (typeof query !== 'string' || query.trim().length === 0) {
    sendError(res, 400, 'query must be a non-empty string');
    return;
  }
  if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
    sendError(res, 400, 'repositoryPath must be a non-empty string');
    return;
  }

  const validation = await validateRepositoryDirectory(repositoryPath.trim());
  if (!validation.ok) {
    sendJson(res, 200, { ok: false, message: validation.message });
    return;
  }

  const result = await searchRepository(query.trim(), validation.resolvedPath, {
    prepare: prepareSourceScope,
    createEmbedder: getEmbedder,
  });

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
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendError(res, 400, e instanceof Error ? e.message : 'Bad request');
    return;
  }

  if (typeof body !== 'object' || body === null) {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  const { repositoryPath, filePath, startLine, endLine, context } = body as {
    repositoryPath?: unknown;
    filePath?: unknown;
    startLine?: unknown;
    endLine?: unknown;
    context?: unknown;
  };

  if (typeof repositoryPath !== 'string' || repositoryPath.trim().length === 0) {
    sendError(res, 400, 'repositoryPath must be a non-empty string');
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
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    if (req.method === 'POST' && url === '/api/search') {
      await handleSearch(req, res);
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
const server = createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`LocalCode Intelligence API listening on http://${HOST}:${PORT}`);
});
