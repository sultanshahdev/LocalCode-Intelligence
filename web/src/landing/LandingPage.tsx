import React from 'react';
import { LandingNavbar } from '../components/navigation/LandingNavbar';
import { HeroSection } from './sections/HeroSection';
import { StorySections } from './sections/StorySections';
import { CapabilitiesSection } from './sections/CapabilitiesSection';
import { WorkflowSection } from './sections/WorkflowSection';
import { FaqAndFooterSection } from './sections/FaqAndFooterSection';

export function LandingPage({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <div className="landing-page-root">
      <LandingNavbar onOpenWorkspace={onOpenWorkspace} />
      <main>
        <HeroSection onOpenWorkspace={onOpenWorkspace} />
        <StorySections />
        <CapabilitiesSection />
        <WorkflowSection />
        <FaqAndFooterSection onOpenWorkspace={onOpenWorkspace} />
      </main>
    </div>
  );
}
