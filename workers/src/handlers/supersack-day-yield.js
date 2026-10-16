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
import { floorOutputByCultivar, cutFromStrainTitle, harvestTypeFromStrainTitle, resolveCultivars } from '../lib/floor-output.js';
import { variantTitle } from '../lib/supersack-inventory.js';
import { fullSackLbs } from '../lib/sack-weight.js';

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

// ---------------------------------------------------------------------------
// Cerrar día on /salida — design: docs/plans/2026-10-16-salida-close-day-design.md
//
//   GET  /api/supersack?action=close_day_preview&date=YYYY-MM-DD
//   POST /api/supersack?action=close_day   { date, biomass_lbs, trim_lbs }
//
// The only end-of-day numbers that exist nowhere else are Biomass #2 and
// Premium #1. Sacks come from the day's scans, tops and smalls from the hourly
// log, and the two weights are shared across cultivars by sacks scanned. One
// supersack_entries row per scanned (season, cultivar, cut, harvest type),
// then the day's allocation runs so the yield is on screen before the crew
// goes home. Shopify is never touched: the scans already took the sacks out.
// ---------------------------------------------------------------------------

const FIRST_SCANNED_SEASON = 2026;
const harvestTypeOfZone = (zone) => (/^GH/i.test(String(zone || '')) ? 'Greenhouse' : 'Sungrown');
// The floor's civil day, the one the hourly log and the scans are keyed on.
const pacificToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * Tops and smalls the floor logged that day, per (season, cultivar name,
 * cut-or-null, harvest-type-or-null). Both lines count. Titles are resolved
 * through cultivar_aliases, never parsed for the name; a title no alias knows
 * is listed in `unresolved` so the panel can say so instead of showing 0.
 */
async function hourlyOutput(db, day) {
  const rows = await all(db, `
    SELECT time_slot, cultivar1, tops_lbs1, smalls_lbs1, cultivar2, tops_lbs2, smalls_lbs2
    FROM monthly_production WHERE production_date = ?`, [day]);
  const lines = [];
  for (const r of rows) {
    if (r.cultivar1) lines.push({ title: r.cultivar1, tops: Number(r.tops_lbs1) || 0, smalls: Number(r.smalls_lbs1) || 0 });
    if (r.cultivar2) lines.push({ title: r.cultivar2, tops: Number(r.tops_lbs2) || 0, smalls: Number(r.smalls_lbs2) || 0 });
  }
  const names = await resolveCultivars(db, lines.map(l => l.title));
  const out = [];
  const unresolved = new Set();
  for (const l of lines) {
    const name = names.get(String(l.title).toLowerCase());
    const season = seasonOf(l.title);
    if (!name || !season) { if (l.tops || l.smalls) unresolved.add(l.title); continue; }
    out.push({ season, cultivar: name, cut: cutFromStrainTitle(l.title),
      type: harvestTypeFromStrainTitle(l.title), tops: l.tops, smalls: l.smalls });
  }
  const slots = new Set(rows.filter(r => r.cultivar1 || r.cultivar2).map(r => r.time_slot));
  return { lines: out, unresolved: [...unresolved], hours: slots.size };
}

/** The 2026+ sacks scanned that day, one group per (season, cultivar, cut, type). */
async function scannedGroups(db, env, day) {
  const sacks = (await scannedSacks(db, env, day)).filter(s => Number(s.season) >= FIRST_SCANNED_SEASON);
  const groups = new Map();
  for (const s of sacks) {
    const cut = s.cut_number == null ? null : Number(s.cut_number);
    const type = harvestTypeOfZone(s.zone);
    const key = `${s.season}|${s.cultivar}|${cut ?? ''}|${type}`;
    if (!groups.has(key)) {
      groups.set(key, { season: Number(s.season), cultivar: s.cultivar, cut_number: cut, harvest_type: type,
        title: variantTitle(s.season, s.cultivar, type, cut), sacks: 0 });
    }
    groups.get(key).sacks++;
  }
  // First cut first within a cultivar, so the cut-less hourly pounds land on it.
  return [...groups.values()].sort((a, b) => a.season - b.season || a.cultivar.localeCompare(b.cultivar)
    || a.harvest_type.localeCompare(b.harvest_type) || (a.cut_number ?? 0) - (b.cut_number ?? 0));
}

