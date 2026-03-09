/**
 * Supersack Analytics API Handler
 * Manages supersack_entries table for historical tracking + analytics.
 *
 * Actions:
 *   submit   (POST) — upsert supersack entry per date+strain
 *   history  (GET)  — query date range, returns daily entries
 *   summary  (GET)  — aggregated KPIs for a date range (by day/week/month)
 *   backfill (POST) — one-time backfill from pool API + production data
 */

import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';

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

  // Per-strain sack counts from the tracker
  if (strains && typeof strains === 'object') {
    const strainEntries = Object.entries(strains).filter(([, count]) => count > 0);
    const totalSacks = strainEntries.reduce((sum, [, count]) => sum + count, 0);

    for (const [strain, sacks] of strainEntries) {
      const ratio = sacks / totalSacks;
      const raw = sacks * SACK_WEIGHT;
      const strainTops = tops_lbs * ratio;
      const strainSmalls = smalls_lbs * ratio;
      const strainBio = biomass_lbs * ratio;
      const strainTrim = trim_lbs * ratio;
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

    return successResponse({ success: true, entries: strainEntries.length });
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
  const { start, end, strain } = params;
  const db = env.DB;

  let sql = 'SELECT * FROM supersack_entries WHERE 1=1';
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }

  sql += ' ORDER BY date DESC, strain';

  const result = await db.prepare(sql).bind(...binds).all();
  return successResponse({ entries: result.results });
}

/** Aggregated summary for date range */
async function summary(params, env) {
  const { start, end, strain, group_by = 'day' } = params;
  const db = env.DB;

  const groupExpr = group_by === 'month' ? "strftime('%Y-%m', date)"
    : group_by === 'week' ? "strftime('%Y-W%W', date)"
    : 'date';

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
    FROM supersack_entries WHERE 1=1`;
  const binds = [];

  if (start) { sql += ' AND date >= ?'; binds.push(start); }
  if (end) { sql += ' AND date <= ?'; binds.push(end); }
  if (strain) { sql += ' AND strain = ?'; binds.push(strain); }

  sql += ` GROUP BY ${groupExpr} ORDER BY period DESC`;

  const result = await db.prepare(sql).bind(...binds).all();

  // Per-strain totals
  let strainSql = `
    SELECT strain,
      SUM(sacks_opened) as total_sacks,
      SUM(raw_lbs) as total_raw,
      SUM(tops_lbs) as total_tops,
      SUM(smalls_lbs) as total_smalls,
      SUM(biomass_lbs) as total_biomass,
      SUM(trim_lbs) as total_trim,
      SUM(waste_lbs) as total_waste,
      COUNT(DISTINCT date) as days_worked
    FROM supersack_entries WHERE 1=1`;
  const strainBinds = [];

  if (start) { strainSql += ' AND date >= ?'; strainBinds.push(start); }
  if (end) { strainSql += ' AND date <= ?'; strainBinds.push(end); }

  strainSql += ' GROUP BY strain ORDER BY total_sacks DESC';

  const strainResult = await db.prepare(strainSql).bind(...strainBinds).all();

  return successResponse({
    periods: result.results,
    strains: strainResult.results,
  });
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
