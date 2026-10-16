import React from 'react';
import { Search, FileCheck2, Network, Code2, Lock } from 'lucide-react';

export function StorySections() {
  return (
    <div className="landing-story-flow">
      {/* SECTION A: Search beyond filenames */}
      <section className="landing-story-section">
        <div className="landing-story-container">
          <div className="landing-story-text">
            <div className="landing-story-label">
              <Search size={14} /> Semantic Retrieval
            </div>
            <h2 className="landing-story-title">Ask what the code does. Not where it lives.</h2>
            <p className="landing-story-desc">
              Searching by exact filename or identifier only works if you already know how the codebase is structured. LocalCode matches queries against learned vector representations of code behavior, letting you describe operations in plain natural language.
            </p>
            <ul className="landing-story-points">
              <li>Formulate questions naturally without knowing internal jargon</li>
              <li>Calculates cosine similarity locally via quantized MiniLM vectors</li>
              <li>Preserves lexical fallbacks for exact identifier matches</li>
            </ul>
          </div>
          <div className="landing-story-graphic">
            <div className="graphic-card">
              <div className="graphic-card-header">
                <span className="graphic-chip">Natural Language Query</span>
                <span className="graphic-indicator" />
              </div>
              <div className="graphic-query">"How does the server authenticate incoming webhook signatures?"</div>
              <div className="graphic-arrow">↓ Local embedding inference</div>
              <div className="graphic-result">
                <div className="graphic-result-top">
                  <span className="graphic-file">src/webhooks/verify.ts</span>
                  <span className="graphic-score">0.824 similarity</span>
                </div>
                <div className="graphic-snippet">crypto.timingSafeEqual(expectedHmac, computedHmac)</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION B: Every answer has a source */}
      <section className="landing-story-section landing-story-section--alt">
        <div className="landing-story-container landing-story-container--reverse">
          <div className="landing-story-text">
            <div className="landing-story-label">
              <FileCheck2 size={14} /> Source Grounding
            </div>
            <h2 className="landing-story-title">Follow the code, not a guess.</h2>
            <p className="landing-story-desc">
              LocalCode does not invent synthetic answers or hallucinate code explanations. Every search candidate links directly to exact line numbers, readable source files, and inspectable surrounding context.
            </p>
            <ul className="landing-story-points">
              <li>Inspect real lines of code with adjacent context buffers</li>
              <li>Scores presented honestly as ranking signals, not certainty guarantees</li>
              <li>Copy relative paths and line numbers directly into your editor</li>
            </ul>
          </div>
          <div className="landing-story-graphic">
            <div className="graphic-card graphic-card--code">
              <div className="graphic-code-header">
                <span className="graphic-code-path">src/cache/persistent-store.ts:89–112</span>
                <span className="graphic-code-tag">Source Inspector</span>
              </div>
              <div className="graphic-code-body">
                <div className="graphic-code-row"><span className="gln">88</span><span className="glc">async get(key: string): Promise&lt;Buffer | null&gt; &#123;</span></div>
                <div className="graphic-code-row graphic-code-row--hl"><span className="gln">89</span><span className="glc">  const entry = await this.storage.lookup(key);</span></div>
                <div className="graphic-code-row graphic-code-row--hl"><span className="gln">90</span><span className="glc">  if (!entry || entry.isExpired()) return null;</span></div>
                <div className="graphic-code-row graphic-code-row--hl"><span className="gln">91</span><span className="glc">  return entry.decompressPayload();</span></div>
                <div className="graphic-code-row"><span className="gln">92</span><span className="glc">&#125;</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION C: 2D Repository Map */}
      <section className="landing-story-section">
        <div className="landing-story-container">
          <div className="landing-story-text">
            <div className="landing-story-label">
              <Network size={14} /> Architecture Visualization
            </div>
            <h2 className="landing-story-title">From scattered files to a connected picture.</h2>
            <p className="landing-story-desc">
              Understand the physical layout and modular boundaries of the repository. The 2D Repository Map constructs an interactive hierarchical graph directly from validated project directories and language adapters.
            </p>
            <ul className="landing-story-points">
              <li>Pan, zoom, and filter through complex directory trees</li>
              <li>Detect file distribution across supported programming languages</li>
              <li>Click any file node to immediately inspect its code</li>
            </ul>
          </div>
          <div className="landing-story-graphic">
            <div className="graphic-card graphic-card--map">
              <svg viewBox="0 0 360 220" className="graphic-map-svg">
                <line x1="80" y1="110" x2="180" y2="60" stroke="#9147FF" strokeWidth="1.5" />
                <line x1="80" y1="110" x2="180" y2="160" stroke="#262438" strokeWidth="1.5" />
                <line x1="180" y1="60" x2="280" y2="40" stroke="#C59EFF" strokeWidth="1.5" />
                <line x1="180" y1="60" x2="280" y2="85" stroke="#9147FF" strokeWidth="1.5" />

                <circle cx="80" cy="110" r="22" fill="#13141D" stroke="#9147FF" strokeWidth="2" />
                <text x="80" y="114" fill="#F5F4F7" fontSize="11" textAnchor="middle">root</text>

                <circle cx="180" cy="60" r="18" fill="#13141D" stroke="#C59EFF" strokeWidth="1.5" />
                <text x="180" y="64" fill="#F5F4F7" fontSize="9" textAnchor="middle">src</text>

                <circle cx="180" cy="160" r="16" fill="#090A11" stroke="#262438" strokeWidth="1" />
                <text x="180" y="164" fill="#898590" fontSize="9" textAnchor="middle">test</text>

                <rect x="230" y="28" width="95" height="22" rx="5" fill="#13141D" stroke="#C59EFF" strokeWidth="1" />
                <text x="277" y="43" fill="#F5F4F7" fontSize="9" textAnchor="middle">server.ts</text>

                <rect x="230" y="74" width="95" height="22" rx="5" fill="#090A11" stroke="#262438" strokeWidth="1" />
                <text x="277" y="89" fill="#898590" fontSize="9" textAnchor="middle">search.ts</text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION D: Symbols & Usages */}
      <section className="landing-story-section landing-story-section--alt">
        <div className="landing-story-container landing-story-container--reverse">
          <div className="landing-story-text">
            <div className="landing-story-label">
              <Code2 size={14} /> Symbol Intelligence
            </div>
            <h2 className="landing-story-title">Find the declarations that matter.</h2>
            <p className="landing-story-desc">
              Extract functions, classes, interfaces, and methods without compiling the whole project. Discover AST identifier locations across files to investigate where declarations are referenced.
            </p>
            <ul className="landing-story-points">
              <li>Structured declaration extraction powered by tree-sitter grammars</li>
              <li>Filter declarations instantly by name, kind, container, or file</li>
              <li>Find potential usages clearly labeled as syntax matches</li>
            </ul>
          </div>
          <div className="landing-story-graphic">
            <div className="graphic-card">
              <div className="graphic-symbol-item">
                <span className="symbol-tag">function</span>
                <span className="symbol-name">createLocalEmbedder()</span>
                <span className="symbol-loc">retrieval.ts:42</span>
              </div>
              <div className="graphic-symbol-item graphic-symbol-item--active">
                <span className="symbol-tag">class</span>
                <span className="symbol-name">PersistentCachingEmbedder</span>
                <span className="symbol-loc">cache.ts:18</span>
              </div>
              <div className="graphic-usages-box">
                <div className="usages-title">3 possible usages in repository</div>
                <div className="usage-line">• server.ts:54 new PersistentCachingEmbedder(...)</div>
                <div className="usage-line">• test/cache.test.ts:12 test('cache init')</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION E: Local-first privacy */}
      <section id="privacy" className="landing-story-section">
        <div className="landing-story-container">
          <div className="landing-story-text">
            <div className="landing-story-label">
              <Lock size={14} /> Privacy & Execution
            </div>
            <h2 className="landing-story-title">Your repository. Your machine.</h2>
            <p className="landing-story-desc">
              LocalCode runs locally on 127.0.0.1. No code snippets, embeddings, or queries are ever sent to an external LLM, third-party analytics, or remote cloud servers.
            </p>
            <ul className="landing-story-points">
              <li>Completely offline-capable once embedding models are downloaded</li>
              <li>Public GitHub imports are cloned into ephemeral local folders</li>
              <li>Explicit localhost binding and strict origin validation</li>
            </ul>
          </div>
          <div className="landing-story-graphic">
            <div className="graphic-card graphic-card--security">
              <div className="security-badge">
                <Lock size={20} color="#22C55E" />
                <span>Local Sandbox Verification</span>
              </div>
              <div className="security-rows">
                <div className="sec-row"><span>Binding</span><code>127.0.0.1:4317</code></div>
                <div className="sec-row"><span>Cloud Model Dependency</span><span className="tag-safe">None (Local ONNX)</span></div>
                <div className="sec-row"><span>External Code Telemetry</span><span className="tag-safe">None</span></div>
                <div className="sec-row"><span>Symlink Protection</span><span className="tag-safe">Enforced</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
