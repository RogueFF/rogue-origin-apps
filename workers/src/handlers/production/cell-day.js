/**
 * One cell's day for the Phase 1 scorecard (Koa 2026-11-11: "fully automatic",
 * no paper, no photo). Read only:
 *
 *   GET ?action=cellDay&stationId=table1&date=YYYY-MM-DD   (date defaults to Pacific today)
 *       &raw=1 adds the day's raw record, read-only, for re-working it later:
 *       scale_events (ts, g), every scale_mark, the screen's change log
 *       (cell_screen_log), the End of day rows (windows and weighs, undone ones
 *       too) and the episodes as stored. Times are UTC 'YYYY-MM-DD HH:MM:SS'.
 *
 * Everything comes from what the floor already records: the scale (cell-auto),
 * the hourly log (a typed value wins over the scale, as on the hourly page), the
 * screen's pickup marks (jobs), the queue's Start times, scale_episodes, the
 * quality batches, and the End of day panel (cell_eod, cell_sacks; 0062).
 * Each part reads as empty when its table isn't there yet.
 *
 * Continuous rounds (Koa 2026-11-11): every round is a job. `pickups` is the
 * timeline (picked up, round start, Collected tap, grams; the scorecard's field
 * names) with `pickupSummary` (time between pickups, lunch out; wait at the spot).
 * Changeovers between cultivars carry from/to and the leftover weighed in them,
 * and `yieldByCultivar` works tops/sack out per cultivar from the rounds, the
 * ticked sacks and the leftover-raw rows tagged with their cultivar (0063).
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { pacificDay, pacificParts, sqliteUtc } from '../../lib/pacific.js';
import { TIME_SLOT_MULTIPLIERS } from '../../lib/production-helpers.js';
import { battPct } from '../../lib/battery.js';
import { sackLbs } from '../../lib/sack-weight.js';
import { autoDay, SLOT_MINUTES } from './cell-hourly.js';
import {
  changeovers, median, episodesInDay, qualityOf, verifiedYield, msOf, START_G, SHIFT_MIN, personHours, mainCultivar, workWindow,
  pickupTimeline, yieldByCultivar, cultivarKey,
} from '../../lib/cell-day.js';

const r2 = x => Math.round(x * 100) / 100;
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

async function rows(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such table|no such column/i.test(String(e && e.message))) return [];
    throw e;
  }
}

/** [fromMs, toMs) of a Pacific civil day. */
export function pacificDayMs(date) {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const offH = 12 - pacificParts(new Date(noon)).hour;           // 8 (PST) or 7 (PDT)
  const from = Date.parse(`${date}T00:00:00Z`) + offH * 3600e3;
  return [from, from + 24 * 3600e3];
}

