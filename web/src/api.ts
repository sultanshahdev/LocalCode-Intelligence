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

export interface ExactMatch {
  filePath: string;
  line: number;
  text: string;
  occurrences: Array<{ start: number; end: number }>;
}

export interface ExactSearchResponse {
  ok: boolean;
  matches?: ExactMatch[];
  filesWithMatches?: number;
  truncated?: boolean;
  scope?: SearchScopeInfo;
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

export interface RepositoryFilesResponse {
  ok: boolean;
  files?: string[];
  truncated?: boolean;
  message?: string;
}

export interface RepositoryMapNode {
  id: string;
  path: string;
  name: string;
  type: 'directory' | 'file';
  parentId: string | null;
  language?: string;
  sizeBytes?: number;
}

export interface RepositoryMapResponse {
  ok: boolean;
  root?: string;
  nodes?: RepositoryMapNode[];
  truncated?: boolean;
  warnings?: string[];
  message?: string;
}

export interface SourceSymbol {
  filePath: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  containerName?: string;
  exported?: boolean;
}

export interface SymbolsResponse {
  ok: boolean;
  symbols?: SourceSymbol[];
  truncated?: boolean;
  scope?: SearchScopeInfo;
  message?: string;
}

export interface SymbolUsage {
  filePath: string;
  line: number;
  column: number;
  preview: string;
  start: number;
  end: number;
}

export interface UsagesResponse {
  ok: boolean;
  usages?: SymbolUsage[];
  truncated?: boolean;
  scope?: SearchScopeInfo;
  message?: string;
}

export interface DefinitionResponse {
  ok: boolean;
  outcome?: 'resolved' | 'unresolved' | 'ambiguous' | 'unsupported';
  definition?: SourceSymbol;
  message?: string;
}

export interface LanguageAdapterInfo {
  id: string;
  name: string;
  extensions: string[];
  capabilities: {
    structural: boolean;
    usages?: boolean;
    definitions?: boolean;
  };
  parserAvailable: boolean;
}

export interface LanguagesResponse {
  languages: LanguageAdapterInfo[];
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
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

export async function apiLanguages(): Promise<LanguagesResponse> {
  const res = await fetch(`${BASE}/languages`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<LanguagesResponse>;
}

export async function apiRepoStatus(repositoryPath: string): Promise<RepoStatusResponse> {
  return post<RepoStatusResponse>('/repo/status', { repositoryPath });
}

export async function nodeApiPrepareRepository(
  type: 'local' | 'github',
  value: string,
  refresh = false
): Promise<PreparedRepositoryResponse> {
  return post<PreparedRepositoryResponse>('/repositories/prepare', { source: { type, value }, refresh });
}

export async function nodeApiSearch(
  query: string,
  repositoryPath: string,
  repositoryId?: string
): Promise<SearchResponse> {
  return post<SearchResponse>('/search', repositoryId ? { query, repositoryId } : { query, repositoryPath });
}

export async function nodeApiExactSearch(
  query: string,
  repositoryPath: string,
  options: { caseSensitive: boolean; wholeWord: boolean },
  repositoryId?: string
): Promise<ExactSearchResponse> {
  return post<ExactSearchResponse>(
    '/search/exact',
    repositoryId ? { query, repositoryId, ...options } : { query, repositoryPath, ...options }
  );
}

export async function nodeApiSource(
  repositoryPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  context = 25,
  repositoryId?: string
): Promise<SourceResponse> {
  return post<SourceResponse>(
    '/source',
    repositoryId
      ? { repositoryId, filePath, startLine, endLine, context }
      : { repositoryPath, filePath, startLine, endLine, context }
  );
}

export async function nodeApiRepositoryFiles(
  repositoryPath: string,
  repositoryId?: string
): Promise<RepositoryFilesResponse> {
  return post<RepositoryFilesResponse>(
    '/repositories/files',
    repositoryId ? { repositoryId } : { repositoryPath }
  );
}

export async function nodeApiRepositoryMap(
  repositoryPath: string,
  repositoryId?: string
): Promise<RepositoryMapResponse> {
  return post<RepositoryMapResponse>(
    '/repository/map',
    repositoryId ? { repositoryId } : { repositoryPath }
  );
}

export async function nodeApiSymbols(
  repositoryPath: string,
  repositoryId?: string
): Promise<SymbolsResponse> {
  return post<SymbolsResponse>('/symbols', repositoryId ? { repositoryId } : { repositoryPath });
}

export async function nodeApiSymbolUsages(
  symbol: SourceSymbol,
  repositoryPath: string,
  repositoryId?: string
): Promise<UsagesResponse> {
  return post<UsagesResponse>(
    '/symbols/usages',
    repositoryId ? { repositoryId, symbol } : { repositoryPath, symbol }
  );
}

export async function nodeApiSymbolDefinition(
  filePath: string,
  line: number,
  column: number,
  repositoryPath: string,
  repositoryId?: string
): Promise<DefinitionResponse> {
  return post<DefinitionResponse>(
    '/symbols/definition',
    repositoryId ? { repositoryId, filePath, line, column } : { repositoryPath, filePath, line, column }
  );
}

// The workspace deliberately speaks to this stable facade. Runtime selection is
// made once, before the first operation; a real Node failure is never hidden by
// falling back to a different engine mid-investigation.
async function engine() { return (await import('./engine/detect-runtime')).getAnalysisEngine(); }
export async function apiPrepareRepository(type: 'local' | 'github', value: string, refresh = false): Promise<PreparedRepositoryResponse> { return (await engine()).prepare(type, value, refresh); }
export async function apiSearch(query: string, repositoryPath: string, repositoryId?: string): Promise<SearchResponse> { return (await engine()).search(query, repositoryPath, repositoryId); }
export async function apiExactSearch(query: string, repositoryPath: string, options: { caseSensitive: boolean; wholeWord: boolean }, repositoryId?: string): Promise<ExactSearchResponse> { return (await engine()).exactSearch(query, repositoryPath, options, repositoryId); }
export async function apiSource(repositoryPath: string, filePath: string, startLine: number, endLine: number, context = 25, repositoryId?: string): Promise<SourceResponse> { return (await engine()).source(repositoryPath, filePath, startLine, endLine, context, repositoryId); }
export async function apiRepositoryFiles(repositoryPath: string, repositoryId?: string): Promise<RepositoryFilesResponse> { return (await engine()).files(repositoryPath, repositoryId); }
export async function apiRepositoryMap(repositoryPath: string, repositoryId?: string): Promise<RepositoryMapResponse> { return (await engine()).map(repositoryPath, repositoryId); }
export async function apiSymbols(repositoryPath: string, repositoryId?: string): Promise<SymbolsResponse> { return (await engine()).symbols(repositoryPath, repositoryId); }
export async function apiSymbolUsages(symbol: SourceSymbol, repositoryPath: string, repositoryId?: string): Promise<UsagesResponse> { return (await engine()).usages(symbol, repositoryPath, repositoryId); }
export async function apiSymbolDefinition(filePath: string, line: number, column: number, repositoryPath: string, repositoryId?: string): Promise<DefinitionResponse> { return (await engine()).definition(filePath, line, column, repositoryPath, repositoryId); }
