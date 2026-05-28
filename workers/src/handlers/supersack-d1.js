/**
 * Supersack Analytics API Handler
 * Manages supersack_entries table for historical tracking + analytics.
 *
 * Actions:
 *   submit         (POST) — upsert supersack entry per date+strain
 *   history        (GET)  — query date range, returns daily entries
 *   summary        (GET)  — aggregated KPIs for a date range (by day/week/month)
 *   tops_remaining (GET)  — projected finished tops (lbs) in current raw inventory (public)
 *   tops_breakdown (GET)  — per-cultivar projection (Bearer auth; competitively sensitive)
 *   backfill       (POST) — one-time backfill from pool API + production data
 */

import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { constantTimeEqual } from '../lib/auth.js';

const SACK_WEIGHT = 37;

export async function handleSupersackD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);

  switch (action) {
    case 'test':
      return successResponse({ ok: true, service: 'Supersack Analytics' });
    case 'submit':
      return await submit(body, env);
    case 'history':
      return await history(params, env);
    case 'summary':
      return await summary(params, env);
    case 'tops_remaining':
      return await topsRemaining(request, env, ctx);
    case 'tops_breakdown':
      return await topsBreakdown(request, env, ctx);
    case 'backfill':
      return await backfill(body, env);
    default:
      return errorResponse(`Unknown action: ${action}`, 'VALIDATION_ERROR', 400);
  }
}

/** Upsert supersack entry per date+strain */
async function submit(body, env) {
  const { date, strains, biomass_lbs = 0, trim_lbs = 0, tops_lbs = 0, smalls_lbs = 0, supersack_count = 0, waste_lbs = 0 } = body;

  if (!date) return errorResponse('date is required', 'VALIDATION_ERROR', 400);

  const db = env.DB;

  // Per-strain data from the tracker
  if (strains && typeof strains === 'object') {
    // Support three formats:
    //   { strain: sackCount }                                              (legacy)
    //   { strain: { sacks, tops, smalls } }                                (v2 — per-strain tops/smalls)
    //   { strain: { sacks, tops, smalls, biomass, trim } }                 (v3 — per-strain everything)
    const normalized = Object.entries(strains).map(([name, val]) => {
      if (typeof val === 'object' && val !== null) {
        return [name, val.sacks || 0, val.tops ?? null, val.smalls ?? null, val.biomass ?? null, val.trim ?? null];
      }
      return [name, val, null, null, null, null]; // legacy: sack count only
    }).filter(([, sacks]) => sacks > 0);

    const totalSacks = normalized.reduce((sum, [, sacks]) => sum + sacks, 0);

    for (const [strain, sacks, perStrainTops, perStrainSmalls, perStrainBio, perStrainTrim] of normalized) {
      const ratio = sacks / totalSacks;
      const raw = sacks * SACK_WEIGHT;
      // Use per-strain values when supplied; otherwise ratio-split the day-totals.
      // Per-strain entry eliminates the multi-strain attribution error.
      const strainTops = perStrainTops != null ? perStrainTops : tops_lbs * ratio;
      const strainSmalls = perStrainSmalls != null ? perStrainSmalls : smalls_lbs * ratio;
      const strainBio = perStrainBio != null ? perStrainBio : biomass_lbs * ratio;
      const strainTrim = perStrainTrim != null ? perStrainTrim : trim_lbs * ratio;
      const strainWaste = Math.max(0, raw - strainTops - strainSmalls - strainBio - strainTrim);

      await db.prepare(`
        INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, strain) DO UPDATE SET
          sacks_opened = excluded.sacks_opened,
          tops_lbs = excluded.tops_lbs,
          smalls_lbs = excluded.smalls_lbs,
          biomass_lbs = excluded.biomass_lbs,
          trim_lbs = excluded.trim_lbs,
          waste_lbs = excluded.waste_lbs,
          raw_lbs = excluded.raw_lbs,
          updated_at = datetime('now')
      `).bind(date, strain, sacks, strainTops, strainSmalls, strainBio, strainTrim, strainWaste, raw).run();
    }

    return successResponse({ success: true, entries: normalized.length });
  }

  // Single-strain fallback
  const raw = supersack_count * SACK_WEIGHT;
  const strain = body.strain || 'Unknown';
  const computedWaste = waste_lbs || Math.max(0, raw - tops_lbs - smalls_lbs - biomass_lbs - trim_lbs);

  await db.prepare(`
    INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, strain) DO UPDATE SET
      sacks_opened = excluded.sacks_opened,
      tops_lbs = excluded.tops_lbs,
      smalls_lbs = excluded.smalls_lbs,
      biomass_lbs = excluded.biomass_lbs,
      trim_lbs = excluded.trim_lbs,
      waste_lbs = excluded.waste_lbs,
      raw_lbs = excluded.raw_lbs,
      updated_at = datetime('now')
  `).bind(date, strain, supersack_count, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, computedWaste, raw).run();

  return successResponse({ success: true });
}

