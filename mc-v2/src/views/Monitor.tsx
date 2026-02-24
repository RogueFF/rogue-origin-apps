import { useState } from 'react';
import { useGatewayStore, type CronJob } from '../store/gateway';
import { useSystemStats, type SystemStats } from '../lib/system-api';
import { DepthCard } from '../components/DepthCard';
import { AGENT_GLYPHS } from '../data/mock';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  main: '#22c55e', atlas: '#22c55e',
  kiln: '#f59e0b',
  razor: '#8b5cf6',
  meridian: '#3b82f6',
  hex: '#ef4444',
};

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'var(--accent-red)';
  if (pct >= 50) return 'var(--accent-gold)';
  return 'var(--accent-green)';
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="chromatic" style={{
      fontFamily: 'var(--font-display)',
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.06em',
      color: 'var(--text-primary)',
      textTransform: 'uppercase',
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceBar — compact progress bar with label
// ---------------------------------------------------------------------------

function ResourceBar({ label, value, max, unit, pct }: {
  label: string;
  value: string;
  max?: string;
  unit?: string;
  pct: number;
}) {
  const color = pctColor(pct);
  return (
    <div style={{ flex: 1, minWidth: 100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color }}>
          {value}{max ? `/${max}` : ''}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`,
          height: '100%',
          borderRadius: 2,
          background: color,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-stat)', fontSize: 13, fontWeight: 700, color: color || 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SystemBar
// ---------------------------------------------------------------------------

function SystemBar({ stats }: { stats?: SystemStats | null }) {
  if (!stats) {
    return (
      <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '12px 16px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          System stats loading...
        </div>
      </DepthCard>
    );
  }

  const memPct = stats.mem.total > 0 ? (stats.mem.used / stats.mem.total) * 100 : 0;
  const diskPct = stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0;
  const memUsedGB = stats.mem.used.toFixed(1);
  const memTotalGB = stats.mem.total.toFixed(1);
  const diskUsedGB = stats.disk.used.toFixed(0);
  const diskTotalGB = stats.disk.total.toFixed(0);
  const load1m = stats.loadAvg?.[0] ?? 0;

  return (
    <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <ResourceBar label="CPU" value={`${stats.cpu.toFixed(0)}%`} pct={stats.cpu} />
        <ResourceBar label="RAM" value={memUsedGB} max={memTotalGB} unit="GB" pct={memPct} />
        <ResourceBar label="Disk" value={diskUsedGB} max={diskTotalGB} unit="GB" pct={diskPct} />
        <StatPill label="Load" value={load1m.toFixed(2)} color={load1m > 4 ? 'var(--accent-red)' : load1m > 2 ? 'var(--accent-gold)' : undefined} />
        <StatPill label="Uptime" value={formatUptime(stats.uptime)} />
        <StatPill label="Procs" value={String(stats.processes?.total ?? '—')} />
        {stats.processes?.node != null && (
          <StatPill label="Node" value={String(stats.processes.node)} />
        )}
      </div>
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// AgentActivityLog
// ---------------------------------------------------------------------------

const FILTER_AGENTS = ['all', 'main', 'kiln', 'razor', 'meridian', 'hex'] as const;
const AGENT_NAMES: Record<string, string> = { main: 'Atlas', kiln: 'Kiln', razor: 'Razor', meridian: 'Meridian', hex: 'Hex' };

function AgentActivityLog() {
  const notifications = useGatewayStore((s) => s.notifications);
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.agentId === filter || n.title?.toLowerCase() === AGENT_NAMES[filter]?.toLowerCase());

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--card-radius)',
      backdropFilter: 'blur(var(--card-blur))',
      boxShadow: 'var(--card-shadow)',
      overflow: 'hidden',
    }}>
      {/* Header + filter pills */}
      <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <SectionLabel>Agent Activity</SectionLabel>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTER_AGENTS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: `1px solid ${filter === f ? 'var(--border-glass)' : 'transparent'}`,
                borderRadius: 6,
                padding: '3px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: f === 'all' ? (filter === f ? 'var(--text-primary)' : 'var(--text-tertiary)')
                  : AGENT_COLORS[f] || 'var(--text-secondary)',
                cursor: 'pointer',
                opacity: filter === f ? 1 : 0.7,
                transition: 'all 150ms',
                textTransform: 'capitalize',
              }}
            >
              {f === 'all' ? 'All' : (AGENT_GLYPHS[f] || '') + ' ' + (AGENT_NAMES[f] || f)}
            </button>
          ))}
        </div>
      </div>

      {/* Activity entries */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 16px' }}>
        {filtered.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '16px 0', textAlign: 'center' }}>
            No activity{filter !== 'all' ? ` for ${AGENT_NAMES[filter] || filter}` : ''} yet
          </div>
        ) : (
          filtered.slice(0, 100).map(n => {
            const agentColor = n.accentColor || AGENT_COLORS[n.agentId || ''] || 'var(--text-tertiary)';
            return (
              <div
                key={n.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: `2px solid ${agentColor}`,
                  paddingLeft: 8,
                  marginLeft: -2,
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                  minWidth: 36,
                }}>
                  {n.timestamp}
                </span>
                <span style={{
                  fontSize: 11,
                  flexShrink: 0,
                  width: 14,
                  textAlign: 'center',
                }}>
                  {AGENT_GLYPHS[n.agentId || ''] || '◆'}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: agentColor,
                  fontWeight: 600,
                  flexShrink: 0,
                  minWidth: 48,
                }}>
                  {n.title}
                </span>
                <span style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {n.body}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CronDashboard
// ---------------------------------------------------------------------------

function cronScheduleLabel(job: CronJob): string {
  const sched = job.schedule as Record<string, unknown>;
  if (sched?.kind === 'cron') return String(sched.expr || '');
  if (sched?.kind === 'every') {
    const ms = sched.everyMs as number;
    if (ms >= 3600000) return `every ${(ms / 3600000).toFixed(0)}h`;
    if (ms >= 60000) return `every ${(ms / 60000).toFixed(0)}m`;
    return `every ${(ms / 1000).toFixed(0)}s`;
  }
  if (sched?.kind === 'at') return `at ${String(sched.at || '').slice(0, 16)}`;
  return '—';
}

function CronDashboard() {
  const crons = useGatewayStore((s) => s.crons);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Sort: enabled first, then by name
  const sorted = [...crons].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
      backdropFilter: 'blur(var(--card-blur))',
      boxShadow: 'var(--card-shadow)',
      overflow: 'auto',
      maxHeight: 280,
    }}>
      <SectionLabel>Cron Jobs</SectionLabel>
      {sorted.length === 0 ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
          No cron jobs loaded
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['', 'Job', 'Schedule', 'Next Run'].map(h => (
                <th key={h} style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  fontWeight: 600,
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  textAlign: 'left',
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(job => {
              const isExpanded = expandedJob === job.id;
              const nextRun = job.nextRun ? timeAgo(new Date(job.nextRun).getTime()) : '—';
              return (
                <>
                  <tr
                    key={job.id}
                    onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                    style={{
                      cursor: 'pointer',
                      opacity: job.enabled ? 1 : 0.4,
                      background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                    onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '5px 6px', borderBottom: '1px solid var(--border-subtle)', width: 16 }}>
                      <div style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: !job.enabled ? 'var(--text-tertiary)' : 'var(--accent-green)',
                        boxShadow: job.enabled ? '0 0 4px var(--accent-green)' : 'none',
                      }} />
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      padding: '5px 6px',
                      borderBottom: '1px solid var(--border-subtle)',
                      textDecoration: job.enabled ? 'none' : 'line-through',
                    }}>
                      {job.name || job.id.slice(0, 12)}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-secondary)',
                      padding: '5px 6px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {cronScheduleLabel(job)}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      padding: '5px 6px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {nextRun}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${job.id}-detail`}>
                      <td colSpan={4} style={{
                        padding: '6px 6px 6px 28px',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: 'rgba(255,255,255,0.01)',
                      }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                          <div>ID: {job.id}</div>
                          <div>Enabled: {job.enabled ? 'yes' : 'no'}</div>
                          <div style={{ marginTop: 4, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                            Run history will be wired in next iteration
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HealthCards
// ---------------------------------------------------------------------------

function healthDots(score: number) {
  const filled = Math.min(5, Math.max(0, Math.round(score / 20)));
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} style={{
      color: i < filled ? 'var(--accent-green)' : 'var(--text-tertiary)',
      fontSize: 10,
    }}>
      {i < filled ? '●' : '○'}
    </span>
  ));
}

function HealthCards() {
  const agents = useGatewayStore((s) => s.agents);

  const healthScore = (status: string): number => {
    switch (status) {
      case 'running': return 100;
      case 'online': return 80;
      case 'idle': return 60;
      default: return 20;
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
      backdropFilter: 'blur(var(--card-blur))',
      boxShadow: 'var(--card-shadow)',
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
    }}>
      <SectionLabel>Agent Health</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {agents.map(agent => {
          const score = healthScore(agent.status);
          const agentColor = AGENT_COLORS[agent.id] || 'var(--text-secondary)';
          return (
            <div
              key={agent.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'rgba(255,255,255,0.01)',
              }}
            >
              {/* Glyph + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                <span style={{ fontSize: 14 }}>{AGENT_GLYPHS[agent.id] || '◆'}</span>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  fontWeight: 700,
                  color: agentColor,
                }}>
                  {agent.name}
                </span>
              </div>

              {/* Health dots */}
              <div style={{ display: 'flex', gap: 2, minWidth: 60 }}>
                {healthDots(score)}
              </div>

              {/* Status */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                flex: 1,
              }}>
                <div
                  className={agent.status === 'running' ? 'dot-pulse' : ''}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: agent.status === 'offline' ? 'var(--text-tertiary)'
                      : agent.status === 'running' ? 'var(--accent-green)'
                      : 'var(--text-secondary)',
                    boxShadow: agent.status === 'running' ? '0 0 4px var(--accent-green)' : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                }}>
                  {agent.status}
                </span>
              </div>

              {/* Last activity */}
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-tertiary)',
                flexShrink: 0,
              }}>
                {agent.lastActivity}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitor View
// ---------------------------------------------------------------------------

export function Monitor() {
  const { data: systemStats } = useSystemStats();

  return (
    <div style={{ padding: '16px 20px', overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── System Bar ── */}
      <SystemBar stats={systemStats} />

      {/* ── Two-column layout ── */}
      <div data-two-col="" style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>

        {/* Left: Agent Activity Log */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <AgentActivityLog />
        </div>

        {/* Right: Cron Dashboard + Health Cards */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <CronDashboard />
          <HealthCards />
        </div>
      </div>
    </div>
  );
}
