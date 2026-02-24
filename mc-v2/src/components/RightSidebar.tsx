import { useState } from 'react';
import { useGatewayStore } from '../store/gateway';
import { activities as mockActivities } from '../data/mock';
import type { Activity } from '../data/mock';

// Merge type for both live notifications and mock activities
type FeedItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  timestamp: string;
  accentColor: string;
};

const TYPE_LABELS: Record<string, string> = {
  briefing: 'BRIEF',
  production: 'PROD',
  alert: 'ALERT',
  toast: 'LOG',
  chat: 'CHAT',
};

// Glow colors per type — bleeds through frosted glass from behind
const TYPE_GLOW: Record<string, string> = {
  alert: 'radial-gradient(ellipse at 50% 0%, rgba(255,51,68,0.12) 0%, transparent 70%)',
  production: 'radial-gradient(ellipse at 50% 0%, rgba(0,255,136,0.06) 0%, transparent 70%)',
  briefing: 'radial-gradient(ellipse at 50% 0%, rgba(0,240,255,0.06) 0%, transparent 70%)',
  chat: 'radial-gradient(ellipse at 50% 0%, rgba(228,170,79,0.06) 0%, transparent 70%)',
  toast: 'none',
};

const TYPE_ICONS: Record<string, string> = {
  briefing: '◆',
  production: '▣',
  alert: '▲',
  toast: '○',
  chat: '◇',
};

// Priority tiers for depth layering
function getCardDepth(type: string): { blur: string; bg: string; scale: number; zOffset: number } {
  switch (type) {
    case 'alert':
      return { blur: '32px', bg: 'rgba(255,255,255,0.07)', scale: 1.0, zOffset: 3 };
    case 'production':
    case 'briefing':
      return { blur: '24px', bg: 'rgba(255,255,255,0.05)', scale: 1.0, zOffset: 2 };
    default:
      return { blur: '16px', bg: 'rgba(255,255,255,0.03)', scale: 1.0, zOffset: 1 };
  }
}

function ActivityCard({ activity, isNew = false }: { activity: FeedItem; isNew?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isAlert = activity.type === 'alert';
  const depth = getCardDepth(activity.type);
  const glow = TYPE_GLOW[activity.type] || 'none';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 'var(--card-radius)',
        marginBottom: isAlert ? 8 : 5,
        cursor: 'pointer',
        animation: isNew ? 'card-enter 0.4s ease-out, glass-pulse-ring 0.8s ease-out' : 'none',
        zIndex: depth.zOffset,
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Glow layer — sits behind the glass */}
      {glow !== 'none' && (
        <div
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: 'calc(var(--card-radius) + 2px)',
            background: glow,
            opacity: hovered ? 1 : 0.7,
            transition: 'opacity 0.3s ease',
            pointerEvents: 'none',
            animation: isAlert ? 'alert-glow 3s ease-in-out infinite' : 'none',
          }}
        />
      )}

      {/* Glass card */}
      <div
        style={{
          position: 'relative',
          background: hovered ? `${depth.bg.replace(')', ', 1)')}` : depth.bg,
          backgroundImage: hovered ? 'var(--glass-highlight-hover)' : 'var(--glass-highlight)',
          border: `1px solid ${hovered ? 'var(--border-glass)' : 'var(--border-card)'}`,
          borderRadius: 'var(--card-radius)',
          padding: isAlert ? '12px 14px' : '10px 12px',
          backdropFilter: `blur(${depth.blur})`,
          WebkitBackdropFilter: `blur(${depth.blur})`,
          boxShadow: hovered ? 'var(--glass-shadow-hover)' : 'var(--glass-shadow)',
          transition: `all var(--transition-speed) ease`,
          transform: hovered ? 'translateY(-1px)' : 'none',
        }}
      >
        {/* Top edge highlight — the iOS signature */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '10%',
            right: '10%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
            borderRadius: '0 0 2px 2px',
            pointerEvents: 'none',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: isAlert ? 'var(--accent-red)' : 'var(--text-tertiary)',
                opacity: 0.8,
                lineHeight: 1,
              }}
            >
              {TYPE_ICONS[activity.type] || '○'}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                letterSpacing: '0.08em',
                color: isAlert ? 'var(--accent-red)' : 'var(--text-tertiary)',
                opacity: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {TYPE_LABELS[activity.type] || activity.type.toUpperCase()}
            </span>
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--text-tertiary)',
              opacity: 0.5,
              flexShrink: 0,
            }}
          >
            {activity.timestamp}
          </span>
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: isAlert ? 12 : 11,
            fontWeight: isAlert ? 600 : 500,
            color: 'var(--text-primary)',
            lineHeight: 1.35,
            marginBottom: expanded ? 6 : 0,
          }}
        >
          {activity.title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            maxHeight: expanded ? 200 : 0,
            overflow: 'hidden',
            opacity: expanded ? 1 : 0,
            transition: `all var(--transition-speed) ease`,
          }}
        >
          {activity.body}
        </div>
        {isAlert && expanded && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={(e) => { e.stopPropagation(); }}
              style={{
                background: 'rgba(255,51,68,0.08)',
                border: '1px solid rgba(255,51,68,0.12)',
                borderRadius: 'var(--card-radius)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--accent-red)',
                cursor: 'pointer',
                padding: '4px 12px',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,51,68,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,51,68,0.08)';
              }}
            >
              acknowledge
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RightSidebar() {
  const [filter, setFilter] = useState<string>('all');
  const liveNotifications = useGatewayStore((s) => s.notifications);
  const connectionState = useGatewayStore((s) => s.connectionState);

  // Convert live notifications to feed items
  const liveFeed: FeedItem[] = liveNotifications.map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    timestamp: n.timestamp,
    accentColor: n.accentColor,
  }));

  // Convert mock activities to feed items
  const mockFeed: FeedItem[] = mockActivities.map((a: Activity) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    timestamp: a.timestamp,
    accentColor: a.accentColor,
  }));

  // Only show mock data when disconnected with no live events
  const allFeed = connectionState === 'connected' || liveFeed.length > 0 ? liveFeed : mockFeed;
  const filtered = filter === 'all' ? allFeed : allFeed.filter((a) => a.type === filter);
  const types = ['all', 'briefing', 'production', 'alert', 'toast', 'chat'];

  return (
    <aside
      style={{
        width: 280,
        minWidth: 280,
        borderLeft: '1px solid var(--border-glass)',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(var(--card-blur))',
        WebkitBackdropFilter: 'blur(var(--card-blur))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Activity Feed</span>
          {connectionState === 'connected' && liveFeed.length > 0 && (
            <span style={{ color: 'var(--accent-green)', fontSize: 8 }}>● {liveFeed.length} LIVE</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              style={{
                background: filter === t ? 'var(--bg-glass)' : 'transparent',
                border: `1px solid ${filter === t ? 'var(--border-glass)' : 'transparent'}`,
                borderRadius: 'var(--card-radius)',
                padding: '2px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: filter === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                textTransform: 'capitalize',
                backdropFilter: filter === t ? 'blur(12px)' : 'none',
                boxShadow: filter === t ? 'var(--glass-shadow)' : 'none',
                transition: `all var(--transition-speed) ease`,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
        {filtered.map((a) => (
          <ActivityCard key={a.id} activity={a} />
        ))}
      </div>
    </aside>
  );
}
