/**
 * Application constants — polling intervals, agent config, glyphs
 */

// ---------------------------------------------------------------------------
// Polling Intervals (ms)
// ---------------------------------------------------------------------------

export const POLL_FAST = 10_000;      // System stats
export const POLL_NORMAL = 30_000;    // Sessions, notifications
export const POLL_SLOW = 60_000;      // Production (in-shift), hourly data
export const POLL_IDLE = 300_000;     // Production (off-shift)

// ---------------------------------------------------------------------------
// Agent Identity
// ---------------------------------------------------------------------------

export interface AgentConfig {
  name: string;
  color: string;
  glyph: string;
}

export const AGENT_CONFIG: Record<string, AgentConfig> = {
  main:     { name: 'Atlas',    color: '#22c55e', glyph: '軸' },
  kiln:     { name: 'Kiln',     color: '#f59e0b', glyph: '窯' },
  razor:    { name: 'Razor',    color: '#8b5cf6', glyph: '刃' },
  meridian: { name: 'Meridian', color: '#3b82f6', glyph: '経' },
  hex:      { name: 'Hex',      color: '#ef4444', glyph: '呪' },
};

/** Agent glyphs — indexed by both id and display name */
export const AGENT_GLYPHS: Record<string, string> = {
  main: '軸',
  atlas: '軸',
  kiln: '窯',
  razor: '刃',
  meridian: '経',
  hex: '呪',
};

// ---------------------------------------------------------------------------
// Feed / Notifications
// ---------------------------------------------------------------------------

export const FEED_CACHE_KEY = 'mc-v2:activity-feed';
export const FEED_MAX_ITEMS = 100;
export const CHAT_CACHE_PREFIX = 'mc-v2:chat:';
export const CHAT_MAX_MESSAGES = 200;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: '◆' },
  { label: 'Production', path: '/production', icon: '▣' },
  { label: 'Tasks', path: '/tasks', icon: '☐' },
  { label: 'Monitor', path: '/monitor', icon: '◉' },
  { label: 'System', path: '/system', icon: '⚙' },
];

export const FALLBACK_CRONS = [
  { label: 'Hourly Pulse', time: '17:00', agent: 'Kiln' },
  { label: 'Nightly Build', time: '02:00', agent: 'Hex' },
  { label: 'Morning Report', time: '06:00', agent: 'Kiln' },
];
