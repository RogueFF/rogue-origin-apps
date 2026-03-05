/**
 * StateCard — Unified loading / empty / error state component
 */

interface StateCardProps {
  state: 'loading' | 'empty' | 'error';
  message?: string;
  icon?: string;
  onRetry?: () => void;
}

export function StateCard({ state, message, icon, onRetry }: StateCardProps) {
  if (state === 'loading') {
    return (
      <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="skeleton-pulse"
            style={{
              width: `${100 - i * 15}%`,
              height: 14,
              borderRadius: 4,
              background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 20, opacity: 0.6 }}>{icon || '⚠'}</span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--accent-red)',
          textAlign: 'center',
        }}>
          {message || 'Something went wrong'}
        </span>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--accent-red)',
              borderRadius: 'var(--card-radius)',
              padding: '4px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--accent-red)',
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  // empty
  return (
    <div style={{
      padding: '20px 0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
    }}>
      <span style={{ fontSize: 18, opacity: 0.4 }}>{icon || '○'}</span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--text-tertiary)',
        textAlign: 'center',
      }}>
        {message || 'No data available'}
      </span>
    </div>
  );
}
