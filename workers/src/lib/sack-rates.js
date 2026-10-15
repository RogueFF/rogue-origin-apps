/**
 * Measured tops per raw sack — and the raw sacks a line still needs.
 *
 * ONE HOME FOR THE RATE. `tops_breakdown` answers "how many pounds of tops will
 * this pile of sacks make"; the order board needs the inverse — "this line
 * still wants N pounds, how much raw is that". Those two must never disagree,
 * and the only way to guarantee that is for both to read the same table and the
 * same fence. supersack-d1's projectFinishedTops was the original home and is
 * now a caller.
 *
 * TOPS ONLY, DELIBERATELY. sacks_opened and tops_lbs are both entered per
 * strain per day, so a tops rate is measurable. Biomass and trim are logged
 * episodically — one entry when a bag is weighed, spanning several days — so a
 * smalls rate built the same way would be fiction. It does not matter: smalls
 * are the byproduct of the same lot, not a separate demand on raw material.
 * Sacks are driven by tops, and the smalls fall out of them.
 */

export function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/**
 * This year's crop stands on its own.
 *
 * History arrives per cultivar AND season. Once the current season has
 * `minSacks` of measured history for a cultivar, that season alone is the
 * rate: a new year's sacks are packed differently and trim differently, and
 * last year's number would only drag the estimate toward a product that no
 * longer exists. Until then every season is summed, as it always was, because
 * a rate built on three sacks is noise.
 *
 * @param rows [{ key, season, sacks, tops }] — season null = unknown = old
 * @returns [{ key, sacks, tops }] in first-seen key order, for buildRates
 */
export function preferSeason(rows = [], season, minSacks = 10) {
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, { all: { sacks: 0, tops: 0 }, cur: { sacks: 0, tops: 0 } });
    const k = byKey.get(r.key);
    const sacks = Number(r.sacks) || 0, tops = Number(r.tops) || 0;
    k.all.sacks += sacks; k.all.tops += tops;
    if (Number(r.season) === Number(season)) { k.cur.sacks += sacks; k.cur.tops += tops; }
  }
  return [...byKey].map(([key, k]) => {
    const pick = k.cur.sacks >= minSacks ? k.cur : k.all;
    return { key, sacks: pick.sacks, tops: pick.tops };
  });
}

/**
 * Build the rate table from aggregated history.
 *
 * @param rows [{ key, sacks, tops }] — one row per cultivar (or strain), already
 *   summed. Totals, not an average of daily rates: a day that opened one sack
 *   must not weigh the same as a day that opened forty.
 * @returns { rateMap, sacksMap, upperFence, floor }
 */
export function buildRates(rows = []) {
  const rateMap = new Map();
  const sacksMap = new Map();

  for (const r of rows) {
    const sacks = Number(r.sacks) || 0;
    const tops = Number(r.tops) || 0;
    sacksMap.set(r.key, sacks);
    if (sacks > 0) rateMap.set(r.key, tops / sacks);
  }

  const rates = [...rateMap.values()];

  // High-side outlier fence, and only where it means something: a
  // median-absolute-deviation over three points is noise, not statistics.
  let upperFence = Infinity;
  if (rates.length >= 5) {
    const med = median(rates);
    const mad = median(rates.map(r => Math.abs(r - med))) * 1.4826;
    if (mad > 0) upperFence = med + 3 * mad;
  }

  // The LOWEST trusted rate is the fallback, which is pessimistic on purpose.
  // Costing an unknown cultivar at the best rate anyone has ever managed would
  // under-order raw, and running the line short is the expensive direction.
  const trusted = rates.filter(r => r <= upperFence);
  const floor = trusted.length ? Math.min(...trusted) : 0;

  return { rateMap, sacksMap, upperFence, floor };
}

/**
 * Which rate a cultivar actually gets, and why.
 *
 * @param own measured rate, or null when the cultivar has no history
 * @returns { rate, source } — source is 'own' | 'floor_unknown_cultivar' |
 *   'floor_anomaly_high', so a surface can say where a number came from rather
 *   than presenting a guess and a measurement identically.
 */
export function effectiveRate(own, { upperFence = Infinity, floor = 0 } = {}) {
  if (own == null) return { rate: floor, source: 'floor_unknown_cultivar' };
  if (own <= upperFence) return { rate: own, source: 'own' };
  return { rate: floor, source: 'floor_anomaly_high' };
}

/**
 * Raw sacks needed for the tops a line still wants.
 *
 * Returns null rather than Infinity when there is no usable rate — a farm with
 * no history at all would otherwise divide by zero and print "Infinity sacks"
 * on the board. Null means "cannot say", which a surface can render honestly.
 */
export function sacksFor(remainingTopsLbs, rate) {
  const lbs = Number(remainingTopsLbs) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) return null;
  if (lbs <= 0) return 0;
  return lbs / r;
}