export async function getCellDay(params, env, now = Date.now()) {
  const stationId = typeof params.stationId === 'string' ? params.stationId : '';
  const station = stationId && await env.DB.prepare(
    `SELECT s.station_id, COALESCE(c.label, s.label, s.station_id) AS label FROM scale_stations s
     LEFT JOIN cell_roster c ON c.station_id = s.station_id WHERE s.station_id = ? AND s.kind = 'table'`
  ).bind(stationId).first();
  if (!station) return errorResponse('Unknown table station', 'VALIDATION_ERROR', 400);
  const date = validDate(params.date) ? params.date : pacificDay(new Date(now));
  const [dayFrom, dayTo] = pacificDayMs(date);
  const fromSql = sqliteUtc(new Date(dayFrom)), toSql = sqliteUtc(new Date(dayTo));
  const id = station.station_id;

  const [auto, typed, marks, starts, episodes, quality, eod, sacks, reading, screenLog] = await Promise.all([
    autoDay(env, date, [id]).then(m => m.get(id) || null),
    rows(env.DB.prepare(`SELECT time_slot, tops_lbs, cultivar FROM cell_hourly WHERE production_date = ? AND station_id = ?`).bind(date, id)),
    rows(env.DB.prepare(
      `SELECT * FROM scale_marks
       WHERE station_id = ? AND kind = 'pickup' AND ts >= ? AND ts < ? ORDER BY ts, id`
    ).bind(id, fromSql, toSql)),
    rows(env.DB.prepare(`SELECT started_at FROM cell_jobs WHERE station_id = ? AND started_at >= ? AND started_at < ?`).bind(id, fromSql, toSql)),
    rows(env.DB.prepare(
      `SELECT kind, from_ts, to_ts, why FROM scale_episodes
       WHERE station_id = ? AND from_ts < ? AND (to_ts IS NULL OR to_ts >= ?) ORDER BY from_ts`
    ).bind(id, toSql, fromSql)),
    rows(env.DB.prepare(`SELECT batch_no, quality, q_mold, q_insects FROM cell_quality WHERE production_date = ? AND station_id = ?`).bind(date, id)),
    rows(env.DB.prepare(
      `SELECT * FROM cell_eod WHERE station_id = ? AND production_date = ? AND kind IN ('raw', 'tote') AND undone_at IS NULL ORDER BY ts, id`
    ).bind(id, date)),
    rows(env.DB.prepare(
      `SELECT cs.sack_id, h.season, h.cultivar, h.fill_lbs FROM cell_sacks cs
       LEFT JOIN harvest_sacks h ON h.sack_id = cs.sack_id
       WHERE cs.production_date = ? AND cs.station_id = ? ORDER BY cs.ticked_at`
    ).bind(date, id)),
    rows(env.DB.prepare(`SELECT batt_mv, batt_at, updated_at FROM scale_readings WHERE station_id = ?`).bind(id)),
    // The screen's change log (0062): when each round started trimming.
    rows(env.DB.prepare(`SELECT ts, phase, cultivar FROM cell_screen_log WHERE station_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id`).bind(id, fromSql, toSql)),
  ]);

  // ---- tops by hour: a typed value wins, otherwise the scale's ----
  const typedBy = new Map(typed.map(t => [t.time_slot, t]));
  const p = pacificParts(new Date(now));
  const nowMin = p.hour * 60 + p.minute;
  const hourly = [];
  for (const s of SLOT_MINUTES) {
    const scaleLb = auto && s.slot in auto.bySlot ? auto.bySlot[s.slot] : null;
    const t = typedBy.get(s.slot);
    const typedLb = t && t.tops_lbs != null ? t.tops_lbs : null;
    if (scaleLb === null && typedLb === null) continue;
    hourly.push({
      slot: s.slot, hours: TIME_SLOT_MULTIPLIERS[s.slot] ?? 1,
      lb: typedLb ?? scaleLb, scaleLb, typedLb, source: typedLb !== null ? 'typed' : 'scale',
      final: date < p.day || (date === p.day && nowMin >= s.endMin),
      flag: auto && auto.flags[s.slot] ? auto.flags[s.slot][0] : null,
      cultivar: t ? t.cultivar : null,
    });
  }
  const topsLb = r2(hourly.reduce((a, h) => a + (h.lb || 0), 0));
  const workedH = r2(hourly.filter(h => h.lb > 0).reduce((a, h) => a + h.hours, 0));

  // ---- jobs (the screen's pickup marks) and changeovers ----
  const jobs = marks.filter(m => m.kg > 0).map(m => ({
    at: msOf(m.ts), g: r2(m.kg * 1000), cultivar: m.cultivar, bag: m.bag, cycleS: m.cycle_s, jobId: m.job_id ?? null,
    collectedAt: m.collected_at ? msOf(m.collected_at) : null,
  }));
  const rises = ((auto && auto.rises) || []).map(r => ({ ms: msOf(r.ts), g: r.g }));
  const co = changeovers(jobs.map(j => ({ ms: j.at, jobId: j.jobId })), rises, starts.map(s => msOf(s.started_at)).filter(Boolean));
  const coS = co.map(c => c.s);
  // One trimmer per cell in Phase 1: first gram to last pickup, breaks out.
  const startMs = starts.map(s => msOf(s.started_at)).filter(Boolean);
  const personH = personHours(rises, jobs.map(j => j.at), startMs);
  const work = workWindow(rises, jobs.map(j => j.at), startMs);

  // ---- recording gaps ----
  // NOT RECORDING (a real weight rise with no job) counts anywhere in the shift.
  // Scale offline counts only inside the working window: a Feather off before
  // anyone sits down, or charging after the last pickup, is not a gap. Offline
  // time in the shift but outside the window is listed as `uncounted`, so a
  // scale that died mid-afternoon (and so had no pickups after it) still shows.
  const shiftFrom = dayFrom + SHIFT_MIN[0] * 60e3, shiftTo = dayFrom + SHIFT_MIN[1] * 60e3;
  const nrEps = episodesInDay(episodes.filter(e => e.kind === 'untracked'), shiftFrom, shiftTo, now);
  const offRows = episodes.filter(e => e.kind === 'offline');
  const offEps = work ? episodesInDay(offRows, Math.max(shiftFrom, work.fromMs), Math.min(shiftTo, work.toMs), now) : [];
  const offShift = episodesInDay(offRows, shiftFrom, shiftTo, now);
  const uncounted = offShift
    .map(e => ({ ...e, minutes: e.minutes - offEps.filter(x => x.fromMs < (e.toMs ?? Infinity) && (x.toMs ?? Infinity) > e.fromMs).reduce((a, x) => a + x.minutes, 0) }))
    .filter(e => e.minutes > 0);
  const gap = list => ({ count: list.length, minutes: list.reduce((a, x) => a + x.minutes, 0), episodes: list });

  // ---- End of day, sacks, verified tops/sack ----
  const sum = k => eod.filter(e => e.kind === k).reduce((a, e) => a + e.grams, 0);
  const has = k => eod.some(e => e.kind === k && (k !== 'raw' || (e.reason || 'eod') === 'eod'));
  // Every leftover-raw row comes off the day's raw (changeover weighs too), but the
  // day is only verified once End of day weighed what was left at the end.
  const eodRawG = has('raw') ? r2(sum('raw')) : null;
  const changeoverRawG = r2(eod.filter(e => e.kind === 'raw' && e.reason === 'changeover').reduce((a, e) => a + e.grams, 0));
  const eodToteG = has('tote') ? r2(sum('tote')) : null;
  const sackList = sacks.map(s => ({ sackId: s.sack_id, cultivar: s.cultivar, lbs: sackLbs(s), fillLbs: s.fill_lbs ?? null }));
  const sacksLb = sackList.reduce((a, s) => a + s.lbs, 0);
  // No carry-in: the leftover goes back each night (Koa 2026-11-11).
  const yieldOut = verifiedYield({ topsLb, sacksLb, eodRawG, toteG: eodToteG });

  // ---- per cultivar (Continuous changeovers, 0063) ----
  const leftovers = eod.filter(e => e.kind === 'raw').map(e => ({ cultivar: e.cultivar ?? null, g: e.grams, at: msOf(e.ts), reason: e.reason || 'eod' }));
  const byCultivar = yieldByCultivar({ jobs, sacks: sackList, leftovers });

  // ---- the pickup timeline ----
  const timeline = pickupTimeline(jobs, screenLog);

  // ---- battery: the last End of day weigh's, else (today) the node's latest ----
  const lastEod = [...eod].reverse().find(e => e.batt_mv != null && (e.reason || 'eod') === 'eod');
  const r = reading[0];
  const battery = lastEod
    ? { pct: battPct(lastEod.batt_mv), mv: lastEod.batt_mv, at: msOf(lastEod.ts), from: 'eod' }
    : r && r.batt_mv != null && date === pacificDay(new Date(now))
      ? { pct: battPct(r.batt_mv), mv: r.batt_mv, at: msOf(r.batt_at || r.updated_at), from: 'latest' }
      : null;

  const rawRecord = params.raw === '1' || params.raw === 'true' ? await rawDay(env, id, date, fromSql, toSql, episodes) : undefined;

  const out = {
    stationId: id, label: station.label, date, serverNow: now,
    // A blend (no cultivar at 80% of the raw) has no single break-even: mixed.
    ...(() => { const c = mainCultivar(sackList, jobs); return { cultivar: c.name, cultivarShare: c.share, mixed: c.mixed }; })(),
    tops: {
      lb: topsLb, workedH, perHour: workedH > 0 ? r2(topsLb / workedH) : null,
      personH, perPersonH: personH > 0 ? r2(topsLb / personH) : null, hourly,
    },
    jobs,
    changeovers: {
      // A changeover between cultivars says from/to and the leftover weighed in it.
      list: co.map(c => {
        const i = jobs.findIndex(j => j.at === c.fromMs);
        const from = i >= 0 ? jobs[i].cultivar : null, to = i >= 0 && jobs[i + 1] ? jobs[i + 1].cultivar : null;
        const cultivarChange = !!(from && to && cultivarKey(from) !== cultivarKey(to));
        const weighedG = r2(leftovers.filter(l => l.reason === 'changeover' && l.at >= c.fromMs && l.at <= c.toMs).reduce((a, l) => a + l.g, 0));
        return { ...c, fromCultivar: from, toCultivar: to, cultivarChange, leftoverG: cultivarChange ? weighedG : null };
      }),
      count: co.length, cultivarChanges: 0, medianS: median(coS), maxS: coS.length ? Math.max(...coS) : null, startG: START_G,
    },
    pickups: timeline.list,
    pickupSummary: timeline.summary,
    gaps: {
      offline: { ...gap(offEps), uncounted },
      notRecording: gap(nrEps),
      window: work,
    },
    quality: qualityOf(quality),
    sacks: { list: sackList, count: sackList.length, lb: r2(sacksLb) },
    eod: { rawG: eodRawG, toteG: eodToteG, changeoverRawG },
    yield: yieldOut,
    yieldByCultivar: byCultivar,
    battery,
    ...(rawRecord ? { raw: rawRecord } : {}),
  };
  out.changeovers.cultivarChanges = out.changeovers.list.filter(c => c.cultivarChange).length;
  return successResponse(out);
}

/** The day's raw record for one station (raw=1). */
async function rawDay(env, id, date, fromSql, toSql, episodes) {
  const [events, marks, screen, eod] = await Promise.all([
    rows(env.DB.prepare(`SELECT ts, weight_kg FROM scale_events WHERE station_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id`).bind(id, fromSql, toSql)),
    rows(env.DB.prepare(`SELECT * FROM scale_marks WHERE station_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id`).bind(id, fromSql, toSql)),
    rows(env.DB.prepare(`SELECT ts, phase, cultivar, bag, paused, pause_note, job_id FROM cell_screen_log WHERE station_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id`).bind(id, fromSql, toSql)),
    rows(env.DB.prepare(`SELECT id, kind, grams, batt_mv, ts, ended_at, undone_at FROM cell_eod WHERE station_id = ? AND production_date = ? ORDER BY ts, id`).bind(id, date)),
  ]);
  return {
    scaleEvents: events.map(e => ({ ts: e.ts, g: Math.round(e.weight_kg * 100000) / 100 })),
    scaleMarks: marks,
    screenLog: screen,
    eod,
    episodes,
  };
}

