import React, { useState } from 'react';
import { LocalCodeLogo, Button } from '../ui/Primitives';
import { Menu, X, ArrowUpRight } from 'lucide-react';

export function LandingNavbar({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="landing-nav-header">
      <div className="landing-nav-inner">
        <div className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <LocalCodeLogo size={32} />
          <span className="landing-brand__title">LocalCode</span>
          <span className="landing-brand__badge">Intelligence</span>
        </div>

        <nav className="landing-nav-links" aria-label="Main Navigation">
          <button type="button" onClick={() => scrollTo('how-it-works')} className="landing-nav-link">
            How It Works
          </button>
          <button type="button" onClick={() => scrollTo('capabilities')} className="landing-nav-link">
            Capabilities
          </button>
          <button type="button" onClick={() => scrollTo('privacy')} className="landing-nav-link">
            Privacy
          </button>
          <button type="button" onClick={() => scrollTo('faq')} className="landing-nav-link">
            FAQ
          </button>
        </nav>

        <div className="landing-nav-actions">
          <Button variant="primary" size="sm" onClick={onOpenWorkspace} icon={<ArrowUpRight size={14} />}>
            Open Workspace
          </Button>
          <button
            type="button"
            className="landing-nav-mobile-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="landing-nav-mobile-menu animate-wf-rise">
          <button type="button" onClick={() => scrollTo('how-it-works')} className="landing-mobile-link">
            How It Works
          </button>
          <button type="button" onClick={() => scrollTo('capabilities')} className="landing-mobile-link">
            Capabilities
          </button>
          <button type="button" onClick={() => scrollTo('privacy')} className="landing-mobile-link">
            Privacy
          </button>
          <button type="button" onClick={() => scrollTo('faq')} className="landing-mobile-link">
            FAQ
          </button>
          <div className="landing-mobile-cta">
            <Button variant="primary" size="md" onClick={onOpenWorkspace} icon={<ArrowUpRight size={16} />}>
              Open Workspace
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
