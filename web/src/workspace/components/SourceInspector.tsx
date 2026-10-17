import React, { useState, useEffect, useRef } from 'react';
import {
  apiSource,
  type SearchCandidate,
  type SourceResponse,
} from '../../api';
import { Copy, Check, X, FileCode, ExternalLink } from 'lucide-react';
import { Spinner } from '../../components/ui/Primitives';

interface SourceInspectorProps {
  repositoryPath: string;
  repositoryId?: string;
  candidate: SearchCandidate | null;
  onClose: () => void;
  githubUrl?: string;
  revision?: string;
}

export function SourceInspector({
  repositoryPath,
  repositoryId,
  candidate,
  onClose,
  githubUrl,
  revision,
}: SourceInspectorProps) {
  const [sourceData, setSourceData] = useState<SourceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    if (!candidate) {
      setSourceData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSourceData(null);

    apiSource(
      repositoryPath,
      candidate.filePath,
      candidate.startLine,
      candidate.endLine,
      30,
      repositoryId
    )
      .then((res) => {
        if (cancelled) return;
        setSourceData(res);
        if (!res.ok) setError(res.message ?? 'Source reading failed');
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error reading source');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repositoryPath, repositoryId, candidate]);

  useEffect(() => {
    if (sourceData?.ok && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [sourceData]);

  if (!candidate) return null;

  const locationText = `${candidate.filePath}:${candidate.startLine}-${candidate.endLine}`;

  const copyLocation = () => {
    void navigator.clipboard.writeText(locationText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <aside
      className="workspace-inspector workspace-evidence-inspector animate-wf-rise"
      aria-label="Source viewer"
      role="complementary"
    >
      <div className="inspector-header">
        <div className="inspector-file-info">
          <FileCode size={18} className="inspector-icon" />
          <div className="inspector-titles">
            <span className="inspector-filename" title={candidate.filePath}>
              {candidate.filePath.split('/').pop()}
            </span>
            <span className="inspector-subpath">{candidate.filePath}</span>
          </div>
        </div>

        <div className="inspector-actions">
          <button
            type="button"
            className="inspector-action-btn"
            onClick={copyLocation}
            title="Copy path and line numbers"
          >
            {copied ? <Check size={14} color="#22C55E" /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {githubUrl && revision && (
            <a
              href={`${githubUrl}/blob/${revision}/${candidate.filePath.split('/').map(encodeURIComponent).join('/')}#L${candidate.startLine}-L${candidate.endLine}`}
              target="_blank"
              rel="noreferrer"
              className="inspector-action-btn"
              title="Open file on GitHub"
            >
              <ExternalLink size={14} />
              <span>GitHub</span>
            </a>
          )}

          <button
            type="button"
            className="inspector-close-btn"
            onClick={onClose}
            title="Close Inspector (Esc)"
            aria-label="Close source viewer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="inspector-meta-bar">
        <span className="inspector-lines-tag">
          Lines {candidate.startLine}–{candidate.endLine}
        </span>
        {candidate.score > 0 && (
          <span className="inspector-score-pill">
            Similarity {(candidate.score).toFixed(3)}
          </span>
        )}
      </div>

      <div className="inspector-body">
        {loading && (
          <div className="inspector-state">
            <Spinner size={18} />
            <span>Loading source evidence…</span>
          </div>
        )}

        {error && (
          <div className="inspector-error-box" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && sourceData?.ok && sourceData.lines && (
          <div className="inspector-code-canvas">
            <pre className="inspector-code-pre">
              {sourceData.lines.map((line, idx) => {
                const lineNum = (sourceData.startLine ?? candidate.startLine) + idx;
                const isHighlighted = lineNum >= candidate.startLine && lineNum <= candidate.endLine;

                return (
                  <div
                    key={lineNum}
                    ref={isHighlighted && lineNum === candidate.startLine ? highlightRef : undefined}
                    className={`inspector-line ${isHighlighted ? 'inspector-line--highlight sv-line--hl' : ''}`}
                  >
                    <span className="inspector-ln">{lineNum}</span>
                    <span className="inspector-code-text">{line}</span>
                  </div>
                );
              })}
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}
