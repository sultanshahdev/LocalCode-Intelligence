import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  apiRepoStatus,
  apiPrepareRepository,
  apiSearch,
  apiExactSearch,
  apiSource,
  apiRepositoryFiles,
  apiSymbols,
  apiSymbolUsages,
  apiSymbolDefinition,
  type SearchCandidate,
  type RepoStatus,
  type SearchResponse,
  type ExactMatch,
  type ExactSearchResponse,
  type SourceResponse,
  type SourceSymbol,
  type SymbolUsage,
} from './api';

function FileExplorer({ files, loading, error, onOpen }: { files: string[]; loading: boolean; error: string | null; onOpen: (filePath: string) => void }) {
  const [filter, setFilter] = useState('');
  const visible = files.filter(file => file.toLowerCase().includes(filter.toLowerCase()));
  const groups = new Map<string, string[]>();
  visible.forEach(file => { const slash = file.lastIndexOf('/'); const dir = slash < 0 ? 'Repository root' : file.slice(0, slash); const names = groups.get(dir) ?? []; names.push(file); groups.set(dir, names); });
  return <section className="explorer" aria-label="Repository files">
    <div className="explorer-head"><strong>Files</strong><span>{files.length}</span></div>
    <input className="explorer-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter files…" aria-label="Filter repository files" />
    {loading && <div className="explorer-state"><Spinner /> Loading files…</div>}
    {error && <div className="explorer-state" role="alert">{error}</div>}
    {!loading && !error && visible.length === 0 && <div className="explorer-state">No matching source files.</div>}
    {[...groups.entries()].map(([dir, entries]) => <details key={dir} open className="explorer-dir">
      <summary>{dir}</summary>
      {entries.map(file => <button key={file} className="explorer-file" onClick={() => onOpen(file)} title={file}><FileIcon /> <span>{file.slice(file.lastIndexOf('/') + 1)}</span></button>)}
    </details>)}
  </section>;
}
function SymbolExplorer({ symbols, loading, error, truncated, onOpen, onUsages }: { symbols: SourceSymbol[]; loading: boolean; error: string | null; truncated: boolean; onOpen: (symbol: SourceSymbol) => void; onUsages: (symbol: SourceSymbol) => void }) {
  const [filter, setFilter] = useState(''); const visible = symbols.filter(s => `${s.name} ${s.filePath} ${s.kind} ${s.containerName ?? ''}`.toLowerCase().includes(filter.toLowerCase())); const byFile = new Map<string, SourceSymbol[]>(); visible.forEach(s => byFile.set(s.filePath, [...(byFile.get(s.filePath) ?? []), s]));
  return <section className="symbol-explorer" aria-label="Symbol Explorer"><div className="explorer-head"><strong>Symbols</strong><span>{symbols.length}</span></div><p className="symbol-help">Declarations below; Find usages shows possible name matches, not type-resolved references.</p><input className="explorer-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter declarations…" aria-label="Filter symbols" />{loading && <div className="explorer-state"><Spinner /> Reading declarations…</div>}{error && <div className="explorer-state" role="alert">{error}</div>}{!loading && !error && visible.length === 0 && <div className="explorer-state">No matching declarations.</div>}{truncated && <div className="explorer-state">Symbol results are truncated.</div>}{[...byFile.entries()].map(([file, entries]) => <details key={file} open className="explorer-dir"><summary>{file}</summary>{entries.map(s => <div className="symbol-row" key={`${s.name}:${s.startLine}:${s.kind}`}><button className="explorer-file" onClick={() => onOpen(s)}><span className="symbol-kind">{s.kind}</span><span>{s.containerName ? `${s.containerName}.` : ''}{s.name}</span><span className="symbol-line">:{s.startLine}</span></button><button className="symbol-usages" onClick={() => onUsages(s)}>Find usages</button></div>)}</details>)}</section>;
}

// ── Escape-key hook ───────────────────────────────────────────────────────────

