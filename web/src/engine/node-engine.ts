import * as api from '../api';
import type { AnalysisEngine } from './types';

/** Delegates to the trusted localhost API without changing its request contract. */
export const nodeEngine: AnalysisEngine = {
  kind: 'node',
  prepare: (type, value, refresh) => api.nodeApiPrepareRepository(type, value, refresh),
  search: (query, path, id) => api.nodeApiSearch(query, path, id),
  exactSearch: (query, path, options, id) => api.nodeApiExactSearch(query, path, options, id),
  source: (path, file, start, end, context, id) => api.nodeApiSource(path, file, start, end, context, id),
  files: (path, id) => api.nodeApiRepositoryFiles(path, id),
  map: (path, id) => api.nodeApiRepositoryMap(path, id),
  symbols: (path, id) => api.nodeApiSymbols(path, id),
  usages: (symbol, path, id) => api.nodeApiSymbolUsages(symbol, path, id),
  definition: (file, line, column, path, id) => api.nodeApiSymbolDefinition(file, line, column, path, id),
};
