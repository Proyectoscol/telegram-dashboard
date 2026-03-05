'use client';

interface LoadingSpinnerProps {
  /** 'md' = default 40px, 'sm' = 18px for buttons */
  size?: 'md' | 'sm';
  className?: string;
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <div
      className={`loading-spinner ${size === 'sm' ? 'loading-spinner--sm' : ''} ${className}`.trim()}
      role="status"
      aria-label="Loading"
    />
  );
}

interface LoadingCardProps {
  message?: string;
}

/** Full card-style loading state for initial page/data load */
export function LoadingCard({ message = 'Loading…' }: LoadingCardProps) {
  return (
    <div className="card">
      <div className="loading-card">
        <LoadingSpinner />
        <span>{message}</span>
      </div>
    </div>
  );
}

interface LoadingOverlayProps {
  message?: string;
  active: boolean;
  children: React.ReactNode;
}

/** Wraps content and shows a spinner overlay when active (e.g. dashboard refetch) */
export function LoadingOverlay({ message = 'Loading…', active, children }: LoadingOverlayProps) {
  if (!active) return <>{children}</>;
  return (
    <div className="loading-overlay" style={{ position: 'relative' }}>
      {children}
      <div className="loading-overlay__content">
        <LoadingSpinner />
        <span>{message}</span>
      </div>
    </div>
  );
}

/** Inline spinner + text for buttons or small areas */
export function LoadingInline({ message = 'Loading…' }: { message?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <LoadingSpinner size="sm" />
      <span>{message}</span>
    </span>
  );
}