function useEscapeKey(handler: () => void) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.key === 'Escape') handler(); };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [handler]);
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied'>('idle');
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => {
      setState('copied');
      setTimeout(() => setState('idle'), 1600);
    });
  };
  return (
    <button
      className={`copy-btn ${state === 'copied' ? 'copy-btn--done' : ''}`}
      onClick={copy}
      title={`Copy ${label}`}
      aria-label={state === 'copied' ? 'Copied!' : `Copy ${label}`}
    >
      {state === 'copied' ? (
        <><CheckIcon /> Copied</>
      ) : (
        <><CopyIcon /> {label}</>
      )}
    </button>
  );
}

// ── Source viewer ─────────────────────────────────────────────────────────────

interface SourceViewerProps {
  repositoryPath: string;
  repositoryId?: string;
  candidate: SearchCandidate;
  onClose: () => void;
}

function SourceViewer({ repositoryPath, repositoryId, candidate, onClose }: SourceViewerProps) {
  const [sourceData, setSourceData] = useState<SourceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const location = `${candidate.filePath}:${candidate.startLine}-${candidate.endLine}`;

  useEscapeKey(onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSourceData(null);
    apiSource(repositoryPath, candidate.filePath, candidate.startLine, candidate.endLine, 25, repositoryId)
      .then((result) => {
        if (cancelled) return;
        setSourceData(result);
        if (!result.ok) setError(result.message ?? 'Source read failed');
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repositoryPath, repositoryId, candidate.filePath, candidate.startLine, candidate.endLine]);

  // Scroll highlighted region into view once loaded
  useEffect(() => {
    if (sourceData?.ok && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [sourceData]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Source viewer">
      <div className="source-viewer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sv-header">
          <div className="sv-path-group">
            <FileIcon />
            <span className="sv-filepath">{candidate.filePath}</span>
            <span className="sv-lines">:{candidate.startLine}–{candidate.endLine}</span>
          </div>
          <div className="sv-actions">
            <CopyButton text={location} label="location" />
            <button
              className="sv-close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close source viewer"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Snapshot notice */}
        <div className="sv-notice">
          <InfoIcon />
          <span>Current file — content may differ from the search snapshot if the file was modified since indexing.</span>
        </div>

        {/* Body */}
        <div className="sv-body">
          {loading && (
            <div className="sv-placeholder">
              <Spinner /> Loading source…
            </div>
          )}
          {error && (
            <div className="sv-error">
              <ErrorIcon /> {error}
            </div>
          )}
          {!loading && !error && sourceData?.ok && sourceData.lines && (
            <pre className="sv-code">
              {sourceData.lines.map((line, idx) => {
                const lineNum = (sourceData.startLine ?? candidate.startLine) + idx;
                const isHighlighted = lineNum >= candidate.startLine && lineNum <= candidate.endLine;
                return (
                  <div
                    key={lineNum}
                    ref={isHighlighted && lineNum === candidate.startLine ? highlightRef : undefined}
                    className={`sv-line${isHighlighted ? ' sv-line--hl' : ''}`}
                  >
                    <span className="sv-ln">{lineNum}</span>
                    <span className="sv-lc">{line}</span>
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────

interface ResultCardProps {
  candidate: SearchCandidate;
  index: number;
  onViewSource: (c: SearchCandidate) => void;
  githubUrl?: string;
  revision?: string;
}

function ResultCard({ candidate, index, onViewSource, githubUrl, revision }: ResultCardProps) {
  const location = `${candidate.filePath}:${candidate.startLine}-${candidate.endLine}`;
  const score = candidate.score;
  const scorePct = Math.round(score * 100);
  const tier = scorePct >= 65 ? 'high' : scorePct >= 35 ? 'mid' : 'low';

  // Split path for better display: dir prefix + filename
  const lastSlash = candidate.filePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? candidate.filePath.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? candidate.filePath.slice(lastSlash + 1) : candidate.filePath;

  return (
    <article className="card">
      <div className="card-header">
        <div className="card-rank" aria-label={`Result ${index + 1}`}>
          {index + 1}
        </div>
        <div className="card-meta">
          <div className="card-path">
            {dir && <span className="card-dir">{dir}</span>}
            <span className="card-filename">{filename}</span>
          </div>
          <div className="card-location-row">
            <span className="card-lines">lines {candidate.startLine}–{candidate.endLine}</span>
            <span className={`score-pill score-pill--${tier}`} title={`Cosine similarity (ranking signal, not a probability): ${score.toFixed(4)}`}>
              Similarity {score.toFixed(3)}
            </span>
          </div>
        </div>
        <div className="card-actions">
          <CopyButton text={location} label="path" />
          <button
            className="btn-view"
            onClick={() => onViewSource(candidate)}
            aria-label={`View source for ${candidate.filePath}`}
          >
            View Source
          </button>
          {githubUrl && revision && <a className="btn-view" target="_blank" rel="noreferrer" href={`${githubUrl}/blob/${revision}/${candidate.filePath.split('/').map(encodeURIComponent).join('/')}#L${candidate.startLine}-L${candidate.endLine}`}>Open on GitHub</a>}
        </div>
      </div>

      <div className="card-excerpt-wrap">
        <pre className="card-excerpt">{candidate.text}</pre>
      </div>

      <div className="card-footer">
        Unverified semantic candidate — similarity is a ranking signal, not a confidence score.
      </div>
    </article>
  );
}

function ExactResultCard({ match, onViewSource, githubUrl, revision }: { match: ExactMatch; onViewSource: (c: SearchCandidate) => void; githubUrl?: string; revision?: string }) {
  const candidate = { filePath: match.filePath, startLine: match.line, endLine: match.line, text: match.text, score: 0 };
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  match.occurrences.forEach((occurrence, index) => {
    if (cursor < occurrence.start) parts.push(match.text.slice(cursor, occurrence.start));
    parts.push(<mark key={index} className="exact-highlight">{match.text.slice(occurrence.start, occurrence.end)}</mark>);
    cursor = occurrence.end;
  });
  if (cursor < match.text.length) parts.push(match.text.slice(cursor));
  return <article className="card exact-card">
    <div className="card-header">
      <div className="card-meta"><div className="card-path"><span className="card-filename">{match.filePath}</span></div><div className="card-location-row"><span className="card-lines">line {match.line}</span></div></div>
      <div className="card-actions">
        <button className="btn-view" onClick={() => onViewSource(candidate)} aria-label={`View source for ${match.filePath} line ${match.line}`}>View Source</button>
        {githubUrl && revision && <a className="btn-view" target="_blank" rel="noreferrer" href={`${githubUrl}/blob/${revision}/${match.filePath.split('/').map(encodeURIComponent).join('/')}#L${match.line}`}>Open on GitHub</a>}
      </div>
    </div>
    <pre className="card-excerpt exact-excerpt"><span className="exact-line-number">{match.line}</span>{parts}</pre>
  </article>;
}

function ExactResults({ matches, onViewSource, githubUrl, revision }: { matches: ExactMatch[]; onViewSource: (c: SearchCandidate) => void; githubUrl?: string; revision?: string }) {
  const byFile = new Map<string, ExactMatch[]>();
  matches.forEach(match => byFile.set(match.filePath, [...(byFile.get(match.filePath) ?? []), match]));
  return <>{[...byFile.entries()].map(([filePath, fileMatches]) => <section className="exact-file-group" key={filePath} aria-label={`Matches in ${filePath}`}>
    <h3>{filePath} <span>{fileMatches.length} match{fileMatches.length === 1 ? '' : 'es'}</span></h3>
    {fileMatches.map(match => <ExactResultCard key={`${match.filePath}:${match.line}`} match={match} onViewSource={onViewSource} githubUrl={githubUrl} revision={revision} />)}
  </section>)}</>;
}

// ── Repo status display ───────────────────────────────────────────────────────

function RepoStatusDisplay({ status, resolvedPath }: { status: RepoStatus; resolvedPath: string }) {
  return (
    <div className="repo-status">
      <div className="status-grid">
        <StatusRow label="Eligibility" value={
          <span className={status.eligible ? 'tag tag--ok' : 'tag tag--warn'}>
            {status.eligible ? 'Ready for search' : 'No searchable source'}
          </span>
        } />
        <StatusRow label="Coverage" value={
          <span className={status.coverage === 'complete' ? 'tag tag--ok' : 'tag tag--warn'}>
            {status.coverage}
          </span>
        } />
        <StatusRow label="Source files" value={
          <span className="status-val">
            {status.filesProcessed}
            {status.filesDiscovered > status.filesProcessed && (
              <span className="status-val-dim"> / {status.filesDiscovered} discovered</span>
            )}
          </span>
        } />
        {resolvedPath && (
          <StatusRow label="Resolved path" value={
            <code className="status-path">{resolvedPath}</code>
          } />
        )}
      </div>
      {status.warnings.length > 0 && (
        <div className="status-warnings">
          {status.warnings.map((w, i) => (
            <div key={i} className="status-warn-item">
              <WarningIcon /> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="status-row">
      <dt className="status-key">{label}</dt>
      <dd className="status-val-wrap">{value}</dd>
    </div>
  );
}

// ── Search scope summary ──────────────────────────────────────────────────────

function SearchMeta({ result }: { result: SearchResponse | ExactSearchResponse }) {
  if (!result.ok || !result.scope) return null;
  return (
    <div className="search-meta">
      <span>
        Searched <strong>{result.scope.filesProcessed}</strong> file{result.scope.filesProcessed !== 1 ? 's' : ''}
      </span>
      {'withheldCandidates' in result && (result.withheldCandidates ?? 0) > 0 && (
        <span className="meta-dim">
          · {result.withheldCandidates} candidate{result.withheldCandidates !== 1 ? 's' : ''} withheld (non-positive alignment)
        </span>
      )}
      {result.scope.warnings.map((w, i) => (
        <span key={i} className="meta-warn"><WarningIcon /> {w}</span>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [repoPath, setRepoPath] = useState('');
  const [sourceType, setSourceType] = useState<'local' | 'github'>('local');
  const [repositoryId, setRepositoryId] = useState<string | undefined>();
  const [githubSource, setGithubSource] = useState<{ url: string; revision: string } | null>(null);
  const repositoryGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const usageGeneration = useRef(0);
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [resolvedPath, setResolvedPath] = useState('');

  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [exactResult, setExactResult] = useState<ExactSearchResponse | null>(null);
  const [searchMode, setSearchMode] = useState<'semantic' | 'exact'>('semantic');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [activeSource, setActiveSource] = useState<SearchCandidate | null>(null);
  const [navigatorFiles, setNavigatorFiles] = useState<string[]>([]);
  const [navigatorLoading, setNavigatorLoading] = useState(false);
  const [navigatorError, setNavigatorError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<SourceSymbol[]>([]); const [symbolsLoading, setSymbolsLoading] = useState(false); const [symbolsError, setSymbolsError] = useState<string | null>(null); const [symbolsTruncated, setSymbolsTruncated] = useState(false);
  const [usageSymbol, setUsageSymbol] = useState<SourceSymbol | null>(null);
  const [usages, setUsages] = useState<SymbolUsage[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [usagesError, setUsagesError] = useState<string | null>(null);
  const [usagesTruncated, setUsagesTruncated] = useState(false);
  const [usagesWarnings, setUsagesWarnings] = useState<string[]>([]);
  const definitionGeneration = useRef(0);
  const [definitionLoading, setDefinitionLoading] = useState<string | null>(null);
  const [definitionMessage, setDefinitionMessage] = useState<string | null>(null);

  const queryInputRef = useRef<HTMLInputElement>(null);

  const handleCheckRepo = useCallback(async (refresh = false) => {
    const path = repoPath.trim();
    if (!path) return;
    const current = ++repositoryGeneration.current;
    // Ignore any in-flight usage response when a repository is prepared or refreshed.
    usageGeneration.current += 1;
    setUsageSymbol(null);
    setUsages([]);
    setUsagesLoading(false);
    setUsagesError(null);
    setUsagesTruncated(false);
    setUsagesWarnings([]);
    setRepoLoading(true);
    setRepoError(null);
    if (!refresh) {
      searchGeneration.current += 1;
      setSearchLoading(false);
      setRepoStatus(null);
      setResolvedPath('');
      setSearchResult(null);
      setExactResult(null);
      setActiveSource(null);
      setNavigatorFiles([]); setNavigatorError(null);
      setSymbols([]); setSymbolsError(null); setSymbolsTruncated(false);
    }
    try {
      const result = await apiPrepareRepository(sourceType, path, refresh);
      if (current !== repositoryGeneration.current) return;
      if (result.ok && result.status) {
        // Only a completed, successful refresh invalidates the old revision's
        // search results; a failed refresh leaves the prior session usable.
        if (refresh) {
          searchGeneration.current += 1;
          setSearchLoading(false);
          setSearchResult(null);
          setExactResult(null);
          setActiveSource(null);
        }
        setRepoStatus(result.status);
        setResolvedPath(result.source?.label ?? result.resolvedPath ?? path);
        setRepositoryId(result.repositoryId);
        setGithubSource(result.source?.githubUrl && result.source.revision ? { url: result.source.githubUrl, revision: result.source.revision } : null);
        setNavigatorLoading(true); setNavigatorError(null);
        void apiRepositoryFiles(result.source?.label ?? result.resolvedPath ?? path, result.repositoryId).then(listing => {
          if (current !== repositoryGeneration.current) return;
          if (listing.ok) setNavigatorFiles(listing.files ?? []); else setNavigatorError(listing.message ?? 'Files are unavailable.');
        }).catch(() => { if (current === repositoryGeneration.current) setNavigatorError('Files are unavailable.'); })
          .finally(() => { if (current === repositoryGeneration.current) setNavigatorLoading(false); });
        setSymbolsLoading(true); setSymbolsError(null);
        void apiSymbols(result.source?.label ?? result.resolvedPath ?? path, result.repositoryId).then(response => { if (current !== repositoryGeneration.current) return; if (response.ok) { setSymbols(response.symbols ?? []); setSymbolsTruncated(response.truncated === true); } else setSymbolsError(response.message ?? 'Symbols are unavailable.'); }).catch(() => { if (current === repositoryGeneration.current) setSymbolsError('Symbols are unavailable.'); }).finally(() => { if (current === repositoryGeneration.current) setSymbolsLoading(false); });
        // Focus search input if eligible
        if (result.status.eligible) {
          setTimeout(() => queryInputRef.current?.focus(), 100);
        }
      } else {
        setRepoError(result.message ?? 'Repository check failed');
      }
    } catch (e) {
      if (current === repositoryGeneration.current) setRepoError(e instanceof Error ? e.message : 'Network error — is the server running?');
    } finally {
      if (current === repositoryGeneration.current) setRepoLoading(false);
    }
  }, [repoPath, sourceType]);

  const invalidateRepository = () => { repositoryGeneration.current += 1; searchGeneration.current += 1; usageGeneration.current += 1; setUsageSymbol(null); setUsages([]); setUsagesLoading(false); setUsagesError(null); setUsagesTruncated(false); setUsagesWarnings([]); setRepoLoading(false); setSearchLoading(false); setRepositoryId(undefined); setRepoStatus(null); setResolvedPath(''); setGithubSource(null); setSearchResult(null); setExactResult(null); setSearchError(null); setRepoError(null); setActiveSource(null); setNavigatorFiles([]); setNavigatorError(null); setNavigatorLoading(false); setSymbols([]); setSymbolsError(null); setSymbolsLoading(false); setSymbolsTruncated(false); };
  const changeSource = (type: 'local' | 'github') => { invalidateRepository(); setSourceType(type); };
  const invalidateSearch = () => {
    searchGeneration.current += 1;
    setSearchLoading(false);
    setSearchResult(null);
    setExactResult(null);
    setSearchError(null);
  };

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !resolvedPath) return;
    const current = ++searchGeneration.current;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null); setExactResult(null);
    setActiveSource(null);
    try {
      const result = searchMode === 'semantic'
        ? await apiSearch(q, resolvedPath, repositoryId)
        : await apiExactSearch(q, resolvedPath, { caseSensitive, wholeWord }, repositoryId);
      if (current !== searchGeneration.current) return;
      if (searchMode === 'semantic') setSearchResult(result as SearchResponse); else setExactResult(result as ExactSearchResponse);
      if (!result.ok) setSearchError(result.message ?? 'Search failed');
    } catch (e) {
      if (current === searchGeneration.current) setSearchError(e instanceof Error ? e.message : 'Network error — is the server running?');
    } finally {
      if (current === searchGeneration.current) setSearchLoading(false);
    }
  }, [query, resolvedPath, repositoryId, searchMode, caseSensitive, wholeWord]);

  const canSearch = !!repoStatus?.eligible && !!resolvedPath;
  const hasResults = searchMode === 'semantic'
    ? !!(searchResult?.ok && (searchResult.candidates?.length ?? 0) > 0)
    : !!(exactResult?.ok && (exactResult.matches?.length ?? 0) > 0);

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">{'</>'}</span>
            <span className="brand-name">LocalCode Intelligence</span>
          </div>
          <span className="brand-sub">local-first code search</span>
        </div>
      </header>

      <main className="app-main">

        {/* ── Step 1: Repository ── */}
        <section className="section">
          <div className="section-label">
            <StepBadge n={1} done={!!repoStatus} />
            <span>Repository</span>
          </div>

          <div className="search-mode" role="group" aria-label="Search mode">
            <button className={searchMode === 'semantic' ? 'search-mode__active' : ''} aria-pressed={searchMode === 'semantic'} onClick={() => { invalidateSearch(); setSearchMode('semantic'); }}>AI / Semantic</button>
            <button className={searchMode === 'exact' ? 'search-mode__active' : ''} aria-pressed={searchMode === 'exact'} onClick={() => { invalidateSearch(); setSearchMode('exact'); }}>Exact text</button>
          </div>
          {searchMode === 'exact' && <div className="exact-options" aria-label="Exact text options">
            <label><input type="checkbox" checked={caseSensitive} onChange={e => { invalidateSearch(); setCaseSensitive(e.target.checked); }} /> Case sensitive</label>
            <label><input type="checkbox" checked={wholeWord} onChange={e => { invalidateSearch(); setWholeWord(e.target.checked); }} /> Whole word</label>
          </div>}
          <div className="source-switch" role="group" aria-label="Repository source">
            <button className={sourceType === 'local' ? 'source-switch__active' : ''} onClick={() => changeSource('local')}>Local folder</button>
            <button className={sourceType === 'github' ? 'source-switch__active' : ''} onClick={() => changeSource('github')}>GitHub URL</button>
          </div>

          <div className="field-row">
            <input
              className="field-input"
              type="text"
              placeholder={sourceType === 'local' ? 'Absolute path, e.g. /home/user/my-project' : 'https://github.com/owner/repository'}
              value={repoPath}
              onChange={(e) => { invalidateRepository(); setRepoPath(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCheckRepo(); }}
              aria-label={sourceType === 'local' ? 'Repository path' : 'Public GitHub repository URL'}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="btn btn--primary"
              onClick={() => void handleCheckRepo()}
              disabled={repoLoading || !repoPath.trim()}
            >
              {repoLoading ? <><Spinner />Preparing…</> : sourceType === 'github' ? 'Prepare repository' : 'Check Repository'}
            </button>
            {sourceType === 'github' && repoStatus && (
              <button className="btn" onClick={() => void handleCheckRepo(true)} disabled={repoLoading}>Refresh</button>
            )}
          </div>

          {repoError && (
            <div className="inline-error" role="alert">
              <ErrorIcon /> {repoError}
            </div>
          )}

          {repoStatus && (
            <RepoStatusDisplay status={repoStatus} resolvedPath={resolvedPath} />
          )}
          {repoStatus && <FileExplorer files={navigatorFiles} loading={navigatorLoading} error={navigatorError} onOpen={(filePath) => setActiveSource({ filePath, startLine: 1, endLine: 1, text: '', score: 0 })} />}
          {repoStatus && <SymbolExplorer symbols={symbols} loading={symbolsLoading} error={symbolsError} truncated={symbolsTruncated} onOpen={symbol => setActiveSource({ filePath: symbol.filePath, startLine: symbol.startLine, endLine: Math.min(symbol.endLine, symbol.startLine + 20), text: '', score: 0 })} onUsages={symbol => {
             const current = ++usageGeneration.current;
             setUsageSymbol(symbol);
             setUsagesLoading(true);
             setUsages([]);
             setUsagesError(null);
             setUsagesTruncated(false);
             setUsagesWarnings([]);
             void apiSymbolUsages(symbol, resolvedPath, repositoryId)
               .then(response => {
                 if (current !== usageGeneration.current) return;
                 if (!response.ok) {
                   setUsagesError(response.message ?? 'Possible usages could not be found.');
                   return;
                 }
                 setUsages(response.usages ?? []);
                 setUsagesTruncated(response.truncated === true);
                 setUsagesWarnings(response.scope?.warnings ?? []);
               })
               .catch(() => {
                 if (current === usageGeneration.current) setUsagesError('Unable to load possible usages.');
               })
               .finally(() => {
                 if (current === usageGeneration.current) setUsagesLoading(false);
               });
           }} />}
          {usageSymbol && <section className="usage-panel" aria-label="Possible usages">
             <strong>Possible usages of {usageSymbol.name}</strong>
             <p>AST name matches are not verified references.</p>
             {usagesLoading && <div className="explorer-state"><Spinner /> Finding possible usages…</div>}
             {!usagesLoading && usagesError && <div className="explorer-state" role="alert">{usagesError}</div>}
             {!usagesLoading && !usagesError && usages.length === 0 && <div className="explorer-state">No possible usages found.</div>}
             {!usagesLoading && !usagesError && usagesTruncated && <div className="explorer-state">Only the first 200 possible usages are shown.</div>}
             {!usagesLoading && !usagesError && usagesWarnings.map((warning, index) =>
               <div key={index} className="explorer-state" role="status">{warning}</div>)}
             {!usagesLoading && !usagesError && definitionMessage && <div className="explorer-state" role="status">{definitionMessage}</div>}
             {!usagesLoading && !usagesError && usages.map(u => <div className="symbol-row" key={`${u.filePath}:${u.line}:${u.column}`}>
               <button className="explorer-file" onClick={() => setActiveSource({ filePath: u.filePath, startLine: u.line, endLine: u.line, text: '', score: 0 })}>{u.filePath}:{u.line} {u.preview}</button>
               <button className="symbol-usages" disabled={definitionLoading === `${u.filePath}:${u.line}:${u.column}`} onClick={() => { const id = `${u.filePath}:${u.line}:${u.column}`; const current = ++definitionGeneration.current; setDefinitionLoading(id); setDefinitionMessage(null); void apiSymbolDefinition(u.filePath, u.line, u.column, resolvedPath, repositoryId).then(response => { if (current !== definitionGeneration.current) return; if (response.ok && response.outcome === 'resolved' && response.definition) setActiveSource({ filePath: response.definition.filePath, startLine: response.definition.startLine, endLine: response.definition.endLine, text: '', score: 0 }); else setDefinitionMessage(response.message ?? `Definition ${response.outcome ?? 'could not be resolved'}.`); }).catch(() => { if (current === definitionGeneration.current) setDefinitionMessage('Definition lookup failed.'); }).finally(() => { if (current === definitionGeneration.current) setDefinitionLoading(null); }); }}>{definitionLoading === `${u.filePath}:${u.line}:${u.column}` ? 'Resolving…' : 'Go to definition'}</button>
             </div>)}
           </section>}
        </section>

        {/* ── Step 2: Search ── */}
        <section className={`section${!canSearch ? ' section--locked' : ''}`} aria-disabled={!canSearch}>
          <div className="section-label">
            <StepBadge n={2} done={hasResults} />
            <span>Search</span>
            {!canSearch && <span className="section-hint">— check a repository first</span>}
          </div>

          <div className="field-row">
            <input
              ref={queryInputRef}
              className="field-input"
              type="text"
              placeholder={
                canSearch
                  ? searchMode === 'semantic' ? 'Describe what you\'re looking for in natural language…' : 'Find a literal identifier, string, TODO, or error message…'
                  : 'Select a valid repository above to enable search'
              }
              value={query}
              onChange={(e) => {
                // A response to the previous query must never be rendered as
                // evidence for the text currently visible in the search field.
                searchGeneration.current += 1;
                setSearchLoading(false);
                setSearchResult(null); setExactResult(null);
                setSearchError(null);
                setActiveSource(null);
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
              disabled={!canSearch}
              aria-label="Search query"
              spellCheck={false}
            />
            <button
              className="btn btn--primary"
              onClick={() => void handleSearch()}
              disabled={!canSearch || searchLoading || !query.trim()}
            >
              {searchLoading ? <><Spinner />Searching…</> : 'Search'}
            </button>
          </div>

          {searchLoading && (
            <div className="loading-notice" role="status" aria-live="polite">
              <Spinner />
              <div>
                <div>{searchMode === 'semantic' ? 'Running local inference…' : 'Scanning source text locally…'}</div>
                <div className="loading-sub">
                  {searchMode === 'semantic' ? 'First run downloads the embedding model (~23 MB). Subsequent runs use the cache.' : 'Exact text search does not load the embedding model.'}
                </div>
              </div>
            </div>
          )}

          {searchError && (
            <div className="inline-error" role="alert">
              <ErrorIcon /> {searchError}
            </div>
          )}

          {searchResult?.ok && <SearchMeta result={searchResult} />}
          {exactResult?.ok && <SearchMeta result={exactResult} />}

          {exactResult?.ok && <div className="search-meta"><span>Found <strong>{exactResult.matches?.length ?? 0}</strong> matching line{(exactResult.matches?.length ?? 0) !== 1 ? 's' : ''} in <strong>{exactResult.filesWithMatches ?? 0}</strong> file{(exactResult.filesWithMatches ?? 0) !== 1 ? 's' : ''}</span>{exactResult.truncated && <span className="meta-warn"><WarningIcon /> Results truncated</span>}</div>}

          {searchResult?.ok && (searchResult.outcome === 'no-supported-candidate' || searchResult.outcome === 'no-relevant-results') && (
            <div className="empty-state">
              <div className="empty-state-title">No relevant code found</div>
              <div className="empty-state-body">
                We couldn’t identify a code region strongly related to your query. Rephrase it, describe a function or behavior, or try a programming-related keyword. This does not establish that the behavior is absent.
              </div>
            </div>
          )}
          {exactResult?.ok && (exactResult.matches?.length ?? 0) === 0 && <div className="empty-state"><div className="empty-state-title">No exact text matches</div><div className="empty-state-body">Try a shorter literal string or turn off case-sensitive and whole-word matching.</div></div>}

          {hasResults && (
            <div className="results">
              {searchMode === 'semantic' && searchResult!.candidates!.map((candidate, i) => (
                <ResultCard
                  key={`${candidate.filePath}:${candidate.startLine}`}
                  candidate={candidate}
                  index={i}
                  onViewSource={setActiveSource}
                  githubUrl={githubSource?.url}
                  revision={githubSource?.revision}
                />
              ))}
              {searchMode === 'exact' && <ExactResults matches={exactResult!.matches!} onViewSource={setActiveSource} githubUrl={githubSource?.url} revision={githubSource?.revision} />}
              {searchMode === 'semantic' && <p className="results-disclaimer">
                Results are unverified semantic candidates. Similarity scores are ranking signals — not confidence or probability estimates.
              </p>}
            </div>
          )}
        </section>

      </main>

      {/* ── Source viewer overlay ── */}
      {activeSource && (
        <SourceViewer
          repositoryPath={resolvedPath}
          repositoryId={repositoryId}
          candidate={activeSource}
          onClose={() => setActiveSource(null)}
        />
      )}
    </div>
  );
}

// ── Small icon components (inline SVG, no deps) ───────────────────────────────

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`step-badge${done ? ' step-badge--done' : ''}`} aria-hidden="true">
      {done ? '✓' : n}
    </span>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function FileIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3 11V2h8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="icon icon--warn" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2L14 13H2L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="icon icon--info" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="icon icon--error" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
