import type {
  DefinitionResponse, ExactSearchResponse, PreparedRepositoryResponse, RepositoryFilesResponse,
  RepositoryMapResponse, SearchResponse, SourceResponse, SymbolsResponse, UsagesResponse,
  SourceSymbol,
} from '../api';

export type RepositorySourceType = 'local' | 'github';

/** The common contract used by the workspace in both supported runtimes. */
export interface AnalysisEngine {
  readonly kind: 'node' | 'browser';
  prepare(type: RepositorySourceType, value: string, refresh?: boolean, signal?: AbortSignal): Promise<PreparedRepositoryResponse>;
  search(query: string, repositoryPath: string, repositoryId?: string, signal?: AbortSignal): Promise<SearchResponse>;
  exactSearch(query: string, repositoryPath: string, options: { caseSensitive: boolean; wholeWord: boolean }, repositoryId?: string, signal?: AbortSignal): Promise<ExactSearchResponse>;
  source(repositoryPath: string, filePath: string, startLine: number, endLine: number, context: number, repositoryId?: string): Promise<SourceResponse>;
  files(repositoryPath: string, repositoryId?: string): Promise<RepositoryFilesResponse>;
  map(repositoryPath: string, repositoryId?: string): Promise<RepositoryMapResponse>;
  symbols(repositoryPath: string, repositoryId?: string): Promise<SymbolsResponse>;
  usages(symbol: SourceSymbol, repositoryPath: string, repositoryId?: string): Promise<UsagesResponse>;
  definition(filePath: string, line: number, column: number, repositoryPath: string, repositoryId?: string): Promise<DefinitionResponse>;
}

export interface BrowserProgress {
  phase: 'metadata' | 'tree' | 'download' | 'ready' | 'model';
  message: string;
  completed?: number;
  total?: number;
}
