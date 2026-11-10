/**
 * Raw -> tops yield per hand-out lot (migration 0057, handlers/production/cell-raw.js).
 * Pure: the handler reads the rows, this works the numbers. Nothing here is stored,
 * so a late correction anywhere (an hourly entry, an undo) shows up on the next read.
 *
 * Tops come from one of two places:
 *   scale  a cell with a table scale: the pickups its screen marked (net tops the
 *          basket held, scale_marks kind 'pickup') from the lot's first hand-out to
 *          its weigh-back, plus PICKUP_GRACE_MS for a last lift that lands just after
 *          the weigh-back, never into the next lot. One lot, one yield.
 *   hourly every other cell: the hourly log's tops for that cell, day and cultivar
 *          (cell_hourly; a blank cultivar is the room's cultivar that hour). The log
 *          is by hour, not by order, so the yield is for the cell's day of that
 *          cultivar: every lot of it that day together, and only once all are closed.
 *          Only the hours the lots were out count (first hand-out to last weigh-back),
 *          so tops logged before the water spider started entering raw never land
 *          on a small lot (a whole morning on one 175 g hand-out reads 300%).
 *
 * A yield outside YIELD_BAND is shown with check: true and kept out of the roll-up
 * (known cell yields: Sour Lifter 19%, Lifter 25%): a missed hand-out or a typo
 * should never teach a cultivar its rate.
 *
 * No yield (null) while raw is still at the cell, when nothing was used (out - back
 * <= 0), or when there are no tops yet. Those are left out of the per-cultivar
 * roll-up, which counts weighed lots so a cultivar can get its own rate later.
 */
export const PICKUP_GRACE_MS = 2 * 60 * 1000;
export const G_PER_LB = 453.59237;
export const YIELD_BAND = [5, 50];   // % tops of raw used

/** "2:00 PM – 3:00 PM" -> { startMin, endMin }, Pacific minutes since midnight; null if unreadable. */
export function slotRange(slot) {
  const parts = String(slot || '').split('–').map(x => x.trim());
  const min = t => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t || '');
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    return h * 60 + Number(m[2]);
  };
  const startMin = min(parts[0]), endMin = min(parts[1]);
  return startMin === null || endMin === null ? null : { startMin, endMin };
}
const pacificMinutes = ms => {
  const s = new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
  return Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
};
const checked = y => (y === null ? { yieldPct: null, check: false } : { yieldPct: y, check: y < YIELD_BAND[0] || y > YIELD_BAND[1] });

const parseUtc = s => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]$/.test(s) ? '' : 'Z')) : null);
const r1 = n => Math.round(n * 10) / 10;
const pct = (tops, used) => (used > 0 && tops > 0 ? r1((tops / used) * 100) : null);

/**
 * @param {object} a
 * @param {Array<{id,stationId,date,cultivar,bag,bags,openedAt,closedAt,outG,backG,outs}>} a.lots
 * @param {Set<string>} a.scaleStations stations with a table scale
 * @param {Array<{station_id,ts,kg}>} a.marks pickup marks for those stations
 * @param {Array<{station_id,production_date,time_slot,cultivar,tops_lbs}>} a.hourly cultivar already resolved
 */
