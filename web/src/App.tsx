import React, { useState, useEffect } from 'react';
import { LandingPage } from './landing/LandingPage';
import { WorkspacePage } from './workspace/WorkspacePage';

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<'landing' | 'app'>(() => {
    const path = window.location.pathname;
    return path.startsWith('/app') ? 'app' : 'landing';
  });

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      setCurrentRoute(path.startsWith('/app') ? 'app' : 'landing');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = (route: 'landing' | 'app') => {
    const targetUrl = route === 'app' ? '/app' : '/';
    window.history.pushState({}, '', targetUrl);
    setCurrentRoute(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {currentRoute === 'landing' ? (
        <LandingPage onOpenWorkspace={() => navigateTo('app')} />
      ) : (
        <WorkspacePage onReturnToLanding={() => navigateTo('landing')} />
      )}
    </>
  );
}
