export interface Agent {
  id: string;
  name: string;
  color: string;
  status: 'online' | 'running' | 'idle' | 'offline';
  task: string;
  lastActivity: string;
  glyph?: string;
}

// Agent identity glyphs (kanji)
export const AGENT_GLYPHS: Record<string, string> = {
  main: '軸',      // axis — orchestrator
  atlas: '軸',
  kiln: '窯',      // kiln — production
  razor: '刃',     // blade — trading
  meridian: '経',  // meridian — logistics
  hex: '呪',       // spell — code
};

export interface KPI {
  label: string;
  value: string;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface Activity {
  id: string;
  type: 'briefing' | 'production' | 'alert' | 'toast';
  title: string;
  body: string;
  timestamp: string;
  accentColor: string;
  acknowledged?: boolean;
}

export const agents: Agent[] = [
  { id: 'atlas', name: 'Atlas', color: '#22c55e', status: 'online', task: 'Orchestrator', lastActivity: '2m ago' },
  { id: 'kiln', name: 'Kiln', color: '#f59e0b', status: 'running', task: 'Hourly pulse check', lastActivity: '1m ago' },
  { id: 'razor', name: 'Razor', color: '#8b5cf6', status: 'idle', task: 'Idle', lastActivity: '14m ago' },
  { id: 'meridian', name: 'Meridian', color: '#3b82f6', status: 'running', task: 'Cannaflora status', lastActivity: '3m ago' },
  { id: 'hex', name: 'Hex', color: '#ef4444', status: 'running', task: 'MC v2 Phase 1', lastActivity: 'now' },
];

export const kpis: KPI[] = [
  { label: "Today's Lbs", value: '47.2', unit: 'lbs', trend: 'up' },
  { label: 'Rate', value: '12.1', unit: 'lbs/hr', trend: 'up' },
  { label: 'Crew', value: '6', trend: 'flat' },
  { label: 'Agents', value: '5/5', trend: 'flat' },
  { label: 'Open Tasks', value: '8', trend: 'down' },
  { label: 'Regime', value: 'Bull' },
];

export const sparklineData = [8.2, 9.1, 10.4, 11.8, 12.1, 11.6, 12.4, 13.1, 12.8, 12.1];

export const activities: Activity[] = [
  {
    id: '1',
    type: 'briefing',
    title: 'Morning Briefing — 0800',
    body: 'DECODED TRANSMISSION // 47.2 lbs processed across 3 strains. Crew of 6 maintaining 12.1 lbs/hr. Cherry Pie lot CP-2026-017 completing final dry cycle. Cannaflora shipment ETA Wednesday.',
    timestamp: '08:00',
    accentColor: 'var(--accent-cyan)',
  },
  {
    id: '2',
    type: 'production',
    title: 'Production Update',
    body: 'Shift 1 complete: 24.8 lbs trimmed. GMO Cookies leading at 9.2 lbs. Rate holding steady at 12.1 lbs/hr.',
    timestamp: '12:30',
    accentColor: 'var(--accent-green)',
  },
  {
    id: '3',
    type: 'alert',
    title: 'Humidity Alert — Dry Room B',
    body: 'RH spiked to 68% in Dry Room B. Target: 58-62%. Check dehumidifier. Auto-alert sent to crew lead.',
    timestamp: '14:15',
    accentColor: 'var(--accent-red)',
  },
  {
    id: '4',
    type: 'toast',
    title: 'Consignment Logged',
    body: '✅ Mountain Farms — 12.4 lbs Tropicana Cookies tops @ $680/lb (intake #247)',
    timestamp: '15:45',
    accentColor: 'var(--accent-gold)',
  },
  {
    id: '5',
    type: 'production',
    title: 'Lot Completion',
    body: 'Cherry Pie lot CP-2026-017 moved to final QA. 18.6 lbs total yield. Samples pulled for testing.',
    timestamp: '16:00',
    accentColor: 'var(--accent-green)',
  },
  {
    id: '6',
    type: 'briefing',
    title: 'Market Intel',
    body: 'Czech wholesale prices firming. Swiss demand steady for indoor tops. Cannaflora confirmed Wednesday delivery slot.',
    timestamp: '10:20',
    accentColor: 'var(--accent-cyan)',
  },
  {
    id: '7',
    type: 'toast',
    title: 'Task Completed',
    body: 'Razor finished order fulfillment analysis. 3 orders ready for Wednesday ship.',
    timestamp: '11:45',
    accentColor: 'var(--accent-gold)',
  },
  {
    id: '8',
    type: 'alert',
    title: 'Agent Reconnect',
    body: 'Razor reconnected after 14min idle. Network timeout on ClickUp sync.',
    timestamp: '13:00',
    accentColor: 'var(--accent-red)',
  },
  {
    id: '9',
    type: 'production',
    title: 'Hourly Pulse',
    body: 'Hour 6: 11.8 lbs/hr (+0.2 from last). Cumulative: 47.2 lbs. On track for 52 lbs daily target.',
    timestamp: '15:00',
    accentColor: 'var(--accent-green)',
  },
  {
    id: '10',
    type: 'toast',
    title: 'Deploy Success',
    body: 'rogue-origin-apps deployed to Cloudflare Pages. Build time: 34s. Zero errors.',
    timestamp: '09:30',
    accentColor: 'var(--accent-gold)',
  },
];

export const navItems = [
  { label: 'Dashboard', path: '/', icon: '◆' },
  { label: 'Production', path: '/production', icon: '▣' },
  { label: 'Trading', path: '/trading', icon: '◈' },
  { label: 'Tasks', path: '/tasks', icon: '☐' },
  { label: 'Monitor', path: '/monitor', icon: '◉' },
  { label: 'System', path: '/system', icon: '⚙' },
];

export const upcomingCrons = [
  { label: 'Hourly Pulse', time: '17:00', agent: 'Kiln' },
  { label: 'Nightly Build', time: '02:00', agent: 'Hex' },
  { label: 'Market Scan', time: '06:00', agent: 'Razor' },
];
