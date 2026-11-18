/**
 * The cells scoreboard (Koa 2026-11-18: "adopt the cell look with the new cell
 * hourly-entry"; its own page; the big number counts the cells only).
 *
 * Reads three public GETs and turns them into what the wall shows:
 *   · cellHourly&date=   tops per cell per hour (typed people-hours win; a scale's
 *                        auto value fills an hour nobody typed), slots + hours
 *   · cellBoard          live screens: job, continuous rounds, not recording,
 *                        End of day weigh, baskets waiting at the pickup spot
 *   · crewBoard          the goal (lb of tops per person-hour; one person per cell)
 *
 * Toyota rule, as on the crew Top 5: cells are never ranked and never red for
 * low output. Red is only an andon: a cell that needs someone (not recording,
 * a basket waiting too long, a quality stop).
 *
 * Pure: no DOM, no fetch. The page controller is main.js; tests import this file.
 */

export const REFRESH_LIVE_MS = 15 * 1000;     // cellBoard: screens, pickups
export const REFRESH_HOURLY_MS = 60 * 1000;   // cellHourly: the hour log
export const WAITING_HELP_MIN = 15;           // a basket at the spot this long turns the cell red
export const MAX_CELLS_SHOWN = 24;

export const LABELS = {
  en: {
    clTitle: 'Cells', clRunning: '{n} cells running', clOne: '1 cell running', clNone: 'No cells running yet',
    clSoFar: 'lbs goal so far', clCells: '{n} cells',
    clEod: 'End of day:', clEodGoal: '/ {g} lbs goal',
    clOnPace: 'ON PACE', clAhead: 'AHEAD', clBehind: 'BEHIND', clWaiting: 'WAITING TO START', clNoGoal: 'NO GOAL YET',
    clCellsKey: 'lb today · rounds', clRounds: '{n} rounds', clRound1: '1 round',
    clNotRec: 'Not recording', clBasket: 'Basket waiting · {m} min', clEodWeigh: 'End of day weigh', clChange: 'Changeover',
    clIdle: 'Not started', clStop: 'Quality stop · call the lead',
    clPickups: 'Baskets waiting for pickup', clNoPickups: 'No baskets waiting',
    clQuality: 'Quality today', clPass: 'pass', clRedo: 'redo',
    clNow: 'Now · order', clNext: 'Next',
    clChart: 'Cells · lb per cell-hour', clRoundsToday: 'Rounds today', clRoundsK: 'Rounds', clPickupsK: 'Pickups waiting', clCellHrs: 'Cell-hours',
    clGoalFrom: 'Goal {lb} lb/h · from {d}',
  },
  es: {
    clTitle: 'Celdas', clRunning: '{n} celdas trabajando', clOne: '1 celda trabajando', clNone: 'Ninguna celda trabajando todavía',
    clSoFar: 'lbs meta hasta ahora', clCells: '{n} celdas',
    clEod: 'Fin del día:', clEodGoal: '/ {g} lbs meta',
    clOnPace: 'AL RITMO', clAhead: 'ADELANTE', clBehind: 'ATRÁS', clWaiting: 'ESPERANDO INICIO', clNoGoal: 'SIN META TODAVÍA',
    clCellsKey: 'lb hoy · rondas', clRounds: '{n} rondas', clRound1: '1 ronda',
    clNotRec: 'No está registrando', clBasket: 'Canasta esperando · {m} min', clEodWeigh: 'Pesaje de fin del día', clChange: 'Cambio de cultivar',
    clIdle: 'Sin empezar', clStop: 'Alto de calidad · llamar al líder',
    clPickups: 'Canastas esperando recogida', clNoPickups: 'Ninguna canasta esperando',
    clQuality: 'Calidad hoy', clPass: 'pasa', clRedo: 'rehacer',
    clNow: 'Ahora · pedido', clNext: 'Siguiente',
    clChart: 'Celdas · lb por hora-celda', clRoundsToday: 'Rondas hoy', clRoundsK: 'Rondas', clPickupsK: 'Canastas esperando', clCellHrs: 'Horas-celda',
    clGoalFrom: 'Meta {lb} lb/h · del {d}',
  },
};

export const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const r1 = (x) => Math.round(x * 10) / 10;

