import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Primitives';
import { HeroWorkflowDemo } from '../demos/HeroWorkflowDemo';

export function HeroSection({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const scrollToDemo = () => {
    const el = document.getElementById('demo-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="landing-hero-section">
      <div className="landing-hero-container">
        {/* Editorial Top Tag */}
        <div className="landing-hero-tag animate-wf-rise">
          <Sparkles size={14} className="landing-hero-tag-icon" />
          <span>Local-First Repository Intelligence & Code Exploration</span>
        </div>

        {/* Staggered Headline */}
        <h1 className="landing-hero-title animate-wf-rise">
          <span className="hero-title-line">Understand any codebase.</span>
          <br />
          <span className="hero-title-line hero-title-line--gradient">Follow the evidence.</span>
        </h1>

        {/* Supporting Copy */}
        <p className="landing-hero-sub animate-wf-rise" style={{ animationDelay: '100ms' }}>
          Explore unfamiliar repositories through local semantic search, source-grounded candidates, symbol navigation, and an interactive 2D map of your code.
        </p>

        {/* Hero CTAs */}
        <div className="landing-hero-actions animate-wf-rise" style={{ animationDelay: '200ms' }}>
          <Button variant="primary" size="lg" onClick={onOpenWorkspace} icon={<ArrowRight size={18} />}>
            Open Workspace
          </Button>
          <Button variant="secondary" size="lg" onClick={scrollToDemo}>
            See How It Works
          </Button>
        </div>

        {/* Demonstration Frame */}
        <div id="demo-section" className="landing-hero-demo-wrap animate-wf-rise" style={{ animationDelay: '300ms' }}>
          <HeroWorkflowDemo onOpenWorkspace={onOpenWorkspace} />
        </div>
      </div>
    </section>
  );
}
