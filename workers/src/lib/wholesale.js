/**
 * Pure core of the wholesale order queue.
 *
 * Everything here is deterministic and D1-free so it can be unit-tested
 * (tests/wholesale.test.mjs). The handlers do the round-trips and call in here
 * for the arithmetic that decides what the floor runs and when an order lands.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

/**
 * One conversion constant for the whole repo. The tree previously carried
 * 2.205 in the retired api/orders and 2.20462 in the Apps Script estimator,
 * which quietly disagreed by ~28 g per 100 kg.
 */
export const LB_PER_KG = 2.20462;

const UNITS = new Set(['lb', 'kg']);
const FORMS = new Set(['tops', 'smalls']);

function assertQty(qty) {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
    throw new Error(`Invalid quantity: ${qty}`);
  }
}

function assertUnit(unit) {
  if (!UNITS.has(unit)) {
    throw new Error(`Invalid unit "${unit}" — expected one of: ${[...UNITS].join(', ')}`);
  }
}

/** Convert an operator-entered quantity to the canonical pound value. */
export function toLbs(qty, unit) {
  assertQty(qty);
  assertUnit(unit);
  return unit === 'kg' ? qty * LB_PER_KG : qty;
}

/**
 * Convert canonical pounds back to the unit the order was written in, so a
 * kg order redisplays as the kg the customer agreed to rather than drifting
 * through repeated round-trips.
 */
export function fromLbs(lbs, unit) {
  assertQty(lbs);
  assertUnit(unit);
  return unit === 'kg' ? lbs / LB_PER_KG : lbs;
}

/**
 * Size one cultivar lot.
 *
 * Tops and smalls are joint products of a single trimming pass — verified
 * against 45 days of monthly_production, where both are recorded against the
 * same cultivar and the same trimmer count. So a lot is not "the tops order
 * plus the smalls order"; it is however much material must go through the
 * line for the *binding* form to be satisfied. The other form falls out as
 * surplus, which is real future inventory rather than waste.
 */
export function lotSize({ topsLbs = 0, smallsLbs = 0, topsFraction }) {
  assertQty(topsLbs);
  assertQty(smallsLbs);

  if (typeof topsFraction !== 'number' || !Number.isFinite(topsFraction)
      || topsFraction < 0 || topsFraction > 1) {
    throw new Error(`Invalid tops fraction: ${topsFraction} — expected 0..1`);
  }
  // A cultivar that yields no smalls can never satisfy a smalls order, and
  // vice versa. Fail loudly instead of returning Infinity.
  if (topsLbs > 0 && topsFraction <= 0) {
    throw new Error(`Cannot fill a tops order: tops fraction is ${topsFraction}`);
  }
  if (smallsLbs > 0 && topsFraction >= 1) {
    throw new Error(`Cannot fill a smalls order: tops fraction is ${topsFraction}`);
  }

  const needForTops = topsLbs > 0 ? topsLbs / topsFraction : 0;
  const needForSmalls = smallsLbs > 0 ? smallsLbs / (1 - topsFraction) : 0;
  const lotLbs = Math.max(needForTops, needForSmalls);

  if (lotLbs === 0) {
    return {
      lotLbs: 0, binding: null,
      yieldTops: 0, yieldSmalls: 0, surplusTops: 0, surplusSmalls: 0,
    };
  }

  const yieldTops = lotLbs * topsFraction;
  const yieldSmalls = lotLbs * (1 - topsFraction);

  return {
    lotLbs,
    binding: needForTops >= needForSmalls ? 'tops' : 'smalls',
    yieldTops,
    yieldSmalls,
    surplusTops: yieldTops - topsLbs,
    surplusSmalls: yieldSmalls - smallsLbs,
  };
}

/**
 * Choose the trim rate and tops share for one cultivar, and say where the
 * number came from.
 *
 * Provenance is not decoration. Cultivars with live SKUs and zero trim history
 * exist — Alium OG and Sour Brulee both sell and neither has ever been run —
 * and an estimate built on the farm average must not read like one built on
 * 7,110 trimmer-hours of Lifter.
 *
 * Buckets are `{ lbs, topsLbs, hours }` where lbs is tops + smalls combined.
 */
export function pickRate({ sameYear, allYears, minHours, fallback }) {
  const usable = (b) => b && b.hours >= minHours && b.hours > 0 && b.lbs > 0;

  for (const [basis, bucket] of [['same-year', sameYear], ['all-years', allYears]]) {
    if (!usable(bucket)) continue;
    return {
      basis,
      ratePerTrimmerHour: bucket.lbs / bucket.hours,
      topsFraction: bucket.topsLbs / bucket.lbs,
      hours: bucket.hours,
    };
  }

  return {
    basis: 'fallback',
    ratePerTrimmerHour: fallback.ratePerTrimmerHour,
    topsFraction: fallback.topsFraction,
    hours: 0,
  };
}

/**
 * Group open line items into ORDER blocks, and each block into trim passes.
 *
 * This replaces the pooled-by-cultivar model. A block is an order; the floor
 * works one order at a time, so a cultivar wanted by two orders is trimmed
 * twice. Inside a block, line items run in the order they were typed
 * (`sortOrder`), which is what the operator asked for and what
 * `order_items.sort_order` has been storing all along.
 *
 * PASSES, and why they are not just line items. Tops and smalls of the SAME
 * cultivar within the SAME order come off one lot in one pass — 45 days of
 * monthly_production record both against the same cultivar and the same trimmer
 * count. So lines are grouped by cultivar into a pass, which is what gets
 * scheduled and sized. Each line keeps its own identity inside the pass so the
 * board can show a separate progress bar per line, which is the whole reason the
 * lines stay separate.
 *
 * A pass sits at the position of its EARLIEST line: if Berry Bliss tops is line
 * 1 and Berry Bliss smalls is line 4, the pass runs first and both lines finish
 * together.
 *
 * Design: docs/plans/2026-08-20-order-blocks-restructure.md §4
 */
export function orderBlocks(items) {
  const blocks = new Map();

  for (const item of items) {
    if (!FORMS.has(item.form)) {
      throw new Error(`Invalid form "${item.form}" — expected one of: ${[...FORMS].join(', ')}`);
    }
    assertQty(item.qtyLbs);

    let block = blocks.get(item.orderId);
    if (!block) {
      block = { orderId: item.orderId, passes: new Map() };
      blocks.set(item.orderId, block);
    }

    let pass = block.passes.get(item.cultivarId);
    if (!pass) {
      pass = {
        cultivarId: item.cultivarId,
        seq: item.sortOrder,
        topsLbs: 0,
        smallsLbs: 0,
        lines: [],
      };
      block.passes.set(item.cultivarId, pass);
    }

    if (item.form === 'tops') pass.topsLbs += item.qtyLbs;
    else pass.smallsLbs += item.qtyLbs;

    pass.seq = Math.min(pass.seq, item.sortOrder);
    pass.lines.push({
      lineId: item.lineId,
      form: item.form,
      qtyLbs: item.qtyLbs,
      sortOrder: item.sortOrder,
    });
  }

  return [...blocks.values()].map(b => ({
    orderId: b.orderId,
    passes: [...b.passes.values()]
      .sort((x, y) => x.seq - y.seq || x.cultivarId.localeCompare(y.cultivarId))
      .map(p => ({ ...p, lines: [...p.lines].sort((x, y) => x.sortOrder - y.sortOrder) })),
  }));
}
