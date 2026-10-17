import React, { useState } from 'react';
import { Folder, FileCode, Search, Code2 } from 'lucide-react';
import { Spinner } from '../../components/ui/Primitives';

interface FileExplorerViewProps {
  files: string[];
  loading: boolean;
  error: string | null;
  onOpen: (filePath: string) => void;
  onOpenSymbols?: () => void;
}

export function FileExplorerView({ files, loading, error, onOpen, onOpenSymbols }: FileExplorerViewProps) {
  const [filter, setFilter] = useState('');

  const visible = files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()));

  const groups = new Map<string, string[]>();
  visible.forEach((f) => {
    const slash = f.lastIndexOf('/');
    const dir = slash < 0 ? 'Root' : f.slice(0, slash);
    const existing = groups.get(dir) ?? [];
    existing.push(f);
    groups.set(dir, existing);
  });

  return (
    <div className="workspace-files-view">
      <div className="files-view-toolbar">
        <div className="files-toolbar-title">
          <Folder size={16} />
          <span>Repository Files</span>
          <span className="files-count-badge">{files.length}</span>
        </div>
        {onOpenSymbols && <button type="button" className="cb-explore-symbols" onClick={onOpenSymbols}><Code2 size={14}/>Symbols</button>}

        <div className="files-search-wrap">
          <Search size={14} className="files-search-icon" />
          <input
            type="text"
            placeholder="Filter files by path…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="files-filter-input"
            aria-label="Filter files"
          />
        </div>
      </div>

      <div className="files-list-body">
        {loading && (
          <div className="files-state">
            <Spinner size={18} />
            <span>Listing navigable source files…</span>
          </div>
        )}

        {error && (
          <div className="files-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="files-state">No matching files found.</div>
        )}

        {!loading &&
          !error &&
          [...groups.entries()].map(([dir, entries]) => (
            <div key={dir} className="files-dir-group">
              <div className="files-dir-header">
                <Folder size={14} color="#898590" />
                <span>{dir}</span>
                <span className="files-dir-count">{entries.length}</span>
              </div>
              <div className="files-grid">
                {entries.map((file) => (
                  <button
                    key={file}
                    type="button"
                    className="files-item-btn"
                    onClick={() => onOpen(file)}
                    title={file}
                    aria-label={file}
                  >
                    <FileCode size={14} color="#9147FF" />
                    <span className="files-item-name">{file.slice(file.lastIndexOf('/') + 1)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
