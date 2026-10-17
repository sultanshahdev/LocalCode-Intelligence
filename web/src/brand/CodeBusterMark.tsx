import React from 'react';

export function CodeBusterMark({ size = 32, monochrome = false, title = 'Code Buster' }: { size?: number; monochrome?: boolean; title?: string }) {
  const ink = monochrome ? 'currentColor' : '#F2F3EE';
  const accent = monochrome ? 'currentColor' : '#FF7566';
  const violet = monochrome ? 'currentColor' : '#AD9BF7';
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label={title} className="cb-mark">
    <title>{title}</title>
    <path d="M13 13.5C17.4 7.9 26.6 6.4 33 10.2c3.9 2.3 5.9 6.2 5.8 10.4" stroke={violet} strokeWidth="3" strokeLinecap="round" />
    <path d="M38.8 27.8c-1.7 7.5-8.5 12.7-16.2 12.2-5.2-.3-9.4-3.5-11.5-7.8" stroke={accent} strokeWidth="3" strokeLinecap="round" />
    <path d="M12.2 19.6c-1.2 2-1.7 4.5-1.3 7" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    <path d="M16.2 30.2V21c0-5.3 3.3-9.1 7.8-9.1 4.6 0 7.8 3.8 7.8 9.1v9.2c0 3.3 2 5.2 4.5 6.1-3.2 1.5-6.2.7-8-1.4-2.3 1.4-6.1 1.4-8.4 0-1.9 2.1-4.8 2.9-8 1.4 2.5-.9 4.3-2.8 4.3-6.1Z" fill={ink} />
    <ellipse className="cb-mark-eye" cx="21.1" cy="22.9" rx="2.25" ry="2.75" fill="#090B0D" />
    <ellipse className="cb-mark-eye" cx="27.4" cy="22.9" rx="2.25" ry="2.75" fill="#090B0D" />
    <circle cx="22" cy="22" r=".65" fill="white" /><circle cx="28.3" cy="22" r=".65" fill="white" />
    <path d="M21.3 28c1.8 1.2 3.7 1.2 5.4 0" stroke="#090B0D" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="40.2" cy="20.3" r="2.4" fill={accent} /><path d="M40.2 15.2v2" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
