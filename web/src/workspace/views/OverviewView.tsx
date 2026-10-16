import React from 'react';
import { type RepoStatus } from '../../api';
import {
  FolderGit2,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  ArrowRight,
  ShieldCheck,
  Search,
  Code2,
  Network,
} from 'lucide-react';
import { Button } from '../../components/ui/Primitives';
import { BusterGhost } from '../../brand/BusterGhost';

interface OverviewViewProps {
  repoStatus: RepoStatus | null;
  resolvedPath: string;
  filesCount: number;
  symbolsCount: number;
  mapNodesCount: number;
  onNavigateTab: (tab: 'search' | 'exact' | 'symbols' | 'map' | 'files') => void;
}

export function OverviewView({
  repoStatus,
  resolvedPath,
  filesCount,
  symbolsCount,
  mapNodesCount,
  onNavigateTab,
}: OverviewViewProps) {
  if (!repoStatus) {
    return (
      <div className="overview-unprepared-state">
        <BusterGhost className="overview-buster" />
        <h3 className="overview-title">What are we investigating?</h3>
        <p className="overview-subtitle">
          Start with a public GitHub URL above, or open a local directory when Code Buster is running on your machine.
        </p>
        <p className="overview-subtitle overview-subtitle--quiet">Repository contents are read locally. Search results remain inspectable source evidence.</p>
      </div>
    );
  }

  return (
    <div className="workspace-overview-dashboard">
      <div className="overview-hero-card">
        <div className="overview-hero-top">
          <div className="overview-hero-title-group">
            <span className="overview-eyebrow">Active Repository</span>
            <h2 className="overview-repo-name" title={resolvedPath}>
              {resolvedPath.split('/').pop() || resolvedPath}
            </h2>
            <code className="overview-repo-path">{resolvedPath}</code>
          </div>

          <div className="overview-status-pill-wrap">
            <span
              className={`status-pill ${repoStatus.eligible ? 'status-pill--ready' : 'status-pill--warn'}`}
            >
              {repoStatus.eligible ? (
                <>
                  <CheckCircle2 size={13} /> Ready for Search
                </>
              ) : (
                <>
                  <AlertCircle size={13} /> Ineligible Source
                </>
              )}
            </span>
            <span className="status-pill status-pill--subtle">
              Coverage: {repoStatus.coverage}
            </span>
          </div>
        </div>

        {repoStatus.warnings.length > 0 && (
          <div className="overview-warnings-box">
            {repoStatus.warnings.map((w, idx) => (
              <div key={idx} className="overview-warning-row">
                <AlertCircle size={14} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="overview-metrics-grid">
        <div className="metric-card" onClick={() => onNavigateTab('files')}>
          <div className="metric-header">
            <FileCode2 size={18} className="metric-icon" />
            <span className="metric-label">Source Files</span>
          </div>
          <div className="metric-val">{repoStatus.filesProcessed}</div>
          <div className="metric-sub">
            {filesCount > 0 ? `${filesCount} navigable source files` : 'Files indexed'}
          </div>
        </div>

        <div className="metric-card" onClick={() => onNavigateTab('symbols')}>
          <div className="metric-header">
            <Code2 size={18} className="metric-icon" />
            <span className="metric-label">Symbols & Declarations</span>
          </div>
          <div className="metric-val">{symbolsCount}</div>
          <div className="metric-sub">Extracted across AST adapters</div>
        </div>

        <div className="metric-card" onClick={() => onNavigateTab('map')}>
          <div className="metric-header">
            <Network size={18} className="metric-icon" />
            <span className="metric-label">Map Nodes</span>
          </div>
          <div className="metric-val">{mapNodesCount}</div>
          <div className="metric-sub">Hierarchical tree elements</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <ShieldCheck size={18} className="metric-icon" />
            <span className="metric-label">Execution Environment</span>
          </div>
          <div className="metric-val metric-val--text">127.0.0.1</div>
          <div className="metric-sub">Zero cloud inference telemetry</div>
        </div>
      </div>

      {/* Quick Launch Cards */}
      <div className="overview-actions-grid">
        <div className="action-card" onClick={() => onNavigateTab('search')}>
          <div className="action-card-header">
            <Search size={20} color="#9147FF" />
            <h3 className="action-card-title">Run Semantic Search</h3>
          </div>
          <p className="action-card-desc">
            Ask behavioral questions in natural language to locate relevant code regions.
          </p>
          <div className="action-card-link">
            <span>Explore candidates</span>
            <ArrowRight size={14} />
          </div>
        </div>

        <div className="action-card" onClick={() => onNavigateTab('symbols')}>
          <div className="action-card-header">
            <Code2 size={20} color="#C59EFF" />
            <h3 className="action-card-title">Explore Symbols</h3>
          </div>
          <p className="action-card-desc">
            Filter functions, classes, and methods, and find AST identifier usage occurrences.
          </p>
          <div className="action-card-link">
            <span>Inspect declarations</span>
            <ArrowRight size={14} />
          </div>
        </div>

        <div className="action-card" onClick={() => onNavigateTab('map')}>
          <div className="action-card-header">
            <Network size={20} color="#9147FF" />
            <h3 className="action-card-title">2D Codebase Map</h3>
          </div>
          <p className="action-card-desc">
            Explore the directory hierarchy and see where files sit in the codebase.
          </p>
          <div className="action-card-link">
            <span>View map</span>
            <ArrowRight size={14} />
          </div>
        </div>
      </div>
    </div>
  );
}