export function lotYields({ lots, scaleStations, marks = [], hourly = [] }) {
  // Where each scale lot's window ends: weigh-back + grace, but never past the next lot.
  const byStation = new Map();
  for (const l of lots) (byStation.get(l.stationId) || byStation.set(l.stationId, []).get(l.stationId)).push(l);
  const windowEnd = new Map();
  for (const list of byStation.values()) {
    list.sort((a, b) => parseUtc(a.openedAt) - parseUtc(b.openedAt) || a.id - b.id);
    list.forEach((l, i) => {
      const closed = parseUtc(l.closedAt);
      const next = list[i + 1] ? parseUtc(list[i + 1].openedAt) : Infinity;
      windowEnd.set(l.id, closed === null ? null : Math.min(closed + PICKUP_GRACE_MS, next));
    });
  }

  const out = lots.map(l => {
    const closed = l.closedAt !== null && l.closedAt !== undefined;
    const usedG = closed ? r1((l.outG || 0) - (l.backG || 0)) : null;
    const base = { ...l, closed, usedG, topsG: null, yieldPct: null, source: scaleStations.has(l.stationId) ? 'scale' : 'hourly' };
    if (base.source !== 'scale') return base;
    const from = parseUtc(l.openedAt);
    const to = windowEnd.get(l.id) ?? Date.now();
    const topsG = r1(marks
      .filter(m => m.station_id === l.stationId)
      .filter(m => { const at = parseUtc(m.ts); return at >= from && at <= to; })
      .reduce((s, m) => s + (Number(m.kg) || 0) * 1000, 0));
    return { ...base, topsG, ...checked(closed ? pct(topsG, usedG) : null) };
  });

  // Hourly cells: one yield per cell, day and cultivar.
  const groups = new Map();
  for (const l of out.filter(x => x.source === 'hourly')) {
    const key = `${l.stationId}|${l.date}|${l.cultivar}`;
    const g = groups.get(key) || { key, stationId: l.stationId, date: l.date, cultivar: l.cultivar, lots: 0, open: 0, usedG: 0, topsG: 0, from: Infinity, to: -Infinity };
    g.lots += 1;
    if (l.closed) g.usedG += l.usedG; else g.open += 1;
    g.from = Math.min(g.from, parseUtc(l.openedAt));
    if (l.closed) g.to = Math.max(g.to, parseUtc(l.closedAt));
    groups.set(key, g);
  }
  // Only the hours the group's raw was out: an hour counts if it overlaps the
  // window from the first hand-out to the last weigh-back (Pacific minutes).
  for (const g of groups.values()) {
    g.fromMin = Number.isFinite(g.from) ? pacificMinutes(g.from) : null;
    g.toMin = Number.isFinite(g.to) ? pacificMinutes(g.to) : null;
  }
  for (const h of hourly) {
    const g = groups.get(`${h.station_id}|${h.production_date}|${h.cultivar}`);
    if (!g || g.open || g.fromMin === null || g.toMin === null || !Number.isFinite(Number(h.tops_lbs))) continue;
    const r = slotRange(h.time_slot);
    if (!r || r.endMin <= g.fromMin || r.startMin >= g.toMin) continue;
    g.topsG += Number(h.tops_lbs) * G_PER_LB;
  }
  const groupList = [...groups.values()].map(({ from, to, fromMin, toMin, ...g }) => {
    const usedG = r1(g.usedG), topsG = r1(g.topsG);
    return { ...g, usedG, topsG, ...checked(g.open ? null : pct(topsG, usedG)) };
  });
  for (const l of out) {
    if (l.source !== 'hourly') continue;
    const g = groups.get(`${l.stationId}|${l.date}|${l.cultivar}`);
    l.group = g.key;
  }

  // Per cultivar: every weighed unit (a scale lot, or an hourly cell-day) with a yield.
  const units = [
    ...out.filter(l => l.source === 'scale' && l.yieldPct !== null && !l.check).map(l => ({ cultivar: l.cultivar, lots: 1, usedG: l.usedG, topsG: l.topsG })),
    ...groupList.filter(g => g.yieldPct !== null && !g.check).map(g => ({ cultivar: g.cultivar, lots: g.lots, usedG: g.usedG, topsG: g.topsG })),
  ];
  const cult = new Map();
  for (const u of units) {
    const c = cult.get(u.cultivar) || { cultivar: u.cultivar, lots: 0, usedG: 0, topsG: 0 };
    c.lots += u.lots; c.usedG += u.usedG; c.topsG += u.topsG;
    cult.set(u.cultivar, c);
  }
  const byCultivar = [...cult.values()]
    .map(c => ({ ...c, usedG: r1(c.usedG), topsG: r1(c.topsG), yieldPct: pct(c.topsG, c.usedG),
      rawPerTops: c.topsG > 0 ? Math.round((c.usedG / c.topsG) * 100) / 100 : null }))
    .sort((a, b) => b.lots - a.lots || a.cultivar.localeCompare(b.cultivar));

  return { lots: out, groups: groupList, byCultivar };
}
