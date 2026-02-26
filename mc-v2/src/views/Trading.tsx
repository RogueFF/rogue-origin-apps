import { useState } from 'react';
import { useRegime, usePortfolio, useMarketNews, type RegimeData, type PortfolioData, type NewsItem } from '../lib/mc-api';
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

function PositionDetail({ pos }: { pos: PortfolioData['positions'][0] }) {
  const pnlColor = (pos.current_pnl ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  const multiplier = pos.vehicle === 'shares' ? 1 : 100;
  const cost = pos.entry_price * pos.quantity * multiplier;
  const dteMs = new Date(pos.expiry).getTime() - Date.now();
  const dte = Math.max(0, Math.ceil(dteMs / (1000 * 60 * 60 * 24)));

  // Parse thesis from notes (first sentence after the strike info)
  const thesis = pos.notes?.replace(/^\d+\s+[\d/]+\s+x\d+\.\s*/, '') || '—';

  return (
    <div style={{
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid var(--border-subtle)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '6px 16px',
    }}>
      <StatRow label="Entry Price" value={`$${pos.entry_price.toFixed(2)}`} />
      <StatRow label="Quantity" value={`${pos.quantity} × ${multiplier}`} />
      <StatRow label="Cost Basis" value={`$${cost.toFixed(0)}`} />
      <StatRow label="Current P&L" value={`${(pos.current_pnl ?? 0) >= 0 ? '+' : ''}$${(pos.current_pnl ?? 0).toFixed(0)}`} accent={pnlColor} />
      <StatRow label="Target" value={pos.target_price ? `$${pos.target_price.toFixed(2)}` : '—'} accent="var(--accent-green)" />
      <StatRow label="Stop Loss" value={pos.stop_loss ? `$${pos.stop_loss.toFixed(2)}` : '—'} accent="var(--accent-red)" />
      <StatRow label="DTE" value={`${dte}d`} accent={dte <= 5 ? 'var(--accent-red)' : dte <= 10 ? 'var(--accent-gold)' : undefined} />
      <StatRow label="Entry Date" value={pos.entry_date} />
      {pos.current_price != null && (
        <StatRow label="Current Price" value={`$${pos.current_price.toFixed(2)}`} />
      )}
      <div style={{ gridColumn: '1 / -1', paddingTop: 4 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 3 }}>Thesis</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {thesis}
        </div>
      </div>
    </div>
  );
}

function sentimentDot(s: string | null) {
  if (s === 'bullish') return '🟢';
  if (s === 'bearish') return '🔴';
  return '⚪';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NewsSection({ items }: { items: NewsItem[] }) {
  if (!items.length) return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
      No market news available
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((item, i) => (
        <a
          key={i}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '6px 4px',
            borderBottom: '1px solid var(--border-subtle)',
            textDecoration: 'none',
            transition: 'background 0.15s',
            borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 8, marginTop: 2, flexShrink: 0 }}>{sentimentDot(item.sentiment)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
            }}>
              {item.title}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent-green)', fontWeight: 600 }}>
                {item.ticker}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                {item.publisher}
              </span>
              {item.published && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
                  {timeAgo(item.published)}
                </span>
              )}
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

export function Trading() {
  const { data: regimeResp } = useRegime();
  const { data: portfolioResp } = usePortfolio();
  const { data: newsData } = useMarketNews();
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
        <DepthCard className="liquid-glass" style={{ borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
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

        {/* Market News */}
        <DepthCard className="liquid-glass trading-news-card" style={{ borderRadius: 'var(--card-radius)', padding: '16px 18px', flex: 1, overflow: 'auto' }}>
          <SectionLabel>Market News</SectionLabel>
          <NewsSection items={newsData?.items || []} />
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

        {/* Open Positions — Expandable */}
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
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '70px 52px 62px 70px 90px 56px',
                padding: '6px 8px',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                {['Ticker', 'Dir', 'Vehicle', 'Strike', 'Expiry', 'P&L'].map(h => (
                  <span key={h} style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}>
                    {h}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {positions.map((pos) => {
                const isExpanded = expandedId === pos.ticker.charCodeAt(0) * 1000 + pos.strike;
                const rowId = pos.ticker.charCodeAt(0) * 1000 + pos.strike;
                const rowPnl = pos.current_pnl ?? 0;
                const rowPnlColor = rowPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

                return (
                  <div key={rowId}>
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : rowId)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '70px 52px 62px 70px 90px 56px',
                        padding: '7px 8px',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent')}
                    >
                      <span style={{ fontFamily: 'var(--font-stat)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {pos.ticker}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: pos.direction === 'long' ? 'var(--accent-green)' : 'var(--accent-red)', textTransform: 'uppercase' }}>
                        {pos.direction}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                        {pos.vehicle}
                      </span>
                      <span style={{ fontFamily: 'var(--font-stat)', fontSize: 11, color: 'var(--text-primary)' }}>
                        ${pos.strike}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
                        {pos.expiry}
                      </span>
                      <span style={{ fontFamily: 'var(--font-stat)', fontSize: 11, fontWeight: 600, color: rowPnlColor }}>
                        {rowPnl >= 0 ? '+' : ''}${rowPnl.toFixed(0)}
                      </span>
                    </div>
                    {isExpanded && <PositionDetail pos={pos} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
