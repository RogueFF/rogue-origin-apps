import { useGatewayStore } from '../store/gateway';
import { useScoreboard } from '../lib/production-api';
import { kpis as fallbackKpis, activities, AGENT_GLYPHS } from '../data/mock';
import type { KPI } from '../data/mock';

function KpiCard({ kpi }: { kpi: KPI }) {
  return (
    <div
      style={{
        minWidth: 130,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--card-radius)',
        padding: '14px 16px',
        flexShrink: 0,
        scrollSnapAlign: 'start',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.08em',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {kpi.label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          style={{
            fontFamily: 'var(--font-stat)',
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {kpi.value}
        </span>
        {kpi.unit && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
            {kpi.unit}
          </span>
        )}
      </div>
    </div>
  );
}

export function MobileDashboard() {
  const agents = useGatewayStore((s) => s.agents);
  const notifications = useGatewayStore((s) => s.notifications);
  const { data: scoreboard, isError } = useScoreboard();

  const prod = scoreboard?.production;
  const kpis: KPI[] = prod && !isError
    ? [
        { label: "Today's Lbs", value: prod.totalLbs?.toFixed(1) ?? '—', unit: 'lbs', trend: 'up' },
        { label: 'Rate', value: prod.rate?.toFixed(1) ?? '—', unit: prod.rateUnit || 'lbs/hr', trend: 'up' },
        { label: 'Crew', value: String(prod.crew ?? 0), trend: 'flat' },
        { label: 'Agents', value: `${agents.filter(a => a.status !== 'offline').length}/5`, trend: 'flat' },
        { label: 'Strain', value: prod.strain || '—' },
        { label: 'Bags', value: String(prod.bagCount || 0) },
      ]
    : fallbackKpis;

  // Use live notifications or mock activities
  const feed = notifications.length > 0
    ? notifications.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, timestamp: n.timestamp }))
    : activities.map(a => ({ id: a.id, type: a.type, title: a.title, body: a.body, timestamp: a.timestamp }));

  return (
    <div style={{ height: '100%', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {/* KPI horizontal scroll */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '16px 16px 12px',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Agent pills */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '0 16px 16px',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {agents.map((agent) => (
          <div
            key={agent.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              borderRadius: 20,
              padding: '6px 12px 6px 8px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 14,
                color: agent.status === 'offline' ? 'var(--text-tertiary)' : agent.color,
                textShadow: agent.status === 'running' ? `0 0 6px ${agent.color}` : 'none',
                fontFamily: 'serif',
              }}
            >
              {AGENT_GLYPHS[agent.id] || '◆'}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: 600,
                color: agent.status === 'offline' ? 'var(--text-tertiary)' : 'var(--text-primary)',
              }}
            >
              {agent.name}
            </span>
          </div>
        ))}
      </div>

      {/* Activity feed — terminal style */}
      <div style={{ padding: '0 16px 24px' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Activity
        </div>
        {feed.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '10px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {item.title}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                }}
              >
                {item.timestamp}
              </span>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
