import { useGatewayStore } from '../store/gateway';
import { AGENT_GLYPHS } from '../data/mock';

export function MobileFleet() {
  const agents = useGatewayStore((s) => s.agents);

  return (
    <div style={{ padding: '16px', overflow: 'auto', height: '100%' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.12em',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        Agent Fleet
      </div>
      {agents.map((agent) => (
        <div
          key={agent.id}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--card-radius)',
            padding: '14px 16px',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: 24,
              color: agent.status === 'offline' ? 'var(--text-tertiary)' : agent.color,
              textShadow: agent.status === 'running' ? `0 0 10px ${agent.color}` : 'none',
              fontFamily: 'serif',
              width: 32,
              textAlign: 'center',
            }}
          >
            {AGENT_GLYPHS[agent.id] || '◆'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {agent.name}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: agent.status === 'offline' ? 'var(--text-tertiary)' :
                         agent.status === 'running' ? 'var(--accent-green)' : 'var(--text-secondary)',
                  textTransform: 'uppercase',
                }}
              >
                {agent.status}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              {agent.task}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {agent.lastActivity}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
