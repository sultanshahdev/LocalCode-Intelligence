import React, { useState } from 'react';
import { CodeBusterMark } from './CodeBusterMark';

export function BusterGhost({ className = '', label }: { className?: string; label?: string }) {
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  return <div className={`buster-ghost ${className}`} aria-label={label} role={label ? 'img' : undefined} aria-hidden={label ? undefined : true}>
    {!renderUnavailable && <img className="buster-ghost__render" src="/brand/buster-hero.png" alt="" onError={() => setRenderUnavailable(true)} />}
    {renderUnavailable && <span className="buster-ghost__fallback"><CodeBusterMark size={160} title={label ?? 'Decorative Code Buster ghost'} /></span>}
    <i className="buster-ghost__trail buster-ghost__trail--one" /><i className="buster-ghost__trail buster-ghost__trail--two" />
  </div>;
}
