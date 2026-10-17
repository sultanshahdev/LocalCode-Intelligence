import React from 'react';

export function CodeBusterMark({ size = 32, monochrome = false, title = 'Code Buster' }: { size?: number; monochrome?: boolean; title?: string }) {
  const ink = monochrome ? 'currentColor' : '#F2F3EE';
  const accent = monochrome ? 'currentColor' : '#FF7566';
  const violet = monochrome ? 'currentColor' : '#AD9BF7';
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label={title} className="cb-mark">
    <title>{title}</title>
    <path d="M12 28V20c0-7 5-12 12-12s12 5 12 12v8c0 3 1.8 5 4 6-3.3 2.4-6.6 1.7-8.7-.7-2 1.3-5 1.3-7.2 0-2.1 2.4-5.4 3.1-8.7.7 2.2-1 4-3 4-6Z" fill={ink} />
    <path d="M13 18c-3 1-4 3.5-3 6" stroke={violet} strokeWidth="2.6" strokeLinecap="round" /><path d="M36 15c3 1.1 4.1 3.7 3 6.5" stroke={accent} strokeWidth="2.6" strokeLinecap="round" />
    <ellipse className="cb-mark-eye" cx="20.2" cy="22" rx="2.1" ry="2.7" fill="#090B0D" /><ellipse className="cb-mark-eye" cx="27.8" cy="22" rx="2.1" ry="2.7" fill="#090B0D" />
    <circle cx="20.8" cy="21.2" r=".6" fill="white" /><circle cx="28.4" cy="21.2" r=".6" fill="white" /><path d="M21.5 28c1.6 1 3.4 1 5 0" stroke="#090B0D" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
