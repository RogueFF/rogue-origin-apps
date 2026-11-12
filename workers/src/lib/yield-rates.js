/**
 * Measured finished pounds per raw sack, per SACK TYPE — the `yield_rates`
 * contract the website reads once a day.
 *
 * A sack type is one Shopify Super Sack variant: crop year + cultivar +
 * harvest type + cut ("2026 - Sour Lifter / Sungrown / 1st Cut"). The 2026
 * floor log names its strains with that full title, so the cut is known; 2025
 * and older rows have no cut, and a variant that can only be matched to such a
 * row says so with `per_cut: false`.
 *
 * WHAT IS MEASURED AND WHAT IS NOT.
 *   tops   — sacks_opened and tops_lbs are both entered per strain per day.
 *            History arrives already cut down to CLEAN DAYS (see
 *            YIELD_HISTORY_SQL: a day where one strain's tops were weighed in
 *            with another's is dropped whole), so the floor and fence here are
 *            built by the same buildRates as tops_breakdown but from stricter
 *            data, and may differ from that endpoint's.
 *   smalls — bagged and logged in lumps, often days after the sacks were
 *            opened. A per-day rate would be fiction; the total over the whole
 *            run of that sack type is honest.
 *   trim   — the weight is real: every pound is on a scale and entered by
 *            hand. What is not measured is whose it was — the floor weighs one
 *            total across the cultivars run together and splits it. So a
 *            per-type number is an ATTRIBUTION (`rate_source: 'attributed'`),
 *            and the exact figure — all trim over all sacks of a crop year —
 *            travels beside it as `trim_all_types`, labelled 'measured'
 *            (Koa, 2026-11-11). The attributed rows sum back to that total.
 *
 * NO BORROWING, NO FLOOR. Unlike tops_breakdown, a type with no history gets
 * null — the site applies its own default. The floor and the fence travel at
 * the top level for reference only, and they are live values recomputed from
 * history on every build, not constants.
 */

import { buildRates } from './sack-rates.js';

export const YIELD_RATES_API_VERSION = 1;
export const CONFIDENCE_OK_SACKS = 15;

const r2 = x => Math.round(x * 100) / 100;

/** "2026 - Sour Lifter / Sungrown / 1st Cut" -> its parts. Cut is null when absent. */
export function parseSackTitle(title) {
  const m = /^\s*(\d{4})\s*-\s*(.+?)\s*$/.exec(String(title || ''));
  if (!m) return { harvest_year: null, strain: String(title || '').trim(), harvest_type: null, cut: null };
  const parts = m[2].split('/').map(s => s.trim()).filter(Boolean);
  const cutAt = parts.findIndex(p => /^\d+(st|nd|rd|th)\s+Cut$/i.test(p));
  const cut = cutAt >= 0 ? parts[cutAt] : null;
  const rest = parts.filter((_, i) => i !== cutAt);
  return {
    harvest_year: Number(m[1]),
    strain: rest[0] || '',
    harvest_type: rest[1] || null,
    cut,
  };
}

/**
 * The join key. Floor titles and variant titles spell the same cultivar
 * differently ("Rainbow GMO Quik" against "Rainbow GMO"), so the cultivar comes
 * from the resolved alias table when there is one, and from the title only
 * when there is not.
 */
function typeKey(title, cultivarOf, withCut = true) {
  const p = parseSackTitle(title);
  const cultivar = cultivarOf.get(title) || p.strain;
  return [p.harvest_year ?? '', cultivar, p.harvest_type || '', withCut ? (p.cut || '') : '']
    .map(s => String(s).toLowerCase()).join('|');
}

function confidence(sacks) {
  if (sacks <= 0) return 'none';
  return sacks < CONFIDENCE_OK_SACKS ? 'thin' : 'ok';
}

const NO_HISTORY = Object.freeze({
  avg_lb_per_sack: null, sacks_counted: 0, first_day: null, last_day: null,
  confidence: 'none', rate_source: 'no_history',
});

function block(sacks, lbs, first, last, source) {
  if (!(sacks > 0) || !(lbs > 0)) return { ...NO_HISTORY };
  return {
    avg_lb_per_sack: r2(lbs / sacks),
    sacks_counted: sacks,
    first_day: first || null,
    last_day: last || null,
    confidence: confidence(sacks),
    rate_source: source,
  };
}

const minDay = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));
const maxDay = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

/**
 * @param history one row per floor strain title:
 *   { strain, tops_sacks, tops_lbs, tops_first, tops_last,   — tops-rated days only
 *     run_sacks, smalls_lbs, trim_lbs, run_first, run_last } — the whole run
 * @param variants [{ id, title, quantity }] from the Super Sack inventory
 * @param cultivarOf Map title -> cultivar name (resolveTitleCultivars)
 */
