import type { AnalysisEngine } from '../types';
import type { ExactMatch, RepositoryMapNode, SourceSymbol, SymbolUsage } from '../../api';

const LIMITS = { files: 500, fileBytes: 256 * 1024, totalBytes: 5 * 1024 * 1024, matches: 200, concurrent: 6 } as const;
const EXTENSIONS: Record<string, string> = { js: 'javascript-typescript', jsx: 'javascript-typescript', ts: 'javascript-typescript', tsx: 'javascript-typescript', py: 'python', go: 'go', java: 'java', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash' };
const EXCLUDED = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', '.git', '.next', '.cache', 'generated']);

type File = { path: string; content: string; bytes: number; language: string };
type Snapshot = { id: string; url: string; owner: string; repo: string; revision: string; files: File[]; discovered: number; warnings: string[]; truncated: boolean };
let snapshot: Snapshot | undefined;
let embedded: { snapshotId: string; chunks: Array<{ filePath: string; startLine: number; endLine: number; text: string; vector: number[] }> } | undefined;
let worker: Worker | undefined; let requestId = 0;

export function normalizeGitHubUrl(value: string): { owner: string; repo: string; url: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a canonical HTTPS GitHub repository URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) throw new Error('Only canonical public HTTPS github.com repository URLs are supported.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('GitHub URLs must contain exactly an owner and repository name.');
  const [owner, rawRepo] = parts; const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) throw new Error('The GitHub owner or repository name is malformed.');
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

async function github<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Repository not found or it is private.');
    if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limit reached. Try again later.');
    throw new Error(`GitHub request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
function language(path: string): string | undefined { return EXTENSIONS[path.split('.').pop()?.toLowerCase() ?? '']; }
function eligible(path: string): boolean { return !path.split('/').some(part => EXCLUDED.has(part.toLowerCase())) && Boolean(language(path)); }
async function boundedText(url: string, maximum: number, signal?: AbortSignal): Promise<string | undefined> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GitHub source request failed (${response.status}).`);
  const declared = Number(response.headers.get('content-length') ?? 0); if (declared > maximum) return undefined;
  if (!response.body) { const text = await response.text(); return new TextEncoder().encode(text).byteLength <= maximum ? text : undefined; }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); return undefined; } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function concurrent<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0; await Promise.all(Array.from({ length: Math.min(LIMITS.concurrent, items.length) }, async () => { while (next < items.length) { const item = items[next++]; if (item !== undefined) await fn(item); } }));
}
async function prepare(value: string, signal?: AbortSignal): Promise<Snapshot> {
  const target = normalizeGitHubUrl(value);
  const metadata = await github<{ default_branch: string }>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`, signal);
  const commit = await github<{ sha: string }>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits/${encodeURIComponent(metadata.default_branch)}`, signal);
  const tree = await github<{ tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/git/trees/${commit.sha}?recursive=1`, signal);
  const warnings: string[] = []; if (tree.truncated) warnings.push('GitHub returned a truncated file tree; coverage is partial.');
  const eligibleFiles = tree.tree.filter(entry => entry.type === 'blob' && eligible(entry.path)).sort((a, b) => a.path.localeCompare(b.path));
  const selected: Array<{ path: string; type: string; size?: number }> = []; let declaredTotal = 0;
  for (const entry of eligibleFiles) { if (selected.length >= LIMITS.files) { warnings.push(`File limit reached (${LIMITS.files}); remaining supported files were not downloaded.`); break; } if ((entry.size ?? 0) > LIMITS.fileBytes) { warnings.push(`Skipped ${entry.path}: exceeds ${LIMITS.fileBytes} bytes.`); continue; } if (declaredTotal + (entry.size ?? 0) > LIMITS.totalBytes) { warnings.push(`Source byte limit reached (${LIMITS.totalBytes}); remaining files were not downloaded.`); break; } selected.push(entry); declaredTotal += entry.size ?? 0; }
  let total = 0; const files: File[] = [];
  await concurrent(selected, async entry => {
    if ((entry.size ?? 0) > LIMITS.fileBytes) { warnings.push(`Skipped ${entry.path}: exceeds ${LIMITS.fileBytes} bytes.`); return; }
    const content = await boundedText(`https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${commit.sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, LIMITS.fileBytes, signal);
    if (content === undefined) { warnings.push(`Skipped ${entry.path}: exceeds ${LIMITS.fileBytes} bytes.`); return; }
    const bytes = new TextEncoder().encode(content).byteLength;
    // Completion order must not decide the budget. Serialize accounting by file order below.
    files.push({ path: entry.path, content, bytes, language: language(entry.path)! });
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const bounded: File[] = [];
  for (const file of files) { if (total + file.bytes > LIMITS.totalBytes) { warnings.push(`Source byte limit reached (${LIMITS.totalBytes}); remaining files were excluded.`); break; } total += file.bytes; bounded.push(file); }
  return { id: `github:${target.owner}/${target.repo}@${commit.sha}`, url: target.url, owner: target.owner, repo: target.repo, revision: commit.sha, files: bounded, discovered: eligibleFiles.length, warnings, truncated: Boolean(tree.truncated) || bounded.length < eligibleFiles.length };
}
function requireSnapshot(id?: string): Snapshot { if (!snapshot || (id && snapshot.id !== id)) throw new Error('This repository is no longer prepared.'); return snapshot; }
function scope(s: Snapshot) { return { filesProcessed: s.files.length, filesDiscovered: s.discovered, warnings: s.warnings }; }
function exact(s: Snapshot, query: string, options: { caseSensitive: boolean; wholeWord: boolean }) {
  if (!query || query.length > 256) return { ok: false, message: 'Enter an exact query of at most 256 characters.' } as const;
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase(); const matches: ExactMatch[] = []; let filesWithMatches = 0;
  for (const file of s.files) { let found = false; for (const [index, text] of file.content.split(/\r?\n/).entries()) { const haystack = options.caseSensitive ? text : text.toLocaleLowerCase(); const occurrences: Array<{ start: number; end: number }> = []; let cursor = 0; while (cursor <= haystack.length - needle.length) { const start = haystack.indexOf(needle, cursor); if (start < 0) break; const end = start + query.length; const word = (character: string | undefined) => Boolean(character && /[\p{L}\p{N}_]/u.test(character)); if (!options.wholeWord || (!word(text[start - 1]) && !word(text[end]))) occurrences.push({ start, end }); cursor = start + Math.max(1, query.length); } if (occurrences.length) { found = true; matches.push({ filePath: file.path, line: index + 1, text, occurrences }); if (matches.length >= LIMITS.matches) break; } } if (found) filesWithMatches++; if (matches.length >= LIMITS.matches) break; }
  return { ok: true, matches, filesWithMatches, truncated: matches.length >= LIMITS.matches, scope: scope(s) } as const;
}
function map(s: Snapshot): RepositoryMapNode[] { const nodes: RepositoryMapNode[] = [{ id: '.', path: '.', name: 'repository', type: 'directory', parentId: null }]; const directories = new Set<string>(); for (const file of s.files) { const parts = file.path.split('/'); for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/')); } for (const path of [...directories].sort()) { const name = path.split('/').pop()!; const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'; nodes.push({ id: path, path, name, type: 'directory', parentId: parent }); } for (const file of s.files) { const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'; nodes.push({ id: file.path, path: file.path, name: file.path.split('/').pop()!, type: 'file', parentId: parent, language: file.language, sizeBytes: file.bytes }); } return nodes; }
function symbols(s: Snapshot): SourceSymbol[] { const result: SourceSymbol[] = []; const expression = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/; for (const file of s.files) { if (file.language !== 'javascript-typescript') continue; for (const [i, line] of file.content.split(/\r?\n/).entries()) { const match = expression.exec(line); if (match?.[1]) result.push({ filePath: file.path, name: match[1], kind: /class/.test(line) ? 'class' : /function/.test(line) ? 'function' : 'variable', startLine: i + 1, endLine: i + 1 }); } } return result; }
function chunks(s: Snapshot) { const result: Array<{ filePath: string; startLine: number; endLine: number; text: string }> = []; for (const file of s.files) { const lines = file.content.split(/\r?\n/); for (let start = 0; start < lines.length; start += 30) { const segment = lines.slice(start, start + 40).join('\n'); if (segment.trim()) result.push({ filePath: file.path, startLine: start + 1, endLine: Math.min(lines.length, start + 40), text: segment }); } } return result; }
function embed(texts: string[]): Promise<number[][]> { worker ??= new Worker(new URL('./embedding-worker.ts', import.meta.url), { type: 'module' }); const activeWorker = worker; const id = ++requestId; return new Promise((resolve, reject) => { const listener = (event: MessageEvent<{ id?: number; vectors?: number[][]; error?: string }>) => { if (event.data.id !== id) return; activeWorker.removeEventListener('message', listener); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.vectors ?? []); }; activeWorker.addEventListener('message', listener); activeWorker.postMessage({ id, texts }); }); }
async function semantic(s: Snapshot, query: string) { if (!query.trim()) return { ok: false, message: 'Enter a search question.' } as const; if (!embedded || embedded.snapshotId !== s.id) { const sourceChunks = chunks(s); const vectors: number[][] = []; for (let index = 0; index < sourceChunks.length; index += 16) vectors.push(...await embed(sourceChunks.slice(index, index + 16).map(chunk => `${chunk.filePath}\n${chunk.text}`))); embedded = { snapshotId: s.id, chunks: sourceChunks.map((chunk, index) => ({ ...chunk, vector: vectors[index] ?? [] })) }; } const [queryVector] = await embed([query]); if (!queryVector) return { ok: false, message: 'The browser embedding model returned no query vector.' } as const; const candidates = embedded.chunks.filter(chunk => chunk.vector.length === queryVector.length).map(chunk => ({ filePath: chunk.filePath, startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.text, score: chunk.vector.reduce((sum, value, index) => sum + value * (queryVector[index] ?? 0), 0) })).sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath)).slice(0, 20); return { ok: true, outcome: candidates.length ? 'candidates' : 'no-relevant-results', candidates, withheldCandidates: 0, scope: scope(s) } as const; }

