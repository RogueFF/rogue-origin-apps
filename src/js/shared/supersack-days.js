/**
 * Supersacks per day for the analytics page: the salida scan-out merged with
 * the water spider's end-of-day tracker and the hourly production log.
 *
 * Three sources, each trusted for what it actually measures:
 *   scan-out  (harvest sack_out_today)  sacks opened, per cultivar. Ground
 *             truth from 2026-10-13, when the barn started scanning sacks out.
 *   tracker   (supersack history)       raw lb, biomass, trim, waste, and the
 *             sack count for anything not scanned (2025 strains, days before
 *             scan-out). Empty until somebody closes the day.
 *   hourly    (production getProduction) tops and smalls per cultivar, as the
 *             trim room logged them hour by hour.
 *
 * Joins are by crop year AND cultivar, because the floor trims 2025 material
 * during 2026 and those pounds must not land on 2026 sacks. One exception: an
 * hourly line whose year has no sacks that day falls back to the same cultivar
 * of another year when exactly one such cultivar opened sacks (2026-10-30: 2026
 * Lifter sacks, hourly logged as "2025 - Lifter"). That match is flagged.
 *
 * RAW POUNDS. A scanned sack weighs its takedown fill_lbs when it has one (a
 * light last sack), else a full sack for its crop year (35 lb 2026, 37 lb
 * 2025). Raw is what was OPENED that day. A future "leftover lb in open sacks
 * at 4:20" value would make processed = raw - today's leftover + yesterday's;
 * mergeDay takes both (null until that field exists) so nothing here assumes
 * opened = processed.
 *
 * Pure functions, no imports, so tests/supersack-days.test.mjs can load this
 * very file and the page imports it with no build step.
 */

/** First day the barn scanned sacks out at salida. Earlier days are tracker-only. */
export const SCAN_START = '2026-10-13';

/** Fewer sacks than this in the range and a cultivar gets no days-supply or yield projection. */
export const MIN_SACKS_FOR_PREDICTION = 10;

/**
 * Full-sack weight by crop year: 37 lb through 2025, 35 lb from 2026.
 * Mirrors workers/src/lib/sack-weight.js (tests pin the two together).
 */
export function fullSackLbs(season) {
  const y = Number(season);
  return Number.isFinite(y) && y >= 2026 ? 35 : 37;
}

/** "2026 - Sour Lifter / Sungrown / 1st Cut" -> { season: 2026, cultivar: 'Sour Lifter' }. */
export function parseTitle(title) {
  const t = String(title || '').trim();
  const m = t.match(/^\s*(\d{4})\s*[-–]\s*(.*)$/);
  const season = m ? Number(m[1]) : null;
  const rest = m ? m[2] : t;
  const cultivar = rest.split('/')[0].trim();
  return { season, cultivar };
}