/** '7:00 AM – 8:00 AM' → { startMin: 420, endMin: 480 } (any dash). */
export function slotBounds(slot) {
  const m = String(slot || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–—]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const toMin = (h, mi, ap) => ((Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(mi);
  return { startMin: toMin(m[1], m[2], m[3]), endMin: toMin(m[4], m[5], m[6]) };
}

/** Pacific day and minute-of-day for a timestamp (ms). */
export function pacificNow(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return { day: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** The goal (lb/h per person) from the crewBoard reply: the latest workday that has one. */
export function goalFrom(crew) {
  const days = crew && crew.byDay ? Object.keys(crew.byDay).sort() : [];
  for (let i = days.length - 1; i >= 0; i--) {
    const g = num(crew.byDay[days[i]]?.room?.goal?.lbHr);
    if (g !== null && g > 0) return { lbHr: g, day: days[i] };
  }
  const g = num(crew?.room?.goal?.lbHr);
  return g !== null && g > 0 ? { lbHr: g, day: crew.room.date || crew.day || null } : null;
}

/** Tops per station per slot: a typed value wins, else the scale's auto value. */
export function topsGrid(hourly) {
  const grid = new Map();   // stationId -> Map(slot -> lb)
  const put = (id, slot, lb) => { if (!grid.has(id)) grid.set(id, new Map()); grid.get(id).set(slot, lb); };
  for (const a of hourly?.auto || []) { const v = num(a.tops); if (v !== null && v > 0) put(a.stationId, a.slot, v); }
  for (const r of hourly?.rows || []) { const v = num(r.tops); if (v !== null && v > 0) put(r.stationId, r.slot, v); }
  return grid;
}

const cellNo = (label, id) => (String(label || '').match(/\d+/) || String(id || '').match(/\d+/) || [''])[0];

/**
 * Everything the wall draws.
 *   hourly: cellHourly reply · board: cellBoard reply · goal: { lbHr, day } or null
 *   nowMs: the time (serverNow when we have it) · day: the Pacific day shown
 */
export function cellsModel({ hourly, board, goal, nowMs, day }) {
  const now = pacificNow(nowMs);
  const today = day || now.day;
  const isToday = today === now.day;
  const nowMin = isToday ? now.min : 24 * 60;   // a past day: every hour is done
  const slots = (hourly?.slots || []).map((s) => ({ slot: s.slot, hours: num(s.hours) ?? 1, ...(slotBounds(s.slot) || { startMin: 0, endMin: 0 }) }))
    .filter((s) => s.endMin > s.startMin);
  const done = (s) => nowMin >= s.endMin;
  const grid = topsGrid(hourly);
  const liveBoard = isToday ? board : null;   // live screens are today's (see below)
  const live = new Map((liveBoard?.cells || []).map((c) => [c.stationId, c]));
  const rowsBy = new Map();
  for (const r of hourly?.rows || []) { if (!rowsBy.has(r.stationId)) rowsBy.set(r.stationId, []); rowsBy.get(r.stationId).push(r); }
  const stops = new Set((hourly?.batches || []).filter((b) => b.alert === 'stop').map((b) => b.stationId));
  // Live screens only count today, and only fresh ones: cell_screen_state keeps
  // a tablet's last job overnight, so match the Cells board (tabletOnline =
  // reported in the last 90 s). A basket marked before today's first hour is
  // yesterday's, not a cell that needs a hand now.
  const dayStartMs = slots.length ? nowMs - (now.min - slots[0].startMin) * 60000 : nowMs;
  const waitingList = (liveBoard?.waiting || []).filter((w) => num(w.at) === null || w.at >= dayStartMs);
  const waitingBy = new Map();
  for (const w of waitingList) {
    const min = num(w.at) !== null ? Math.max(0, Math.round((nowMs - w.at) / 60000)) : 0;
    if (!waitingBy.has(w.stationId) || waitingBy.get(w.stationId) < min) waitingBy.set(w.stationId, min);
  }
  const roster = (hourly?.roster || []).filter((c) => c.active !== false);
  const goalLb = goal && goal.lbHr > 0 ? goal.lbHr : null;

  const cells = [];
  let lbAll = 0, lbDone = 0, hoursDone = 0;
  for (const c of roster) {
    const g = grid.get(c.stationId) || new Map();
    const b = live.get(c.stationId);
    const job = b?.job || null;
    const working = !!(job && job.tabletOnline === true && job.phase && job.phase !== 'idle');
    let lb = 0, cLbDone = 0, cHrsDone = 0;
    for (const s of slots) {
      const v = g.get(s.slot) || 0;
      lb += v;
      if (v > 0 && done(s)) { cLbDone += v; cHrsDone += s.hours; }
    }
    const rounds = num(job?.rounds);
    const inUse = lb > 0 || working || (rounds !== null && rounds > 0) || !!b?.notRecording || waitingBy.has(c.stationId);
    if (!inUse) continue;
    lbAll += lb; lbDone += cLbDone; hoursDone += cHrsDone;
    const rows = (rowsBy.get(c.stationId) || []).filter((r) => r.cultivar).sort((a, z) => (slotBounds(a.slot)?.startMin || 0) - (slotBounds(z.slot)?.startMin || 0));
    const cultivar = job?.cultivar || (rows.length ? rows[rows.length - 1].cultivar : null);
    const wait = waitingBy.get(c.stationId);
    let state = working ? 'on' : (lb > 0 ? 'on' : 'idle');
    let flag = null;
    if (stops.has(c.stationId)) { state = 'help'; flag = { key: 'clStop' }; }
    else if (b?.notRecording) { state = 'help'; flag = { key: 'clNotRec' }; }
    else if (wait !== undefined && wait >= WAITING_HELP_MIN) { state = 'help'; flag = { key: 'clBasket', m: wait }; }
    else if (b?.eod) { state = 'idle'; flag = { key: 'clEodWeigh' }; }
    else if (b?.changeover) { state = 'idle'; flag = { key: 'clChange' }; }
    else if (!working && lb === 0) { flag = { key: 'clIdle' }; }
    const cGoal = goalLb ? goalLb * cHrsDone : null;
    cells.push({
      id: c.stationId, no: cellNo(c.label, c.stationId), label: c.label, lane: c.lane || null,
      cultivar: cultivar || null, lb: r1(lb), rounds,
      state, flag,
      // the bar fills toward the cell's goal so far; green only at or over it (never red)
      bar: cGoal ? Math.min(100, Math.round((cLbDone / cGoal) * 100)) : null,
      overGoal: cGoal ? cLbDone >= cGoal : false,
    });
    if (cells.length >= MAX_CELLS_SHOWN) break;
  }

  // the room of cells, on one basis: completed hours only
  const goalDone = goalLb ? goalLb * hoursDone : null;
  const delta = goalDone !== null ? lbDone - goalDone : null;
  const pct = goalDone ? (lbDone / goalDone) * 100 : null;
  let status = 'idle';
  if (lbAll > 0 && pct !== null) status = pct >= 105 ? 'ahead' : pct >= 90 ? 'on-target' : 'behind';
  else if (lbAll > 0) status = 'nogoal';

  // end of day: this pace (lb per cell-hour) over the hours left, on the cells working now
  const activeNow = cells.filter((c) => c.state !== 'idle' || c.flag?.key === 'clNotRec' || c.flag?.key === 'clBasket').length;
  const hoursLeft = slots.filter((s) => !done(s)).reduce((a, s) => {
    const frac = nowMin > s.startMin ? (s.endMin - nowMin) / (s.endMin - s.startMin) : 1;
    return a + s.hours * Math.max(0, Math.min(1, frac));
  }, 0);
  // the part of the running hour already gone (its tops are in lbAll; its goal isn't in goalDone)
  const hoursGone = slots.filter((s) => !done(s) && nowMin > s.startMin)
    .reduce((a, s) => a + s.hours * Math.min(1, (nowMin - s.startMin) / (s.endMin - s.startMin)), 0);
  const pace = hoursDone > 0 ? lbDone / hoursDone : null;
  const projected = pace !== null ? r1(lbAll + pace * hoursLeft * activeNow) : null;
  const dayGoal = goalLb ? r1(goalDone + goalLb * (hoursGone + hoursLeft) * activeNow) : null;

  // the chart: lb per cell-hour, hour by hour, against the goal
  const chart = slots.map((s) => {
    let lb = 0, hrs = 0;
    for (const [, g] of grid) { const v = g.get(s.slot) || 0; if (v > 0) { lb += v; hrs += s.hours; } }
    const label = s.slot.split(/[-–—]/)[0].trim().replace(/:00/, '').replace(/\s*(AM|PM)/i, (m) => m.trim()[0].toLowerCase());
    return { slot: s.slot, label, rate: hrs > 0 ? Math.round((lb / hrs) * 100) / 100 : null, done: done(s) };
  }).filter((h) => h.rate !== null);

  const waiting = waitingList.map((w) => ({ label: w.label, no: cellNo(w.label, w.stationId), min: num(w.at) !== null ? Math.max(0, Math.round((nowMs - w.at) / 60000)) : null }))
    .sort((a, z) => (z.min ?? 0) - (a.min ?? 0));
  const batches = hourly?.batches || [];
  const quality = { pass: batches.filter((b) => b.quality === 'pass').length, redo: batches.filter((b) => b.quality === 'fail').length, stop: stops.size };
  const roundsToday = cells.reduce((a, c) => a + (c.rounds || 0), 0);
  const cultivars = [...new Set(cells.map((c) => c.cultivar).filter(Boolean))];

  return {
    day: today, isToday, cells, cultivars,
    hero: { lb: r1(lbAll), goalSoFar: goalDone !== null ? r1(goalDone) : null, delta: delta !== null ? r1(delta) : null, pct: pct !== null ? Math.round(pct) : null, status },
    eod: projected !== null ? { projected, goal: dayGoal, delta: dayGoal !== null ? r1(projected - dayGoal) : null } : null,
    progress: slots.length ? Math.round(Math.min(1, Math.max(0, (nowMin - slots[0].startMin) / (slots[slots.length - 1].endMin - slots[0].startMin))) * 100) : 0,
    cellHours: r1(hoursDone), roundsToday, waiting, quality, chart, goal: goalLb,
  };
}
