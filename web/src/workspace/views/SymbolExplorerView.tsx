import React, { useState } from 'react';
import { type SourceSymbol, type SymbolUsage } from '../../api';
import { Code2, Search, ArrowRight, CornerDownRight } from 'lucide-react';
import { Spinner } from '../../components/ui/Primitives';

interface SymbolExplorerViewProps {
  symbols: SourceSymbol[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  onOpen: (symbol: SourceSymbol) => void;
  onUsages: (symbol: SourceSymbol) => void;
  usageSymbol: SourceSymbol | null;
  usages: SymbolUsage[];
  usagesLoading: boolean;
  usagesError: string | null;
  usagesTruncated: boolean;
  usagesWarnings: string[];
  definitionLoading: string | null;
  definitionMessage: string | null;
  onDefinition: (usage: SymbolUsage) => void;
  onOpenUsage: (usage: SymbolUsage) => void;
}

export function SymbolExplorerView({
  symbols,
  loading,
  error,
  truncated,
  onOpen,
  onUsages,
  usageSymbol,
  usages,
  usagesLoading,
  usagesError,
  usagesTruncated,
  usagesWarnings,
  definitionLoading,
  definitionMessage,
  onDefinition,
  onOpenUsage,
}: SymbolExplorerViewProps) {
  const [filter, setFilter] = useState('');

  const visible = symbols.filter((s) =>
    `${s.name} ${s.filePath} ${s.kind} ${s.containerName ?? ''}`.toLowerCase().includes(filter.toLowerCase())
  );

  const byFile = new Map<string, SourceSymbol[]>();
  visible.forEach((s) => {
    byFile.set(s.filePath, [...(byFile.get(s.filePath) ?? []), s]);
  });

  return (
    <div className="workspace-symbols-layout">
      {/* Declarations Pane */}
      <div className="symbols-declarations-pane">
        <div className="symbols-toolbar">
          <div className="symbols-toolbar-title">
            <Code2 size={16} />
            <span>Declarations</span>
            <span className="symbols-count-badge">{symbols.length}</span>
          </div>
          <div className="symbols-search-wrap">
            <Search size={14} className="symbols-search-icon" />
            <input
              type="text"
              placeholder="Filter symbols by name, kind, or file…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="symbols-filter-input"
              aria-label="Filter symbols"
            />
          </div>
        </div>

        {truncated && (
          <div className="symbols-notice">
            Declarations result is truncated by repository budget limits.
          </div>
        )}

        <div className="symbols-list-body">
          {loading && (
            <div className="symbols-state">
              <Spinner size={18} />
              <span>Extracting declarations via AST parsers…</span>
            </div>
          )}

          {error && (
            <div className="symbols-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <div className="symbols-state">No matching declarations found.</div>
          )}

          {!loading &&
            !error &&
            [...byFile.entries()].map(([file, entries]) => (
              <div key={file} className="symbols-file-group">
                <div className="symbols-file-header">{file}</div>
                <div className="symbols-rows">
                  {entries.map((s) => {
                    const isSelected = usageSymbol?.name === s.name && usageSymbol.filePath === s.filePath;
                    return (
                      <div
                        key={`${s.name}:${s.startLine}:${s.kind}`}
                        className={`symbol-row ${isSelected ? 'symbol-row--selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="symbol-name-btn"
                          onClick={() => onOpen(s)}
                          title={`Inspect ${s.name} at line ${s.startLine}`}
                        >
                          <span className={`symbol-kind-tag symbol-kind--${s.kind}`}>{s.kind}</span>
                          <span className="symbol-ident">
                            {s.containerName ? `${s.containerName}.` : ''}
                            {s.name}
                          </span>
                          <span className="symbol-line-num">:{s.startLine}</span>
                        </button>
                        <button
                          type="button"
                          className="symbol-find-usages-btn"
                          onClick={() => onUsages(s)}
                          title="Find AST identifier matches"
                        >
                          Usages
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Usages Panel */}
      <div className="symbols-usages-pane">
        <div className="usages-header">
          <div className="usages-title-row">
            <CornerDownRight size={16} />
            <span>Possible Usages</span>
            {usageSymbol && <span className="usage-symbol-name">{usageSymbol.name}</span>}
          </div>
          <span className="usages-sub-note">
            AST identifier matches — not guaranteed type-resolved references.
          </span>
        </div>

        <div className="usages-body">
          {!usageSymbol && (
            <div className="usages-placeholder">
              Select "Usages" next to any declaration on the left to inspect AST identifier occurrences.
            </div>
          )}

          {usageSymbol && (
            <>
              {usagesLoading && (
                <div className="usages-state">
                  <Spinner size={18} />
                  <span>Searching AST identifier usages across files…</span>
                </div>
              )}

              {usagesError && (
                <div className="usages-error" role="alert">
                  <span>{usagesError}</span>
                </div>
              )}

              {!usagesLoading && !usagesError && usages.length === 0 && (
                <div className="usages-state">No identifier usages found for this declaration.</div>
              )}

              {usagesTruncated && (
                <div className="usages-notice">
                  Showing first 200 possible usages.
                </div>
              )}

              {usagesWarnings.map((w, idx) => (
                <div key={idx} className="usages-notice">
                  {w}
                </div>
              ))}

              {definitionMessage && (
                <div className="usages-notice usages-notice--info">
                  {definitionMessage}
                </div>
              )}

              {!usagesLoading &&
                !usagesError &&
                usages.map((u) => {
                  const key = `${u.filePath}:${u.line}:${u.column}`;
                  const isResolving = definitionLoading === key;

                  return (
                    <div key={key} className="usage-item-card">
                      <div className="usage-item-top">
                        <button
                          type="button"
                          className="usage-file-btn"
                          onClick={() => onOpenUsage(u)}
                          title={`Inspect ${u.filePath} line ${u.line}`}
                        >
                          <span className="usage-path">{u.filePath}</span>
                          <span className="usage-line">:{u.line}</span>
                        </button>

                        <button
                          type="button"
                          className="usage-def-btn"
                          disabled={isResolving}
                          onClick={() => onDefinition(u)}
                          title="Attempt to navigate to definition"
                        >
                          {isResolving ? 'Resolving…' : 'Go to definition'}
                          <ArrowRight size={12} />
                        </button>
                      </div>

                      <pre className="usage-preview-code">{u.preview}</pre>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
