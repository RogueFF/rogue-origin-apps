/**
 * Pacific-time helpers for the harvest hourly log.
 *
 * Same approach as harvest-d1.js: let Intl carry the DST rules rather than an
 * offset that is right for half of harvest and wrong for the other half — the
 * season runs across the November change. Duplicated here (four lines) rather
 * than exported from the 4,800-line handler, so the pure libs stay importable
 * in tests without dragging Shopify and R2 code along.
 */
export const HARVEST_TZ = 'America/Los_Angeles';

/** The civil date in Pacific, 'YYYY-MM-DD'. */
export function pacificDay(date) {
  return date.toLocaleDateString('en-CA', { timeZone: HARVEST_TZ });
}

/** { day, hour, minute } of the Pacific wall clock at the given instant. */
export function pacificParts(date) {
  // 'sv-SE' formats as "YYYY-MM-DD HH:MM:SS"
  const s = date.toLocaleString('sv-SE', { timeZone: HARVEST_TZ });
  return { day: s.slice(0, 10), hour: Number(s.slice(11, 13)), minute: Number(s.slice(14, 16)) };
}

/**
 * The hour that just ended, as the barn labels it. At 10:07 Pacific that is
 * { harvest_date: today, hour_start: '09:00' }. Null during the 00:xx hour —
 * the hour that ended belongs to yesterday and nobody is hanging at midnight.
 */
export function justEndedHour(date) {
  const p = pacificParts(date);
  if (p.hour === 0) return null;
  return { harvest_date: p.day, hour_start: String(p.hour - 1).padStart(2, '0') + ':00' };
}

/** SQLite's own timestamp text, "YYYY-MM-DD HH:MM:SS", always UTC. */
export function sqliteUtc(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function parseSqliteUtc(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z');
}
