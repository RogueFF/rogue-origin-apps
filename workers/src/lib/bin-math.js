/**
 * Grove bins — pure lane math (design §5, docs/plans/2026-10-14-grove-bins-design.md).
 *
 * Turns a lane's baseline, usage ledger and config into on hand, burn rate,
 * reorder point, red tape depth (bins deep the red ORDER card sits), order-by
 * and run-out dates. Pure: no Date.now(), no I/O. Dates are UTC.
 */

export const DAY = 86400000;

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {object} i
 * @param {number} i.per            bags per bin, > 0
 * @param {number} i.lead           lead time, days
 * @param {number} i.safety         safety stock, days
 * @param {number} i.moq            minimum order qty (0 = none)
 * @param {number} i.seedPerMonth   bags/month used until the ledger has 14 days
 * @param {number} [i.planPerMonth] bags/month Koa plans on; > 0 overrides ledger, seed and season (the measured rate still comes back in `measured`), and one month becomes the suggested order
 * @param {number} [i.orderDays]    days of use one order covers (the order cycle); 0/absent = 30 with a plan, 120 without
 * @param {{bags:number, at:string}|null} i.baseline  null = never received/counted: no estimate (on hand 0, recount false)
 * @param {number} i.usageSince     bags used after baseline.at
 * @param {number} i.usage56        bags used in the last 56 days
 * @param {number} i.usageDays      days of ledger data available
 * @param {number|null} i.seasonUsage bags used last year in the window seasonWindow() gives, or null
 * @param {boolean} i.redScanned
 * @param {number|null} [i.leftoverBins] physical bin count, if one was taken
 * @param {{available:number, at:string}|null} [i.shopify] Shopify's last word on the lane — its level and when it said so (addendum 2026-10-21); lanes Shopify does not count pass nothing
 * @param {Date} i.today
 */
export function laneStatus(i) {
  const { lead, safety, moq, seedPerMonth, baseline, usageSince, usage56, usageDays,
    seasonUsage, redScanned, leftoverBins, today } = i;
  const plan = Number(i.planPerMonth) || 0;
  const orderDays = Number(i.orderDays) > 0 ? Number(i.orderDays) : 0;
  const per = Math.max(1, Number(i.per) || 0);

  // The freshest word wins (addendum 2026-10-21): Shopify's level when it is newer than the
  // last count, else the count minus the scans since it. Compared as instants, not strings —
  // Flow echoes carry whole seconds and baselines milliseconds, and "…:00.500Z" sorts before "…:00Z".
  const ledgerOnHand = baseline ? Math.max(0, baseline.bags - usageSince) : null;
  const word = i.shopify && Number.isFinite(Number(i.shopify.available)) ? i.shopify : null;
  const level = word ? Number(word.available) : null;
  const shopifyNewer = !!word && (!baseline || new Date(word.at).getTime() > new Date(baseline.at).getTime());
  const onHand = shopifyNewer ? Math.max(0, level) : (ledgerOnHand ?? 0);
  const onHandSource = shopifyNewer ? 'shopify' : 'ledger';
  const windowDays = Math.min(56, Math.max(1, usageDays));

  let rate, rateSource;
  if (usageDays >= 14) {
    rate = usage56 / windowDays;
    rateSource = 'ledger';
  } else {
    rate = seedPerMonth / 30.4;
    rateSource = 'seed';
  }

  const cover = lead + safety;
  if (seasonUsage != null && cover > 0) {
    const s = seasonUsage / cover;
    if (s > rate) {
      rate = s;
      rateSource = 'season';
    }
  }

  // What the data says, kept beside a plan so the next order can compare the two.
  const measured = { rate, source: rateSource };
  if (plan > 0) {
    rate = plan / 30.4;
    rateSource = 'plan';
  }

  const reorderPoint = Math.round(rate * cover);
  const redTapeAtBins = Math.ceil(reorderPoint / per);
  // One order covers `cycle` days of use: four months by default (custom bags: one Grove run), one month
  // under a plan, or the lane's own order cycle (Koa 2026-10-21: the 10 lb lane orders every 2 weeks).
  const cycle = orderDays || (plan > 0 ? 30 : 120);
  const suggestedQty = Math.max(moq, Math.ceil((rate * cycle) / 100) * 100);

  const t = today.getTime();
  const runOut = rate > 0 ? isoDate(t + (onHand / rate) * DAY) : null;
  const orderBy = rate > 0 ? isoDate(t + ((onHand - rate * lead) / rate) * DAY) : null;

  let status;
  if (redScanned || (rate > 0 && onHand <= reorderPoint)) status = 'order';
  else if (rate > 0 && onHand <= reorderPoint + 14 * rate) status = 'soon';
  else status = 'ok';

  // With no estimate (no count and no Shopify word) there is nothing to disagree with.
  const recount = (!!baseline || shopifyNewer) && leftoverBins != null && Math.abs(leftoverBins * per - onHand) > per;
  const bins = Math.floor(onHand / per);
  // Shopify's word kept beside the lane whichever source won, so the Desk can show when it
  // last spoke and nag when it is more than a bin off the count (`agrees`).
  const shopify = word ? { available: level, at: word.at, bins: Math.floor(Math.max(0, level) / per),
    agrees: ledgerOnHand == null || Math.abs(level - ledgerOnHand) <= per } : null;

  return { onHand, bins, onHandSource, ledgerOnHand, shopify, rate, rateSource, measured, reorderPoint, redTapeAtBins, suggestedQty,
    runOut, orderBy, status, recount };
}

/**
 * Last year's demand over the span a reorder placed today must cover:
 * [today, today+lead+safety], shifted back one year (laneStatus divides it by
 * lead+safety). Both bounds are full ISO: `from` is the start of its day
 * (T00:00:00.000Z), `to` the end of its day (T23:59:59.999Z) so `at <= to`
 * includes the last day. UTC.
 */
export function seasonWindow(today, lead, safety) {
  const back = (days) => {
    const d = new Date(today.getTime() + days * DAY);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  return { from: `${back(0)}T00:00:00.000Z`, to: `${back(lead + safety)}T23:59:59.999Z` };
}
