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
 * used. Raw in = the sacks ticked to the cell that day (fill_lbs, or the crop
 * year's full sack); used = raw in - the leftover weighed at EOD. There is no
 * carry-in: the leftover goes back each night (Koa 2026-11-11). The fall-through
 * tote is a mass-balance check beside it (accountedPct), never added to tops.
 * Null until there is raw in and an EOD weigh (no weigh, no verified figure).
 */
export function verifiedYield({ topsLb, sacksLb, eodRawG = null, toteG = null, sackLbs = fullSackLbs(2026) }) {
  const eodRawLb = eodRawG === null ? null : eodRawG / G_PER_LB;
  const rawInLb = sacksLb;
  const usedLb = eodRawLb === null ? null : rawInLb - eodRawLb;
  const r2 = x => (x === null ? null : Math.round(x * 100) / 100);
  return {
    sacksLb: r2(sacksLb), rawInLb: r2(rawInLb), eodRawLb: r2(eodRawLb), usedLb: r2(usedLb),
    toteLb: r2(toteG === null ? null : toteG / G_PER_LB),
    topsPerSack: usedLb !== null && usedLb > 0 && rawInLb > 0 ? r2((topsLb * sackLbs) / usedLb) : null,
    // Check line: tops + the fall-through tote, as a % of the raw used.
    accountedPct: usedLb !== null && usedLb > 0 && toteG !== null ? Math.round(((topsLb + toteG / G_PER_LB) / usedLb) * 100) : null,
    sackLbs,
  };
}

/**
 * The cell's working window: from the day's first gram of real tops (or first
 * queue Start) to its last pickup (or last gram). null with nothing trimmed.
 * Person-hours and offline gap minutes both use it (hourly-data session
 * 2026-11-11: a Feather off before anyone sits down, or charging after the last
 * pickup, is not a recording gap).
 */
export function workWindow(rises, pickups, starts = []) {
  const firsts = [...rises.filter(r => r.g >= START_G).map(r => r.ms), ...starts];
  const lasts = [...pickups, ...rises.map(r => r.ms)];
  if (!firsts.length || !lasts.length) return null;
  const a = Math.min(...firsts), b = Math.max(...lasts);
  return b > a ? { fromMs: a, toMs: b } : null;
}

/** Person-hours for a one-trimmer cell (Phase 1): the working window, breaks out. */
export function personHours(rises, pickups, starts = [], people = 1, breaks = CELL_BREAKS) {
  const w = workWindow(rises, pickups, starts);
  if (!w) return null;
  return Math.round(((w.toMs - w.fromMs - breakMsIn(w.fromMs, w.toMs, breaks)) / 3600e3) * people * 100) / 100;
}

/** A day's raw is one cultivar when the main one is at least this share of it. */
export const SINGLE_SHARE = 0.8;

/**
 * The day's cultivar: the sacks the cell used (by lb), else its jobs (by count),
 * with its share. A blend (no cultivar at SINGLE_SHARE) has no single break-even.
 */
export function mainCultivar(sacks, jobs) {
  const w = new Map();
  for (const s of sacks) if (s.cultivar) w.set(s.cultivar, (w.get(s.cultivar) || 0) + s.lbs);
  if (!w.size) for (const j of jobs) if (j.cultivar) w.set(j.cultivar, (w.get(j.cultivar) || 0) + 1);
  const all = [...w.values()].reduce((a, x) => a + x, 0);
  const top = [...w.entries()].sort((x, y) => y[1] - x[1])[0];
  if (!top || !(all > 0)) return { name: null, share: null, mixed: false };
  const share = Math.round((top[1] / all) * 100) / 100;
  return { name: top[0], share, mixed: share < SINGLE_SHARE };
}


/**
 * The shift the gap clock runs in, as Pacific minutes: the scale watch's own
 * window (6:00 to the 4:20 cleanup). A NOT RECORDING or offline episode left
 * open overnight (scale switched off at cleanup, nothing recorded after the
 * last job) only counts inside it.
 */
export const SHIFT_MIN = [6 * 60, 16 * 60 + 20];

/** Lunch only (the half hour), for time between pickups: 10-minute breaks stay in (scorecard design). */
export const LUNCH = CELL_BREAKS.filter(([s, e]) => e - s >= 30);

/**
 * The pickup timeline (Koa 2026-11-11: "timestamped too so we can track how
 * often it was picked up"). One item per round/job, from the screen's pickup
 * marks: at = picked up (the pickup or swap), collectedAt = bag/tag's Collected
 * tap on the board (null: never tapped), startedAt = the round's first gram (the
 * screen's first 'running' after the pickup before it, from cell_screen_log;
 * null when the log has none). Field names match the scorecard's.
 *   sinceLastS: time since the pickup before, lunch out
 *   waitS:      picked up -> Collected
 */
export function pickupTimeline(jobs, screenLog = [], lunch = LUNCH) {
  const running = screenLog.filter(r => r.phase === 'running').map(r => msOf(r.ts)).filter(Boolean).sort((a, b) => a - b);
  const list = [];
  let prev = null;
  for (const j of [...jobs].sort((a, b) => a.at - b.at)) {
    const startedAt = running.find(ms => (prev === null || ms > prev) && ms <= j.at) ?? null;
    const collectedAt = j.collectedAt ?? null;
    list.push({
      at: j.at, g: j.g, collectedAt, startedAt, cultivar: j.cultivar ?? null, bag: j.bag ?? null,
      sinceLastS: prev === null ? null : Math.round((j.at - prev - breakMsIn(prev, j.at, lunch)) / 1000),
      waitS: collectedAt !== null && collectedAt >= j.at ? Math.round((collectedAt - j.at) / 1000) : null,
    });
    prev = j.at;
  }
  const gaps = list.filter(p => p.sinceLastS !== null);
  const waits = list.filter(p => p.waitS !== null);
  const avg = xs => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
  const maxBy = (xs, k) => xs.reduce((m, x) => (m === null || x[k] > m[k] ? x : m), null);
  const longGap = maxBy(gaps, 'sinceLastS'), longWait = maxBy(waits, 'waitS');
  const totalG = Math.round(list.reduce((a, p) => a + p.g, 0) * 100) / 100;
  return {
    list,
    summary: {
      count: list.length, totalG, avgG: list.length ? Math.round((totalG / list.length) * 100) / 100 : null,
      intervalAvgS: avg(gaps.map(p => p.sinceLastS)), intervalMaxS: longGap ? longGap.sinceLastS : null, intervalMaxEndAt: longGap ? longGap.at : null,
      waitAvgS: avg(waits.map(p => p.waitS)), waitMaxS: longWait ? longWait.waitS : null, waitMaxAt: longWait ? longWait.at : null,
      uncollected: list.filter(p => p.collectedAt === null).length,
    },
  };
}

/** A cultivar name as a key: "2026 - Sour Lifter / Sungrown" and "Sour Lifter" are the same raw. */
export const cultivarKey = c => (c ? String(c).replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim().toLowerCase() : '');

/**
 * Verified tops/sack per cultivar (Koa 2026-11-11, Continuous changeovers):
 *   tops(c) x 35 / (c's ticked sack lbs - c's leftover raw)
 * tops(c) = the grams of the rounds (pickup marks) of that cultivar. Leftover raw
 * rows (cell_eod 'raw', 0063) carry their cultivar: changeover weighs and End of
 * day. Only a cultivar's leftover weighed AFTER its last round counts: when the
 * cell comes back to a cultivar (A -> B -> A), A's earlier leftover went back into
 * use. Untagged rows (before 0063) belong to the day's last cultivar. A cultivar
 * is verified once its leftover was weighed after its last round.
 */
export function yieldByCultivar({ jobs, sacks, leftovers, sackLbs: full = fullSackLbs(2026) }) {
  const last = [...jobs].sort((a, b) => a.at - b.at).pop();
  const lastKey = cultivarKey(last && last.cultivar);
  const names = new Map();
  const by = new Map();
  const slot = (c) => {
    const k = cultivarKey(c);
    if (!k) return null;
    if (!names.has(k) || (c && /^\d{4} - /.test(c))) names.set(k, c);
    if (!by.has(k)) by.set(k, { g: 0, sacksLb: 0, lastAt: null, leftoverG: 0, weighed: false });
    return by.get(k);
  };
  for (const j of jobs) { const s = slot(j.cultivar); if (s) { s.g += j.g; s.lastAt = Math.max(s.lastAt ?? 0, j.at); } }
  for (const s of sacks) { const x = slot(s.cultivar); if (x) x.sacksLb += s.lbs; }
  for (const l of leftovers) {
    const x = l.cultivar ? slot(l.cultivar) : lastKey ? by.get(lastKey) : null;
    if (!x || (x.lastAt !== null && l.at < x.lastAt)) continue;   // superseded: the cultivar came back after it
    x.leftoverG += l.g; x.weighed = true;
  }
  return [...by.entries()].map(([k, x]) => {
    const topsLb = Math.round((x.g / G_PER_LB) * 100) / 100;
    const v = verifiedYield({ topsLb, sacksLb: x.sacksLb, eodRawG: x.weighed ? x.leftoverG : null, sackLbs: full });
    return { cultivar: names.get(k), rounds: jobs.filter(j => cultivarKey(j.cultivar) === k).length, topsLb, sacksLb: v.sacksLb, leftoverLb: v.eodRawLb, usedLb: v.usedLb, topsPerSack: v.topsPerSack, verified: v.topsPerSack !== null };
  });
}
