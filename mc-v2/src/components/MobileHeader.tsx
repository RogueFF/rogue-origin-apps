import { useThemeStore } from '../store/theme';
import { WarClock } from './WarClock';
import type { ConnectionState } from '../lib/gateway-client';

const stateColors: Record<ConnectionState, string> = {
  connected: 'var(--accent-green)',
  connecting: 'var(--accent-gold)',
  reconnecting: 'var(--accent-gold)',
  disconnected: 'var(--accent-red)',
};

export function MobileHeader({ connectionState }: { connectionState: ConnectionState }) {
  const { theme, toggleTheme } = useThemeStore();
  const dotColor = stateColors[connectionState];

  return (
    <header
      style={{
        padding: '12px 16px 8px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        background: 'var(--bg-primary)',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Top row: branding + controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="chromatic"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: '0.15em',
              color: 'var(--text-primary)',
            }}
          >
            ATLAS
          </span>
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 6px ${dotColor}`,
            }}
          />
        </div>
        <button
          onClick={toggleTheme}
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: theme === 'solaris' ? 16 : 'var(--card-radius)',
            padding: '3px 10px',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          {theme === 'relay' ? '◐' : '◑'}
        </button>
      </div>
      {/* Clock strip */}
      <div style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}>
        <WarClock />
      </div>
    </header>
  );
}