/**
 * Lay the hourly pounds on the scanned groups. A line that names a cut goes to
 * that cut; a cut-less line (every hourly title) goes to the cultivar's first
 * scanned cut, and later cuts point at it with `pounds_on`, exactly as the
 * form reports "pounds for both cuts are combined on the first row".
 */
function layPounds(groups, hourly) {
  for (const g of groups) { g.tops = 0; g.smalls = 0; g.pounds_on = null; g.alias_missing = false; }
  const sameLot = (g, l) => g.season === l.season && g.cultivar === l.cultivar && (!l.type || g.harvest_type === l.type);
  for (const l of hourly.lines) {
    const target = l.cut != null ? groups.find(g => sameLot(g, l) && g.cut_number === l.cut) : groups.find(g => sameLot(g, l));
    if (!target) continue;
    target.tops += l.tops; target.smalls += l.smalls;
  }
  for (const g of groups) {
    const first = groups.find(x => x.season === g.season && x.cultivar === g.cultivar && x.harvest_type === g.harvest_type);
    if (first !== g && !g.tops && !g.smalls) g.pounds_on = first.title;
    g.tops = round1(g.tops); g.smalls = round1(g.smalls);
    // No hourly line resolved to this cultivar while some title went
    // unresolved: 0 would be a silent lie, so the panel says "sin alias".
    const anyLine = hourly.lines.some(l => l.season === g.season && l.cultivar === g.cultivar);
    g.alias_missing = !anyLine && hourly.unresolved.length > 0;
  }
  return groups;
}

async function existingWeights(db, day, groups) {
  if (!groups.length) return null;
  const rows = await all(db, `SELECT biomass_lbs, trim_lbs FROM supersack_entries
    WHERE date = ? AND strain IN (${groups.map(() => '?').join(',')})`, [day, ...groups.map(g => g.title)]);
  if (!rows.length) return null;
  const sum = (k) => round1(rows.reduce((n, r) => n + (Number(r[k]) || 0), 0));
  return { biomass_lbs: sum('biomass_lbs'), trim_lbs: sum('trim_lbs') };
}

