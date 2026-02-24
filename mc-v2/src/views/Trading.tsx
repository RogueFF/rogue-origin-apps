import { useRegime, usePortfolio, type RegimeData, type PortfolioData } from '../lib/mc-api';
import { DepthCard } from '../components/DepthCard';

function regimeColor(signal?: string): string {
  if (signal === 'GREEN') return 'var(--accent-green)';
  if (signal === 'RED') return 'var(--accent-red)';
  if (signal === 'YELLOW') return 'var(--accent-gold)';
  return 'var(--text-secondary)';
}

function regimeBorder(signal?: string): string {
  if (signal === 'GREEN') return 'rgba(0,255,136,0.15)';
  if (signal === 'RED') return 'rgba(255,51,68,0.15)';
  if (signal === 'YELLOW') return 'rgba(228,170,79,0.15)';
  return 'var(--border-card)';
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-stat)', fontSize: 12, fontWeight: 600, color: accent || 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="chromatic" style={{
      fontFamily: 'var(--font-display)',
      fontSize: 12,
      fontWeight: 800,
      letterSpacing: '0.06em',
      color: 'var(--text-primary)',
      textTransform: 'uppercase',
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

export function Trading() {
  const { data: regimeResp } = useRegime();
  const { data: portfolioResp } = usePortfolio();

  const regime = (regimeResp as Record<string, unknown>)?.success
    ? (regimeResp as Record<string, unknown>).data as RegimeData | null
    : null;
  const portfolio = (portfolioResp as Record<string, unknown>)?.success
    ? (portfolioResp as Record<string, unknown>).data as PortfolioData | null
    : null;

  const signal = regime?.signal;
  const color = regimeColor(signal);
  const positions = portfolio?.positions || [];
  const totalPnl = (portfolio?.realized_pnl ?? 0) + (portfolio?.unrealized_pnl ?? 0);
  const pnlColor = totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div style={{ padding: '20px 24px', overflow: 'auto', height: '100%', display: 'flex', gap: 16 }}>

      {/* ── Left Column: Regime + Strategy ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Regime Card */}
        <DepthCard className="liquid-glass" style={{
          borderRadius: 'var(--card-radius)',
          padding: '20px',
          borderColor: regimeBorder(signal),
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <SectionLabel>Market Regime</SectionLabel>
            {regime?.created_at && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                {new Date(regime.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: `${color}18`,
              border: `2px solid ${color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-stat)',
              fontSize: 14,
              fontWeight: 700,
              color,
            }}>
              {signal || '—'}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {regime?.label || 'No regime data'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>SPY</div>
              <div style={{ fontFamily: 'var(--font-stat)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                ${regime?.data?.spy_price?.toFixed(2) ?? '—'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
                {regime?.data?.spy_trend || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>VIX</div>
              <div style={{ fontFamily: 'var(--font-stat)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                {regime?.data?.vix?.toFixed(1) ?? '—'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
                {regime?.data?.vix_level || '—'}
              </div>
            </div>
            {regime?.data?.yield_10y != null && (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 2 }}>10Y</div>
                <div style={{ fontFamily: 'var(--font-stat)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {regime.data.yield_10y.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </DepthCard>

        {/* Strategy Card */}
        <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '16px 18px', flex: 1 }}>
          <SectionLabel>Strategy</SectionLabel>
          {regime?.strategy ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <StatRow label="Position Sizing" value={regime.strategy.position_sizing || '—'} />
              <StatRow label="Strategies" value={regime.strategy.strategies || '—'} />
              <StatRow label="Stops" value={regime.strategy.stops || '—'} />
              <StatRow label="New Entries" value={regime.strategy.new_entries || '—'} />
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
              No strategy data — regime signal required
            </div>
          )}
        </DepthCard>
      </div>

      {/* ── Right Column: Portfolio + Positions ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Portfolio Summary */}
        <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
          <SectionLabel>Portfolio</SectionLabel>
          {portfolio ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <StatRow label="Value" value={`$${portfolio.portfolio_value?.toLocaleString() ?? '—'}`} />
              <StatRow label="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`} accent={pnlColor} />
              <StatRow label="Realized" value={`$${portfolio.realized_pnl?.toFixed(0) ?? '—'}`} />
              <StatRow label="Unrealized" value={`$${portfolio.unrealized_pnl?.toFixed(0) ?? '—'}`} />
              <StatRow label="Win Rate" value={portfolio.win_rate != null ? `${portfolio.win_rate.toFixed(1)}%` : '—'}
                accent={portfolio.win_rate != null && portfolio.win_rate >= 50 ? 'var(--accent-green)' : undefined} />
              <StatRow label="Open Exposure" value={`$${portfolio.open_exposure?.toLocaleString() ?? '—'}`} />
              <StatRow label="Open Positions" value={String(portfolio.open_positions ?? 0)} />
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
              No portfolio data available
            </div>
          )}
        </DepthCard>

        {/* Open Positions Table */}
        <div style={{
          flex: 1,
          minHeight: 0,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--card-radius)',
          padding: '16px 20px',
          backdropFilter: 'blur(var(--card-blur))',
          boxShadow: 'var(--card-shadow)',
          overflow: 'auto',
        }}>
          <SectionLabel>Open Positions</SectionLabel>
          {positions.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
              No open positions
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Ticker', 'Dir', 'Vehicle', 'Strike', 'Expiry', 'Status'].map(h => (
                    <th key={h} style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      fontWeight: 600,
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, i) => (
                  <tr key={i}>
                    <td style={{
                      fontFamily: 'var(--font-stat)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {pos.ticker}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: pos.direction === 'long' ? 'var(--accent-green)' : 'var(--accent-red)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      textTransform: 'uppercase',
                    }}>
                      {pos.direction}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {pos.vehicle}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-stat)',
                      fontSize: 11,
                      color: 'var(--text-primary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      ${pos.strike}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {pos.expiry}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: pos.status === 'open' ? 'var(--accent-green)' : 'var(--text-tertiary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      textTransform: 'uppercase',
                    }}>
                      {pos.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
