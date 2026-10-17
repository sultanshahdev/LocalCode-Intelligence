import React, { useState, useCallback, useEffect, useRef } from 'react';
import './workspace-redesign.css';
import {
  apiPrepareRepository,
  apiSearch,
  apiExactSearch,
  apiRepositoryFiles,
  apiRepositoryMap,
  apiSymbols,
  apiSymbolUsages,
  apiSymbolDefinition,
  type RepoStatus,
  type SearchResponse,
  type ExactSearchResponse,
  type SearchCandidate,
  type SourceSymbol,
  type SymbolUsage,
  type RepositoryMapNode,
} from '../api';
import { WorkspaceHeader, type WorkspaceTab } from './components/WorkspaceHeader';
import { OverviewView } from './views/OverviewView';
import { SearchView } from './views/SearchView';
import { SymbolExplorerView } from './views/SymbolExplorerView';
import { RepositoryMap } from './views/RepositoryMapView';
import { FileExplorerView } from './views/FileExplorerView';
import { SourceInspector } from './components/SourceInspector';

interface WorkspacePageProps {
  onReturnToLanding: () => void;
}

export function WorkspacePage({ onReturnToLanding }: WorkspacePageProps) {
  // Navigation
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');

  // Repository State
  const [repoPath, setRepoPath] = useState('');
  const [sourceType, setSourceType] = useState<'local' | 'github'>('github');
  const [repositoryId, setRepositoryId] = useState<string | undefined>();
  const [githubSource, setGithubSource] = useState<{ url: string; revision: string } | null>(null);
  const repositoryGeneration = useRef(0);
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [resolvedPath, setResolvedPath] = useState('');

  // Search State
  const searchGeneration = useRef(0);
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'semantic' | 'exact'>('semantic');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [semanticResult, setSemanticResult] = useState<SearchResponse | null>(null);
  const [exactResult, setExactResult] = useState<ExactSearchResponse | null>(null);

  // Inspector State
  const [activeCandidate, setActiveCandidate] = useState<SearchCandidate | null>(null);

  // Navigable Files
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // 2D Map State
  const [mapNodes, setMapNodes] = useState<RepositoryMapNode[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Symbols & Usages State
  const usageGeneration = useRef(0);
  const definitionGeneration = useRef(0);
  const [symbols, setSymbols] = useState<SourceSymbol[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);
  const [symbolsTruncated, setSymbolsTruncated] = useState(false);
  const [usageSymbol, setUsageSymbol] = useState<SourceSymbol | null>(null);
  const [usages, setUsages] = useState<SymbolUsage[]>([]);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [usagesError, setUsagesError] = useState<string | null>(null);
  const [usagesTruncated, setUsagesTruncated] = useState(false);
  const [usagesWarnings, setUsagesWarnings] = useState<string[]>([]);
  const [definitionLoading, setDefinitionLoading] = useState<string | null>(null);
  const [definitionMessage, setDefinitionMessage] = useState<string | null>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (editing || !repoStatus) return;
      if (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault();
        document.getElementById('cb-investigation-query')?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [repoStatus]);

  // Invalidate when switching repo
  const invalidateRepository = () => {
    repositoryGeneration.current += 1;
    searchGeneration.current += 1;
    usageGeneration.current += 1;
    definitionGeneration.current += 1;
    setDefinitionLoading(null);
    setDefinitionMessage(null);
    setUsageSymbol(null);
    setUsages([]);
    setUsagesLoading(false);
    setUsagesError(null);
    setUsagesTruncated(false);
    setUsagesWarnings([]);
    setRepoLoading(false);
    setSearchLoading(false);
    setRepositoryId(undefined);
    setRepoStatus(null);
    setActiveTab('overview');
    setResolvedPath('');
    setGithubSource(null);
    setSemanticResult(null);
    setExactResult(null);
    setSearchError(null);
    setRepoError(null);
    setActiveCandidate(null);
    setFiles([]);
    setFilesError(null);
    setFilesLoading(false);
    setMapNodes([]);
    setMapError(null);
    setMapLoading(false);
    setSymbols([]);
    setSymbolsError(null);
    setSymbolsLoading(false);
    setSymbolsTruncated(false);
  };

  const handlePrepareRepo = useCallback(
    async (refresh = false) => {
      const path = repoPath.trim();
      if (!path) return;
      const current = ++repositoryGeneration.current;
      usageGeneration.current += 1;
      definitionGeneration.current += 1;
      setDefinitionLoading(null);
      setDefinitionMessage(null);
      setUsageSymbol(null);
      setUsages([]);
      setUsagesLoading(false);
      setUsagesError(null);
      setUsagesTruncated(false);
      setUsagesWarnings([]);
      setRepoLoading(true);
      setRepoError(null);

      if (!refresh) {
        setActiveTab('overview');
        searchGeneration.current += 1;
        setSearchLoading(false);
        setRepoStatus(null);
        setResolvedPath('');
        setSemanticResult(null);
        setExactResult(null);
        setActiveCandidate(null);
        setFiles([]);
        setFilesError(null);
        setMapNodes([]);
        setMapError(null);
        setSymbols([]);
        setSymbolsError(null);
        setSymbolsTruncated(false);
      }

      try {
        const result = await apiPrepareRepository(sourceType, path, refresh);
        if (current !== repositoryGeneration.current) return;
        if (result.ok && result.status) {
          if (refresh) {
            searchGeneration.current += 1;
            setSearchLoading(false);
            setSemanticResult(null);
            setExactResult(null);
            setActiveCandidate(null);
          }
          setRepoStatus(result.status);
          setActiveTab('search');
          const targetPath = result.source?.label ?? result.resolvedPath ?? path;
          setResolvedPath(targetPath);
          setRepositoryId(result.repositoryId);
          setGithubSource(
            result.source?.githubUrl && result.source.revision
              ? { url: result.source.githubUrl, revision: result.source.revision }
              : null
          );

          // Auto-load files
          setFilesLoading(true);
          setFilesError(null);
          void apiRepositoryFiles(targetPath, result.repositoryId)
            .then((listing) => {
              if (current !== repositoryGeneration.current) return;
              if (listing.ok) setFiles(listing.files ?? []);
              else setFilesError(listing.message ?? 'Files are unavailable.');
            })
            .catch(() => {
              if (current === repositoryGeneration.current) setFilesError('Files are unavailable.');
            })
            .finally(() => {
              if (current === repositoryGeneration.current) setFilesLoading(false);
            });

          // Auto-load 2D map
          setMapLoading(true);
          setMapError(null);
          void apiRepositoryMap(targetPath, result.repositoryId)
            .then((m) => {
              if (current !== repositoryGeneration.current) return;
              if (m.ok) setMapNodes(m.nodes ?? []);
              else setMapError(m.message ?? 'Repository map is unavailable.');
            })
            .catch(() => {
              if (current === repositoryGeneration.current) setMapError('Repository map is unavailable.');
            })
            .finally(() => {
              if (current === repositoryGeneration.current) setMapLoading(false);
            });

          // Auto-load symbols
          setSymbolsLoading(true);
          setSymbolsError(null);
          void apiSymbols(targetPath, result.repositoryId)
            .then((resp) => {
              if (current !== repositoryGeneration.current) return;
              if (resp.ok) {
                setSymbols(resp.symbols ?? []);
                setSymbolsTruncated(resp.truncated === true);
              } else {
                setSymbolsError(resp.message ?? 'Symbols are unavailable.');
              }
            })
            .catch(() => {
              if (current === repositoryGeneration.current) setSymbolsError('Symbols are unavailable.');
            })
            .finally(() => {
              if (current === repositoryGeneration.current) setSymbolsLoading(false);
            });
        } else {
          setRepoError(result.message ?? 'Repository check failed');
        }
      } catch (e) {
        if (current === repositoryGeneration.current) {
          setRepoError(e instanceof Error ? e.message : 'Network error — is server running?');
        }
      } finally {
        if (current === repositoryGeneration.current) setRepoLoading(false);
      }
    },
    [repoPath, sourceType]
  );

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || !resolvedPath) return;
    const current = ++searchGeneration.current;
    setSearchLoading(true);
    setSearchError(null);
    setSemanticResult(null);
    setExactResult(null);
    setActiveCandidate(null);

    const effectiveMode = activeTab === 'exact' ? 'exact' : searchMode;
    try {
      const result =
        effectiveMode === 'semantic'
          ? await apiSearch(q, resolvedPath, repositoryId)
          : await apiExactSearch(q, resolvedPath, { caseSensitive, wholeWord }, repositoryId);

      if (current !== searchGeneration.current) return;
      if (effectiveMode === 'semantic') setSemanticResult(result as SearchResponse);
      else setExactResult(result as ExactSearchResponse);

      if (!result.ok) setSearchError(result.message ?? 'Search failed');
    } catch (e) {
      if (current === searchGeneration.current) {
        setSearchError(e instanceof Error ? e.message : 'Search error');
      }
    } finally {
      if (current === searchGeneration.current) setSearchLoading(false);
    }
  }, [query, resolvedPath, repositoryId, searchMode, activeTab, caseSensitive, wholeWord]);

  // Usages Finder
  const handleFindUsages = (sym: SourceSymbol) => {
    const current = ++usageGeneration.current;
    definitionGeneration.current += 1;
    setDefinitionLoading(null);
    setDefinitionMessage(null);
    setUsageSymbol(sym);
    setUsagesLoading(true);
    setUsages([]);
    setUsagesError(null);
    setUsagesTruncated(false);
    setUsagesWarnings([]);

    void apiSymbolUsages(sym, resolvedPath, repositoryId)
      .then((res) => {
        if (current !== usageGeneration.current) return;
        if (!res.ok) {
          setUsagesError(res.message ?? 'Possible usages could not be retrieved.');
          return;
        }
        setUsages(res.usages ?? []);
        setUsagesTruncated(res.truncated === true);
        setUsagesWarnings(res.scope?.warnings ?? []);
      })
      .catch(() => {
        if (current === usageGeneration.current) setUsagesError('Unable to load possible usages.');
      })
      .finally(() => {
        if (current === usageGeneration.current) setUsagesLoading(false);
      });
  };

  // Definition Resolution
  const handleResolveDefinition = (u: SymbolUsage) => {
    const key = `${u.filePath}:${u.line}:${u.column}`;
    const current = ++definitionGeneration.current;
    setDefinitionLoading(key);
    setDefinitionMessage(null);

    void apiSymbolDefinition(u.filePath, u.line, u.column, resolvedPath, repositoryId)
      .then((res) => {
        if (current !== definitionGeneration.current) return;
        if (res.ok && res.outcome === 'resolved' && res.definition) {
          setActiveCandidate({
            filePath: res.definition.filePath,
            startLine: res.definition.startLine,
            endLine: Math.min(res.definition.endLine, res.definition.startLine + 25),
            text: '',
            score: 0,
          });
        } else {
          setDefinitionMessage(
            res.message ?? `Definition ${res.outcome ?? 'could not be resolved'}.`
          );
        }
      })
      .catch(() => {
        if (current === definitionGeneration.current) setDefinitionMessage('Definition lookup failed.');
      })
      .finally(() => {
        if (current === definitionGeneration.current) setDefinitionLoading(null);
      });
  };

  return (
    <div className="workspace-app-layout cb-workspace">
      {/* Workspace App Shell Header & Navigation */}
      <WorkspaceHeader
        repoPath={repoPath}
        onSetRepoPath={(p) => {
          invalidateRepository();
          setRepoPath(p);
        }}
        sourceType={sourceType}
        onChangeSourceType={(t) => {
          invalidateRepository();
          setSourceType(t);
        }}
        onPrepareRepo={handlePrepareRepo}
        repoLoading={repoLoading}
        repoError={repoError}
        repoStatus={repoStatus}
        resolvedPath={resolvedPath}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onReturnToLanding={onReturnToLanding}
      />

      {/* Main Workspace Body */}
      <main className={`workspace-main-area cb-workspace-main ${activeCandidate ? 'cb-workspace-main--inspecting' : ''}`}>
        <div className="workspace-content-pane">
          {activeTab === 'overview' && (
            <OverviewView
              repoStatus={repoStatus}
              loading={repoLoading}
              repositoryName={repoPath}
              resolvedPath={resolvedPath}
              filesCount={files.length}
              symbolsCount={symbols.length}
              mapNodesCount={mapNodes.length}
              onNavigateTab={(tab) => {
                if (tab === 'search') {
                  setSearchMode('semantic');
                  setActiveTab('search');
                } else if (tab === 'exact') {
                  setSearchMode('exact');
                  setActiveTab('search');
                } else {
                  setActiveTab(tab);
                }
              }}
            />
          )}

          {(activeTab === 'search' || activeTab === 'exact') && (
            <SearchView
              searchMode={activeTab === 'exact' ? 'exact' : searchMode}
              onSetSearchMode={(m) => {
                searchGeneration.current += 1;
                setSearchLoading(false);
                setSemanticResult(null);
                setExactResult(null);
                setSearchError(null);
                setSearchMode(m);
                setActiveTab('search');
              }}
              caseSensitive={caseSensitive}
              onSetCaseSensitive={(v) => {
                searchGeneration.current += 1;
                setSearchLoading(false);
                setExactResult(null);
                setCaseSensitive(v);
              }}
              wholeWord={wholeWord}
              onSetWholeWord={(v) => {
                searchGeneration.current += 1;
                setSearchLoading(false);
                setExactResult(null);
                setWholeWord(v);
              }}
              query={query}
              onSetQuery={(q) => {
                searchGeneration.current += 1;
                setSearchLoading(false);
                setSemanticResult(null);
                setExactResult(null);
                setSearchError(null);
                setActiveCandidate(null);
                setQuery(q);
              }}
              onSearch={handleSearch}
              loading={searchLoading}
              error={searchError}
              semanticResult={semanticResult}
              exactResult={exactResult}
              onViewSource={setActiveCandidate}
              activeCandidate={activeCandidate}
              githubUrl={githubSource?.url}
              revision={githubSource?.revision}
            />
          )}

          {activeTab === 'symbols' && (
            <SymbolExplorerView
              symbols={symbols}
              loading={symbolsLoading}
              error={symbolsError}
              truncated={symbolsTruncated}
              onOpen={(sym) =>
                setActiveCandidate({
                  filePath: sym.filePath,
                  startLine: sym.startLine,
                  endLine: Math.min(sym.endLine, sym.startLine + 25),
                  text: '',
                  score: 0,
                })
              }
              onUsages={handleFindUsages}
              usageSymbol={usageSymbol}
              usages={usages}
              usagesLoading={usagesLoading}
              usagesError={usagesError}
              usagesTruncated={usagesTruncated}
              usagesWarnings={usagesWarnings}
              definitionLoading={definitionLoading}
              definitionMessage={definitionMessage}
              onDefinition={handleResolveDefinition}
              onOpenUsage={(u) =>
                setActiveCandidate({
                  filePath: u.filePath,
                  startLine: u.line,
                  endLine: u.line,
                  text: '',
                  score: 0,
                })
              }
            />
          )}

          {activeTab === 'map' && (
            <RepositoryMap
              nodes={mapNodes}
              loading={mapLoading}
              error={mapError}
              onOpen={(filePath: string) =>
                setActiveCandidate({
                  filePath,
                  startLine: 1,
                  endLine: 35,
                  text: '',
                  score: 0,
                })
              }
            />
          )}

          {activeTab === 'files' && (
            <FileExplorerView
              files={files}
              loading={filesLoading}
              error={filesError}
              onOpen={(filePath) =>
                setActiveCandidate({
                  filePath,
                  startLine: 1,
                  endLine: 35,
                  text: '',
                  score: 0,
                })
              }
              onOpenSymbols={() => setActiveTab('symbols')}
            />
          )}
        </div>

        {/* Right Source Inspector Drawer */}
        {activeCandidate && (
          <SourceInspector
            repositoryPath={resolvedPath}
            repositoryId={repositoryId}
            candidate={activeCandidate}
            onClose={() => setActiveCandidate(null)}
            githubUrl={githubSource?.url}
            revision={githubSource?.revision}
          />
        )}
      </main>
    </div>
  );
}
