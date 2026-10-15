#!/usr/bin/env node
/**
 * LocalCode Intelligence — localhost-only HTTP API server.
 * Binds to 127.0.0.1:4317 by default.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, lstat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRepositoryDirectory } from './repository.js';
import { inspectRepositorySearchStatus } from './status.js';
import { searchRepository } from './search.js';
import { createLocalEmbedder, type Embedder } from './retrieval.js';
import { prepareSourceScope } from './source.js';

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
  return (
    origin === 'http://localhost:4317' ||
    origin === 'http://127.0.0.1:4317' ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  );
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
async function safeReadSourceLines(
  repositoryPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<{ ok: true; lines: string[]; totalLines: number } | { ok: false; message: string }> {
  // Reject absolute paths and traversal components
  if (filePath.startsWith('/') || filePath.startsWith('\\')) {
    return { ok: false, message: 'Absolute file paths are not permitted.' };
  }
  const normalized = normalize(filePath);
  if (normalized.startsWith('..')) {
    return { ok: false, message: 'Path traversal is not permitted.' };
  }

  const absoluteFilePath = join(repositoryPath, normalized);
  // Ensure resolved path stays inside the repository
  const resolvedRepo = resolve(repositoryPath);
  const resolvedFile = resolve(absoluteFilePath);
  if (!resolvedFile.startsWith(resolvedRepo + '/') && resolvedFile !== resolvedRepo) {
    return { ok: false, message: 'File path escapes the repository boundary.' };
  }

  // Reject symlinks
  let stat;
  try {
    stat = await lstat(resolvedFile);
  } catch {
    return { ok: false, message: `File not found: ${filePath}` };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, message: 'Symbolic links are not permitted.' };
  }
  if (!stat.isFile()) {
    return { ok: false, message: 'Path is not a regular file.' };
  }

  let content: string;
  try {
    content = await readFile(resolvedFile, 'utf8');
  } catch {
    return { ok: false, message: `Cannot read file: ${filePath}` };
  }

  const allLines = content.split(/\r?\n/);
  const totalLines = allLines.length;

  // Validate line range
  if (startLine < 1 || endLine < startLine || startLine > totalLines) {
    return {
      ok: false,
      message: `Line range ${startLine}-${endLine} is out of bounds (file has ${totalLines} lines).`,
    };
  }
  const clampedEnd = Math.min(endLine, totalLines);
  const lines = allLines.slice(startLine - 1, clampedEnd);

  return { ok: true, lines, totalLines };
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

  const { repositoryPath, filePath, startLine, endLine } = body as {
    repositoryPath?: unknown;
    filePath?: unknown;
    startLine?: unknown;
    endLine?: unknown;
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

  const validation = await validateRepositoryDirectory(repositoryPath.trim());
  if (!validation.ok) {
    sendJson(res, 200, { ok: false, message: validation.message });
    return;
  }

  const result = await safeReadSourceLines(validation.resolvedPath, filePath.trim(), sl, el);
  if (!result.ok) {
    sendJson(res, 200, { ok: false, message: result.message });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    filePath: filePath.trim(),
    startLine: sl,
    endLine: Math.min(el, result.totalLines),
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
  if (!resolve(filePath).startsWith(resolve(STATIC_DIR))) {
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
