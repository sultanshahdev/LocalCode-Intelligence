import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  apiRepoStatus,
  apiSearch,
  apiSource,
  type SearchCandidate,
  type RepoStatus,
  type SearchResponse,
  type SourceResponse,
} from './api';

// ── Source viewer panel ───────────────────────────────────────────────────────

interface SourceViewerProps {
  repositoryPath: string;
  candidate: SearchCandidate;
  onClose: () => void;
}

function SourceViewer({ repositoryPath, candidate, onClose }: SourceViewerProps) {
  const [sourceData, setSourceData] = useState<SourceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Context window: ±20 lines around the candidate region
  const contextStart = Math.max(1, candidate.startLine - 20);
  const contextEnd = candidate.endLine + 20;

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiSource(repositoryPath, candidate.filePath, contextStart, contextEnd)
      .then((result) => {
        setSourceData(result);
        if (!result.ok) setError(result.message ?? 'Source read failed');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, [repositoryPath, candidate.filePath, contextStart, contextEnd]);

  const location = `${candidate.filePath}:${candidate.startLine}-${candidate.endLine}`;

  const handleCopy = () => {
    void navigator.clipboard.writeText(location);
  };

  return (
    <div className="source-viewer-overlay" onClick={onClose}>
      <div className="source-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="source-viewer-header">
          <div className="source-viewer-path">
            <span className="file-icon">📄</span>
            <span className="path-text">{candidate.filePath}</span>
            <span className="line-badge">:{candidate.startLine}–{candidate.endLine}</span>
          </div>
          <div className="source-viewer-actions">
            <button className="btn-icon" onClick={handleCopy} title="Copy location">
              📋
            </button>
            <button className="btn-icon btn-close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>

        {sourceData?.notice && (
          <div className="source-notice">{sourceData.notice}</div>
        )}

        {loading && <div className="source-loading">Loading source…</div>}
        {error && <div className="source-error">{error}</div>}

        {!loading && !error && sourceData?.ok && sourceData.lines && (
          <div className="source-code-wrap">
            <pre className="source-code">
              {sourceData.lines.map((line, idx) => {
                const lineNum = contextStart + idx;
                const isHighlighted =
                  lineNum >= candidate.startLine && lineNum <= candidate.endLine;
                return (
                  <div
                    key={lineNum}
                    className={`source-line ${isHighlighted ? 'source-line--highlight' : ''}`}
                  >
                    <span className="line-num">{lineNum}</span>
                    <span className="line-content">{line}</span>
                  </div>
                );
              })}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

interface ResultCardProps {
  candidate: SearchCandidate;
  index: number;
  repositoryPath: string;
  onViewSource: (c: SearchCandidate) => void;
}

function ResultCard({ candidate, index, repositoryPath, onViewSource }: ResultCardProps) {
  const location = `${candidate.filePath}:${candidate.startLine}-${candidate.endLine}`;
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(location).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const scorePercent = Math.round(candidate.score * 100);
  const scoreClass =
    scorePercent >= 70 ? 'score--high' : scorePercent >= 40 ? 'score--mid' : 'score--low';

  return (
    <div className="result-card">
      <div className="result-card-header">
        <span className="result-rank">#{index + 1}</span>
        <div className="result-location">
          <span className="result-filepath">{candidate.filePath}</span>
          <span className="result-lines">
            lines {candidate.startLine}–{candidate.endLine}
          </span>
        </div>
        <div className="result-actions">
          <span className={`score-badge ${scoreClass}`} title="Cosine similarity score">
            {scorePercent}%
          </span>
          <button className="btn-sm" onClick={handleCopy} title="Copy location">
            {copied ? '✓' : '📋'}
          </button>
          <button className="btn-sm btn-primary" onClick={() => onViewSource(candidate)}>
            View Source
          </button>
        </div>
      </div>
      <pre className="result-excerpt">{candidate.text}</pre>
      <p className="result-notice">
        ⚠️ Unverified semantic candidate — relevance is uncertain.
      </p>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [repoPath, setRepoPath] = useState('');
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [resolvedPath, setResolvedPath] = useState('');

  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [activeSource, setActiveSource] = useState<SearchCandidate | null>(null);

  const queryInputRef = useRef<HTMLInputElement>(null);

  const handleCheckRepo = useCallback(async () => {
    const path = repoPath.trim();
    if (!path) return;
    setRepoLoading(true);
    setRepoError(null);
    setRepoStatus(null);
    setResolvedPath('');
    setSearchResult(null);
    try {
      const result = await apiRepoStatus(path);
      if (result.ok && result.status) {
        setRepoStatus(result.status);
        setResolvedPath(result.resolvedPath ?? path);
      } else {
        setRepoError(result.message ?? 'Repository check failed');
      }
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRepoLoading(false);
    }
  }, [repoPath]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !resolvedPath) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    setActiveSource(null);
    try {
      const result = await apiSearch(q, resolvedPath);
      setSearchResult(result);
      if (!result.ok) setSearchError(result.message ?? 'Search failed');
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSearchLoading(false);
    }
  }, [query, resolvedPath]);

  const handleRepoKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleCheckRepo();
  };

  const handleQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSearch();
  };

  const canSearch = !!repoStatus?.eligible && !!resolvedPath;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon">⟨/⟩</span>
            <span className="brand-name">LocalCode Intelligence</span>
          </div>
          <span className="brand-tagline">local-first semantic code search</span>
        </div>
      </header>

      <main className="app-main">
        {/* Repository panel */}
        <section className="panel repo-panel">
          <h2 className="panel-title">Repository</h2>
          <div className="input-row">
            <input
              className="input-text"
              type="text"
              placeholder="/absolute/path/to/your/repository"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={handleRepoKeyDown}
              aria-label="Repository path"
            />
            <button
              className="btn btn-primary"
              onClick={() => void handleCheckRepo()}
              disabled={repoLoading || !repoPath.trim()}
            >
              {repoLoading ? 'Checking…' : 'Check'}
            </button>
          </div>

          {repoError && <div className="error-msg">{repoError}</div>}

          {repoStatus && (
            <div className="repo-status-card">
              <div className="status-row">
                <span className="status-label">Status</span>
                <span className={`status-value ${repoStatus.eligible ? 'status--ok' : 'status--warn'}`}>
                  {repoStatus.eligible ? '✓ Eligible for search' : '✗ No searchable source'}
                </span>
              </div>
              <div className="status-row">
                <span className="status-label">Coverage</span>
                <span className="status-value">{repoStatus.coverage}</span>
              </div>
              <div className="status-row">
                <span className="status-label">Files discovered</span>
                <span className="status-value">{repoStatus.filesDiscovered}</span>
              </div>
              <div className="status-row">
                <span className="status-label">Files processed</span>
                <span className="status-value">{repoStatus.filesProcessed}</span>
              </div>
              {repoStatus.warnings.length > 0 && (
                <div className="status-warnings">
                  {repoStatus.warnings.map((w, i) => (
                    <div key={i} className="status-warning">⚠️ {w}</div>
                  ))}
                </div>
              )}
              {resolvedPath && (
                <div className="resolved-path">
                  <span className="status-label">Resolved</span>
                  <code className="status-code">{resolvedPath}</code>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Search panel */}
        <section className={`panel search-panel ${!canSearch ? 'panel--disabled' : ''}`}>
          <h2 className="panel-title">Search</h2>
          <div className="input-row">
            <input
              ref={queryInputRef}
              className="input-text"
              type="text"
              placeholder={canSearch ? 'Describe what you\'re looking for…' : 'Check a repository first'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleQueryKeyDown}
              disabled={!canSearch}
              aria-label="Search query"
            />
            <button
              className="btn btn-primary"
              onClick={() => void handleSearch()}
              disabled={!canSearch || searchLoading || !query.trim()}
            >
              {searchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchLoading && (
            <div className="loading-state">
              <div className="spinner" />
              <span>Loading model and embedding source… this may take a moment on first run.</span>
            </div>
          )}

          {searchError && <div className="error-msg">{searchError}</div>}

          {searchResult?.ok && (
            <div className="search-meta">
              <span>Files processed: <strong>{searchResult.scope?.filesProcessed}</strong></span>
              {(searchResult.scope?.warnings.length ?? 0) > 0 && (
                <span className="meta-warn">
                  ⚠️ {searchResult.scope?.warnings.join(' ')}
                </span>
              )}
              {(searchResult.withheldCandidates ?? 0) > 0 && (
                <span className="meta-warn">
                  {searchResult.withheldCandidates} candidate(s) withheld (non-positive alignment)
                </span>
              )}
            </div>
          )}

          {searchResult?.ok && searchResult.outcome === 'no-supported-candidate' && (
            <div className="no-results">
              <p>No sufficiently supported candidate found.</p>
              <p className="no-results-note">
                The search completed but no retrieved region had positive cosine alignment.
                This does not establish that the requested behavior is absent from the repository.
              </p>
            </div>
          )}

          {searchResult?.ok && searchResult.candidates && searchResult.candidates.length > 0 && (
            <div className="results-list">
              {searchResult.candidates.map((candidate, i) => (
                <ResultCard
                  key={`${candidate.filePath}:${candidate.startLine}`}
                  candidate={candidate}
                  index={i}
                  repositoryPath={resolvedPath}
                  onViewSource={setActiveSource}
                />
              ))}
              <p className="results-footer">
                Note: Similarity is a ranking signal, not a probability or verified behavioral guarantee.
              </p>
            </div>
          )}
        </section>
      </main>

      {/* Source viewer overlay */}
      {activeSource && (
        <SourceViewer
          repositoryPath={resolvedPath}
          candidate={activeSource}
          onClose={() => setActiveSource(null)}
        />
      )}
    </div>
  );
}
