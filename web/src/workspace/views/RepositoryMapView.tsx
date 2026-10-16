import React, { useState } from 'react';
import { type RepositoryMapNode } from '../../api';
import { Search, Folder, FolderOpen, FileCode, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Spinner } from '../../components/ui/Primitives';

interface RepositoryMapProps {
  nodes: RepositoryMapNode[];
  loading: boolean;
  error: string | null;
  onOpen: (filePath: string) => void;
}

export function RepositoryMap({ nodes, loading, error, onOpen }: RepositoryMapProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoomLevel, setZoomLevel] = useState(1);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visible = nodes
    .filter((node) => node.path === '.' || !filter || node.path.toLowerCase().includes(filter.toLowerCase()))
    .filter((node) => {
      for (
        let parent = node.parentId;
        parent && parent !== '.';
        parent = nodes.find((item) => item.id === parent)?.parentId ?? null
      ) {
        if (collapsed.has(parent)) return false;
      }
      return true;
    });

  return (
    <div className="workspace-map-view">
      <div className="map-view-toolbar">
        <div className="map-toolbar-title">
          <span className="map-title-text">2D Repository Map</span>
          <span className="map-node-count">{nodes.length} nodes</span>
        </div>

        <div className="map-toolbar-actions">
          <div className="map-search-box">
            <Search size={14} className="map-search-icon" />
            <input
              type="text"
              placeholder="Filter file or directory…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="map-filter-input"
              aria-label="Filter repository map"
            />
          </div>

          <div className="map-zoom-controls">
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={() => setZoomLevel((z) => Math.min(1.5, z + 0.1))}
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={() => setZoomLevel((z) => Math.max(0.7, z - 0.1))}
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              className="map-ctrl-btn"
              onClick={() => {
                setZoomLevel(1);
                setFilter('');
                setCollapsed(new Set());
              }}
              title="Reset View"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="map-view-canvas-wrap">
        {loading && (
          <div className="map-empty-state">
            <Spinner size={20} />
            <span>Building repository map hierarchy…</span>
          </div>
        )}

        {error && (
          <div className="map-error-state" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && (
          <div
            className="map-hierarchy-container"
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}
          >
            {visible
              .filter((n) => n.path !== '.')
              .map((node) => {
                const depth = Math.max(0, node.path.split('/').length - 1);
                const isDir = node.type === 'directory';
                const isCollapsed = collapsed.has(node.id);

                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`map-tree-row ${isDir ? 'map-tree-row--dir' : 'map-tree-row--file'}`}
                    style={{ paddingLeft: `${depth * 20 + 12}px` }}
                    onClick={() => (isDir ? toggleCollapse(node.id) : onOpen(node.path))}
                    title={node.path}
                  >
                    <span className="map-node-icon" aria-hidden="true">
                      {isDir ? (
                        isCollapsed ? <Folder size={15} color="#898590" /> : <FolderOpen size={15} color="#C59EFF" />
                      ) : (
                        <FileCode size={15} color="#9147FF" />
                      )}
                    </span>
                    <span className="map-node-name">{node.name}</span>
                    {node.language && <span className="map-node-lang">{node.language}</span>}
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