/** Query history for date range */
async function history(params, env) {
  const { start, end, strain, complete } = params;
  const db = env.DB;

  let sql = 'SELECT * FROM supersack_entries WHERE 1=1';
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }
  if (complete === 'true') { sql += ' AND biomass_lbs > 0 AND trim_lbs > 0 AND (tops_lbs + smalls_lbs + biomass_lbs + trim_lbs) <= raw_lbs * 1.3'; }

  sql += ' ORDER BY date DESC, strain';

  const result = await db.prepare(sql).bind(...binds).all();
  return successResponse({ entries: result.results });
}

/** Aggregated summary for date range */
async function summary(params, env) {
  const { start, end, strain, group_by = 'day', complete } = params;
  const db = env.DB;

  const groupExpr = group_by === 'month' ? "strftime('%Y-%m', date)"
    : group_by === 'week' ? "strftime('%Y-W%W', date)"
    : 'date';

  const completeFilter = complete === 'true' ? ' AND biomass_lbs > 0 AND trim_lbs > 0 AND (tops_lbs + smalls_lbs + biomass_lbs + trim_lbs) <= raw_lbs * 1.3' : '';

  let sql = `
    SELECT ${groupExpr} as period,
      SUM(sacks_opened) as total_sacks,
      SUM(raw_lbs) as total_raw,
      SUM(tops_lbs) as total_tops,
      SUM(smalls_lbs) as total_smalls,
      SUM(biomass_lbs) as total_biomass,
      SUM(trim_lbs) as total_trim,
      SUM(waste_lbs) as total_waste,
      COUNT(DISTINCT date) as days_worked,
      COUNT(DISTINCT strain) as strain_count
    FROM supersack_entries WHERE 1=1${completeFilter}`;
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }

  sql += ` GROUP BY ${groupExpr} ORDER BY period DESC`;

  const result = await db.prepare(sql).bind(...binds).all();

  // Per-strain totals.
  // effective_days_worked weights each day by this strain's share of that day's
  // sacks (e.g. half-day on Lifter while Sour Lifter ran the other half = 0.5
  // for each), so the projection answers "if we ran this strain full-time at
  // the rate we've actually been opening its sacks per full day, how long?"
  // — instead of diluting by all calendar days the strain wasn't worked.
  let strainSql = `
    WITH daily_totals AS (
      SELECT date, SUM(sacks_opened) as day_total
      FROM supersack_entries WHERE 1=1${completeFilter}`;
  const strainBinds = [];

  // CTE filters (date range only — we want the full day's sack total across all strains)
  if (start) { strainSql += ' AND date >= ?'; strainBinds.push(start); }
  if (end) { strainSql += ' AND date <= ?'; strainBinds.push(end); }

  strainSql += `
      GROUP BY date
    )
    SELECT e.strain,
      SUM(e.sacks_opened) as total_sacks,
      SUM(e.raw_lbs) as total_raw,
      SUM(e.tops_lbs) as total_tops,
      SUM(e.smalls_lbs) as total_smalls,
      SUM(e.biomass_lbs) as total_biomass,
      SUM(e.trim_lbs) as total_trim,
      SUM(e.waste_lbs) as total_waste,
      COUNT(DISTINCT e.date) as days_worked,
      SUM(CAST(e.sacks_opened AS REAL) / NULLIF(d.day_total, 0)) as effective_days_worked
    FROM supersack_entries e
    JOIN daily_totals d ON e.date = d.date
    WHERE 1=1${completeFilter}`;

  // Main query filters (same date range, applied via aliased column)
  if (start) { strainSql += ' AND e.date >= ?'; strainBinds.push(start); }
  if (end) { strainSql += ' AND e.date <= ?'; strainBinds.push(end); }

  strainSql += ' GROUP BY e.strain ORDER BY total_sacks DESC';

  const strainResult = await db.prepare(strainSql).bind(...strainBinds).all();

  return successResponse({
    periods: result.results,
    strains: strainResult.results,
  });
}

