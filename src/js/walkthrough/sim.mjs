/**
 * The floor walkthrough's simulation (demo.html; Koa 2026-11-11: "I was just
 * talking about seeing how it would look/flow digitally"). Runs entirely in the
 * browser: no Worker, no database, no network. Pure, so it's unit-tested
 * (tests/walkthrough-sim.test.mjs).
 *
 * It uses the floor's REAL rules, imported from the Worker's pure modules:
 *   routeLine (which line goes to a cell, bagging or pack) and planAssignments
 *   (the stand-in auto-assign: first free cell, same cultivar only breaks a tie,
 *   NOW + NEXT per cell, never idle). Scheduling is Nathan's on the real floor;
 *   here it's the stand-in, clearly marked.
 *
 * A day: mock orders arrive on a sim clock -> the stand-in puts them on a cell ->
 * the cell trims its NOW basket -> the scale reaches the target (chime) -> the
 * basket swaps to the pickup spot and NEXT moves up -> when every basket of an
 * order is at the spot it's ready -> bag/tag collects -> the label is bought in
 * Shopify (fulfilled). Bag/tag confirms each order as it starts it (in Shopify:
 * Print packing slips). Pool-only orders skip the cells.
 */
import { routeLine } from '../../../workers/src/lib/order-route.js';
import { planAssignments, basketsFor, DEFAULT_PACE_GPM } from '../../../workers/src/lib/order-assign.js';

export const CELLS = [
  { id: 'table1', label: 'Cell 1', sort: 1, scale: true },
  { id: 'table12', label: 'Cell 12', sort: 12, scale: false },
  { id: 'table13', label: 'Cell 13', sort: 13, scale: false },
  { id: 'table14', label: 'Cell 14', sort: 14, scale: false },
];
/** Sim minutes for each bag/tag step, and how long a full basket shows before the swap. */
export const STEPS = { confirmMin: 2, collectMin: 6, shipMin: 10, fullMin: 1 };
const MIN = 60000;

/** A cell's own pace, a little either side of the room default. */
export function cellPace(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEFAULT_PACE_GPM * (0.85 + (h % 31) / 100);
}

const shortName = c => String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim();

/**
 * @param {{simStartMs:number, orders:Array<{name, simAt, rush, lines}>}} day  from orders.mjs
 */
