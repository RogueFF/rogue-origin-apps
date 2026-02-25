import { useEffect } from 'react';
import { useToastStore, type Toast as ToastType } from '../lib/notifications-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function borderColor(priority: string): string {
  switch (priority) {
    case 'high': return 'var(--accent-red)';
    case 'low': return 'var(--accent-green)';
    default: return 'var(--accent-cyan)';
  }
}

function typeIcon(type: string): string {
  switch (type) {
    case 'alert': return '⚠';
    case 'production-card': return '📊';
    case 'briefing': return '📋';
    default: return '🔔';
  }
}

function dismissMs(priority: string): number {
  return priority === 'high' ? 10000 : 5000;
}

// ---------------------------------------------------------------------------
// Single Toast Card
// ---------------------------------------------------------------------------

function ToastCard({ toast, index }: { toast: ToastType; index: number }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const color = borderColor(toast.priority);

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), dismissMs(toast.priority));
    return () => clearTimeout(timer);
  }, [toast.id, toast.priority, removeToast]);

  return (
    <div
      style={{
        background: 'var(--bg-glass)',
        border: '1px solid var(--border-glass)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--card-radius)',
        backdropFilter: 'blur(var(--card-blur))',
        WebkitBackdropFilter: 'blur(var(--card-blur))',
        boxShadow: 'var(--glass-shadow)',
        padding: '10px 14px',
        width: 320,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        animation: 'toast-slide-in 300ms ease-out',
        marginBottom: 8,
        transform: `translateY(${index * 2}px)`,
        transition: 'transform 200ms ease, opacity 200ms ease',
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 14, flexShrink: 0, paddingTop: 1 }}>
        {typeIcon(toast.type)}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.3,
          }}
        >
          {toast.title}
        </div>
        {toast.body && (
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {toast.body}
          </div>
        )}
      </div>

      {/* Close */}
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          fontSize: 12,
          padding: '0 2px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast Container (mount at root level)
// ---------------------------------------------------------------------------

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 56,
          right: 20,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
        }}
      >
        {toasts.map((toast, i) => (
          <ToastCard key={toast.id} toast={toast} index={i} />
        ))}
      </div>
      <style>{`
        @keyframes toast-slide-in {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
