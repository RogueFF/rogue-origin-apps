import { useState } from 'react';
import { useGatewayStore } from '../store/gateway';
import { activities as mockActivities } from '../data/mock';

export function MobileFeed() {
  const notifications = useGatewayStore((s) => s.notifications);
  const [filter, setFilter] = useState('all');

  const feed = notifications.length > 0
    ? notifications.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, timestamp: n.timestamp }))
    : mockActivities.map(a => ({ id: a.id, type: a.type, title: a.title, body: a.body, timestamp: a.timestamp }));

  const types = ['all', 'briefing', 'production', 'alert', 'toast'];
  const filtered = filter === 'all' ? feed : feed.filter(f => f.type === filter);

  return (
    <div style={{ height: '100%', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, padding: '12px 16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {types.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              background: filter === t ? 'var(--bg-card-hover)' : 'transparent',
              border: '1px solid',
              borderColor: filter === t ? 'var(--border-card)' : 'var(--border-subtle)',
              borderRadius: 16,
              padding: '4px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: filter === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              textTransform: 'capitalize',
              flexShrink: 0,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Feed items */}
      <div style={{ padding: '0 16px 24px' }}>
        {filtered.map((item) => (
          <div
            key={item.id}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderLeft: item.type === 'alert' ? '2px solid var(--accent-red)' : '1px solid var(--border-card)',
              borderRadius: 'var(--card-radius)',
              padding: '12px 14px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  color: item.type === 'alert' ? 'var(--accent-red)' : 'var(--text-tertiary)',
                  letterSpacing: '0.08em',
                }}>
                  {item.type.toUpperCase()}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {item.title}
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {item.timestamp}
              </span>
            </div>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              {item.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
