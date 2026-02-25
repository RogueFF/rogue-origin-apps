import { useThemeStore } from '../store/theme';
import { WarClock } from './WarClock';
import { NotificationBell } from './NotificationBell';
import type { ConnectionState } from '../lib/gateway-client';

const stateColors: Record<ConnectionState, string> = {
  connected: 'var(--accent-green)',
  connecting: 'var(--accent-gold)',
  reconnecting: 'var(--accent-gold)',
  disconnected: 'var(--accent-red)',
};

const stateLabels: Record<ConnectionState, string> = {
  connected: 'CONNECTED',
  connecting: 'CONNECTING...',
  reconnecting: 'RECONNECTING...',
  disconnected: 'OFFLINE',
};

export function Header({ connectionState }: { connectionState: ConnectionState }) {
  const { theme, toggleTheme } = useThemeStore();
  const dotColor = stateColors[connectionState];

  return (
    <header
      style={{
        height: 48,
        borderBottom: '1px solid var(--border-glass)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(var(--card-blur))',
        WebkitBackdropFilter: 'blur(var(--card-blur))',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="chromatic"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: '0.15em',
            color: 'var(--text-primary)',
          }}
        >
          ATLAS
        </span>
        <div
          className={connectionState === 'connected' ? 'dot-pulse' : ''}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
            transition: 'background 0.3s, box-shadow 0.3s',
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tertiary)' }}>
          MISSION CONTROL v2
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', opacity: 0.6 }}>
          {stateLabels[connectionState]}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <WarClock />
        <span style={{ color: 'var(--border-card)', fontSize: 10 }}>│</span>
        <NotificationBell />
        <span style={{ color: 'var(--border-card)', fontSize: 10 }}>│</span>
        <button
          onClick={toggleTheme}
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: theme === 'solaris' ? 20 : 'var(--card-radius)',
            padding: '4px 12px',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
            transition: `all var(--transition-speed) ease`,
          }}
        >
          {theme === 'relay' ? '◐ Solaris' : '◑ Relay'}
        </button>
        <button
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            borderRadius: theme === 'solaris' ? 20 : 'var(--card-radius)',
            padding: '4px 12px',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ⌘K
        </button>
      </div>
    </header>
  );
}
