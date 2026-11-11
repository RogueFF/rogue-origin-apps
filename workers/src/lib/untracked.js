/**
 * Trimming with no job on the screen (Koa 2026-11-10: "Anything we can do to
 * make sure everything is entered correctly with hard restrictions is what we
 * need"). On 11-10 table1 logged a whole morning of weighings and no job: the
 * hourly tops (from the scale) were fine, but nothing recorded cultivar or time.
 *
 * A cell is "not recording" when its scale is live, its settled net weight rose
 * by RISE_G or more over the last WINDOW_MS, and no job is running on a tablet
 * that is reporting: no report at all, the tablet silent past TABLET_STALE_MS,
 * or the job idle / armed. The Cells board shows it, and the 5-minute cron tells
 * Koa once per episode (scale_stations.untracked_since, migration 0056).
 */
export const RISE_G = 5;                    // a real handful of tops, not scale drift
export const WINDOW_MS = 6 * 60 * 1000;     // a little over one cron period
export const TABLET_STALE_MS = 90 * 1000;   // same as the board's "Tablet off"

const parseUtc = s => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]$/.test(s) ? '' : 'Z')) : null);

/** SQLite UTC text for `ms`, the form scale_events.ts is stored in. */
export const sqliteUtc = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Grams the net rose over the window: the last settled reading minus the lowest
 * on-pan one before it. Lifts (negative) are skipped, so a pickup never counts.
 * @param {Array<{ts:string, weight_kg:number}>} events one station, oldest first
 */
export function riseG(events, now) {
  const onPan = events
    .map(e => ({ at: parseUtc(e.ts), g: e.weight_kg * 1000 }))
    .filter(e => e.at !== null && now - e.at <= WINDOW_MS && e.g >= 0);
  if (onPan.length < 2) return 0;
  const last = onPan[onPan.length - 1].g;
  const low = Math.min(...onPan.slice(0, -1).map(e => e.g));
  return Math.max(0, Math.round((last - low) * 100) / 100);
}

/**
 * Settled weights of the last WINDOW_MS, per station, oldest first. Bounded by
 * id first (scale_events is indexed on station_id, id, not ts): 22 tables log
 * about one row a minute each, so the last 5,000 rows always cover the window.
 * @returns {Promise<Map<string, Array<{ts, weight_kg}>>>}
 */
export async function recentEvents(env, now) {
  let rows = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT station_id, ts, weight_kg FROM scale_events
       WHERE id > (SELECT COALESCE(MAX(id), 0) - 5000 FROM scale_events) AND ts >= ?
       ORDER BY id`
    ).bind(sqliteUtc(now - WINDOW_MS)).all()).results || [];
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) throw e;
  }
  const by = new Map();
  for (const r of rows) (by.get(r.station_id) || by.set(r.station_id, []).get(r.station_id)).push(r);
  return by;
}

/** Is a job being recorded? job = a cell_screen_state row or null. */
export function recording(job, now) {
  if (!job) return false;
  if (now - job.updated_at > TABLET_STALE_MS) return false;
  return job.phase === 'running' || job.phase === 'finished';
}

/**
 * Not recording: live scale, real rise, no running job on a reporting tablet.
 * eod: the lead's End of day panel is open (or just closed, so the window's
 * rises are still in view): those weighs are not trimming (lib/cell-eod.js).
 */
export function notRecording({ scaleLive, events, job, now, eod = false }) {
  if (!scaleLive || eod) return null;
  const g = riseG(events, now);
  if (g < RISE_G || recording(job, now)) return null;
  const why = !job ? 'noScreen' : now - job.updated_at > TABLET_STALE_MS ? 'tabletOff' : 'noJob';
  return { riseG: g, why };
}