/**
 * Projected finished tops (lbs) sitting in current raw supersack inventory.
 *
 * Answers: "given the raw supersacks on hand right now, how many pounds of
 * finished tops will they produce?" — for a public website widget.
 *
 *   GET /api/supersack?action=tops_remaining
 *   → { finished_tops_lbs, as_of, inventory_sacks }
 *
 * Yield rates come from D1 (all clean history); current counts come from the
 * Shopify pool via the same GAS proxy /api/pool uses. Result is edge-cached for
 * 5 minutes so public traffic doesn't hammer the GAS/Shopify quota — inventory
 * only changes a couple times a day.
 */
async function topsRemaining(request, env, ctx) {
  const cache = caches.default;
  // Canonical keys — one entry each regardless of how the client formats the URL.
  const freshKey = new Request('https://cache.local/supersack/tops_remaining');       // 5-min hot cache
  const lastGoodKey = new Request('https://cache.local/supersack/tops_remaining-lg');  // 24-h outage fallback

  const hit = await cache.match(freshKey);
  if (hit) return hit;

  if (!env.POOL_INVENTORY_API_URL || !env.POOL_INVENTORY_API_KEY) {
    return errorResponse('Pool inventory API not configured', 'CONFIG_ERROR', 500);
  }

  try {
    // 1. Per-strain measured tops/sack (tops-only filter — see getStrainTopsRates).
    const stats = await getStrainTopsRates(env);

    // 2. Current inventory from the Shopify pool (via the GAS proxy).
    const r = await fetch(env.POOL_INVENTORY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'get_supersack_variants', apiKey: env.POOL_INVENTORY_API_KEY }),
      redirect: 'follow',
    });
    const data = JSON.parse(await r.text());
    if (data.error) throw new Error(data.error);
    const variants = data.variants || [];

    // 3. Project.
    const { finished_tops_lbs, inventory_sacks } = projectFinishedTops(stats, variants);
    const payload = { finished_tops_lbs, as_of: new Date().toISOString(), inventory_sacks };

    const resp = new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(cache.put(freshKey, resp.clone()));
      // Stash a long-lived copy so a later GAS/D1 hiccup can serve a stale-but-real number.
      ctx.waitUntil(cache.put(lastGoodKey, new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      })));
    }
    return resp;
  } catch (e) {
    // Log the detail server-side; don't echo upstream internals to the client.
    console.error('[supersack tops_remaining] compute failed:', e?.message || e);
    // Live compute failed — serve the last known good value (flagged stale) if we have one.
    const stale = await cache.match(lastGoodKey);
    if (stale) {
      const headers = new Headers(stale.headers);
      headers.set('X-Stale', 'true');
      return new Response(stale.body, { status: 200, headers });
    }
    return errorResponse('Inventory temporarily unavailable', 'EXTERNAL_API_ERROR', 502);
  }
}

/**
 * Per-strain measured tops/sack — the rate source for BOTH tops_remaining and
 * tops_breakdown (shared so they can never drift).
 *
 * Tops-only by design. For a *tops* projection the only trustworthy signals are
 * sacks_opened and tops_lbs — both entered per-strain, per-day. Biomass/trim are
 * logged episodically (one entry when a bag is weighed, spanning several days), so
 * the dashboard's per-day biomass-balance "clean" filter wrongly discards ~25–65%
 * of valid tops days on multi-day strains (and drops some cultivars to the floor
 * entirely). We instead rate tops on every day that has real tops, guarded only
 * against physically-impossible rows (tops > half the raw weight — a data-entry
 * typo; true tops yield is ~10–15% of raw). Biomass correctness is irrelevant here.
 */
