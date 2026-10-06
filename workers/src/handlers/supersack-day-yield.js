/**
 * End of day for scanned (2026+) supersacks — the form's side of scan-out.
 *
 *   GET  /api/supersack?action=scanned_day&date=YYYY-MM-DD
 *   POST /api/supersack?action=day_yield   { date }
 *
 * From 2026 every sack leaves inventory by being scanned at the trim line; the
 * scan is the Shopify subtract. The end-of-day form therefore stops TYPING the
 * sack count for those strains and reads it from here instead, or every sack
 * would leave Shopify twice.
 *
 * Reads `harvest_sacks` directly (contract: it must not wait for Track A's
 * endpoint) with the same definition: opened_at inside the Pacific day,
 * is_test matching the mode, voided_at IS NULL.
 */
import { successResponse, errorResponse } from '../lib/response.js';
import { handleAllocate, pacificDayRange } from './harvest-d1.js';
import { floorOutputByCultivar, cutFromStrainTitle, harvestTypeFromStrainTitle } from '../lib/floor-output.js';

// Same rule as harvest-d1's isTestMode: test unless explicitly switched off.
const isTest = (env) => (env.HARVEST_TEST_MODE !== 'false' ? 1 : 0);

/**
 * The mode as harvest-d1's withSettings resolves it: a preview build is always
 * test; otherwise the farm's DB switch (harvest_settings.test_mode) overrides
 * the deployed env var. Replicated (harvest-d1 does not export withSettings)
 * because reading only the env var would show real sacks while the harvest
 * screens are in test mode, or the reverse. The resolved env is also what
 * handleAllocate gets, so both sides of day_yield read the same set.
 */
async function modeEnv(env) {
  if (env?.HARVEST_FORCE_TEST === 'true') return { ...env, HARVEST_TEST_MODE: 'true' };
  if (!env?.DB) return env;
  try {
    const row = await env.DB.prepare(`SELECT value FROM harvest_settings WHERE key = 'test_mode'`).bind().first();
    if (row) return { ...env, HARVEST_TEST_MODE: String(row.value) === 'true' ? 'true' : 'false' };
  } catch { /* unreadable settings: the deployed value stands, as in harvest-d1 */ }
  return env;
}

/** A real calendar day, not just the right shape ("2026-02-31" is refused). */
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === day;
}
// The year prefix is structural (see floor-output.js seasonFromStrainTitle);
// the cultivar name is NOT parsed — it comes from cultivar_aliases.
const seasonOf = (title) => { const m = String(title || '').match(/^\s*(\d{4})\s*-/); return m ? Number(m[1]) : null; };
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

async function all(db, sql, args = []) {
  const r = await db.prepare(sql).bind(...args).all();
  return r.results || [];
}

async function scannedSacks(db, env, day) {
  const [start, end] = pacificDayRange(day);
  return all(db, `
    SELECT * FROM harvest_sacks
    WHERE opened_at >= ? AND opened_at < ? AND is_test = ? AND voided_at IS NULL
    ORDER BY season, cultivar, serial`, [start, end, isTest(env)]);
}

/** Floor strain titles that alias to each cultivar NAME, for one season. */
async function titlesByCultivar(db, names) {
  const list = [...new Set(names.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await all(db, `
    SELECT a.alias, c.name FROM cultivar_aliases a JOIN cultivars c ON c.id = a.cultivar_id
    WHERE c.name IN (${list.map(() => '?').join(',')})`, list);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.name)) out.set(r.name, []);
    out.get(r.name).push(r.alias);
  }
  return out;
}

/**
 * by_strain, as the contract shapes it, plus two additive fields the form
 * needs to land a sack on the right ROW: one cultivar is several rows when it
 * has several cuts ("… / 1st Cut", "… / 2nd Cut"), and each row is a Shopify
 * variant. `by_variant` splits the count by the tag's shopify_variant_id;
 * `no_variant` lists sacks whose tag carries none, which the form may place
 * only when the cultivar has exactly one row that season and must otherwise
 * report.
 */
