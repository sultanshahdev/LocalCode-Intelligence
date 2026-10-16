import React from 'react';

export function LocalCodeLogo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#13141D" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="#262438" />
      {/* Sleek brackets and node dot */}
      <path
        d="M11 11L7 16L11 21"
        stroke="#C59EFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 11L25 16L21 21"
        stroke="#C59EFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.5" fill="#9147FF" />
    </svg>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  icon,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'lavender';
  size?: 'sm' | 'md' | 'lg';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  icon?: React.ReactNode;
}) {
  const sizeClasses = {
    sm: 'kiro-btn--sm',
    md: 'kiro-btn--md',
    lg: 'kiro-btn--lg',
  }[size];

  const variantClasses = {
    primary: 'kiro-btn--primary',
    secondary: 'kiro-btn--secondary',
    ghost: 'kiro-btn--ghost',
    lavender: 'kiro-btn--lavender',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`kiro-btn ${variantClasses} ${sizeClasses} ${className}`}
    >
      <span className="kiro-btn__fill" aria-hidden="true" />
      <span className="kiro-btn__content">
        {icon && <span className="kiro-btn__icon">{icon}</span>}
        {children}
      </span>
    </button>
  );
}

export function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'purple' | 'success' | 'warning';
  className?: string;
}) {
  return <span className={`kiro-badge kiro-badge--${variant} ${className}`}>{children}</span>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M12 2A10 10 0 0 1 22 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
