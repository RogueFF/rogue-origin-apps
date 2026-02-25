import { useState, useRef, useEffect } from 'react';
import { useNotifications, type Notification } from '../lib/notifications-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + 'Z').getTime(); // D1 stores UTC without Z
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function groupByDay(items: Notification[]): { label: string; items: Notification[] }[] {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

  const groups: Record<string, Notification[]> = {};
  for (const n of items) {
    const day = (n.created_at || '').slice(0, 10);
    let label: string;
    if (day === todayStr) label = 'Today';
    else if (day === yesterday) label = 'Yesterday';
    else label = 'Older';
    (groups[label] ??= []).push(n);
  }

  const order = ['Today', 'Yesterday', 'Older'];
  return order
    .filter((l) => groups[l]?.length)
    .map((label) => ({ label, items: groups[label] }));
}

function typeIcon(type: string): string {
  switch (type) {
    case 'alert': return '⚠';
    case 'production-card': return '📊';
    case 'briefing': return '📋';
    default: return '🔔';
  }
}

// ---------------------------------------------------------------------------
// Bell SVG
// ---------------------------------------------------------------------------

function BellIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// NotificationBell
// ---------------------------------------------------------------------------

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(20);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const grouped = groupByDay(notifications);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 'var(--card-radius)',
          padding: '4px 8px',
          color: unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)',
          cursor: 'pointer',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          transition: 'all 150ms ease',
        }}
      >
        <BellIcon size={14} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--accent-red)',
              color: '#fff',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 0 8px var(--accent-red)',
              animation: 'badge-pulse 2s ease-in-out infinite',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 360,
            maxHeight: 480,
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--card-radius)',
            backdropFilter: 'blur(var(--card-blur))',
            WebkitBackdropFilter: 'blur(var(--card-blur))',
            boxShadow: 'var(--glass-shadow)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: 'var(--text-primary)',
                textTransform: 'uppercase',
              }}
            >
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--accent-cyan)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '32px 14px',
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                }}
              >
                No notifications
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.label}>
                  <div
                    style={{
                      padding: '6px 14px 2px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {group.label}
                  </div>
                  {group.items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        if (!n.read) markRead(n.id);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        width: '100%',
                        padding: '8px 14px',
                        background: n.read ? 'transparent' : 'rgba(255,255,255,0.02)',
                        border: 'none',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: n.read ? 'default' : 'pointer',
                        textAlign: 'left',
                        transition: 'background 150ms',
                      }}
                      onMouseEnter={(e) => {
                        if (!n.read) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(255,255,255,0.02)';
                      }}
                    >
                      {/* Unread dot */}
                      <div style={{ paddingTop: 4, width: 8, flexShrink: 0 }}>
                        {!n.read && (
                          <div
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--accent-cyan)',
                              boxShadow: '0 0 4px var(--accent-cyan)',
                            }}
                          />
                        )}
                      </div>

                      {/* Icon */}
                      <span style={{ fontSize: 13, flexShrink: 0, paddingTop: 1 }}>
                        {typeIcon(n.type)}
                      </span>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: 11,
                            fontWeight: n.read ? 500 : 700,
                            color: 'var(--text-primary)',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {n.title}
                        </div>
                        {n.body && (
                          <div
                            style={{
                              fontFamily: 'var(--font-body)',
                              fontSize: 10,
                              color: 'var(--text-secondary)',
                              lineHeight: 1.3,
                              marginTop: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {n.body}
                          </div>
                        )}
                      </div>

                      {/* Timestamp */}
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          color: 'var(--text-tertiary)',
                          flexShrink: 0,
                          paddingTop: 2,
                        }}
                      >
                        {relativeTime(n.created_at)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Badge pulse animation */}
      <style>{`
        @keyframes badge-pulse {
          0%, 100% { box-shadow: 0 0 4px var(--accent-red); }
          50% { box-shadow: 0 0 12px var(--accent-red); }
        }
      `}</style>
    </div>
  );
}