export const browserEngine: AnalysisEngine = {
  kind: 'browser',
  async prepare(type, value, _refresh, signal) { if (type !== 'github') return { ok: false, message: 'Local folders require the Code Buster localhost application. Static hosting can investigate public GitHub repositories.' }; const loaded = await prepare(value, signal); snapshot = loaded; return { ok: true, repositoryId: loaded.id, source: { type: 'github', label: `${loaded.owner}/${loaded.repo}`, githubUrl: loaded.url, revision: loaded.revision }, status: { eligible: loaded.files.length > 0, coverage: loaded.truncated ? 'partial' : 'complete', filesDiscovered: loaded.discovered, filesProcessed: loaded.files.length, warnings: loaded.warnings } }; },
  async exactSearch(query, _path, options, id) { return exact(requireSnapshot(id), query, options); },
  async source(_path, filePath, start, end, context, id) { const file = requireSnapshot(id).files.find(item => item.path === filePath); if (!file) return { ok: false, message: 'Source file is not available in the prepared snapshot.' }; const lines = file.content.split(/\r?\n/); const first = Math.max(1, start - context); const last = Math.min(lines.length, end + context); return { ok: true, filePath, startLine: first, endLine: last, totalLines: lines.length, lines: lines.slice(first - 1, last) }; },
  async files(_path, id) { const s = requireSnapshot(id); return { ok: true, files: s.files.map(file => file.path), truncated: s.truncated }; },
  async map(_path, id) { const s = requireSnapshot(id); return { ok: true, root: '.', nodes: map(s), truncated: s.truncated, warnings: s.warnings }; },
  async symbols(_path, id) { const s = requireSnapshot(id); return { ok: true, symbols: symbols(s), truncated: false, scope: scope(s) }; },
  async usages(symbol, _path, id) { const s = requireSnapshot(id); const usages: SymbolUsage[] = []; const regex = new RegExp(`\\b${symbol.name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'g'); for (const file of s.files) for (const [i, line] of file.content.split(/\r?\n/).entries()) for (const match of line.matchAll(regex)) if (!(file.path === symbol.filePath && i + 1 === symbol.startLine)) usages.push({ filePath: file.path, line: i + 1, column: (match.index ?? 0) + 1, preview: line, start: match.index ?? 0, end: (match.index ?? 0) + symbol.name.length }); return { ok: true, usages, truncated: false, scope: scope(s) }; },
  async definition(filePath, line, _column, _path, id) { const s = requireSnapshot(id); const text = s.files.find(file => file.path === filePath)?.content.split(/\r?\n/)[line - 1]; const name = text?.match(/[A-Za-z_$][\w$]*/)?.[0]; if (!name) return { ok: true, outcome: 'unresolved', message: 'No identifier is available at this location.' }; const found = symbols(s).filter(symbol => symbol.name === name); return found.length === 1 ? { ok: true, outcome: 'resolved', definition: found[0] } : { ok: true, outcome: found.length ? 'ambiguous' : 'unresolved', message: found.length ? 'More than one declaration matches this identifier.' : 'No loaded declaration matches this identifier.' }; },
  async search(query, _path, id) { return semantic(requireSnapshot(id), query); },
};
