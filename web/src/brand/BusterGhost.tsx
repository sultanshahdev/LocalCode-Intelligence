import React from 'react';
import { CodeBusterMark } from './CodeBusterMark';

export function BusterGhost({ className = '', label }: { className?: string; label?: string }) {
  return <div className={`buster-ghost ${className}`} aria-label={label} role={label ? 'img' : undefined} aria-hidden={label ? undefined : true}>
    <CodeBusterMark size={160} title={label ?? 'Decorative Code Buster ghost'} />
    <i className="buster-ghost__trail buster-ghost__trail--one" /><i className="buster-ghost__trail buster-ghost__trail--two" />
  </div>;
}
