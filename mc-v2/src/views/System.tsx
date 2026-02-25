import { useState } from 'react';
import { useGatewayStore } from '../store/gateway';
import { useSystemStats, type SystemStats } from '../lib/system-api';
import { DepthCard } from '../components/DepthCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceInfo {
  name: string;
  status: string;
  pid?: number;
  uptime?: number;
  type?: string;
  count?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMs(ms: number): string {
  return formatUptime(Math.floor(ms / 1000));
}

function statusDot(status: string): { color: string; glow: boolean } {
  switch (status) {
    case 'active':
    case 'running':
    case 'connected':
    case 'online':
      return { color: 'var(--accent-green)', glow: true };
    case 'degraded':
    case 'warning':
      return { color: 'var(--accent-gold)', glow: true };
    case 'error':
    case 'down':
    case 'offline':
      return { color: 'var(--accent-red)', glow: true };
    default:
      return { color: 'var(--text-tertiary)', glow: false };
  }
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
// Gateway Status Bar
// ---------------------------------------------------------------------------

function GatewayStatusBar() {
  const connectionState = useGatewayStore((s) => s.connectionState);
  const uptimeMs = useGatewayStore((s) => s.uptimeMs);
  const serverVersion = useGatewayStore((s) => s.serverVersion);
  const agents = useGatewayStore((s) => s.agents);

  const isConnected = connectionState === 'connected';
  const dot = statusDot(isConnected ? 'connected' : 'offline');

  return (
    <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {/* Connection indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            className={isConnected ? 'dot-pulse' : ''}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dot.color,
              boxShadow: dot.glow ? `0 0 6px ${dot.color}` : 'none',
              flexShrink: 0,
            }}
          />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}>
            {isConnected ? 'Connected' : connectionState === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </span>
        </div>

        {/* Stat pills */}
        {[
          { label: 'Uptime', value: uptimeMs > 0 ? formatMs(uptimeMs) : '—' },
          { label: 'Version', value: serverVersion || '—' },
          { label: 'Agents', value: String(agents.length) },
          { label: 'Port', value: '18789' },
          { label: 'Mode', value: 'local' },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {label}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// Services Panel
// ---------------------------------------------------------------------------

function ServicesPanel({ stats }: { stats?: SystemStats | null }) {
  const raw = stats as Record<string, unknown> | null | undefined;
  const services: ServiceInfo[] = (raw?.services as ServiceInfo[]) || [];

  const [confirmRestart, setConfirmRestart] = useState<string | null>(null);

  return (
    <DepthCard className="liquid-glass" style={{
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
    }}>
      <SectionLabel>Services</SectionLabel>
      {services.length === 0 ? (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          padding: '16px 0',
          textAlign: 'center',
        }}>
          Service data unavailable — waiting for /api/system services field
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {services.map((svc) => {
            const dot = statusDot(svc.status);
            const displayName = svc.type === 'docker' ? `${svc.name} (docker)` : svc.name;
            const countLabel = svc.count != null ? ` (${svc.count})` : '';
            const isConfirming = confirmRestart === svc.name;

            return (
              <div
                key={svc.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'rgba(255,255,255,0.01)',
                }}
              >
                {/* Status dot */}
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dot.color,
                  boxShadow: dot.glow ? `0 0 4px ${dot.color}` : 'none',
                  flexShrink: 0,
                }} />

                {/* Name */}
                <span style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  flex: 1,
                }}>
                  {displayName}{countLabel}
                </span>

                {/* Status */}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  minWidth: 44,
                }}>
                  {svc.status}
                </span>

                {/* Uptime */}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  minWidth: 44,
                  textAlign: 'right',
                }}>
                  {svc.uptime != null ? formatUptime(svc.uptime) : '—'}
                </span>

                {/* Restart button */}
                {isConfirming ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setConfirmRestart(null)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8,
                        color: 'var(--text-tertiary)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      disabled
                      title="Restart endpoint coming soon"
                      style={{
                        background: 'rgba(239,68,68,0.15)',
                        border: '1px solid var(--accent-red)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 8,
                        color: 'var(--accent-red)',
                        cursor: 'not-allowed',
                        opacity: 0.5,
                      }}
                    >
                      Confirm
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRestart(svc.name)}
                    title="Coming soon"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8,
                      color: 'var(--text-tertiary)',
                      cursor: 'pointer',
                      opacity: 0.5,
                    }}
                  >
                    ↻
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// Resource Trends Panel
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
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, fontWeight: 600 }}>
          {value}{max ? ` / ${max}` : ''}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div style={{
        width: '100%',
        height: 6,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`,
          height: '100%',
          borderRadius: 3,
          background: color,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

function ResourceTrends({ stats }: { stats?: SystemStats | null }) {
  if (!stats) {
    return (
      <DepthCard className="liquid-glass" style={{
        borderRadius: 'var(--card-radius)',
        padding: '12px 16px',
      }}>
        <SectionLabel>Resource Trends</SectionLabel>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-tertiary)',
          padding: '16px 0',
          textAlign: 'center',
        }}>
          Waiting for system stats…
        </div>
      </DepthCard>
    );
  }

  const memPct = stats.mem.total > 0 ? (stats.mem.used / stats.mem.total) * 100 : 0;
  const diskPct = stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0;
  const load1m = stats.loadAvg?.[0] ?? 0;
  const loadPct = Math.min((load1m / 8) * 100, 100); // 8-core baseline

  return (
    <DepthCard className="liquid-glass" style={{
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
    }}>
      <SectionLabel>Resource Trends</SectionLabel>

      <ResourceBar
        label="CPU"
        value={`${stats.cpu.toFixed(0)}%`}
        pct={stats.cpu}
      />
      <ResourceBar
        label="RAM"
        value={stats.mem.used.toFixed(1)}
        max={stats.mem.total.toFixed(1)}
        unit="GB"
        pct={memPct}
      />
      <ResourceBar
        label="Disk"
        value={`${stats.disk.used.toFixed(0)}`}
        max={`${stats.disk.total.toFixed(0)}`}
        unit="GB"
        pct={diskPct}
      />
      <ResourceBar
        label="Load"
        value={load1m.toFixed(2)}
        pct={loadPct}
      />

      {/* Current values summary */}
      <div style={{
        marginTop: 6,
        padding: '8px 0 0',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        {[
          { label: 'CPU', value: `${stats.cpu.toFixed(0)}%` },
          { label: 'RAM', value: `${stats.mem.used.toFixed(1)}GB` },
          { label: 'Disk', value: `${stats.disk.total.toFixed(0)}GB` },
          { label: 'Load', value: load1m.toFixed(2) },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
            }}>
              {label}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// Error Log
// ---------------------------------------------------------------------------

function ErrorLog() {
  const notifications = useGatewayStore((s) => s.notifications);

  // Filter to errors/warnings
  const errorEntries = notifications.filter((n) => {
    if (n.type === 'alert') return true;
    const text = `${n.title} ${n.body}`.toLowerCase();
    return /error|fail|warning|critical|violation/.test(text);
  }).slice(0, 50);

  return (
    <DepthCard className="liquid-glass" style={{
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
    }}>
      <SectionLabel>Error Log</SectionLabel>
      {errorEntries.length === 0 ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '24px 0',
        }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent-green)',
            boxShadow: '0 0 6px var(--accent-green)',
          }} />
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--accent-green)',
          }}>
            No recent errors — all systems nominal
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {errorEntries.map((entry) => {
            const isError = entry.type === 'alert' || /error|fail|critical/.test(`${entry.title} ${entry.body}`.toLowerCase());
            const entryColor = isError ? 'var(--accent-red)' : 'var(--accent-gold)';

            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '5px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: `2px solid ${entryColor}`,
                  paddingLeft: 8,
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                  minWidth: 36,
                }}>
                  {entry.timestamp}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 700,
                  color: entryColor,
                  flexShrink: 0,
                  minWidth: 48,
                }}>
                  {isError ? 'ERROR' : 'WARN'}
                </span>
                <span style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {entry.title ? `${entry.title}: ` : ''}{entry.body}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// Network Panel
// ---------------------------------------------------------------------------

function NetworkPanel() {
  const connectionState = useGatewayStore((s) => s.connectionState);
  const isConnected = connectionState === 'connected';

  const networkItems = [
    { label: 'Tailscale', value: 'online', status: 'active' as const },
    { label: 'Hostname', value: 'fern', status: 'info' as const },
    { label: 'Tailnet IP', value: '100.65.60.42', status: 'info' as const },
  ];

  const funnelRoutes = [
    { port: ':443', target: 'gateway' },
    { port: ':3333', target: 'mc-v2' },
  ];

  const channels = [
    { name: 'WhatsApp', status: isConnected ? 'connected' : 'unknown' },
    { name: 'Telegram', status: isConnected ? 'connected' : 'unknown' },
    { name: 'Gateway WS', status: isConnected ? 'connected' : 'disconnected' },
  ];

  return (
    <DepthCard className="liquid-glass" style={{
      borderRadius: 'var(--card-radius)',
      padding: '12px 16px',
      flex: 1,
      minHeight: 0,
    }}>
      <SectionLabel>Network</SectionLabel>

      {/* Tailscale info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {networkItems.map(({ label, value, status }) => {
          const dot = status === 'active' ? statusDot('active') : { color: 'transparent', glow: false };
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status === 'active' && (
                <div style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: dot.color,
                  boxShadow: dot.glow ? `0 0 4px ${dot.color}` : 'none',
                  flexShrink: 0,
                }} />
              )}
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                minWidth: 64,
              }}>
                {label}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                fontWeight: 500,
              }}>
                {value}
              </span>
            </div>
          );
        })}
      </div>

      {/* Funnel routes */}
      <div style={{
        padding: '8px 0',
        borderTop: '1px solid var(--border-subtle)',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 10,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Funnel
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {funnelRoutes.map(({ port, target }) => (
            <div key={port} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--accent-green)',
                fontWeight: 600,
              }}>
                {port}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-tertiary)',
              }}>
                →
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-primary)',
              }}>
                {target}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Channel status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {channels.map(({ name, status }) => {
          const dot = statusDot(status === 'connected' ? 'active' : status === 'disconnected' ? 'down' : 'unknown');
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: dot.color,
                boxShadow: dot.glow ? `0 0 4px ${dot.color}` : 'none',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-primary)',
              }}>
                {name}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: status === 'connected' ? 'var(--accent-green)' : status === 'disconnected' ? 'var(--accent-red)' : 'var(--text-tertiary)',
                textTransform: 'uppercase',
                marginLeft: 'auto',
              }}>
                {status}
              </span>
            </div>
          );
        })}
      </div>
    </DepthCard>
  );
}

// ---------------------------------------------------------------------------
// System View
// ---------------------------------------------------------------------------

export function System() {
  const { data: systemStats } = useSystemStats();

  return (
    <div style={{
      padding: '16px 20px',
      overflow: 'auto',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Gateway Status Bar */}
      <GatewayStatusBar />

      {/* Two-column layout */}
      <div data-two-col="" style={{
        display: 'flex',
        gap: 12,
        flex: 1,
        minHeight: 0,
      }}>
        {/* Left: Services + Error Log */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
        }}>
          <ServicesPanel stats={systemStats} />
          <ErrorLog />
        </div>

        {/* Right: Resources + Network */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
        }}>
          <ResourceTrends stats={systemStats} />
          <NetworkPanel />
        </div>
      </div>
    </div>
  );
}
