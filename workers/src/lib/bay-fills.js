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
 * BUT A GAP ALONE IS NOT A TAKEDOWN (2026-10-19). On 10/16 a few loads were
 * scanned into bays 8 and 12 a week after the Lifter went in, the gap read as a
 * refill, and the Lifter fell off the screen with its lots open, no tag printed
 * and no bay-done row. So a later load may only close a fill that showed signs
 * of having come down BEFORE that load arrived: a bay-done row for it, a sack
 * tagged in that bay off one of its lots, or every lot in it finished
 * (fillIsDown). Otherwise the new loads join the fill: they hang beside what
 * was already there. Signs that come later prove nothing about the gap — bay
 * 12's Lifter was bagged on 10/19, three days after the 2nd cut was hung
 * beside it, and those tags must not split the two.
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
 * @param {{gapDays?:number, isDown?:(bay:number, fill:object, at:number) => boolean}} [opts]
 *   `isDown(bay, fill, at)`: had this fill (its loads so far) started coming
 *   down by `at`, the time (ms) of the load that arrived after the gap? Asked
 *   once per gap; `false` makes that load join the fill. Without it a gap alone
 *   splits, as before 2026-10-19 (see fillIsDown).
 * @returns {Map<number, Array<{startMs:number, loads:object[], closed:boolean}>>}
 *          per bay, its fills oldest first. `closed` = a later fill exists, so
 *          this one was taken down and the bay refilled.
 */
export function bayFills(loads, { gapDays = FILL_GAP_DAYS, isDown = null } = {}) {
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
      if (fill && at - prev >= gapMs && (!isDown || isDown(bay, fill, at))) fill = null;
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
 * The `isDown` for bayFills: had a fill shown any sign of coming down by the
 * time `at` (the load after the gap) arrived?
 *
 *  - a bay-done row for this bay keyed on the fill's start ("Finished" or
 *    "Whole bay down" pressed before `at`), or
 *  - a sack tagged in THIS bay, off one of the fill's lots, between the fill's
 *    start and `at` (the bay on a tag is typed, so a tag off another lot or in
 *    another bay proves nothing about this fill), or
 *  - every lot in the fill finished before `at` (closed out lot by lot, the
 *    old way).
 *
 * Anything dated at or after `at` is left out: it happened with the new load
 * already hanging, so it cannot show the bay was empty when that load came in.
 *
 * @param {{lotOfSession: Map<number, object>, tags: Array<{bay, printed_at, zone_session_id}>,
 *          done: Array<{bay, fill_start, done_at}>}} ctx
 *   `lotOfSession` maps every session id of a picker lot to the lot (with
 *   `id`, `takedown_done_at`); tags hang off the lot's primary session, loads
 *   may sit on any of them.
 * @returns {(bay:number, fill:{startMs:number, loads:object[]}, at:number) => boolean}
 */
export function fillIsDown({ lotOfSession, tags = [], done = [] }) {
  const doneAt = new Map();   // `${bay}|${fill start}` -> earliest done_at (ms)
  for (const d of done) {
    const k = `${Number(d.bay)}|${ts(d.fill_start)}`;
    const t = d.done_at ? ts(d.done_at) : -Infinity;   // a row without a time counts as old
    if (!doneAt.has(k) || t < doneAt.get(k)) doneAt.set(k, t);
  }
  return (bay, fill, at = Infinity) => {
    const before = (ms) => Number.isFinite(ms) ? ms < at : ms === -Infinity;
    const k = `${bay}|${fill.startMs}`;
    if (doneAt.has(k) && before(doneAt.get(k))) return true;
    const lotIds = new Set();
    let allFinished = true;
    for (const l of fill.loads) {
      const lot = lotOfSession.get(l.session_id);
      if (!lot) continue;
      lotIds.add(lot.id);
      if (!lot.takedown_done_at || !before(ts(lot.takedown_done_at))) allFinished = false;
    }
    if (lotIds.size && allFinished) return true;
    return tags.some(t => {
      const printed = ts(t.printed_at);
      if (Number(t.bay) !== bay || !(printed > fill.startMs) || !before(printed)) return false;
      const lot = lotOfSession.get(t.zone_session_id);
      return !!lot && lotIds.has(lot.id);
    });
  };
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

/**
 * The bay screen: one group per bay, rows = that bay's cards by bins (largest
 * first), the bay's last tag (for the header's Void) and its sacks today.
 * Active bays first, bay number ascending; a bay whose every card is finished
 * comes after them. Pure: `tags` carry `printed_day` (a Pacific calendar day)
 * set by the caller, and `today` is the same kind of day. Like bayCards, only
 * tags printed after the bay's current fill started count (cards carry
 * `fillStartMs`; a card without one applies no filter).
 */
export function bayScreenGroups(cards, tags, { today } = {}) {
  const newestFirst = (a, b) => String(b.printed_at).localeCompare(String(a.printed_at));
  const inFill = (t, startMs) => startMs == null || ts(t.printed_at) > startMs;
  const tagRef = (t) => (t ? { sack_id: t.sack_id, cultivar: t.cultivar } : null);
  const byBay = new Map();
  for (const c of cards) {
    if (!byBay.has(c.bay)) {
      byBay.set(c.bay, { bay: c.bay, rows: [], lastTag: null, sacksToday: 0, finished: true,
        fillStartMs: c.fillStartMs });
    }
    const g = byBay.get(c.bay);
    const mine = tags.filter(t => Number(t.bay) === c.bay && t.cultivar === c.cultivar
      && Number(t.cut_number ?? 1) === Number(c.cut) && inFill(t, c.fillStartMs)).sort(newestFirst);
    g.rows.push({ ...c, noLoads: !(c.bins > 0), lastTag: tagRef(mine[0]) });
    if (!c.doneAt) g.finished = false;
  }
  const out = [];
  for (const { fillStartMs, ...g } of byBay.values()) {
    g.rows.sort((a, b) => b.bins - a.bins || a.cultivar.localeCompare(b.cultivar, 'en'));
    const mine = tags.filter(t => Number(t.bay) === g.bay && inFill(t, fillStartMs)).sort(newestFirst);
    g.lastTag = tagRef(mine[0]);
    g.sacksToday = today ? mine.filter(t => t.printed_day === today).length : 0;
    out.push(g);
  }
  return out.sort((a, b) => Number(a.finished) - Number(b.finished) || a.bay - b.bay);
}
