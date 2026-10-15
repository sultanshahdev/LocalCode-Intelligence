import {
  createLocalEmbedder,
  retrieveCandidates,
  selectDisplayCandidates,
  type Embedder,
  type SearchCandidate,
} from './retrieval.js';
import { prepareSourceScope, type SourceScope } from './source.js';
import { assessRelevance, type RelevanceAssessment } from './relevance.js';

export type SearchFailureReason = 'unsupported-source-scope' | 'processing-failed';
export type SearchResult =
  | {
      ok: true;
      outcome: 'candidates' | 'no-supported-candidate' | 'no-relevant-results';
      candidates: SearchCandidate[];
      withheldCandidates: number;
      scope: SourceScope;
      relevance?: RelevanceAssessment;
    }
  | { ok: false; reason: SearchFailureReason; message: string };

export interface SearchDependencies {
  prepare(repositoryPath: string): Promise<SourceScope>;
  createEmbedder(): Promise<Embedder>;
}

const defaultDependencies: SearchDependencies = {
  prepare: prepareSourceScope,
  createEmbedder: createLocalEmbedder,
};

export async function searchRepository(
  query: string,
  repositoryPath: string,
  dependencies: SearchDependencies = defaultDependencies,
): Promise<SearchResult> {
  let scope: SourceScope;
  try {
    scope = await dependencies.prepare(repositoryPath);
  } catch (error: unknown) {
    return failure('processing-failed', `Search could not process the source scope: ${errorMessage(error)}`);
  }
  if (scope.regions.length === 0) {
    const coverage = scope.warnings.length > 0
      ? ` Coverage warnings: ${scope.warnings.join(' ')}`
      : '';
    return failure('unsupported-source-scope', `No supported JavaScript or TypeScript source content was found.${coverage}`);
  }

  try {
    const embedder = await dependencies.createEmbedder();
    const retrieved = await retrieveCandidates(query, scope.regions, embedder);
    const selection = selectDisplayCandidates(retrieved);
    const relevance = assessRelevance(query, selection.candidates);
    return {
      ok: true,
      outcome: selection.candidates.length === 0 ? 'no-supported-candidate' : relevance.relevant ? 'candidates' : 'no-relevant-results',
      candidates: relevance.relevant ? selection.candidates : [],
      withheldCandidates: selection.withheldCount,
      scope,
      relevance,
    };
  } catch (error: unknown) {
    return failure('processing-failed', `Search could not complete retrieval: ${errorMessage(error)}. This does not mean relevant code is absent.`);
  }
}

function failure(reason: SearchFailureReason, message: string): SearchResult {
  return { ok: false, reason, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
