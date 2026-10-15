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
export interface PreparedRepositoryResponse extends RepoStatusResponse {
  repositoryId?: string;
  source?: { type: 'local' | 'github'; label: string; githubUrl?: string; revision?: string };
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
  outcome?: 'candidates' | 'no-supported-candidate' | 'no-relevant-results';
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
export interface RepositoryFilesResponse { ok: boolean; files?: string[]; truncated?: boolean; message?: string; }

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
export async function apiPrepareRepository(type: 'local' | 'github', value: string, refresh = false): Promise<PreparedRepositoryResponse> {
  return post<PreparedRepositoryResponse>('/repositories/prepare', { source: { type, value }, refresh });
}

export async function apiSearch(query: string, repositoryPath: string, repositoryId?: string): Promise<SearchResponse> {
  return post<SearchResponse>('/search', repositoryId ? { query, repositoryId } : { query, repositoryPath });
}

export async function apiSource(
  repositoryPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  context = 25, repositoryId?: string,
): Promise<SourceResponse> {
  return post<SourceResponse>('/source', repositoryId ? { repositoryId, filePath, startLine, endLine, context } : { repositoryPath, filePath, startLine, endLine, context });
}
export async function apiRepositoryFiles(repositoryPath: string, repositoryId?: string): Promise<RepositoryFilesResponse> {
  return post<RepositoryFilesResponse>('/repositories/files', repositoryId ? { repositoryId } : { repositoryPath });
}
