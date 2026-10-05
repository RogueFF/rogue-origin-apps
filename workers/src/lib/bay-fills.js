/**
 * Bay fills — what is hanging in each drying bay, as the takedown sees it.
 *
 * Sour Lifter from two or three zones shares every bay, and the sticks carry no
 * zone (Koa, 2026-10-05), so at takedown the BAY is the unit the crew can
 * actually see. These helpers group barn loads into fills so the takedown
 * picker can offer one card per bay and cultivar, with each zone's share of it
 * by bins.
 *
 * A FILL is the run of loads hung in a bay between two takedowns. Nothing
 * records a bay standing empty, but a refill is a completion signal: a bay is
 * hung over a day or two, then dries for a week or more before it comes down,
 * so a load arriving FILL_GAP_DAYS after the bay's previous load is a new fill.
 *
 * NOT the rack board's tag rule (harvest-metrics.js: a tag out of the bay, then
 * a load, starts a new fill). Tested against the live barn on 2026-10-05 it
 * split bay 10 in half: a tag typed with bay 10 on 9/29 landed between that
 * day's loads, and the Bay field is often just the last bay used. The gap
 * depends only on the barn-door scans, which carry the bay the load went into.
 *
 * Pure functions: every input is a plain row, so they test without a database.
 */
import { harvestZone } from './zones.js';

/** A refill comes a drying cycle later; a fill's own loads land within ~2 days. */
export const FILL_GAP_DAYS = 3;

const ts = (s) => {
  if (s instanceof Date) return s.getTime();
  const t = String(s || '');
  return Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);
};

/**
 * Assign every load to its fill.
 *
 * @param {Array<{bay:number, occurred_at:string}>} loads
 * @param {{gapDays?:number}} [opts]
 * @returns {Map<number, Array<{startMs:number, loads:object[], closed:boolean}>>}
 *          per bay, its fills oldest first. `closed` = a later fill exists, so
 *          this one was taken down and the bay refilled.
 */
export function bayFills(loads, { gapDays = FILL_GAP_DAYS } = {}) {
  const gapMs = gapDays * 86400000;
  const loadsByBay = new Map();
  for (const l of loads) {
    if (!l.bay) continue;
    const b = Number(l.bay);
    if (!loadsByBay.has(b)) loadsByBay.set(b, []);
    loadsByBay.get(b).push(l);
  }

  const out = new Map();
  for (const [bay, list] of loadsByBay) {
    const sorted = list.slice().sort((a, b) => ts(a.occurred_at) - ts(b.occurred_at));
    const fills = [];
    let fill = null, prev = null;
    for (const l of sorted) {
      const at = ts(l.occurred_at);
      if (fill && at - prev >= gapMs) fill = null;
      if (!fill) { fill = { startMs: at, loads: [], closed: false }; fills.push(fill); }
      fill.loads.push(l);
      prev = at;
    }
    fills.forEach((f, i) => { f.closed = i < fills.length - 1; });
    out.set(bay, fills);
  }
  return out;
}

/**
 * One takedown card per bay, cultivar and cut, from each bay's CURRENT fill.
 *
 * @param {Map} fills         from bayFills()
 * @param {Map} lotOfSession  session id -> open (unfinished) picker lot
 * @param {Array} tags        {bay, printed_at, cultivar, cut_number}
 * @returns {Array<{bay, cultivar, cut, fillStartMs, firstMs, lastMs, bins, loads,
 *                  zones: Array<{lot, zone, bins, share}>, primary, sacks}>}
 *   `zones` (one per lot) largest share first. `groups` is what the card
 *   shows: the same shares with zones harvested together merged (Z1+Z2).
 *   `primary` is the lot sacks hang off: the one with the most bins here. Loads of finished lots are left out — that
 *   material is already down.
 */
export function bayCards(fills, lotOfSession, tags) {
  const cards = [];
  for (const [bay, list] of fills) {
    const fill = list[list.length - 1];
    if (!fill) continue;
    const byCultivar = new Map();
    for (const l of fill.loads) {
      const lot = lotOfSession.get(l.session_id);
      if (!lot || !lot.cultivar) continue;
      // Per cultivar AND cut: a 2nd cut hung beside the 1st is a different lot.
      const key = `${lot.cultivar}|${lot.cut_number ?? 1}`;
      if (!byCultivar.has(key)) {
        byCultivar.set(key, { cultivar: lot.cultivar, cut: lot.cut_number ?? 1,
          lots: new Map(), bins: 0, loads: 0, firstMs: Infinity, lastMs: 0 });
      }
      const g = byCultivar.get(key);
      const at = ts(l.occurred_at);
      const bins = Number(l.bins) || 0;
      g.bins += bins;
      g.loads++;
      g.firstMs = Math.min(g.firstMs, at);
      g.lastMs = Math.max(g.lastMs, at);
      const z = g.lots.get(lot.id) || { lot, zone: lot.zone, bins: 0, loads: 0 };
      z.bins += bins;
      z.loads++;
      g.lots.set(lot.id, z);
    }
    for (const g of byCultivar.values()) {
      const { cultivar, cut } = g;
      const zones = [...g.lots.values()]
        .map(z => ({ ...z, share: g.bins ? z.bins / g.bins : 1 / g.lots.size }))
        .sort((a, b) => b.bins - a.bins || String(a.zone).localeCompare(String(b.zone), 'en', { numeric: true }));
      const sacks = tags.filter(t => Number(t.bay) === bay && t.cultivar === cultivar
        && Number(t.cut_number ?? 1) === Number(cut) && ts(t.printed_at) > fill.startMs).length;
      // What the card shows: zones harvested together (Z1+Z2) as one share.
      const byGroup = new Map();
      for (const z of zones) {
        const k = harvestZone(z.zone);
        const e = byGroup.get(k) || { zone: k, bins: 0, share: 0 };
        e.bins += z.bins;
        e.share += z.share;
        byGroup.set(k, e);
      }
      const groups = [...byGroup.values()].sort((a, b) => b.bins - a.bins || a.zone.localeCompare(b.zone, 'en', { numeric: true }));
      cards.push({
        bay, cultivar, cut, fillStartMs: fill.startMs, firstMs: g.firstMs, lastMs: g.lastMs,
        bins: g.bins, loads: g.loads, zones, groups, primary: zones[0].lot, sacks,
      });
    }
  }
  return cards.sort((a, b) => a.bay - b.bay || a.cultivar.localeCompare(b.cultivar) || a.cut - b.cut);
}

/** Whole-percent shares that add to 100 (largest remainder), for display. */
export function percentShares(zones) {
  const raw = zones.map(z => z.share * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((t, n) => t + n, 0);
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left-- <= 0) break; floor[i]++; }
  return floor;
}
