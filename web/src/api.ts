// API types matching backend responses

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
}

export interface RepoStatus {
  filesDiscovered: number;
  filesProcessed: number;
  eligible: boolean;
  coverage: 'complete' | 'partial';
  warnings: string[];
}

export interface RepoStatusResponse {
  ok: boolean;
  resolvedPath?: string;
  status?: RepoStatus;
  message?: string;
}

export interface SearchCandidate {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export interface SearchScopeInfo {
  filesProcessed: number;
  filesDiscovered: number;
  warnings: string[];
}

export interface SearchResponse {
  ok: boolean;
  outcome?: 'candidates' | 'no-supported-candidate';
  candidates?: SearchCandidate[];
  withheldCandidates?: number;
  scope?: SearchScopeInfo;
  reason?: string;
  message?: string;
}

export interface SourceResponse {
  ok: boolean;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  lines?: string[];
  notice?: string;
  message?: string;
}

// ── API client ────────────────────────────────────────────────────────────────

const BASE = '/api';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

export async function apiRepoStatus(repositoryPath: string): Promise<RepoStatusResponse> {
  return post<RepoStatusResponse>('/repo/status', { repositoryPath });
}

export async function apiSearch(query: string, repositoryPath: string): Promise<SearchResponse> {
  return post<SearchResponse>('/search', { query, repositoryPath });
}

export async function apiSource(
  repositoryPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  context = 25,
): Promise<SourceResponse> {
  return post<SourceResponse>('/source', { repositoryPath, filePath, startLine, endLine, context });
}
