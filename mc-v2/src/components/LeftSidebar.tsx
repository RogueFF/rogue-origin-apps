import { NavLink } from 'react-router-dom';
import { useGatewayStore } from '../store/gateway';
import { useChatStore } from '../store/chat';
import { navItems, upcomingCrons as fallbackCrons, AGENT_GLYPHS } from '../data/mock';

export function LeftSidebar() {
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const agents = useGatewayStore((s) => s.agents);
  const crons = useGatewayStore((s) => s.crons);
  const connectionState = useGatewayStore((s) => s.connectionState);

  // Use live crons if available, fall back to mock
  const displayCrons = crons.length > 0
    ? crons.filter(c => c.enabled).slice(0, 5).map(c => ({
        label: c.name || 'Job',
        time: typeof c.nextRun === 'string' ? c.nextRun.slice(11, 16) : '—',
        agent: '',
      }))
    : fallbackCrons;

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        borderRight: '1px solid var(--border-glass)',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(var(--card-blur))',
        WebkitBackdropFilter: 'blur(var(--card-blur))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        zIndex: 5,
      }}
    >
      {/* Fleet Status */}
      <div style={{ padding: '16px 14px 8px' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 10,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Fleet Status</span>
          {connectionState === 'connected' && (
            <span style={{ color: 'var(--accent-green)', fontSize: 8 }}>● LIVE</span>
          )}
        </div>
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgent(agent.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 8px',
              marginBottom: 2,
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--card-radius)',
              cursor: 'pointer',
              transition: `background var(--transition-speed) ease`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span
              className={agent.status === 'running' ? 'dot-pulse' : ''}
              style={{
                fontSize: 14,
                lineHeight: 1,
                color: agent.status === 'offline' ? 'var(--text-tertiary)' : agent.color,
                textShadow: agent.status === 'running' ? `0 0 8px ${agent.color}` : 'none',
                flexShrink: 0,
                width: 18,
                textAlign: 'center',
                fontFamily: 'serif',
                transition: 'color 0.3s, text-shadow 0.3s',
              }}
            >
              {AGENT_GLYPHS[agent.id] || '◆'}
            </span>
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: agent.status === 'offline' ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  lineHeight: 1.2,
                }}
              >
                {agent.name}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {agent.task}
              </div>
            </div>
            <span style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}>
              {agent.lastActivity}
            </span>
          </button>
        ))}
      </div>

      {/* Navigation */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-subtle)' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Navigation
        </div>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 8px',
              marginBottom: 1,
              borderRadius: 'var(--card-radius)',
              textDecoration: 'none',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              transition: `all var(--transition-speed) ease`,
            })}
          >
            <span style={{ fontSize: 10, opacity: 0.6, width: 14, textAlign: 'center' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Upcoming Crons */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-subtle)', marginTop: 'auto' }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Upcoming
        </div>
        {displayCrons.map((cron, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
            }}
          >
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)' }}>
              {cron.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)' }}>
              {cron.time}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