const lc = (s) => String(s || '').trim().toLowerCase();
const keyOf = (season, cultivar) => `${season ?? ''}|${lc(cultivar)}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (n) => Math.round(n * 10) / 10;

/** A tracker row whose weights can be used: bio and trim weighed, and the parts not wildly over raw. */
export function trackerWeighed(e) {
  const tops = num(e.tops_lbs), smalls = num(e.smalls_lbs), bio = num(e.biomass_lbs), trim = num(e.trim_lbs), raw = num(e.raw_lbs);
  return bio > 0 && trim > 0 && (tops + smalls + bio + trim) <= raw * 1.3;
}

/** Every calendar day from start to end inclusive, as YYYY-MM-DD. */
export function daysBetween(start, end) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) return out;
  const d = new Date(start + 'T12:00:00Z');
  const last = new Date(end + 'T12:00:00Z');
  while (d <= last && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The days in [start, end] the scan-out can answer for (none before SCAN_START). */
export function scanDays(start, end, scanStart = SCAN_START) {
  return daysBetween(start < scanStart ? scanStart : start, end);
}

/** A finite positive pound value, else null. */
const lbsOrNull = (v) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * Pounds in one scanned sack: its own fill_lbs when the scan payload carries
 * the field, else the takedown weight from `fills` (sack_id -> fill_lbs), else
 * a full sack. Returns { lbs, light }.
 */
export function sackLbs(sack, season, fills = {}) {
  const own = sack && Object.prototype.hasOwnProperty.call(sack, 'fill_lbs') ? lbsOrNull(sack.fill_lbs) : undefined;
  const fill = own !== undefined ? own : lbsOrNull(fills[sack?.sack_id]);
  return fill != null ? { lbs: fill, light: true } : { lbs: fullSackLbs(season), light: false };
}

/** Opened-sack rows (harvest `sacks`) -> { sack_id: fill_lbs } for the light ones. */
export function lbsFillMap(rows) {
  const out = {};
  for (const r of rows || []) { const f = lbsOrNull(r?.fill_lbs); if (r?.sack_id && f != null) out[r.sack_id] = f; }
  return out;
}

/** Hourly rows -> [{ season, cultivar, title, tops, smalls }], one per line per row. */
function hourlyLines(rows) {
  const out = [];
  for (const r of rows || []) {
    for (const n of ['1', '2']) {
      const title = r['cultivar' + n];
      if (!title) continue;
      const tops = num(r['tops' + n]), smalls = num(r['smalls' + n]);
      if (!tops && !smalls) continue;
      out.push({ ...parseTitle(title), title, tops, smalls });
    }
  }
  return out;
}

/**
 * One day, merged.
 *
 * @param date       YYYY-MM-DD
 * @param tracker    supersack history entries for that date
 * @param scan       the sack_out_today payload, or null when not read / before SCAN_START
 * @param hourly     getProduction rows, or null when not read (tracker tops are used instead)
 * @param fills      { sack_id: fill_lbs } for scanned sacks whose payload lacks fill_lbs
 * @param leftover   lb left in open sacks at day end (null: not recorded; no such field yet)
 * @param carriedIn  the previous working day's leftover (null: not recorded)
 * @returns {
 *   date, sacks, raw, processed, leftover, carriedIn, lightSacks, rawEstimated, tops, smalls, biomass, trim, waste, weighed,
 *   topsFrom: 'hourly'|'tracker', scanned, trackerFilled,
 *   cultivars: [{ season, cultivar, sacks, sacksFrom, raw, rawEstimated, tops, smalls,
 *                 biomass, trim, weighed, seasonFallback }],
 *   unmatched: [{ title, tops, smalls }]   hourly pounds with no sacks to land on
 * }
 */
export function mergeDay({ date, tracker = [], scan = null, hourly = null, fills = {}, leftover = null, carriedIn = null }) {
  const groups = new Map();
  const group = (season, cultivar) => {
    const k = keyOf(season, cultivar);
    if (!groups.has(k)) {
      groups.set(k, { season, cultivar, scanSacks: 0, scanLbs: 0, lightSacks: 0, scanned: false, trackerSacks: 0, trackerRaw: 0,
        trackerTops: 0, trackerSmalls: 0, biomass: 0, trim: 0, weighed: false, tracked: false,
        hourlyTops: 0, hourlySmalls: 0, seasonFallback: false });
    }
    return groups.get(k);
  };

  for (const g of (scan?.groups || [])) {
    const n = num(g.sacks_today);
    if (!n) continue;
    const season = num(g.season) || null;
    const x = group(season, g.cultivar);
    x.scanSacks += n; x.scanned = true;
    // Weigh each listed sack; any the payload counts but does not list are full.
    const listed = (g.sacks || []).slice(0, n);
    for (const s of listed) { const w = sackLbs(s, season, fills); x.scanLbs += w.lbs; if (w.light) x.lightSacks++; }
    x.scanLbs += (n - listed.length) * fullSackLbs(season);
  }

  for (const e of tracker) {
    const { season, cultivar } = parseTitle(e.strain);
    const x = group(season, cultivar);
    x.tracked = true;
    x.trackerSacks += num(e.sacks_opened);
    x.trackerRaw += num(e.raw_lbs);
    x.trackerTops += num(e.tops_lbs);
    x.trackerSmalls += num(e.smalls_lbs);
    if (trackerWeighed(e)) { x.weighed = true; x.biomass += num(e.biomass_lbs); x.trim += num(e.trim_lbs); }
  }

  const unmatched = [];
  const haveHourly = Array.isArray(hourly);
  if (haveHourly) {
    for (const l of hourlyLines(hourly)) {
      let x = groups.get(keyOf(l.season, l.cultivar));
      const hasSacks = (g) => g && (g.scanSacks > 0 || g.trackerSacks > 0);
      let fallback = false;
      if (!hasSacks(x)) {
        const same = [...groups.values()].filter(g => lc(g.cultivar) === lc(l.cultivar) && hasSacks(g));
        if (same.length === 1) { x = same[0]; fallback = true; }
      }
      // Pounds with no sacks that day still count toward the day's tops; they
      // land on a zero-sack row of their own and are listed in `unmatched`.
      if (!hasSacks(x)) { unmatched.push({ title: l.title, tops: l.tops, smalls: l.smalls }); x = group(l.season, l.cultivar); }
      x.hourlyTops += l.tops; x.hourlySmalls += l.smalls;
      if (fallback) x.seasonFallback = true;
    }
  }

  const cultivars = [];
  for (const g of groups.values()) {
    const sacks = g.scanned ? g.scanSacks : g.trackerSacks;
    const sacksFrom = g.scanned ? 'scan' : 'tracker';
    // Scanned: the sacks' own weights. Not scanned: the tracker's raw, else
    // sacks x a full sack (flagged as an estimate).
    const trackerRawFits = !g.scanned && g.tracked && g.trackerRaw > 0;
    const raw = g.scanned ? g.scanLbs : trackerRawFits ? g.trackerRaw : sacks * fullSackLbs(g.season);
    const rawEstimated = !g.scanned && !trackerRawFits;
    const tops = haveHourly ? g.hourlyTops : g.trackerTops;
    const smalls = haveHourly ? g.hourlySmalls : g.trackerSmalls;
    if (!sacks && !tops && !smalls) continue;
    cultivars.push({
      season: g.season, cultivar: g.cultivar, sacks, sacksFrom,
      raw: r1(raw), rawEstimated, lightSacks: g.lightSacks,
      tops: r1(tops), smalls: r1(smalls),
      biomass: r1(g.biomass), trim: r1(g.trim), weighed: g.weighed,
      seasonFallback: g.seasonFallback,
    });
  }
  cultivars.sort((a, b) => b.sacks - a.sacks || b.tops - a.tops || a.cultivar.localeCompare(b.cultivar));

  const sum = (k) => r1(cultivars.reduce((n, c) => n + c[k], 0));
  const sacks = cultivars.reduce((n, c) => n + c.sacks, 0);
  const raw = sum('raw'), tops = sum('tops'), smalls = sum('smalls'), biomass = sum('biomass'), trim = sum('trim');
  const weighed = cultivars.some(c => c.weighed);
  const left = lbsOrNull(leftover), carried = lbsOrNull(carriedIn);
  return {
    date, sacks, raw,
    // Opened today, minus what is still in open sacks tonight, plus what last
    // night's open sacks carried in. Equal to raw until leftover is recorded.
    processed: r1(raw - (left || 0) + (carried || 0)), leftover: left, carriedIn: carried,
    lightSacks: cultivars.reduce((n, c) => n + c.lightSacks, 0),
    rawEstimated: cultivars.some(c => c.rawEstimated && c.sacks > 0),
    tops, smalls, biomass, trim,
    // Waste is never weighed: the remainder once tops, smalls, biomass and trim are off raw.
    waste: weighed ? r1(Math.max(0, raw - tops - smalls - biomass - trim)) : null,
    weighed,
    topsFrom: haveHourly ? 'hourly' : 'tracker',
    scanned: cultivars.some(c => c.sacksFrom === 'scan'),
    trackerFilled: tracker.length > 0,
    cultivars,
    unmatched,
  };
}

/**
 * All days in range with anything to show, oldest first.
 * scansByDate / hourlyByDate: { [date]: payload | rows | null }.
 */
export function buildDays({ entries = [], scansByDate = {}, hourlyByDate = {}, fills = {}, leftoverByDate = {} } = {}) {
  const byDate = new Map();
  for (const e of entries) {
    if (!e?.date) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const dates = new Set([...byDate.keys(), ...Object.keys(scansByDate).filter(d => num(scansByDate[d]?.total) > 0)]);
  let prevLeftover = null;
  return [...dates].sort().map(date => {
    const leftover = leftoverByDate[date] ?? null;
    const day = mergeDay({
      date,
      tracker: byDate.get(date) || [],
      scan: scansByDate[date] || null,
      hourly: Object.prototype.hasOwnProperty.call(hourlyByDate, date) ? hourlyByDate[date] : null,
      fills, leftover, carriedIn: prevLeftover,
    });
    prevLeftover = leftover;
    return day;
  }).filter(d => d.sacks > 0 || d.tops > 0);
}

/** Days that opened sacks but have no bio/trim weights yet (not closed), excluding `today`. */
export function unclosedDays(days, today) {
  return days.filter(d => d.sacks > 0 && !d.weighed && d.date !== today).map(d => d.date);
}

/**
 * Per (season, cultivar) totals over the range, for the strain chart and the
 * inventory yield projection. `thin` = too few sacks to trust tops per sack.
 */
export function cultivarTotals(days) {
  const m = new Map();
  for (const d of days) {
    for (const c of d.cultivars) {
      const k = keyOf(c.season, c.cultivar);
      if (!m.has(k)) m.set(k, { season: c.season, cultivar: c.cultivar, sacks: 0, raw: 0, tops: 0, smalls: 0, days: 0 });
      const t = m.get(k);
      t.sacks += c.sacks; t.raw += c.raw; t.tops += c.tops; t.smalls += c.smalls;
      if (c.sacks > 0) t.days += 1;
    }
  }
  return [...m.values()].map(t => ({
    ...t, raw: r1(t.raw), tops: r1(t.tops), smalls: r1(t.smalls),
    topsPerSack: t.sacks > 0 ? t.tops / t.sacks : null,
    smallsPerSack: t.sacks > 0 ? t.smalls / t.sacks : null,
    thin: t.sacks < MIN_SACKS_FOR_PREDICTION,
  })).sort((a, b) => b.sacks - a.sacks);
}

/**
 * The line's pace: sacks opened per working day (a day that opened any), over
 * the range. Null when nothing was opened. Koa, 2026-11-10: days supply is
 * line time, the same rate for every cultivar, not a "run it full-time" rate
 * that made a cultivar mixed into a big day look like it ran 39 sacks a day.
 */
export function lineSacksPerDay(days) {
  const worked = days.filter(d => d.sacks > 0);
  return worked.length ? worked.reduce((n, d) => n + d.sacks, 0) / worked.length : null;
}

/**
 * Projection for one inventory variant (Shopify title + quantity).
 * daysLeft: line time at `lineRate` sacks/day ("<1" for under a day, never 0).
 * topsLbs/smallsLbs: this cultivar's tops/smalls per sack, only from a sample
 * of at least MIN_SACKS_FOR_PREDICTION sacks; otherwise null and `thin`.
 */
export function projectVariant(title, quantity, totals, lineRate) {
  const { season, cultivar } = parseTitle(title);
  const t = totals.find(x => x.season === season && lc(x.cultivar) === lc(cultivar));
  const qty = num(quantity);
  const rate = Number(lineRate) > 0 ? Number(lineRate) : null;
  const yields = t && !t.thin;
  return {
    season, cultivar, quantity: qty,
    daysLeft: rate && qty > 0 ? Math.max(qty / rate, 0.5) : null,
    topsLbs: yields && t.topsPerSack != null ? qty * t.topsPerSack : null,
    smallsLbs: yields && t.smallsPerSack != null ? qty * t.smallsPerSack : null,
    sample: t ? t.sacks : 0,
    thin: !!t && t.thin,
  };
}

/** "7:03 AM – 8:00 AM" -> [423, 480] minutes; null when unreadable. */
export function slotMinutes(slot) {
  const m = String(slot || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)\s*[–—-]\s*(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  const at = (h, mm, ap) => ((Number(h) % 12) + (/p/i.test(ap) ? 12 : 0)) * 60 + Number(mm);
  const start = at(m[1], m[2], m[3]), end = at(m[4], m[5], m[6]);
  return end > start ? [start, end] : null;
}

/**
 * Hours the floor logged that day: the union of the time slots of hourly rows
 * that had crew or output. Union, so a cell row and a line row for the same
 * hour ("7:00 AM – 8:00 AM" and "7:03 AM – 8:00 AM") count once. Null when no
 * row qualifies.
 */
export function loggedHours(rows) {
  const spans = [];
  for (const r of rows || []) {
    const crew = num(r.trimmers1) + num(r.trimmers2) + num(r.buckers1) + num(r.buckers2);
    const out = num(r.tops1) + num(r.tops2) + num(r.smalls1) + num(r.smalls2);
    if (!crew && !out) continue;
    const s = slotMinutes(r.timeSlot);
    if (s) spans.push(s);
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else { total += ce - cs; cs = s; ce = e; }
  }
  total += ce - cs;
  return total / 60;
}

/** Run fn over items with at most `limit` in flight; results in input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