export async function handleCloseDayPreview(db, envIn, params) {
  const day = String(params?.date || '') || pacificToday();
  if (!validDay(day)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const env = await modeEnv(envIn);
  const groups = await scannedGroups(db, env, day);
  const hourly = await hourlyOutput(db, day);
  layPounds(groups, hourly);
  return successResponse({ success: true, date: day, is_test: !!isTest(env), groups, hours_logged: hourly.hours,
    unresolved_strains: hourly.unresolved, existing: await existingWeights(db, day, groups) });
}

/** A weight as typed: a finite number, zero or more. Anything else is refused. */
const lbs = (v) => { const n = Number(v); return v != null && String(v).trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null; };

export async function handleCloseDay(db, envIn, body) {
  const day = String(body?.date || '') || pacificToday();
  if (!validDay(day)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const biomass = lbs(body?.biomass_lbs), trim = lbs(body?.trim_lbs);
  if (biomass == null || trim == null) return errorResponse('biomass_lbs and trim_lbs must be numbers >= 0', 'VALIDATION_ERROR', 400);
  if (trim > biomass) {
    return errorResponse('Premium #1 Trim cannot weigh more than Biomass #2 — check which box is which', 'VALIDATION_ERROR', 400);
  }
  const env = await modeEnv(envIn);
  const groups = await scannedGroups(db, env, day);
  if (!groups.length) return errorResponse('No sacks scanned that day — nothing to close', 'VALIDATION_ERROR', 400);
  layPounds(groups, await hourlyOutput(db, day));
  const before = await existingWeights(db, day, groups);

  const totalSacks = groups.reduce((n, g) => n + g.sacks, 0);
  const written = [];
  for (const g of groups) {
    const share = g.sacks / totalSacks;
    const bio = round1(biomass * share), tr = round1(trim * share);
    const raw = g.sacks * fullSackLbs(g.season);
    const waste = round1(Math.max(0, raw - g.tops - g.smalls - bio - tr));
    await db.prepare(`
      INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, strain) DO UPDATE SET
        sacks_opened = excluded.sacks_opened, tops_lbs = excluded.tops_lbs, smalls_lbs = excluded.smalls_lbs,
        biomass_lbs = excluded.biomass_lbs, trim_lbs = excluded.trim_lbs, waste_lbs = excluded.waste_lbs,
        raw_lbs = excluded.raw_lbs, updated_at = datetime('now')
    `).bind(day, g.title, g.sacks, g.tops, g.smalls, bio, tr, waste, raw).run();
    written.push({ title: g.title, season: g.season, cultivar: g.cultivar, cut_number: g.cut_number,
      sacks: g.sacks, tops: g.tops, smalls: g.smalls, biomass: bio, trim: tr, waste, raw });
  }
  // The pools move by what changed since the last close of this day, so a
  // corrected weight is not added twice. The save above stands either way.
  const pool_errors = await movePools(env, day, {
    biomass: biomass - (before ? before.biomass_lbs : 0), trim: trim - (before ? before.trim_lbs : 0) });

  const yres = await handleDayYield(db, env, { date: day });
  const y = await yres.json();
  if (!yres.ok || y.success === false) {
    return errorResponse(`saved, but allocation failed: ${y.error || yres.status}`, 'ALLOCATE_FAILED', 500);
  }
  return successResponse({ success: true, date: day, rows: written, pool_errors, yield: y });
}

// The form added the day's biomass and trim to two Shopify pool products in
// grams, through the same Apps Script proxy; the close does the same. The
// products are found by title, as the form found them.
const LBS_TO_GRAMS = 453.592;
const POOL_PRODUCTS = [
  { key: 'biomass', label: 'Biomass', match: /CBD Biomass.*Trim/i },
  { key: 'trim', label: 'Trim', match: /Premium CBD Flower Trim/i },
];
async function poolCall(env, body) {
  const r = await fetch(env.POOL_INVENTORY_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow',
    body: JSON.stringify({ apiKey: env.POOL_INVENTORY_API_KEY, ...body }),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`pool API returned non-JSON: ${text.slice(0, 120)}`); }
  if (data.error) throw new Error(String(data.error));
  return data;
}
async function movePools(env, day, delta) {
  const moves = POOL_PRODUCTS.filter(p => Math.abs(delta[p.key]) >= 0.05);
  if (!moves.length) return [];
  if (!env.POOL_INVENTORY_API_URL || !env.POOL_INVENTORY_API_KEY) return ['pool not configured'];
  const errors = [];
  let products;
  try { products = (await poolCall(env, { action: 'list_products', poolType: 'trim' })).products || []; }
  catch (e) { return moves.map(p => `${p.label}: ${e.message}`); }
  for (const p of moves) {
    const product = products.find(x => p.match.test(String(x.title || '')));
    if (!product) { errors.push(`${p.label}: no pool product`); continue; }
    const lbsDelta = round1(delta[p.key]);
    const sign = lbsDelta > 0 ? '+' : '-';
    try {
      await poolCall(env, { action: 'update_pool', productId: product.id, operation: lbsDelta > 0 ? 'add' : 'subtract',
        amount: Math.round(Math.abs(lbsDelta) * LBS_TO_GRAMS * 10) / 10, poolType: 'trim',
        note: `[Salida] ${p.label} ${sign}${Math.abs(lbsDelta)} lbs (${day})` });
    } catch (e) { errors.push(`${p.label}: ${e.message}`); }
  }
  return errors;
}
