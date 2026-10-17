import React from 'react';
import {
  type SearchResponse,
  type ExactSearchResponse,
  type SearchCandidate,
  type ExactMatch,
} from '../../api';
import {
  Search,
  SlidersHorizontal,
  FileCode,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { Button, Spinner } from '../../components/ui/Primitives';

interface SearchViewProps {
  searchMode: 'semantic' | 'exact';
  onSetSearchMode: (m: 'semantic' | 'exact') => void;
  caseSensitive: boolean;
  onSetCaseSensitive: (v: boolean) => void;
  wholeWord: boolean;
  onSetWholeWord: (v: boolean) => void;
  query: string;
  onSetQuery: (q: string) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  semanticResult: SearchResponse | null;
  exactResult: ExactSearchResponse | null;
  onViewSource: (c: SearchCandidate) => void;
  githubUrl?: string;
  revision?: string;
}

export function SearchView({
  searchMode,
  onSetSearchMode,
  caseSensitive,
  onSetCaseSensitive,
  wholeWord,
  onSetWholeWord,
  query,
  onSetQuery,
  onSearch,
  loading,
  error,
  semanticResult,
  exactResult,
  onViewSource,
  githubUrl,
  revision,
}: SearchViewProps) {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const copyPath = (path: string, id: string) => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const hasSemanticResults = !!(semanticResult?.ok && (semanticResult.candidates?.length ?? 0) > 0);
  const hasExactResults = !!(exactResult?.ok && (exactResult.matches?.length ?? 0) > 0);

  return (
    <div className="workspace-search-flow workspace-investigation-surface">
      {/* Search Input Bar */}
      <div className="search-control-bar">
        <div className="search-mode-selector" role="group" aria-label="Search Mode">
          <button
            type="button"
            className={`search-mode-tab ${searchMode === 'semantic' ? 'search-mode-tab--active' : ''}`}
            onClick={() => onSetSearchMode('semantic')}
            aria-pressed={searchMode === 'semantic'}
            aria-label="AI / Semantic"
          >
            AI / Semantic
          </button>
          <button
            type="button"
            className={`search-mode-tab ${searchMode === 'exact' ? 'search-mode-tab--active' : ''}`}
            onClick={() => onSetSearchMode('exact')}
            aria-pressed={searchMode === 'exact'}
            aria-label="Exact text"
          >
            Exact text
          </button>
        </div>

        <div className="search-input-row">
          <div className="search-input-container">
            <Search size={18} className="search-input-icon" />
            <input
              type="text"
              className="search-main-input"
              placeholder={
                searchMode === 'semantic'
                  ? "Describe functionality in natural language (e.g., 'validate webhook payload and signature')…"
                  : 'Enter literal identifier, string, or error pattern…'
              }
              value={query}
              onChange={(e) => onSetQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearch();
              }}
              spellCheck={false}
              aria-label="Search query"
            />
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={onSearch}
            disabled={loading || !query.trim()}
            icon={loading ? <Spinner size={16} /> : <Search size={16} />}
          >
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>

        {/* Exact Search Options */}
        {searchMode === 'exact' && (
          <div className="exact-options-row">
            <span className="exact-opts-label">
              <SlidersHorizontal size={13} /> Filters:
            </span>
            <label className="exact-checkbox-label">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => onSetCaseSensitive(e.target.checked)}
              />
              <span>Case Sensitive</span>
            </label>
            <label className="exact-checkbox-label">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => onSetWholeWord(e.target.checked)}
              />
              <span>Whole Word</span>
            </label>
          </div>
        )}
      </div>

      {/* Loading state indicator */}
      {loading && (
        <div className="search-loading-banner loading-notice animate-wf-rise">
          <Spinner size={18} />
          <div className="search-loading-text">
            <span>
              {searchMode === 'semantic'
                ? 'Running local embedding inference & vector matching…'
                : 'Scanning local repository files for literal matches…'}
            </span>
            <span className="search-loading-sub">
              {searchMode === 'semantic'
                ? 'First run downloads the local ONNX embedding model (~23 MB). Subsequent queries use local caching.'
                : 'Exact text search does not load embedding models.'}
            </span>
          </div>
        </div>
      )}

      {/* Search Error */}
      {error && (
        <div className="search-error-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Scope Metadata */}
      {searchMode === 'semantic' && semanticResult?.ok && semanticResult.scope && (
        <div className="search-scope-meta">
          <span>
            Searched <strong>{semanticResult.scope.filesProcessed}</strong> file
            {semanticResult.scope.filesProcessed !== 1 ? 's' : ''}
          </span>
          {(semanticResult.withheldCandidates ?? 0) > 0 && (
            <span className="scope-dim">
              · {semanticResult.withheldCandidates} candidate
              {semanticResult.withheldCandidates !== 1 ? 's' : ''} withheld (non-positive alignment)
            </span>
          )}
          {semanticResult.scope.warnings.map((w, idx) => (
            <span key={idx} className="scope-warning">
              <AlertTriangle size={13} /> {w}
            </span>
          ))}
        </div>
      )}

      {searchMode === 'exact' && exactResult?.ok && (
        <div className="search-scope-meta">
          <span>
            Found <strong>{exactResult.matches?.length ?? 0}</strong> line
            {(exactResult.matches?.length ?? 0) !== 1 ? 's' : ''} in{' '}
            <strong>{exactResult.filesWithMatches ?? 0}</strong> file
            {(exactResult.filesWithMatches ?? 0) !== 1 ? 's' : ''}
          </span>
          {exactResult.truncated && (
            <span className="scope-warning">
              <AlertTriangle size={13} /> Results truncated at limit
            </span>
          )}
        </div>
      )}

      {/* Empty States */}
      {searchMode === 'semantic' &&
        semanticResult?.ok &&
        (semanticResult.outcome === 'no-supported-candidate' ||
          semanticResult.outcome === 'no-relevant-results') && (
          <div className="search-empty-box">
            <h3 className="empty-title empty-state-title">No relevant code found</h3>
            <p className="empty-desc">
              We couldn’t identify a code region strongly related to your query. Try rephrasing with
              domain actions or programming terms. This does not establish that the behavior is absent.
            </p>
          </div>
        )}

      {searchMode === 'exact' && exactResult?.ok && (exactResult.matches?.length ?? 0) === 0 && (
          <div className="search-empty-box">
          <h3 className="empty-title empty-state-title">No exact text matches</h3>
          <p className="empty-desc">
            Try a shorter substring or disable the Case Sensitive or Whole Word options.
          </p>
        </div>
      )}

      {/* Semantic Results List */}
      {searchMode === 'semantic' && hasSemanticResults && (
        <div className="search-results-list">
          {semanticResult!.candidates!.map((c, idx) => {
            const id = `${c.filePath}:${c.startLine}`;
            const isCopied = copiedId === id;

            return (
              <article key={id} className="candidate-card card animate-wf-rise">
                <div className="candidate-header">
                  <div className="candidate-rank">#{idx + 1}</div>
                  <div className="candidate-path-wrap">
                    <span className="candidate-filepath">{c.filePath}</span>
                    <span className="candidate-lines">
                      lines {c.startLine}–{c.endLine}
                    </span>
                    <span
                      className="candidate-score-badge"
                      title={`Cosine similarity score: ${c.score.toFixed(4)}`}
                    >
                      Similarity {c.score.toFixed(3)}
                    </span>
                  </div>

                  <div className="candidate-actions">
                    <button
                      type="button"
                      className="candidate-btn"
                      onClick={() => copyPath(`${c.filePath}:${c.startLine}-${c.endLine}`, id)}
                      title="Copy location"
                    >
                      {isCopied ? <Check size={13} color="#22C55E" /> : <Copy size={13} />}
                      <span>{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>

                    <button
                      type="button"
                      className="candidate-btn candidate-btn--primary"
                      onClick={() => onViewSource(c)}
                      aria-label={`View source for ${c.filePath}`}
                    >
                      <FileCode size={13} />
                      <span>View Source</span>
                    </button>

                    {githubUrl && revision && (
                      <a
                        href={`${githubUrl}/blob/${revision}/${c.filePath.split('/').map(encodeURIComponent).join('/')}#L${c.startLine}-L${c.endLine}`}
                        target="_blank"
                        rel="noreferrer"
                        className="candidate-btn"
                        aria-label="Open on GitHub"
                        title="Open on GitHub"
                      >
                        <ExternalLink size={13} />
                        <span>Open on GitHub</span>
                      </a>
                    )}
                  </div>
                </div>

                <div className="candidate-code-box">
                  <pre className="candidate-code-pre">{c.text}</pre>
                </div>

                <div className="candidate-footer">
                  Unverified semantic candidate — similarity is a ranking signal, not confidence or proof.
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Exact Results List */}
      {searchMode === 'exact' && hasExactResults && (
        <div className="exact-results-container">
          {exactResult!.matches!.map((match, idx) => {
            const candidate: SearchCandidate = {
              filePath: match.filePath,
              startLine: match.line,
              endLine: match.line,
              text: match.text,
              score: 0,
            };

            const parts: React.ReactNode[] = [];
            let cursor = 0;
            match.occurrences.forEach((occ, oIdx) => {
              if (cursor < occ.start) parts.push(match.text.slice(cursor, occ.start));
              parts.push(
                <mark key={oIdx} className="exact-matched-mark exact-highlight">
                  {match.text.slice(occ.start, occ.end)}
                </mark>
              );
              cursor = occ.end;
            });
            if (cursor < match.text.length) parts.push(match.text.slice(cursor));

            return (
              <div key={`${match.filePath}:${match.line}:${idx}`} className="exact-match-row exact-card">
                <div className="exact-match-meta">
                  <span className="exact-file-label">{match.filePath}</span>
                  <span className="exact-line-label">:{match.line}</span>
                  <button
                    type="button"
                    className="exact-view-btn"
                    onClick={() => onViewSource(candidate)}
                    aria-label={`View source for ${match.filePath} line ${match.line}`}
                  >
                    View Source
                  </button>
                </div>
                <pre className="exact-code-preview">
                  <span className="exact-gutter-num">{match.line}</span>
                  {parts}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
