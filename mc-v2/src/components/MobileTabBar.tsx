import { NavLink } from 'react-router-dom';

const tabs = [
  { path: '/', icon: '◆', label: 'Dash' },
  { path: '/fleet', icon: '⬡', label: 'Fleet' },
  { path: '/feed', icon: '▤', label: 'Feed' },
  { path: '/tasks', icon: '☐', label: 'Tasks' },
  { path: '/system', icon: '⚙', label: 'More' },
];

export function MobileTabBar() {
  return (
    <nav
      style={{
        display: 'flex',
        borderTop: '1px solid var(--border-card)',
        background: 'var(--bg-primary)',
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
        position: 'relative',
        zIndex: 20,
      }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          style={({ isActive }) => ({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '10px 0 8px',
            textDecoration: 'none',
            color: isActive ? 'var(--accent-gold)' : 'var(--text-tertiary)',
            transition: 'color 0.2s',
          })}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{tab.icon}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.05em' }}>
            {tab.label}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}
