import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, ArrowRight, CheckCircle2, Search, FileCode2, Network, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/Primitives';

interface DemoStep {
  id: number;
  title: string;
  subtitle: string;
  durationMs: number;
}

const DEMO_STEPS: DemoStep[] = [
  { id: 1, title: 'Connect Repository', subtitle: 'Validating local source tree and detecting syntax adapters', durationMs: 4000 },
  { id: 2, title: 'Natural Language Query', subtitle: 'Describe behavior or logic rather than memorizing file paths', durationMs: 4500 },
  { id: 3, title: 'Ranked Source Evidence', subtitle: 'Local semantic vectors surface candidate source regions', durationMs: 4500 },
  { id: 4, title: 'Inspect Real Code', subtitle: 'Line-accurate source viewing with surrounding context', durationMs: 4500 },
  { id: 5, title: 'Interactive Codebase Map', subtitle: 'Locate the file within the repository architectural cluster', durationMs: 4500 },
  { id: 6, title: 'Ready For Investigation', subtitle: 'Direct evidence to understand any codebase quickly', durationMs: 5000 },
];

export function HeroWorkflowDemo({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [typedQuery, setTypedQuery] = useState('');

  const fullQuery = 'Where does the application validate authentication tokens?';

  // Step advancement timer
  useEffect(() => {
    if (!isPlaying) return;
    const stepConfig = DEMO_STEPS[currentStep - 1];
    if (!stepConfig) return;
    const timer = setTimeout(() => {
      setCurrentStep((prev) => (prev >= DEMO_STEPS.length ? 1 : prev + 1));
    }, stepConfig.durationMs);

    return () => clearTimeout(timer);
  }, [currentStep, isPlaying]);

  // Typing simulation for Step 2
  useEffect(() => {
    if (currentStep !== 2) {
      if (currentStep > 2) setTypedQuery(fullQuery);
      else setTypedQuery('');
      return;
    }

    setTypedQuery('');
    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      setTypedQuery(fullQuery.slice(0, idx));
      if (idx >= fullQuery.length) {
        clearInterval(interval);
      }
    }, 45);

    return () => clearInterval(interval);
  }, [currentStep]);

  return (
    <div className="hero-demo-showcase" aria-label="Interactive Product Demonstration">
      {/* Outer lavender glow frame */}
      <div className="hero-demo-outer-frame">
        {/* Top Window Bar */}
        <div className="hero-demo-top-bar">
          <div className="hero-demo-dots">
            <span className="hero-demo-dot hero-demo-dot--red" />
            <span className="hero-demo-dot hero-demo-dot--yellow" />
            <span className="hero-demo-dot hero-demo-dot--green" />
            <span className="hero-demo-title-bar">LocalCode Intelligence — Demonstration Fixture</span>
          </div>

          <div className="hero-demo-controls">
            <button
              type="button"
              className="hero-demo-ctrl-btn"
              onClick={() => setIsPlaying(!isPlaying)}
              title={isPlaying ? 'Pause demonstration' : 'Play demonstration'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className="hero-demo-ctrl-btn"
              onClick={() => {
                setCurrentStep(1);
                setIsPlaying(true);
              }}
              title="Restart demonstration"
              aria-label="Restart"
            >
              <RotateCcw size={13} />
              <span>Replay</span>
            </button>
          </div>
        </div>

        {/* Stage / Scene Visualizer */}
        <div className="hero-demo-stage">
          {/* Step indicators */}
          <div className="hero-demo-step-pills">
            {DEMO_STEPS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`hero-demo-pill ${currentStep === s.id ? 'hero-demo-pill--active' : currentStep > s.id ? 'hero-demo-pill--done' : ''}`}
                onClick={() => {
                  setCurrentStep(s.id);
                  setIsPlaying(false);
                }}
              >
                <span className="hero-demo-pill-num">{s.id}</span>
                <span className="hero-demo-pill-title">{s.title}</span>
              </button>
            ))}
          </div>

          {/* Canvas Display */}
          <div className="hero-demo-viewport">
            {/* SCENE 1: CONNECT REPOSITORY */}
            {currentStep === 1 && (
              <div className="demo-scene animate-wf-rise">
                <div className="demo-scene-badge">
                  <ShieldCheck size={16} /> Local Preparation
                </div>
                <div className="demo-input-mockup">
                  <span className="demo-label">Repository Target</span>
                  <div className="demo-repo-box">
                    <span className="demo-code-text">/Users/developer/repos/enterprise-gateway</span>
                    <span className="demo-tag demo-tag--ok">Eligible • Complete</span>
                  </div>
                </div>
                <div className="demo-status-grid">
                  <div className="demo-stat-card">
                    <span className="demo-stat-num">142</span>
                    <span className="demo-stat-label">Source Files Processed</span>
                  </div>
                  <div className="demo-stat-card">
                    <span className="demo-stat-num">11</span>
                    <span className="demo-stat-label">Languages Supported</span>
                  </div>
                  <div className="demo-stat-card">
                    <span className="demo-stat-num">0</span>
                    <span className="demo-stat-label">Cloud Requests Sent</span>
                  </div>
                </div>
                <p className="demo-scene-caption">
                  Local analysis completes without uploading your codebase. All syntax parsing and vector indexing stay on your machine.
                </p>
              </div>
            )}

            {/* SCENE 2: QUERY TYPING */}
            {currentStep === 2 && (
              <div className="demo-scene animate-wf-rise">
                <div className="demo-scene-badge">
                  <Search size={16} /> Semantic Question
                </div>
                <div className="demo-search-bar">
                  <Search size={18} className="demo-search-icon" />
                  <span className="demo-typed-text">{typedQuery}</span>
                  <span className="demo-cursor animate-cursor-blink">|</span>
                </div>
                <div className="demo-suggestion-chips">
                  <span className="demo-chip">validate authentication tokens</span>
                  <span className="demo-chip">database connection pooling</span>
                  <span className="demo-chip">rate limiting middleware</span>
                </div>
                <p className="demo-scene-caption">
                  Describe what the code accomplishes in plain English. LocalCode retrieves candidate functions by semantic intent.
                </p>
              </div>
            )}

            {/* SCENE 3: EVIDENCE RESULTS */}
            {currentStep === 3 && (
              <div className="demo-scene animate-wf-rise">
                <div className="demo-scene-badge">
                  <FileCode2 size={16} /> Ranked Candidates
                </div>
                <div className="demo-results-list">
                  <div className="demo-result-card demo-result-card--primary">
                    <div className="demo-result-head">
                      <span className="demo-rank-badge">#1</span>
                      <span className="demo-path">src/auth/jwt-verifier.ts:42-88</span>
                      <span className="demo-score-pill">Similarity 0.841</span>
                    </div>
                    <pre className="demo-code-snippet">
                      {`export async function verifyBearerToken(req: Request): Promise<TokenPayload> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedError('Missing token');
  return jwt.verify(token, signingKey, { algorithms: ['RS256'] });
}`}
                    </pre>
                  </div>
                  <div className="demo-result-card demo-result-card--subtle">
                    <div className="demo-result-head">
                      <span className="demo-rank-badge">#2</span>
                      <span className="demo-path">src/middleware/session-guard.ts:15-39</span>
                      <span className="demo-score-pill">Similarity 0.692</span>
                    </div>
                  </div>
                </div>
                <p className="demo-scene-caption">
                  Unverified candidates ranked by embedding similarity. Honest scores provide investigation leads without false claims.
                </p>
              </div>
            )}

            {/* SCENE 4: SOURCE INSPECTOR */}
            {currentStep === 4 && (
              <div className="demo-scene animate-wf-rise">
                <div className="demo-scene-badge">
                  <FileCode2 size={16} /> Source Inspector
                </div>
                <div className="demo-inspector-frame">
                  <div className="demo-inspector-header">
                    <span className="demo-path-title">src/auth/jwt-verifier.ts</span>
                    <span className="demo-line-tag">Lines 42–88</span>
                  </div>
                  <div className="demo-code-lines">
                    <div className="demo-code-line"><span className="demo-ln">41</span><span className="demo-lc"></span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">42</span><span className="demo-lc">export async function verifyBearerToken(req: Request): Promise&lt;TokenPayload&gt; &#123;</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">43</span><span className="demo-lc">  const header = req.headers['authorization'];</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">44</span><span className="demo-lc">  if (!header?.startsWith('Bearer ')) &#123;</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">45</span><span className="demo-lc">    throw new UnauthorizedError('Malformed authorization header');</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">46</span><span className="demo-lc">  &#125;</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">47</span><span className="demo-lc">  return jwt.verify(token, signingKey, &#123; algorithms: ['RS256'] &#125;);</span></div>
                    <div className="demo-code-line demo-code-line--hl"><span className="demo-ln">48</span><span className="demo-lc">&#125;</span></div>
                    <div className="demo-code-line"><span className="demo-ln">49</span><span className="demo-lc"></span></div>
                  </div>
                </div>
                <p className="demo-scene-caption">
                  Read complete surrounding context with line numbers. Copy precise coordinates directly to your IDE or clipboard.
                </p>
              </div>
            )}

            {/* SCENE 5: 2D REPOSITORY MAP */}
            {currentStep === 5 && (
              <div className="demo-scene animate-wf-rise">
                <div className="demo-scene-badge">
                  <Network size={16} /> 2D Architectural Map
                </div>
                <div className="demo-map-visual">
                  <svg className="demo-map-svg" viewBox="0 0 500 200" fill="none">
                    {/* Connecting lines */}
                    <line x1="120" y1="100" x2="250" y2="60" stroke="#9147FF" strokeWidth="2" strokeDasharray="4" />
                    <line x1="120" y1="100" x2="250" y2="140" stroke="#262438" strokeWidth="1.5" />
                    <line x1="250" y1="60" x2="380" y2="40" stroke="#C59EFF" strokeWidth="2" />
                    <line x1="250" y1="60" x2="380" y2="80" stroke="#262438" strokeWidth="1.5" />

                    {/* Nodes */}
                    <g className="animate-wf-pop" style={{ transformOrigin: '120px 100px' }}>
                      <circle cx="120" cy="100" r="28" fill="#13141D" stroke="#9147FF" strokeWidth="2" />
                      <text x="120" y="105" fill="#F5F4F7" fontSize="12" textAnchor="middle" fontWeight="bold">src/</text>
                    </g>

                    <g className="animate-wf-pop" style={{ transformOrigin: '250px 60px' }}>
                      <circle cx="250" cy="60" r="24" fill="#13141D" stroke="#C59EFF" strokeWidth="2" />
                      <text x="250" y="64" fill="#F5F4F7" fontSize="11" textAnchor="middle">auth/</text>
                    </g>

                    <g className="animate-wf-pop" style={{ transformOrigin: '250px 140px' }}>
                      <circle cx="250" cy="140" r="20" fill="#090A11" stroke="#262438" strokeWidth="1.5" />
                      <text x="250" y="144" fill="#898590" fontSize="10" textAnchor="middle">middleware/</text>
                    </g>

                    <g className="animate-wf-pop" style={{ transformOrigin: '380px 40px' }}>
                      <rect x="330" y="26" width="130" height="28" rx="6" fill="#9147FF" fillOpacity="0.2" stroke="#C59EFF" strokeWidth="1.5" />
                      <text x="395" y="44" fill="#F5F4F7" fontSize="10" textAnchor="middle" fontWeight="bold">jwt-verifier.ts ★</text>
                    </g>

                    <g className="animate-wf-pop" style={{ transformOrigin: '380px 80px' }}>
                      <rect x="335" y="68" width="115" height="24" rx="6" fill="#090A11" stroke="#262438" strokeWidth="1" />
                      <text x="392" y="84" fill="#898590" fontSize="10" textAnchor="middle">keys.ts</text>
                    </g>
                  </svg>
                </div>
                <p className="demo-scene-caption">
                  See where the discovered file sits in relation to surrounding packages, modules, and directories.
                </p>
              </div>
            )}

            {/* SCENE 6: CONCLUSION */}
            {currentStep === 6 && (
              <div className="demo-scene demo-scene--conclusion animate-wf-rise">
                <div className="demo-conclusion-icon">
                  <CheckCircle2 size={40} color="#9147FF" />
                </div>
                <h3 className="demo-conclusion-title">From a question to verifiable source</h3>
                <p className="demo-conclusion-desc">
                  Stop grep-guessing or relying on hallucinations. Explore your own repositories with local semantic intelligence and source-grounded evidence.
                </p>
                <div className="demo-conclusion-action">
                  <Button variant="primary" size="lg" onClick={onOpenWorkspace} icon={<ArrowRight size={18} />}>
                    Explore Your Repository
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