async function getStrainTopsRates(env) {
  return env.DB.prepare(`
    SELECT strain,
           SUM(sacks_opened) AS sacks,
           SUM(tops_lbs)     AS tops
    FROM supersack_entries
    WHERE tops_lbs > 0 AND sacks_opened > 0
      AND tops_lbs <= raw_lbs * 0.5
    GROUP BY strain
    HAVING SUM(sacks_opened) > 0
  `).all().then(r => r.results || []);
}

/** Raw JSON response (no {data:…} envelope — this endpoint has a fixed public contract). */
function rawJson(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

/**
 * tops_breakdown — per-cultivar version of tops_remaining. Same projection math
 * (via projectFinishedTops), but exposes each cultivar's rate/source/projection
 * so the website can route tops to the right retail product.
 *
 * Sensitive (per-strain inventory + yield rates = IP), so unlike tops_remaining
 * it requires a Bearer token (BREAKDOWN_API_KEY) and is never served `*` CORS.
 * Caching mirrors tops_remaining (5-min fresh + 24-h stale fallback) with one
 * twist: the Cache API won't persist a `private` response, so we store a
 * `public` copy server-side (never edge-reachable) and hand the client a
 * `private` copy so no shared proxy caches an authed payload.
 */
async function topsBreakdown(request, env, ctx) {
  // --- Auth FIRST: unauthorized callers do no work and never touch the cache. ---
  const expected = env.BREAKDOWN_API_KEY;
  if (!expected) {
    console.error('[supersack tops_breakdown] BREAKDOWN_API_KEY not configured');
    return rawJson({ error: 'unauthorized' }, 401);
  }
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || !constantTimeEqual(token, expected)) {
    return rawJson({ error: 'unauthorized' }, 401);
  }

  const cache = caches.default;
  const freshKey = new Request('https://cache.local/supersack/tops_breakdown');       // 5-min hot cache
  const lastGoodKey = new Request('https://cache.local/supersack/tops_breakdown-lg');  // 24-h outage fallback

  // Cache hit: stored copy is `public` (so the Cache API kept it) — re-stamp
  // `private` before handing it back so intermediaries don't cache it.
  const hit = await cache.match(freshKey);
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('Cache-Control', 'private, max-age=300');
    return new Response(hit.body, { status: 200, headers: h });
  }

  if (!env.POOL_INVENTORY_API_URL || !env.POOL_INVENTORY_API_KEY) {
    return rawJson({ error: 'Inventory temporarily unavailable' }, 502);
  }

  try {
    const stats = await getStrainTopsRates(env);

    const r = await fetch(env.POOL_INVENTORY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'get_supersack_variants', apiKey: env.POOL_INVENTORY_API_KEY }),
      redirect: 'follow',
    });
    const data = JSON.parse(await r.text());
    if (data.error) throw new Error(data.error);
    const variants = data.variants || [];

    const { floor_rate, upper_fence, cultivars } = projectFinishedTops(stats, variants);
    // Totals derived from the rounded per-cultivar rows so the response is
    // internally self-checkable (consumer can re-sum and match exactly).
    const total_finished_tops_lbs = Math.round(
      cultivars.reduce((s, c) => s + c.projected_finished_tops_lbs, 0)
    );
    const total_inventory_sacks = cultivars.reduce((s, c) => s + c.inventory_sacks, 0);

    const payload = {
      as_of: new Date().toISOString(),
      floor_rate_lbs_per_sack: floor_rate,
      anomaly_fence_lbs_per_sack: upper_fence,
      total_finished_tops_lbs,
      total_inventory_sacks,
      // Inventory is one atomic batch fetch — there's no per-cultivar partial
      // failure mode, so this is always empty (kept for contract stability).
      partial_failures: [],
      cultivars,
    };
    const body = JSON.stringify(payload);

    if (ctx && ctx.waitUntil) {
      // Stored copies are `public` so caches.default actually persists them
      // (it silently drops `private`/`no-store`). These keys are synthetic and
      // never reachable from the edge, so storing them public is not a leak.
      ctx.waitUntil(cache.put(freshKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      })));
      ctx.waitUntil(cache.put(lastGoodKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
      })));
    }

    return rawJson(payload, 200, { 'Cache-Control': 'private, max-age=300' });
  } catch (e) {
    console.error('[supersack tops_breakdown] compute failed:', e?.message || e);
    const stale = await cache.match(lastGoodKey);
    if (stale) {
      const h = new Headers(stale.headers);
      h.set('X-Stale', 'true');
      h.set('Cache-Control', 'private, max-age=0');
      return new Response(stale.body, { status: 200, headers: h });
    }
    return rawJson({ error: 'Inventory temporarily unavailable' }, 502);
  }
}

