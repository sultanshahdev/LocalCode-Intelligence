import React, { useState } from 'react';
import { ChevronDown, ArrowRight } from 'lucide-react';
import { Button, LocalCodeLogo } from '../../components/ui/Primitives';

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: 'What is LocalCode Intelligence?',
    a: 'LocalCode Intelligence is a local-first repository intelligence and code exploration platform designed to help developers quickly understand unfamiliar source code through semantic search, exact text scanning, symbol navigation, and an interactive 2D repository map.',
  },
  {
    q: 'Does it run completely locally?',
    a: 'Yes. All source parsing, vector embeddings, exact searches, and map layouts execute on your local machine via localhost (127.0.0.1:4317). Once the lightweight ONNX embedding model is initially downloaded, no internet connection is required for local repositories.',
  },
  {
    q: 'Can it inspect public GitHub repositories?',
    a: 'Yes. You can paste any public GitHub repository URL. The backend clones the repository into an isolated local cache, checks source eligibility, and prepares it for search and symbol navigation without requiring API keys or account setup.',
  },
  {
    q: 'Does LocalCode modify my source code or Git history?',
    a: 'No. LocalCode performs purely read-only source analysis. It never creates index files inside your project directory, never creates commits or branches, and never alters your files.',
  },
  {
    q: 'What is the difference between semantic search and exact search?',
    a: 'Semantic search matches the conceptual behavior or intent of your natural-language query against vector representations of code segments. Exact search scans source text literally for matching identifiers, keywords, or error strings with optional case-sensitive and whole-word filters.',
  },
  {
    q: 'Are semantic results verified answers or inspectable candidates?',
    a: 'Semantic results are unverified candidates ranked by embedding similarity. Cosine similarity is a ranking signal to help you discover relevant locations quickly, not a guarantee or statistical proof. You can always click "View Source" to inspect the real lines.',
  },
  {
    q: 'Which programming languages are supported?',
    a: 'LocalCode includes language adapters with structural AST analysis for JavaScript/TypeScript, Python, Go, Rust, Java, C, C++, C#, Ruby, PHP, and Bash, with automatic fallback for general text across supported source files.',
  },
];

export function FaqAndFooterSection({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIdx(openIdx === idx ? null : idx);
  };

  return (
    <>
      {/* FAQ Accordion */}
      <section id="faq" className="landing-faq-section">
        <div className="landing-section-header">
          <span className="section-pre-title">Frequently Asked Questions</span>
          <h2 className="section-main-title">Everything you need to know</h2>
          <p className="section-sub-title">Clear, honest answers about privacy, architecture, and capabilities.</p>
        </div>

        <div className="faq-container">
          {FAQS.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div key={idx} className={`faq-item ${isOpen ? 'faq-item--open' : ''}`}>
                <button
                  type="button"
                  className="faq-question"
                  onClick={() => toggle(idx)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${idx}`}
                >
                  <span>{item.q}</span>
                  <ChevronDown size={18} className="faq-chevron" />
                </button>
                {isOpen && (
                  <div id={`faq-answer-${idx}`} className="faq-answer animate-wf-rise">
                    <p>{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* FINAL CALL TO ACTION (Kiro-style high contrast purple banner) */}
      <section className="landing-cta-banner">
        <div className="cta-banner-card">
          <h2 className="cta-banner-title">Your next codebase shouldn't be a mystery.</h2>
          <p className="cta-banner-desc">
            Explore repositories locally with semantic search, inspectable source candidates, and connected architectural maps.
          </p>
          <div className="cta-banner-action">
            <Button variant="lavender" size="lg" onClick={onOpenWorkspace} icon={<ArrowRight size={18} />}>
              Open Workspace
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="footer-brand-col">
            <div className="footer-brand">
              <LocalCodeLogo size={24} />
              <span>LocalCode Intelligence</span>
            </div>
            <p className="footer-tagline">
              Local-first repository intelligence and code exploration platform.
            </p>
          </div>

          <div className="footer-links-col">
            <span className="footer-col-title">Navigation</span>
            <a href="#how-it-works">How It Works</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#privacy">Privacy</a>
            <a href="#faq">FAQ</a>
          </div>

          <div className="footer-links-col">
            <span className="footer-col-title">Workspace</span>
            <button type="button" onClick={onOpenWorkspace} className="footer-text-btn">
              Launch Workspace (/app)
            </button>
            <a href="/api/health" target="_blank" rel="noreferrer">
              Health Status (/api/health)
            </a>
            <a href="/api/languages" target="_blank" rel="noreferrer">
              Supported Languages (/api/languages)
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} LocalCode Intelligence. Runs entirely on your local machine.</span>
          <span>127.0.0.1:4317</span>
        </div>
      </footer>
    </>
  );
}
