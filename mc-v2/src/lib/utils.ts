/**
 * Shared utility functions — extracted from duplicate implementations
 */

/** Human-readable relative time from timestamp (ms) */
export function timeAgo(ts: number): string {
  const diffS = Math.floor((Date.now() - ts) / 1000);
  if (diffS < 60) return 'now';
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

/** Format seconds into human-readable uptime string */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format milliseconds as uptime */
export function formatMs(ms: number): string {
  return formatUptime(Math.floor(ms / 1000));
}

/** Absolute time string for hover tooltips */
export function absoluteTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