export function createSim(day) {
  let nextJob = 1;
  const s = {
    simMs: day.simStartMs,
    orders: day.orders.map((o, i) => {
      const lines = o.lines.map((l, j) => {
        const r = routeLine({ title: l.title, productTitle: l.title, hasProduct: !l.custom, productType: l.productType,
          productTags: l.productTags || [], options: l.options || {} }, { tags: ['m2o-line'] });
        // A custom line waits for a person at bag/tag; in the walkthrough it goes to bagging.
        return { lineId: `${i}-${j}`, cultivar: r.cultivar || l.title, floorCultivar: r.floorCultivar, bag: r.bag, qty: l.qty,
          route: r.route === 'ask' ? 'bagging' : r.route };
      });
      return { id: i + 1, name: o.name, arriveAt: o.simAt, rush: !!o.rush, lines, state: 'pending',
        arrivedAt: null, confirmedAt: null, readyAt: null, collectedAt: null, shippedAt: null, cell: null };
    }),
    cells: CELLS.map(c => ({ ...c, jobs: [], grams: 0, phase: 'idle', fullAt: null, chimeAt: null, spot: [], lastCultivar: null, done: 0 })),
    events: [],
  };
  const log = text => { s.events.unshift({ at: s.simMs, text }); if (s.events.length > 40) s.events.pop(); };
  const cellLines = o => o.lines.filter(l => l.route === 'cell' && l.floorCultivar && l.bag);

  function assign() {
    const waiting = s.orders.filter(o => o.state === 'queued' && cellLines(o).length);
    if (!waiting.length) return;
    const { assign: plan } = planAssignments({
      cells: s.cells.map(c => ({
        stationId: c.id, sort: c.sort, lastCultivar: c.lastCultivar, paceGpm: cellPace(c.id), liveNetG: c.grams,
        jobs: c.jobs.map((j, i) => ({ orderId: j.orderId, cultivar: j.cultivar, targetG: j.targetG, started: i === 0 && c.grams > 0 })),
      })),
      orders: waiting.map(o => ({ id: o.id, rush: o.rush, placedAt: new Date(o.arrivedAt).toISOString(),
        lines: cellLines(o).map(l => ({ lineId: l.lineId, cultivar: l.floorCultivar, bag: l.bag, qtyOpen: l.qty })) })),
    });
    for (const a of plan) {
      const o = s.orders.find(x => x.id === a.orderId);
      const c = s.cells.find(x => x.id === a.stationId);
      for (const j of a.jobs) c.jobs.push({ id: nextJob++, orderId: o.id, orderName: o.name, cultivar: j.cultivar, bag: j.bag, bags: j.bags, targetG: j.targetG, basketNo: j.basketNo, baskets: j.baskets });
      o.state = 'assigned';
      o.cell = c.id;
      log(`${o.name} → ${c.label} (${a.why})`);
    }
  }

  function step(dtMs) {
    s.simMs += dtMs;
    const dtMin = dtMs / MIN;
    for (const o of s.orders.filter(x => x.state === 'pending' && x.arriveAt <= s.simMs)) {
      o.state = 'queued';
      o.arrivedAt = s.simMs;
      log(`${o.name} arrives from Shopify${o.rush ? ' (RUSH)' : ''}`);
    }
    assign();
    for (const c of s.cells) {
      const j = c.jobs[0];
      if (!j) { c.phase = 'idle'; c.grams = 0; continue; }
      const o = s.orders.find(x => x.id === j.orderId);
      if (c.phase === 'idle' || c.phase === 'swap') { c.phase = 'trim'; c.grams = 0; }
      if (c.phase === 'trim') {
        if (o.state === 'assigned') o.state = 'trimming';
        c.grams = Math.min(j.targetG, c.grams + cellPace(c.id) * dtMin);
        if (c.grams >= j.targetG) { c.phase = 'full'; c.fullAt = s.simMs; c.chimeAt = s.simMs; log(`${c.label} chimes: ${o.name} basket ${j.basketNo} of ${j.baskets} full`); }
        continue;
      }
      if (c.phase === 'full' && s.simMs - c.fullAt >= STEPS.fullMin * MIN) {
        // The two-basket swap: the full basket to the pickup spot, the matched empty one on.
        c.jobs.shift();
        c.spot.push({ orderId: o.id, orderName: o.name, cultivar: j.cultivar, bag: j.bag, bags: j.bags, at: s.simMs });
        c.lastCultivar = j.cultivar;
        c.done += 1;
        c.phase = 'swap';
        c.grams = 0;
        log(`${c.label}: ${o.name} basket to the pickup spot${c.jobs[0] ? `; NEXT ${c.jobs[0].orderName} moves up` : ''}`);
        if (!s.cells.some(x => x.jobs.some(y => y.orderId === o.id))) { o.state = 'ready'; o.readyAt = s.simMs; log(`${o.name} ready at ${c.label}'s pickup spot`); }
      }
    }
    // Bag/tag.
    for (const o of s.orders) {
      const since = t => (s.simMs - t) / MIN;
      if (['queued', 'assigned', 'trimming'].includes(o.state) && !o.confirmedAt && since(o.arrivedAt) >= STEPS.confirmMin) {
        o.confirmedAt = s.simMs;
        log(`Bag/tag confirms ${o.name}: Shopify packing slip`);
        if (o.state === 'queued' && !cellLines(o).length) { o.state = 'ready'; o.readyAt = s.simMs; o.collectedAt = s.simMs; }
      } else if (o.state === 'ready' && !o.collectedAt && since(o.readyAt) >= STEPS.collectMin) {
        o.collectedAt = s.simMs;
        for (const c of s.cells) c.spot = c.spot.filter(b => b.orderId !== o.id);
        log(`Bag/tag collects ${o.name}: weigh, bag, box`);
      } else if (o.state === 'ready' && o.collectedAt && since(o.collectedAt) >= STEPS.shipMin) {
        o.state = 'shipped';
        o.shippedAt = s.simMs;
        log(`${o.name}: label bought in Shopify, fulfilled`);
      }
    }
    return s;
  }

  return { state: s, step, shortName };
}

/** Counts for the header: how many orders are in each part of the flow. */
export function tally(s) {
  const out = { toArrive: 0, toStart: 0, inCells: 0, atSpot: 0, toShip: 0, shipped: 0 };
  for (const o of s.orders) {
    if (o.state === 'pending') out.toArrive++;
    else if (o.state === 'shipped') out.shipped++;
    else if (o.state === 'ready' && o.collectedAt) out.toShip++;
    else if (o.state === 'ready') out.atSpot++;
    else if (!o.confirmedAt) out.toStart++;
    else out.inCells++;
  }
  return out;
}
