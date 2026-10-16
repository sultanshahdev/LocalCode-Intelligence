import React from 'react';
import { CodeBusterMark } from './CodeBusterMark';

export function CodeBusterWordmark({ compact = false }: { compact?: boolean }) {
  return <span className="cb-wordmark"><CodeBusterMark size={compact ? 26 : 32} /><span>Code <b>Buster</b></span></span>;
}