export function buildYieldRates(history = [], variants = [], cultivarOf = new Map(), asOf = new Date().toISOString()) {
  // The same fence and floor maths as tops_breakdown (buildRates), keyed on
  // the floor's own strain title, over clean-day history.
  const { upperFence, floor } = buildRates(
    history.filter(h => Number(h.tops_sacks) > 0)
      .map(h => ({ key: h.strain, sacks: h.tops_sacks, tops: h.tops_lbs })),
  );

  // History summed per sack type, and again without the cut for rows that
  // never recorded one.
  const empty = () => ({
    tops_sacks: 0, tops_lbs: 0, tops_first: null, tops_last: null,
    run_sacks: 0, smalls_lbs: 0, trim_lbs: 0, run_first: null, run_last: null,
  });
  const add = (map, key, h) => {
    const a = map.get(key) || empty();
    a.tops_sacks += Number(h.tops_sacks) || 0;
    a.tops_lbs += Number(h.tops_lbs) || 0;
    a.tops_first = minDay(a.tops_first, h.tops_first);
    a.tops_last = maxDay(a.tops_last, h.tops_last);
    a.run_sacks += Number(h.run_sacks) || 0;
    a.smalls_lbs += Number(h.smalls_lbs) || 0;
    a.trim_lbs += Number(h.trim_lbs) || 0;
    a.run_first = minDay(a.run_first, h.run_first);
    a.run_last = maxDay(a.run_last, h.run_last);
    map.set(key, a);
  };
  const byType = new Map();
  const cutless = new Map();
  for (const h of history) {
    if (parseSackTitle(h.strain).cut) add(byType, typeKey(h.strain, cultivarOf), h);
    else add(cutless, typeKey(h.strain, cultivarOf, false), h);
  }

  const sack_types = variants.map(v => {
    const p = parseSackTitle(v.title);
    const own = byType.get(typeKey(v.title, cultivarOf));
    // The strain average, only when this exact cut has nothing of its own.
    const strainAvg = own ? null : cutless.get(typeKey(v.title, cultivarOf, false));
    const h = own || strainAvg || empty();

    const tops = block(h.tops_sacks, h.tops_lbs, h.tops_first, h.tops_last, 'measured');
    // Above the fence the number is kept and flagged — the site decides.
    if (tops.avg_lb_per_sack != null && h.tops_lbs / h.tops_sacks > upperFence) tops.rate_source = 'anomaly_high';

    return {
      variant_id: v.id ?? null,
      title: v.title,
      strain: p.strain,
      harvest_year: p.harvest_year,
      harvest_type: p.harvest_type,
      cut: p.cut,
      inventory_sacks: Number(v.quantity) || 0,
      per_cut: !strainAvg,
      tops,
      smalls: block(h.run_sacks, h.smalls_lbs, h.run_first, h.run_last, 'measured'),
      trim: block(h.run_sacks, h.trim_lbs, h.run_first, h.run_last, 'attributed'),
    };
  });

  // Trim across every sack type of a crop year: the one trim figure that is
  // weighed rather than split.
  const byYear = new Map();
  for (const h of history) {
    const year = parseSackTitle(h.strain).harvest_year;
    if (year != null) add(byYear, year, h);
  }
  const trim_all_types = [...byYear].sort((a, b) => a[0] - b[0]).map(([harvest_year, a]) => ({
    harvest_year,
    ...block(a.run_sacks, a.trim_lbs, a.run_first, a.run_last, 'measured'),
  }));

  return {
    api_version: YIELD_RATES_API_VERSION,
    as_of: asOf,
    trim_all_types,
    tops_floor_lbs_per_sack: floor > 0 ? r2(floor) : null,
    tops_anomaly_fence_lbs_per_sack: Number.isFinite(upperFence) ? r2(upperFence) : null,
    sack_types,
  };
}

/** The numeric tail of a Shopify id, GID or plain. */
const idTail = id => (/(\d+)\s*$/.exec(String(id ?? '')) || [])[1] || '';

/**
 * Keyed lookup for checking one row. No keys returns everything. An unknown
 * key matches nothing rather than everything.
 */
export function filterSackTypes(sackTypes, q = {}) {
  const lc = s => String(s ?? '').trim().toLowerCase();
  if (q.variant_id) {
    const want = idTail(q.variant_id);
    return sackTypes.filter(s => want && idTail(s.variant_id) === want);
  }
  let out = sackTypes;
  if (q.strain) out = out.filter(s => lc(s.strain) === lc(q.strain));
  if (q.year) out = out.filter(s => String(s.harvest_year) === String(q.year).trim());
  if (q.cut) out = out.filter(s => lc(s.cut) === lc(q.cut));
  if (q.harvest_type) out = out.filter(s => lc(s.harvest_type) === lc(q.harvest_type));
  return out;
}
