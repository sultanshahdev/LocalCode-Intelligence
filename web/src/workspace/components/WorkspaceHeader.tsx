import React, { useState } from 'react';
import {
  FolderGit2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Code2,
  Network,
  Folder,
  SlidersHorizontal,
  Home,
  ArrowLeft,
} from 'lucide-react';
import { LocalCodeLogo, Button, Spinner } from '../../components/ui/Primitives';
import { type RepoStatus } from '../../api';

export type WorkspaceTab = 'overview' | 'search' | 'exact' | 'symbols' | 'map' | 'files';

interface WorkspaceHeaderProps {
  repoPath: string;
  onSetRepoPath: (val: string) => void;
  sourceType: 'local' | 'github';
  onChangeSourceType: (type: 'local' | 'github') => void;
  onPrepareRepo: (refresh?: boolean) => void;
  repoLoading: boolean;
  repoError: string | null;
  repoStatus: RepoStatus | null;
  resolvedPath: string;
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onReturnToLanding: () => void;
}

export function WorkspaceHeader({
  repoPath,
  onSetRepoPath,
  sourceType,
  onChangeSourceType,
  onPrepareRepo,
  repoLoading,
  repoError,
  repoStatus,
  resolvedPath,
  activeTab,
  onSelectTab,
  onReturnToLanding,
}: WorkspaceHeaderProps) {
  const [prepExpanded, setPrepExpanded] = useState(!repoStatus);

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <Home size={15} /> },
    { id: 'search', label: 'Semantic Search', icon: <Search size={15} /> },
    { id: 'exact', label: 'Exact Text', icon: <SlidersHorizontal size={15} /> },
    { id: 'symbols', label: 'Symbols', icon: <Code2 size={15} /> },
    { id: 'map', label: 'Repository Map', icon: <Network size={15} /> },
    { id: 'files', label: 'Files', icon: <Folder size={15} /> },
  ];

  return (
    <header className="workspace-header-root">
      {/* Top Application Bar */}
      <div className="workspace-top-bar">
        <div className="workspace-brand-group">
          <button
            type="button"
            className="workspace-back-btn"
            onClick={onReturnToLanding}
            title="Return to Product Landing Page"
          >
            <ArrowLeft size={16} />
            <span>Product Page</span>
          </button>

          <div className="workspace-brand">
            <LocalCodeLogo size={24} />
            <span className="workspace-brand-title">LocalCode</span>
            <span className="workspace-brand-env">Workspace</span>
          </div>
        </div>

        {/* Repository status badge in top bar */}
        <div className="workspace-repo-pill-container">
          {resolvedPath ? (
            <div
              className="workspace-active-repo-badge"
              onClick={() => setPrepExpanded(!prepExpanded)}
              title="Click to change or refresh repository"
            >
              <FolderGit2 size={14} color="#C59EFF" />
              <span className="repo-badge-name">{resolvedPath.split('/').pop() || resolvedPath}</span>
              {repoStatus?.eligible ? (
                <span className="repo-badge-status repo-badge-status--ready">Ready</span>
              ) : (
                <span className="repo-badge-status repo-badge-status--warn">Warning</span>
              )}
            </div>
          ) : (
            <div
              className="workspace-no-repo-badge"
              onClick={() => setPrepExpanded(true)}
            >
              <AlertCircle size={14} color="#F59E0B" />
              <span>No Repository Connected</span>
            </div>
          )}
        </div>

        <div className="workspace-top-actions">
          {resolvedPath && sourceType === 'github' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onPrepareRepo(true)}
              disabled={repoLoading}
              icon={repoLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
            >
              Refresh Repo
            </Button>
          )}
          <button
            type="button"
            className="workspace-toggle-prep-btn"
            onClick={() => setPrepExpanded(!prepExpanded)}
          >
            {prepExpanded ? 'Hide Repo Setup' : 'Switch Repo'}
          </button>
        </div>
      </div>

      {/* Expandable Repository Preparation Drawer */}
      {prepExpanded && (
        <div className="workspace-prep-drawer animate-wf-rise">
          <div className="prep-drawer-inner">
            <div className="prep-type-toggle" role="group" aria-label="Repository Source Type">
              <button
                type="button"
                className={`prep-type-btn ${sourceType === 'local' ? 'prep-type-btn--active' : ''}`}
                onClick={() => onChangeSourceType('local')}
              >
                Local Folder Path
              </button>
              <button
                type="button"
                className={`prep-type-btn ${sourceType === 'github' ? 'prep-type-btn--active' : ''}`}
                onClick={() => onChangeSourceType('github')}
              >
                Public GitHub URL
              </button>
            </div>

            <div className="prep-input-row">
              <input
                type="text"
                className="prep-input-field"
                placeholder={
                  sourceType === 'local'
                    ? 'e.g. /home/user/my-project or relative directory'
                    : 'https://github.com/owner/repository'
                }
                value={repoPath}
                onChange={(e) => onSetRepoPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPrepareRepo(false);
                }}
                spellCheck={false}
                aria-label="Repository Target"
              />

              <Button
                variant="primary"
                size="md"
                onClick={() => onPrepareRepo(false)}
                disabled={repoLoading || !repoPath.trim()}
                icon={repoLoading ? <Spinner size={14} /> : <FolderGit2 size={14} />}
              >
                {repoLoading
                  ? 'Preparing Source…'
                  : sourceType === 'github'
                  ? 'Prepare GitHub Repo'
                  : 'Check Repository'}
              </Button>
            </div>

            {repoError && (
              <div className="prep-error-banner" role="alert">
                <AlertCircle size={16} />
                <span>{repoError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Workspace Tabs Navigation */}
      <nav className="workspace-mode-nav" aria-label="Workspace Navigation">
        <div className="workspace-nav-tabs">
          {tabs.map((t) => {
            const isActive = activeTab === t.id;
            const isLocked = !repoStatus && t.id !== 'overview';

            return (
              <button
                key={t.id}
                type="button"
                className={`workspace-tab-btn ${isActive ? 'workspace-tab-btn--active' : ''} ${isLocked ? 'workspace-tab-btn--locked' : ''}`}
                onClick={() => !isLocked && onSelectTab(t.id)}
                disabled={isLocked}
                title={isLocked ? 'Connect a repository first' : t.label}
              >
                <span className="tab-icon">{t.icon}</span>
                <span className="tab-label">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