/**
 * The titles that name THIS cut. A cut-specific alias ("… / 1st Cut") is kept
 * only for its own cut; a cut-less alias ("… / Sungrown") names every cut, so
 * from 2026 (when variant titles carry the cut) it is shown with this cut's
 * suffix, the title the floor actually types. Harvest type must agree with the
 * zone when the title carries one.
 */
const ORD = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
function titlesForCut(aliases, s) {
  const cut = s.cut_number == null ? null : Number(s.cut_number);
  const type = /^GH/i.test(String(s.zone || '')) ? 'Greenhouse' : 'Sungrown';
  const out = new Set();
  for (const t of aliases) {
    if (seasonOf(t) !== Number(s.season)) continue;
    const tType = harvestTypeFromStrainTitle(t);
    if (tType && tType !== type) continue;
    const tCut = cutFromStrainTitle(t);
    if (tCut != null) { if (tCut === cut) out.add(t); continue; }
    out.add(cut != null && Number(s.season) >= 2026 ? `${t} / ${cut}${ORD(cut)} Cut` : t);
  }
  return [...out].sort();
}

export async function scannedDay(db, env, day) {
  const sacks = await scannedSacks(db, env, day);
  const titles = await titlesByCultivar(db, sacks.map(s => s.cultivar));
  const groups = new Map();
  const byVariant = new Map();
  const noVariant = [];
  for (const s of sacks) {
    const key = `${s.season}|${s.cultivar}|${s.cut_number}`;
    if (!groups.has(key)) {
      groups.set(key, {
        season: s.season, cultivar: s.cultivar, cut_number: s.cut_number, sacks: 0,
        strain_titles: titlesForCut(titles.get(s.cultivar) || [], s),
        by_variant: [], no_variant: [],
      });
    }
    const g = groups.get(key);
    g.sacks++;
    if (s.shopify_variant_id) {
      let v = g.by_variant.find(x => String(x.shopify_variant_id) === String(s.shopify_variant_id));
      if (!v) g.by_variant.push(v = { shopify_variant_id: String(s.shopify_variant_id), cut_number: s.cut_number, sacks: 0 });
      v.sacks++;
      const vk = `${s.shopify_variant_id}|${s.cut_number}`;
      if (!byVariant.has(vk)) byVariant.set(vk, { shopify_variant_id: String(s.shopify_variant_id), season: s.season, cultivar: s.cultivar, cut_number: s.cut_number, sacks: 0 });
      byVariant.get(vk).sacks++;
    } else {
      g.no_variant.push({ sack_id: s.sack_id, cut_number: s.cut_number });
      noVariant.push({ sack_id: s.sack_id, season: s.season, cultivar: s.cultivar, cut_number: s.cut_number });
    }
  }
  return { by_strain: [...groups.values()], by_variant: [...byVariant.values()], no_variant: noVariant };
}

