/**
 * Which cell gets which order (design doc §2c rules, §2e slice 2; Koa 2026-11-11:
 * "automatic order assignment"). Pure: the handler loads the rows, this decides.
 *
 * Rules, for each waiting order in FIFO order (rush first, then oldest):
 *   1. Only cells that take orders and hold fewer than MAX_ORDERS orders
 *      (NOW + NEXT: the order being trimmed and one behind it).
 *   2. The cell that frees up first (Koa 2026-11-11: "Tie-breaker only": raw is
 *      brought per line item, so same-cultivar grouping saves little, mostly the
 *      leftover raw and a quick tray swap).
 *   3. Same cultivar only breaks a tie: among the cells that free up within
 *      CULTIVAR_TIE_MIN of the first one, a cell whose last queued cultivar (or,
 *      if empty, the cultivar it last ran) is one of the order's cultivars wins.
 *      That covers a mixed order too, and that cultivar's baskets go first.
 *      A cell never sits idle for it: while any cell is idle, only idle cells tie.
 *   4. Still tied: roster order.
 * One order goes to one cell, whole (§2c split rule). A line becomes baskets of at
 * most one 1 lb fill (460 g), whole bags only, so the scale target stays a basket.
 */

/** Fill standards, NET grams per bag (the cell screen's PRESETS). */
export const FILL_G = { qOz: 7.5, hOz: 15.0, oz1: 30.0, qLb: 115.0, hLb: 230.0, lb1: 460.0 };
export const BASKET_MAX_G = 460;
export const MAX_ORDERS = 2;
/** Minutes within which two cells count as freeing up together. 0 = cultivar never decides. */
export const CULTIVAR_TIE_MIN = 3;
/**
 * Room default pace, g of tops per minute: the 11/9 one-touch rate, ~0.9 lb tops
 * per person-hour (n=2). AN ESTIMATE: each scale cell's own pace replaces it once
 * it has finished jobs (paceFromMarks).
 */
export const DEFAULT_PACE_GPM = 6.8;

/** One cell line -> its baskets: [{ bags, targetG, basketNo, baskets }]. */
export function basketsFor(bag, qty) {
  const fill = FILL_G[bag];
  if (!fill || !(qty > 0)) return [];
  const per = Math.max(1, Math.floor(BASKET_MAX_G / fill + 1e-9));
  const out = [];
  for (let left = qty; left > 0; left -= per) out.push(Math.min(per, left));
  return out.map((bags, i) => ({ bags, targetG: Math.round(bags * fill * 100) / 100, basketNo: i + 1, baskets: out.length }));
}

/** A cell's pace from its finished jobs: sum of tops / sum of working minutes. */
export function paceFromMarks(marks = []) {
  let g = 0, min = 0;
  for (const m of marks) {
    const cycle = Number(m.cycle_s), kg = Number(m.kg);
    if (!(cycle >= 60) || !(kg > 0)) continue;
    g += kg * 1000; min += cycle / 60;
  }
  return min >= 30 && g > 0 ? g / min : null;   // under half an hour of data: use the default
}

const remainingG = (job, i, liveNetG) =>
  i === 0 && job.started && liveNetG != null ? Math.max(0, job.targetG - Math.max(0, liveNetG)) : job.targetG;

/** Minutes until a cell has finished everything queued at it. */
export function minutesToFree(cell) {
  const pace = cell.paceGpm > 0 ? cell.paceGpm : DEFAULT_PACE_GPM;
  const g = (cell.jobs || []).reduce((s, j, i) => s + remainingG(j, i, cell.liveNetG), 0)
    + (cell.handJobLeftG || 0);
  return g / pace;
}

/** Minutes until a cell's first order is done (when its NEXT slot opens up again). */
export function minutesToFirstOrderDone(cell) {
  const pace = cell.paceGpm > 0 ? cell.paceGpm : DEFAULT_PACE_GPM;
  const jobs = cell.jobs || [];
  if (!jobs.length) return 0;
  const first = jobs[0].orderId;
  let g = cell.handJobLeftG || 0;
  for (let i = 0; i < jobs.length && jobs[i].orderId === first; i++) g += remainingG(jobs[i], i, cell.liveNetG);
  return g / pace;
}

const ordersAt = cell => new Set((cell.jobs || []).map(j => j.orderId)).size;
const tailCultivar = cell => {
  const jobs = cell.jobs || [];
  return jobs.length ? jobs[jobs.length - 1].cultivar : (cell.lastCultivar || null);
};

/**
 * @param {object} a
 * @param {Array<{stationId, sort, jobs, liveNetG?, lastCultivar?, paceGpm?, handJobLeftG?}>} a.cells
 *        jobs: that cell's queued jobs in seq order [{ orderId, cultivar, targetG, started }]
 * @param {Array<{id, rush, placedAt, lines:[{lineId, cultivar, bag, qtyOpen}]}>} a.orders
 *        waiting orders, cell lines only (cultivar = the floor's spelling)
 * @returns {{ assign: Array<{orderId, stationId, why, jobs:Array}>, waiting: Array<{orderId, stationId, inMin}> }}
 */
export function planAssignments({ cells, orders }) {
  const sim = cells.map(c => ({ ...c, jobs: [...(c.jobs || [])] }));
  const queue = [...orders].sort((a, b) => (b.rush ? 1 : 0) - (a.rush ? 1 : 0) || String(a.placedAt).localeCompare(String(b.placedAt)) || a.id - b.id);
  const assign = [], waiting = [];
  for (const o of queue) {
    const cultivars = [...new Set(o.lines.map(l => l.cultivar))];
    const open = sim.filter(c => ordersAt(c) < MAX_ORDERS);
    if (!open.length) {
      // Every cell is full: say which cell frees a slot first.
      const next = [...sim].sort((a, b) => minutesToFirstOrderDone(a) - minutesToFirstOrderDone(b) || a.sort - b.sort)[0];
      waiting.push({ orderId: o.id, stationId: next ? next.stationId : null, inMin: next ? Math.round(minutesToFirstOrderDone(next)) : null });
      continue;
    }
    const scored = open.map(c => ({ c, free: minutesToFree(c), tail: tailCultivar(c) }))
      .sort((a, b) => a.free - b.free || a.c.sort - b.c.sort);
    const soonest = scored[0];
    const idle = soonest.free < 0.5;
    const match = scored.find(s => s.tail && cultivars.includes(s.tail)
      && (idle ? s.free < 0.5 : s.free <= soonest.free + CULTIVAR_TIE_MIN));
    const pick = match || soonest;
    const why = match
      ? (cultivars.length > 1 ? 'already running one of its cultivars' : 'same cultivar: no changeover')
      : idle ? 'cell is free' : 'frees up soonest';
    // Baskets: the cell's current cultivar first, then each cultivar's lines together.
    const order = [...cultivars].sort((a, b) => (b === pick.tail) - (a === pick.tail));
    const jobs = [];
    for (const cult of order) {
      for (const l of o.lines.filter(x => x.cultivar === cult)) {
        for (const b of basketsFor(l.bag, l.qtyOpen)) {
          jobs.push({ orderId: o.id, lineId: l.lineId, cultivar: cult, bag: l.bag, ...b, started: false });
        }
      }
    }
    if (!jobs.length) continue;
    pick.c.jobs.push(...jobs);
    assign.push({ orderId: o.id, stationId: pick.c.stationId, why, jobs });
  }
  return { assign, waiting };
}
