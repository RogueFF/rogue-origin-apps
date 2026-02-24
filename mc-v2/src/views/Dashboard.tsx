import { useGatewayStore } from '../store/gateway';
import { useChatStore } from '../store/chat';
import { useScoreboard } from '../lib/production-api';
import { useRegime, usePortfolio, type RegimeData, type PortfolioData } from '../lib/mc-api';
import { DepthCard } from '../components/DepthCard';
import { AGENT_GLYPHS } from '../data/mock';

// ---------------------------------------------------------------------------
// Skeleton — pulsing placeholder for loading states
// ---------------------------------------------------------------------------

function Skeleton({ width = '100%', height = 16, radius = 4 }: { width?: string | number; height?: number; radius?: number }) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// HourlyChart — mini bar chart for production summary
// ---------------------------------------------------------------------------

interface HourlyBar {
  label: string;
  lbs: number;
  rate: number;
  target: number;
  trimmers: number;
  notes?: string;
}

function HourlyChart({ hours, target }: { hours: HourlyBar[]; target: number }) {
  if (!hours.length) return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '20px 0' }}>
      No hourly data yet
    </div>
  );

  const maxLbs = Math.max(...hours.map(h => h.lbs), target * 1.2);
  const barW = Math.min(40, (320 - hours.length * 4) / hours.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72, padding: '0 2px' }}>
        {hours.map((h, i) => {
          const pct = (h.lbs / maxLbs) * 100;
          const aboveTarget = h.rate >= h.target;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 1 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 7,
                color: aboveTarget ? 'var(--accent-green)' : 'var(--accent-red)',
                fontWeight: 600,
              }}>
                {h.lbs.toFixed(1)}
              </span>
              <div style={{
                width: barW,
                height: `${pct}%`,
                minHeight: 3,
                background: aboveTarget
                  ? 'linear-gradient(180deg, var(--accent-green), rgba(0,255,136,0.3))'
                  : 'linear-gradient(180deg, var(--accent-red), rgba(255,51,68,0.3))',
                borderRadius: '2px 2px 0 0',
                opacity: 0.8,
                transition: 'height 300ms ease',
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
        <div style={{ height: 1, flex: 1, background: 'var(--accent-gold)', opacity: 0.3 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, color: 'var(--accent-gold)', opacity: 0.6 }}>
          target {target.toFixed(1)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, padding: '0 2px' }}>
        {hours.map((h, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 6, color: 'var(--text-tertiary)' }}>
            {h.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'var(--accent-green)' : pct >= 80 ? 'var(--accent-gold)' : 'var(--accent-red)';
  return (
    <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.5s ease' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ children, live }: { children: string; live?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span className="chromatic" style={{
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.06em',
        color: 'var(--text-primary)',
        textTransform: 'uppercase',
      }}>
        {children}
      </span>
      {live && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--accent-green)', letterSpacing: '0.05em' }}>
          ● LIVE
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function Dashboard() {
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const agents = useGatewayStore((s) => s.agents);
  const notifications = useGatewayStore((s) => s.notifications);

  const { data: scoreboard, isError: scoreboardError, isLoading: prodLoading } = useScoreboard();
  const { data: regimeResp, isLoading: regimeLoading } = useRegime();
  const { data: portfolioResp, isLoading: portfolioLoading } = usePortfolio();

  const regime = (regimeResp as Record<string, unknown>)?.success
    ? (regimeResp as Record<string, unknown>).data as RegimeData | null
    : null;
  const portfolio = (portfolioResp as Record<string, unknown>)?.success
    ? (portfolioResp as Record<string, unknown>).data as PortfolioData | null
    : null;

  const prod = scoreboard?.production;
  const isLive = !!prod && !scoreboardError;
  const pct = prod?.percentage ?? 0;

  const regimeColor = regime?.signal === 'GREEN' ? 'var(--accent-green)'
    : regime?.signal === 'RED' ? 'var(--accent-red)'
    : regime?.signal === 'YELLOW' ? 'var(--accent-gold)'
    : 'var(--text-secondary)';

  // Build hourly bars from raw scoreboard data
  const hourlyBars: HourlyBar[] = (scoreboard as unknown as { production: { hourlyRates?: HourlyBar[] } })?.production?.hourlyRates?.map(h => ({
    label: (h as unknown as { timeSlot?: string }).timeSlot?.replace(/ [AP]M/g, '').split('–')[0]?.trim() || '',
    lbs: h.lbs ?? 0,
    rate: h.rate ?? 0,
    target: h.target ?? 0,
    trimmers: h.trimmers ?? 0,
  })) || [];

  // KPI data
  const kpis = [
    { label: "Lbs Today", value: prod?.totalLbs?.toFixed(1), unit: 'lbs', color: pct >= 100 ? 'var(--accent-green)' : undefined, loading: prodLoading },
    { label: 'Rate', value: prod?.rate?.toFixed(1), unit: 'lbs/hr', loading: prodLoading },
    { label: 'Crew', value: prod?.crew != null ? String(prod.crew) : undefined, loading: prodLoading },
    { label: 'Agents', value: `${agents.filter(a => a.status !== 'offline').length}/${agents.length}`, loading: false },
    { label: 'Trades', value: portfolio?.open_positions != null ? String(portfolio.open_positions) : undefined, loading: portfolioLoading },
    { label: 'Regime', value: regime?.signal, color: regimeColor, loading: regimeLoading },
  ];

  return (
    <div style={{ padding: '16px 20px', overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── KPI STRIP ── */}
      <div style={{ display: 'flex', gap: 8 }}>
        {kpis.map((kpi) => (
          <DepthCard
            key={kpi.label}
            className="liquid-glass"
            style={{ flex: 1, borderRadius: 'var(--card-radius)', padding: '10px 12px' }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              letterSpacing: '0.08em',
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              marginBottom: 3,
            }}>
              {kpi.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              {kpi.loading ? (
                <Skeleton width={48} height={20} radius={4} />
              ) : (
                <>
                  <span style={{
                    fontFamily: 'var(--font-stat)',
                    fontSize: 20,
                    fontWeight: 700,
                    color: kpi.color || 'var(--text-primary)',
                    lineHeight: 1,
                  }}>
                    {kpi.value ?? '—'}
                  </span>
                  {kpi.unit && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                      {kpi.unit}
                    </span>
                  )}
                </>
              )}
            </div>
          </DepthCard>
        ))}
      </div>

      {/* ── MAIN TWO-COLUMN GRID ── */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>

        {/* LEFT COLUMN */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Production Summary */}
          <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '14px 16px' }}>
            <SectionLabel live={isLive}>Production</SectionLabel>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
              {[
                { l: 'Total', v: prod?.totalLbs?.toFixed(1) ?? '—', u: 'lbs' },
                { l: 'Goal', v: prod?.goal?.toFixed(0) ?? '—', u: 'lbs' },
                { l: 'Progress', v: pct ? `${pct.toFixed(0)}%` : '—', c: pct >= 100 ? 'var(--accent-green)' : pct >= 80 ? 'var(--accent-gold)' : 'var(--accent-red)' },
                { l: 'Projected', v: prod?.projected?.toFixed(0) ?? '—', u: 'lbs' },
              ].map(s => (
                <div key={s.l}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                    {s.l}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                    <span style={{ fontFamily: 'var(--font-stat)', fontSize: 16, fontWeight: 700, color: s.c || 'var(--text-primary)', lineHeight: 1 }}>
                      {s.v}
                    </span>
                    {s.u && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)' }}>{s.u}</span>}
                  </div>
                </div>
              ))}
            </div>
            <ProgressBar pct={pct} />

            {/* Mini hourly chart */}
            <div style={{ marginTop: 10 }}>
              <HourlyChart hours={hourlyBars} target={prod?.rate ?? 5} />
            </div>
          </DepthCard>

          {/* Regime + Strategy Compact */}
          <DepthCard className="liquid-glass" style={{
            borderRadius: 'var(--card-radius)',
            padding: '14px 16px',
            borderColor: regime?.signal === 'GREEN' ? 'rgba(0,255,136,0.12)' : regime?.signal === 'RED' ? 'rgba(255,51,68,0.12)' : regime?.signal === 'YELLOW' ? 'rgba(228,170,79,0.12)' : undefined,
            flex: 1,
          }}>
            <SectionLabel>Market Regime</SectionLabel>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: `${regimeColor}18`,
                border: `2px solid ${regimeColor}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-stat)',
                fontSize: 11,
                fontWeight: 700,
                color: regimeColor,
                flexShrink: 0,
              }}>
                {regime?.signal || '—'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                  {regime?.label || 'No regime data'}
                </div>
                {regime?.strategy?.strategies && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {regime.strategy.strategies}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 1 }}>SPY</div>
                <span style={{ fontFamily: 'var(--font-stat)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  ${regime?.data?.spy_price?.toFixed(2) ?? '—'}
                </span>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 1 }}>VIX</div>
                <span style={{ fontFamily: 'var(--font-stat)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {regime?.data?.vix?.toFixed(1) ?? '—'}
                </span>
              </div>
              {portfolio && (
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 1 }}>P&L</div>
                  <span style={{
                    fontFamily: 'var(--font-stat)',
                    fontSize: 15,
                    fontWeight: 700,
                    color: (portfolio.realized_pnl + portfolio.unrealized_pnl) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}>
                    {(portfolio.realized_pnl + portfolio.unrealized_pnl) >= 0 ? '+' : ''}${(portfolio.realized_pnl + portfolio.unrealized_pnl).toFixed(0)}
                  </span>
                </div>
              )}
            </div>
          </DepthCard>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Agent Fleet — Compact */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--card-radius)',
            padding: '14px 16px',
            backdropFilter: 'blur(var(--card-blur))',
            boxShadow: 'var(--card-shadow)',
          }}>
            <SectionLabel>Agent Fleet</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-glass-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Status dot */}
                  <div
                    className={agent.status === 'running' ? 'dot-pulse' : ''}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: agent.status === 'offline' ? 'var(--text-tertiary)' : agent.status === 'running' ? 'var(--accent-green)' : 'var(--text-secondary)',
                      boxShadow: agent.status === 'running' ? '0 0 4px var(--accent-green)' : 'none',
                      opacity: agent.status === 'offline' ? 0.4 : 1,
                      flexShrink: 0,
                    }}
                  />
                  {/* Glyph */}
                  <span style={{ fontSize: 12, flexShrink: 0, width: 18, textAlign: 'center' }}>
                    {AGENT_GLYPHS[agent.id] || '◆'}
                  </span>
                  {/* Name */}
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    flexShrink: 0,
                    width: 60,
                  }}>
                    {agent.name}
                  </span>
                  {/* Task */}
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-secondary)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {agent.task || '—'}
                  </span>
                  {/* Time */}
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8,
                    color: 'var(--text-tertiary)',
                    flexShrink: 0,
                  }}>
                    {agent.lastActivity || ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div style={{
            flex: 1,
            minHeight: 0,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--card-radius)',
            padding: '14px 16px',
            backdropFilter: 'blur(var(--card-blur))',
            boxShadow: 'var(--card-shadow)',
            overflow: 'auto',
          }}>
            <SectionLabel>Recent Activity</SectionLabel>
            {notifications.length === 0 ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
                No activity yet — events appear as agents respond
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '5px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{
                    width: 2,
                    height: 12,
                    borderRadius: 1,
                    background: n.accentColor || 'var(--text-tertiary)',
                    opacity: 0.6,
                    flexShrink: 0,
                    marginTop: 2,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8,
                      color: n.accentColor || 'var(--text-tertiary)',
                      marginBottom: 1,
                    }}>
                      {n.title}
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      color: 'var(--text-primary)',
                      fontWeight: 500,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {n.body}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {n.timestamp}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
