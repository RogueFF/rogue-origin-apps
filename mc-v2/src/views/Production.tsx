import { useScoreboard, useDashboard, type ScoreboardRaw } from '../lib/production-api';
import { useQuery } from '@tanstack/react-query';
import { DepthCard } from '../components/DepthCard';

/** Raw scoreboard for hourly breakdown — separate from the normalized hook */
function useScoreboardRaw() {
  return useQuery<ScoreboardRaw>({
    queryKey: ['production', 'scoreboard-raw'],
    queryFn: async () => {
      const res = await fetch('/api/production?action=scoreboard');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function formatBagTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatCell({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.08em',
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{
          fontFamily: 'var(--font-stat)',
          fontSize: 22,
          fontWeight: 700,
          color: accent || 'var(--text-primary)',
          lineHeight: 1,
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'var(--accent-green)' : pct >= 80 ? 'var(--accent-gold)' : 'var(--accent-red)';
  return (
    <div style={{
      width: '100%',
      height: 4,
      borderRadius: 2,
      background: 'rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.min(pct, 100)}%`,
        height: '100%',
        borderRadius: 2,
        background: color,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

export function Production() {
  const { data: scoreboard, isError: sbError } = useScoreboard();
  const { data: raw, isError: rawError } = useScoreboardRaw();
  const { data: dashboard } = useDashboard();

  const prod = scoreboard?.production;
  const sb = raw?.scoreboard;
  const timer = raw?.timer;
  const hourly = sb?.hourlyRates || [];
  const pct = prod?.percentage ?? 0;
  const isLive = !!prod && !sbError;

  return (
    <div style={{ padding: '20px 24px', overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Daily Summary Strip ── */}
      <div style={{ display: 'flex', gap: 10 }}>
        <DepthCard className="liquid-glass" style={{ flex: 2, borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="chromatic" style={{
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: 'var(--text-primary)',
              textTransform: 'uppercase',
            }}>
              Daily Production
            </div>
            {isLive && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--accent-green)',
                letterSpacing: '0.05em',
              }}>
                ● LIVE
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
            <StatCell
              label="Total"
              value={prod?.totalLbs?.toFixed(1) ?? '—'}
              unit="lbs"
              accent={pct >= 100 ? 'var(--accent-green)' : undefined}
            />
            <StatCell label="Goal" value={prod?.goal?.toFixed(0) ?? '—'} unit="lbs" />
            <StatCell
              label="Progress"
              value={pct ? `${pct.toFixed(0)}%` : '—'}
              accent={pct >= 100 ? 'var(--accent-green)' : pct >= 80 ? 'var(--accent-gold)' : 'var(--accent-red)'}
            />
            <StatCell label="Projected" value={prod?.projected?.toFixed(0) ?? '—'} unit="lbs" />
          </div>
          <ProgressBar pct={pct} />
        </DepthCard>

        <DepthCard className="liquid-glass" style={{ flex: 1, borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
          <div className="chromatic" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Crew
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <StatCell label="Trimmers" value={String(prod?.trimmers ?? sb?.currentHourTrimmers ?? '—')} />
            <StatCell label="Buckers" value={String(sb?.currentHourBuckers ?? '—')} />
            <StatCell label="Rate/Trimmer" value={
              prod?.trimmers && prod.trimmers > 0 && prod.rate
                ? (prod.rate / prod.trimmers).toFixed(1)
                : '—'
            } unit="lbs/hr" />
          </div>
        </DepthCard>
      </div>

      {/* ── Bag Timer + Strain ── */}
      <div style={{ display: 'flex', gap: 10 }}>
        <DepthCard className="liquid-glass" style={{ flex: 1, borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
          <div className="chromatic" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Bag Timer
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <StatCell label="Last Bag" value={formatBagTime(timer?.secondsSinceLastBag ?? 0)} accent={
              timer && timer.secondsSinceLastBag > (timer.targetSeconds * 1.5)
                ? 'var(--accent-red)'
                : undefined
            } />
            <StatCell label="Avg Time" value={formatBagTime(timer?.avgSecondsToday ?? 0)} />
            <StatCell label="Bags Today" value={String(timer?.bagsToday ?? prod?.bagCount ?? '—')} />
            <StatCell label="5kg Bags" value={String(timer?.bags5kgToday ?? '—')} />
          </div>
        </DepthCard>

        <DepthCard className="liquid-glass" style={{ flex: 1, borderRadius: 'var(--card-radius)', padding: '16px 18px' }}>
          <div className="chromatic" style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            Strain
          </div>
          <div style={{
            fontFamily: 'var(--font-stat)',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--accent-gold)',
          }}>
            {prod?.strain || sb?.strain || '—'}
          </div>
          {dashboard?.strains && dashboard.strains.length > 1 && (
            <div style={{ marginTop: 8 }}>
              {dashboard.strains.map(s => (
                <div key={s.name} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  padding: '2px 0',
                }}>
                  <span>{s.name}</span>
                  <span>{s.lbs.toFixed(1)} lbs ({s.percentage.toFixed(0)}%)</span>
                </div>
              ))}
            </div>
          )}
        </DepthCard>
      </div>

      {/* ── Hourly Breakdown Table ── */}
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
        <div className="chromatic" style={{
          fontFamily: 'var(--font-display)',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.06em',
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}>
          Hourly Breakdown
        </div>

        {hourly.length === 0 && !rawError ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)', padding: '12px 0' }}>
            No hourly data yet — data appears as production is logged
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Time Slot', 'Lbs', 'Smalls', 'Rate', 'Target', 'vs Target', 'Trimmers', 'Notes'].map(h => (
                  <th key={h} style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    textAlign: h === 'Notes' ? 'left' : 'right',
                    padding: '6px 8px',
                    borderBottom: '1px solid var(--border-subtle)',
                    ...(h === 'Time Slot' ? { textAlign: 'left' as const } : {}),
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hourly.map((row, i) => {
                const vsTarget = row.target > 0 ? ((row.rate / row.target) * 100) : 0;
                const vsColor = vsTarget >= 100 ? 'var(--accent-green)'
                  : vsTarget >= 80 ? 'var(--accent-gold)'
                  : 'var(--accent-red)';
                const isCurrentSlot = row.timeSlot === sb?.currentTimeSlot;

                return (
                  <tr key={i} style={{
                    background: isCurrentSlot ? 'rgba(0,255,136,0.04)' : 'transparent',
                  }}>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: isCurrentSlot ? 'var(--accent-green)' : 'var(--text-secondary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      whiteSpace: 'nowrap',
                    }}>
                      {row.timeSlot}
                      {isCurrentSlot && ' ◂'}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-stat)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {row.lbs.toFixed(1)}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {row.smalls > 0 ? row.smalls.toFixed(1) : '—'}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-stat)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {row.rate.toFixed(1)}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {row.target.toFixed(1)}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 600,
                      color: vsColor,
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {vsTarget > 0 ? `${vsTarget.toFixed(0)}%` : '—'}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {row.trimmers}
                    </td>
                    <td style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      maxWidth: 180,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {row.notes || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
