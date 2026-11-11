/**
 * One cell's day, worked out for the Phase 1 scorecard (Koa 2026-11-11; wiki
 * cell-conversion.md, "Phase 1 run plan"). Pure functions; the reads are in
 * handlers/production/cell-day.js.
 */
import { WORK_DAY } from './work-calendar.js';
import { pacificParts, parseSqliteUtc } from './pacific.js';
import { fullSackLbs } from './sack-weight.js';

const G_PER_LB = 453.59237;
export const START_G = 1.0;          // the cell screen's own start: two steps of the bench scale

/**
 * The breaks the cell's job clock stops for (#159: 9:00-9:10, 12:00-12:30,
 * 2:30-2:40), as Pacific [startMin, endMin). WORK_DAY also has the 4:20 cleanup,
 * which is the end of the day, not a break inside a changeover.
 */
export const CELL_BREAKS = WORK_DAY.breaks.filter(([s]) => s < 16 * 60);

export const msOf = ts => {
  if (!ts) return null;
  const t = parseSqliteUtc(String(ts)).getTime();
  return Number.isFinite(t) ? t : null;
};
const minOfDay = ms => { const p = pacificParts(new Date(ms)); return p.hour * 60 + p.minute + (new Date(ms).getUTCSeconds() / 60); };

/** Milliseconds of [fromMs, toMs) that fall inside a break (same Pacific day). */
export function breakMsIn(fromMs, toMs, breaks = CELL_BREAKS) {
  if (!(toMs > fromMs)) return 0;
  const base = fromMs - minOfDay(fromMs) * 60e3;     // that day's Pacific midnight, as ms
  let ms = 0;
  for (const [s, e] of breaks) {
    const a = Math.max(fromMs, base + s * 60e3), b = Math.min(toMs, base + e * 60e3);
    if (b > a) ms += b - a;
  }
  return ms;
}

/**
 * Changeover: from a job's pickup (the screen's pickup mark) to the next job's
 * first gram of real tops (a surviving rise of START_G or more) or its Start on
 * the queue (cell_jobs.started_at), whichever is first. Breaks don't count. The
 * last pickup of the day has none.
 * @param {Array<{ms:number, jobId?:number}>} pickups  oldest first
 * @param {Array<{ms:number, g:number}>} rises  surviving tops credits, oldest first
 * @param {number[]} starts  queue Start times (ms)
 */
export function changeovers(pickups, rises, starts = [], breaks = CELL_BREAKS) {
  const out = [];
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    const nextPick = i + 1 < pickups.length ? pickups[i + 1].ms : Infinity;
    const gram = rises.find(r => r.ms > p.ms && r.g >= START_G);
    const start = starts.filter(s => s > p.ms).sort((a, b) => a - b)[0];
    const end = Math.min(gram ? gram.ms : Infinity, start ?? Infinity);
    // Nothing more trimmed before the next pickup (or ever): no changeover to time.
    if (!Number.isFinite(end) || end >= nextPick) continue;
    const brk = breakMsIn(p.ms, end, breaks);
    out.push({
      fromMs: p.ms, toMs: end, by: start !== undefined && end === start ? 'start' : 'gram',
      s: Math.round((end - p.ms - brk) / 1000), breakS: Math.round(brk / 1000), jobId: p.jobId ?? null,
    });
  }
  return out;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * scale_episodes rows clipped to [dayFromMs, dayToMs): minutes, breaks out.
 * An episode still open counts to nowMs (or the day's end).
 */
export function episodesInDay(rows, dayFromMs, dayToMs, nowMs, breaks = CELL_BREAKS) {
  const out = [];
  for (const r of rows) {
    const from = msOf(r.from_ts);
    const to = msOf(r.to_ts) ?? Math.min(nowMs, dayToMs);
    const a = Math.max(from, dayFromMs), b = Math.min(to, dayToMs);
    if (from === null || !(b > a)) continue;
    const min = Math.round((b - a - breakMsIn(a, b, breaks)) / 60000);
    out.push({ kind: r.kind, fromMs: a, toMs: msOf(r.to_ts) === null ? null : b, minutes: min, why: r.why ?? null });
  }
  return out;
}

/** Quality batches -> { batches, pass, redo, stop }. A redone batch's fail stays on record. */
export function qualityOf(rows) {
  const scored = rows.filter(b => b.quality);
  return {
    batches: scored.length,
    pass: scored.filter(b => b.quality === 'pass').length,
    redo: scored.filter(b => b.quality === 'fail').length,
    stop: rows.filter(b => b.q_mold === 1 || b.q_insects === 1).length,
  };
}

/**
 * Verified tops per sack (full weigh): tops per 35 lb of raw the cell actually
 * used. Raw in = the sacks ticked to the cell (fill_lbs, or the crop year's full
 * sack) + the leftover it started the day with (carry-in); used = raw in - the
 * leftover weighed at EOD. The fall-through tote is reported beside it, not in it.
 * A day can run on yesterday's leftover alone (a sack lasts about two days at
 * one trimmer), so it only needs raw in from either source.
 * Null until there is raw in and an EOD weigh (no weigh, no verified figure),
 * and when the carry-in is unknown (carryInG null: the cell got raw the shift day
 * before but its leftover was never weighed).
 */
export function verifiedYield({ topsLb, sacksLb, carryInG = 0, eodRawG = null, toteG = null, sackLbs = fullSackLbs(2026) }) {
  const carryKnown = carryInG !== null;
  const carryInLb = carryKnown ? carryInG / G_PER_LB : null;
  const eodRawLb = eodRawG === null ? null : eodRawG / G_PER_LB;
  const rawInLb = carryKnown ? sacksLb + carryInLb : null;
  const usedLb = eodRawLb === null || rawInLb === null ? null : rawInLb - eodRawLb;
  const r2 = x => (x === null ? null : Math.round(x * 100) / 100);
  return {
    sacksLb: r2(sacksLb), carryInLb: r2(carryInLb), carryKnown, rawInLb: r2(rawInLb), eodRawLb: r2(eodRawLb), usedLb: r2(usedLb),
    toteLb: r2(toteG === null ? null : toteG / G_PER_LB),
    topsPerSack: usedLb !== null && usedLb > 0 && rawInLb > 0 ? r2((topsLb * sackLbs) / usedLb) : null,
    sackLbs,
  };
}

/** The shift day before `date` (Mon–Fri; Friday before a Monday). */
export function prevShiftDay(date) {
  const d = new Date(`${date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/**
 * The shift the gap clock runs in, as Pacific minutes: the scale watch's own
 * window (6:00 to the 4:20 cleanup). A NOT RECORDING or offline episode left
 * open overnight (scale switched off at cleanup, nothing recorded after the
 * last job) only counts inside it.
 */
export const SHIFT_MIN = [6 * 60, 16 * 60 + 20];