export async function handleScannedDay(db, env, params) {
  const day = String(params?.date || '');
  if (!validDay(day)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const menv = await modeEnv(env);
  return successResponse({ success: true, date: day, is_test: !!isTest(menv), ...(await scannedDay(db, menv, day)) });
}

/**
 * Run the day's allocation now and show what each scanned sack produced.
 * Today is allowed on purpose: the nightly cron stops at yesterday, but this
 * is the explicit end-of-day action, and allocation is idempotent.
 */
export async function handleDayYield(db, envIn, body) {
  const day = String(body?.date || '');
  if (!validDay(day)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const env = await modeEnv(envIn);
  // handleAllocate answers with a Response whose body is the payload itself
  // (successResponse does not wrap). A throw or an error body is reported, not
  // turned into an empty-looking day.
  let a;
  try {
    const res = await handleAllocate(db, env, { date: day });
    a = await res.json();
    if (!res.ok || a.success === false) {
      return errorResponse(`allocation failed: ${a.error || res.status}`, 'ALLOCATE_FAILED', 500);
    }
  } catch (e) {
    return errorResponse(`allocation failed: ${e?.message || e}`, 'ALLOCATE_FAILED', 500);
  }
  // With no tagged bag opened, handleAllocate returns early and never reads the
  // floor — but floor output on a zero-scan day is exactly a missed scan.
  if (!a.floor_output_without_tagged_bags) {
    try {
      const { byKey, unresolved } = await floorOutputByCultivar(db, env, day);
      a.unresolved_floor_strains = unresolved;
      a.floor_output_without_tagged_bags = [...byKey.values()].map(f => ({
        season: f.season, cultivar: f.cultivar, cut_number: f.cut, harvest_type: f.harvest_type,
        strain_titles: f.titles,
        floor: { tops: f.tops, smalls: f.smalls, biomass: f.biomass, trim: f.trim, waste: f.waste },
        floor_sacks_opened: f.floorSacks,
      }));
    } catch (e) {
      return errorResponse(`floor output unreadable: ${e?.message || e}`, 'ALLOCATE_FAILED', 500);
    }
  }

  const sacks = await scannedSacks(db, env, day);
  const orderIds = [...new Set(sacks.map(s => s.out_order_id).filter(Boolean))];
  const nick = new Map();
  if (orderIds.length) {
    for (const o of await all(db, `SELECT id, nickname FROM orders WHERE id IN (${orderIds.map(() => '?').join(',')})`, orderIds)) {
      nick.set(String(o.id), o.nickname || null);
    }
  }
  const groups = new Map();
  const withoutOutput = new Map();
  for (const s of sacks) {
    const orderId = s.out_order_id || null;
    const key = [s.season, s.cultivar, s.zone, s.cut_number, orderId].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        season: s.season, cultivar: s.cultivar, zone: s.zone, cut_number: s.cut_number,
        order: orderId ? { id: orderId, nickname: nick.get(String(orderId)) ?? null } : null,
        sacks: 0, tops: 0, smalls: 0, biomass: 0, trim: 0, waste: 0,
      });
    }
    const g = groups.get(key);
    g.sacks++;
    for (const k of ['tops', 'smalls', 'biomass', 'trim', 'waste']) g[k] += Number(s[`${k}_lbs`]) || 0;
    // A scanned sack the floor recorded nothing for: no allocation stamp and no
    // measured weights. Its output is still owed to it.
    if (!s.weights_source) {
      // Keyed like the allocator: a 1st Cut bag left empty while the 2nd Cut
      // got its row is its own line, not folded into the cultivar.
      const type = /^GH/i.test(String(s.zone || '')) ? 'Greenhouse' : 'Sungrown';
      const k2 = `${s.season}|${s.cultivar}|${s.cut_number ?? ''}|${type}`;
      const u = withoutOutput.get(k2) || { kind: 'scanned_without_output', season: s.season, cultivar: s.cultivar,
        cut_number: s.cut_number ?? null, harvest_type: type, sacks: 0 };
      u.sacks++;
      withoutOutput.set(k2, u);
    }
  }
  for (const g of groups.values()) for (const k of ['tops', 'smalls', 'biomass', 'trim', 'waste']) g[k] = round1(g[k]);

  const unallocated = [
    ...(a.floor_output_without_tagged_bags || []).map(f => ({ kind: 'output_without_scans', ...f })),
    ...(a.unresolved_floor_strains || []).map(t => ({ kind: 'unknown_strain', strain: t })),
    ...withoutOutput.values(),
  ];
  return successResponse({
    success: true, date: day, is_test: !!isTest(env), groups: [...groups.values()],
    mismatches: a.sack_count_mismatches || [], unallocated,
    // Output the floor logged without a cut and that was split across several
    // cuts' bags: those groups show a cultivar average, not each cut's yield.
    pooled_across_cuts: a.pooled_across_cuts || [],
  });
}