/**
 * Pure projection logic — no I/O, unit-testable.
 *
 * @param {Array<{strain:string, sacks:number, tops:number}>} strainStats
 *        Per-strain clean-history totals.
 * @param {Array<{title:string, quantity:number}>} inventory
 *        Current supersack counts (titles match strain names exactly).
 *
 * Rate per cultivar:
 *   - has clean history AND rate not a HIGH anomaly → its own measured rate
 *   - no history, OR rate is a high anomaly         → the floor
 * Floor = lowest trusted (non-high-anomaly) rate. High-anomaly = above the
 * robust upper fence (median + 3 × scaled MAD). Conservative / high-only:
 * suspiciously-LOW rates are trusted as-is so the estimate never over-promises.
 */
export function projectFinishedTops(strainStats, inventory) {
  const rateMap = new Map();
  const sacksMap = new Map();          // strain → clean-history sack count
  for (const s of strainStats) {
    const sacks = Number(s.sacks) || 0;
    const tops = Number(s.tops) || 0;
    sacksMap.set(s.strain, sacks);
    if (sacks > 0) rateMap.set(s.strain, tops / sacks);
  }

  const rates = [...rateMap.values()];

  // High-side outlier fence — only meaningful with enough cultivars and spread.
  let upperFence = Infinity;
  if (rates.length >= 5) {
    const med = median(rates);
    const mad = median(rates.map(r => Math.abs(r - med))) * 1.4826;
    if (mad > 0) upperFence = med + 3 * mad;
  }

  const trusted = rates.filter(r => r <= upperFence);
  const floor = trusted.length ? Math.min(...trusted) : 0;

  const r2 = x => Math.round(x * 100) / 100;   // rate display: 2 dp
  const r1 = x => Math.round(x * 10) / 10;     // projected lbs: 1 dp
  const floorR = r2(floor);

  let tops = 0;
  let inventory_sacks = 0;
  const cultivars = [];
  for (const v of inventory) {
    const qty = Number(v.quantity) || 0;
    if (qty <= 0) continue;
    const own = rateMap.get(v.title);

    // --- public rollup math (unchanged: full precision, raw floor/own) ---
    const rate = (own != null && own <= upperFence) ? own : floor;
    tops += qty * rate;
    inventory_sacks += qty;

    // --- per-cultivar breakdown (display-rounded + self-consistent) ---
    // measured/effective are rounded so consumers can recompute
    // projected = round(qty × effective, 1) exactly. Floor branches set
    // effective === floorR so invariant "effective == floor" holds verbatim.
    let measured, effective, rate_source;
    if (own == null) {
      measured = null; effective = floorR; rate_source = 'floor_unknown_cultivar';
    } else if (own <= upperFence) {
      measured = r2(own); effective = r2(own); rate_source = 'own';
    } else {
      measured = r2(own); effective = floorR; rate_source = 'floor_anomaly_high';
    }
    cultivars.push({
      cultivar_name: v.title,
      shopify_variant_id: v.id || null,
      inventory_sacks: qty,
      measured_rate_lbs_per_sack: measured,
      effective_rate_lbs_per_sack: effective,
      rate_source,
      clean_history_sacks: sacksMap.get(v.title) || 0,
      projected_finished_tops_lbs: r1(qty * effective),
    });
  }

  return {
    finished_tops_lbs: Math.round(tops),   // unchanged — tops_remaining relies on this
    inventory_sacks,                        // unchanged
    floor_rate: floorR,
    upper_fence: upperFence === Infinity ? null : r2(upperFence),
    cultivars,
  };
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** One-time backfill from pool API change logs + monthly_production */
async function backfill(body, env) {
  const db = env.DB;
  const results = { supersack_entries: 0, errors: [] };

  const { supersack_changes = [], pool_changes = [], production_data = [] } = body;

  // Group supersack changes by date + strain
  const dateStrainMap = {};

  for (const entry of supersack_changes) {
    const d = new Date(entry.timestamp);
    const dateStr = d.toISOString().slice(0, 10);
    const strain = entry.variantTitle || 'Unknown';
    const key = `${dateStr}|${strain}`;

    if (!dateStrainMap[key]) {
      dateStrainMap[key] = { date: dateStr, strain, sacks: 0, biomass: 0, trim: 0 };
    }
    if (entry.action === 'subtract') {
      dateStrainMap[key].sacks += Math.abs(entry.changeAmount || 0);
    }
  }

  // Parse biomass/trim from pool changes notes
  for (const entry of pool_changes) {
    const note = entry.note || '';
    const match = note.match(/\[Supersack Tracker\]\s*(Biomass|Trim)\s*\+?([\d.]+)\s*lbs\s*\((\d{4}-\d{2}-\d{2})\)/i);
    if (!match) continue;

    const type = match[1].toLowerCase();
    const amount = parseFloat(match[2]);
    const dateStr = match[3];

    const dateEntries = Object.values(dateStrainMap).filter(e => e.date === dateStr);
    const totalSacks = dateEntries.reduce((sum, e) => sum + e.sacks, 0);

    if (totalSacks > 0) {
      for (const e of dateEntries) {
        const ratio = e.sacks / totalSacks;
        e[type] += amount * ratio;
      }
    }
  }

  // Match production data to dates
  const prodByDate = {};
  for (const entry of production_data) {
    const dateStr = entry.date || entry.production_date;
    if (!dateStr) continue;
    if (!prodByDate[dateStr]) prodByDate[dateStr] = { tops: 0, smalls: 0 };
    prodByDate[dateStr].tops += entry.tops_lbs || entry.tops || 0;
    prodByDate[dateStr].smalls += entry.smalls_lbs || entry.smalls || 0;
  }

  // Upsert all entries
  for (const entry of Object.values(dateStrainMap)) {
    if (entry.sacks === 0) continue;

    const raw = entry.sacks * SACK_WEIGHT;
    const prod = prodByDate[entry.date] || { tops: 0, smalls: 0 };

    const sameDayEntries = Object.values(dateStrainMap).filter(e => e.date === entry.date);
    const totalDaySacks = sameDayEntries.reduce((sum, e) => sum + e.sacks, 0);
    const ratio = entry.sacks / totalDaySacks;

    const tops = prod.tops * ratio;
    const smalls = prod.smalls * ratio;
    const waste = Math.max(0, raw - tops - smalls - entry.biomass - entry.trim);

    try {
      await db.prepare(`
        INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, strain) DO UPDATE SET
          sacks_opened = excluded.sacks_opened,
          tops_lbs = excluded.tops_lbs,
          smalls_lbs = excluded.smalls_lbs,
          biomass_lbs = excluded.biomass_lbs,
          trim_lbs = excluded.trim_lbs,
          waste_lbs = excluded.waste_lbs,
          raw_lbs = excluded.raw_lbs,
          updated_at = datetime('now')
      `).bind(entry.date, entry.strain, entry.sacks, tops, smalls, entry.biomass, entry.trim, waste, raw).run();
      results.supersack_entries++;
    } catch (e) {
      results.errors.push(`${entry.date}|${entry.strain}: ${e.message}`);
    }
  }

  return successResponse({ success: true, ...results });
}
