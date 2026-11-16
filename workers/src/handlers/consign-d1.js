/**
 * Consignment lot ledger handler. Route: /api/consign
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md
 * Money rules live in ../lib/consign-ledger.js, not here.
 */
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth, constantTimeEqual } from '../lib/auth.js';
import { pacificDay } from '../lib/pacific.js';
import { checkRun, lotMoney, farmTotals, screenTolerance, round2 } from '../lib/consign-ledger.js';

const OWNER_ACTIONS = new Set(['saveFarm', 'savePricePoint', 'setLotTerms']);

function requireOwner(body, env) {
  const secret = env.CONSIGN_OWNER_PASSWORD;
  const given = typeof body.owner_password === 'string' ? body.owner_password : '';
  // Refuse when the secret is unset. Never fall open.
  if (!secret || !given || !constantTimeEqual(given, secret)) {
    throw createError('UNAUTHORIZED', 'Owner password required');
  }
}

const ok = (data) => successResponse({ success: true, data });
const bad = (msg) => createError('VALIDATION_ERROR', msg);

const TERMS = new Set(['dropoff', 'sold']);
const TYPES = new Set(['tops', 'smalls']);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const posNum = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${label} must be a positive number`);
  return n;
};

async function saveFarm(body, env) {
  const name = clean(body.name);
  if (!name) throw bad('Farm name is required');
  const term = body.default_term || 'dropoff';
  if (!TERMS.has(term)) throw bad('default_term must be dropoff or sold');
  const lang = body.lang === 'es' ? 'es' : 'en';
  const active = body.active === false || body.active === 0 ? 0 : 1;
  let id = Number(body.id) || null;
  if (id) {
    await env.DB.prepare('UPDATE cl_farms SET name = ?, contact = ?, default_term = ?, lang = ?, active = ? WHERE id = ?')
      .bind(name, clean(body.contact) || null, term, lang, active, id).run();
  } else {
    const r = await env.DB.prepare('INSERT INTO cl_farms (name, contact, default_term, lang, active) VALUES (?, ?, ?, ?, ?)')
      .bind(name, clean(body.contact) || null, term, lang, active).run();
    id = r.meta.last_row_id;
  }
  const farm = await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ?').bind(id).first();
  if (!farm) throw createError('NOT_FOUND', 'Farm not found');
  return ok({ farm });
}

/** Latest price point on or before a day. Returns null when none. */
async function priceFor(env, farmId, cultivar, type, day) {
  const row = await env.DB.prepare(
    'SELECT price_per_lb FROM cl_price_points WHERE farm_id = ? AND cultivar = ? AND type = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1'
  ).bind(farmId, cultivar, type, day).first();
  return row ? row.price_per_lb : null;
}

async function savePricePoint(body, env) {
  const farmId = Number(body.farm_id);
  const cultivar = clean(body.cultivar);
  if (!farmId || !cultivar) throw bad('farm_id and cultivar are required');
  if (!TYPES.has(body.type)) throw bad('type must be tops or smalls');
  const p = posNum(body.price_per_lb, 'Price per lb');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body.effective_from || '') ? body.effective_from : pacificDay(new Date());
  const r = await env.DB.prepare(
    'INSERT INTO cl_price_points (farm_id, cultivar, type, price_per_lb, effective_from) VALUES (?, ?, ?, ?, ?)'
  ).bind(farmId, cultivar, body.type, p, from).run();

  // Optional: fill lots that were dropped off before a price existed. Never overwrites a price.
  let lotsPriced = 0;
  if (body.apply_to_unpriced) {
    const a = await env.DB.prepare(
      'UPDATE cl_lots SET price_per_lb = ? WHERE farm_id = ? AND cultivar = ? AND type = ? AND price_per_lb IS NULL AND voided_at IS NULL'
    ).bind(p, farmId, cultivar, body.type).run();
    lotsPriced += a.meta.changes;
    if (body.type === 'smalls') {
      const b = await env.DB.prepare(
        "UPDATE cl_lots SET smalls_price_per_lb = ? WHERE farm_id = ? AND cultivar = ? AND type = 'tops' AND smalls_price_per_lb IS NULL AND voided_at IS NULL"
      ).bind(p, farmId, cultivar).run();
      lotsPriced += b.meta.changes;
    }
  }
  const price_point = await env.DB.prepare('SELECT * FROM cl_price_points WHERE id = ?').bind(r.meta.last_row_id).first();
  return ok({ price_point, lots_priced: lotsPriced });
}

/** Load lots (with runs, sold, money) for a WHERE clause on cl_lots aliased l. */
async function loadLots(env, where, args) {
  const lots = (await env.DB.prepare(
    `SELECT l.*, f.name AS farm_name, d.dropped_at FROM cl_lots l
     JOIN cl_farms f ON f.id = l.farm_id JOIN cl_dropoffs d ON d.id = l.dropoff_id
     WHERE ${where} ORDER BY l.id`
  ).bind(...args).all()).results;
  if (!lots.length) return [];
  const runs = (await env.DB.prepare(
    `SELECT r.* FROM cl_screen_runs r JOIN cl_lots l ON l.id = r.lot_id WHERE ${where} ORDER BY r.id`
  ).bind(...args).all()).results;
  const sold = (await env.DB.prepare(
    `SELECT s.* FROM cl_sold s JOIN cl_lots l ON l.id = s.lot_id WHERE ${where} ORDER BY s.id`
  ).bind(...args).all()).results;
  return lots.map((lot) => {
    const r = runs.filter((x) => x.lot_id === lot.id);
    const s = sold.filter((x) => x.lot_id === lot.id);
    return { ...lot, runs: r, sold: s, money: lotMoney(lot, r, s) };
  });
}

async function dropoffDetail(env, dropoffId, extra = {}) {
  const dropoff = await env.DB.prepare(
    'SELECT d.*, f.name AS farm_name FROM cl_dropoffs d JOIN cl_farms f ON f.id = d.farm_id WHERE d.id = ?'
  ).bind(dropoffId).first();
  if (!dropoff) throw createError('NOT_FOUND', 'Dropoff not found');
  const lots = await loadLots(env, 'l.dropoff_id = ?', [dropoffId]);
  return ok({ dropoff, lots, ...extra });
}

async function saveDropoff(body, env) {
  const farmId = Number(body.farm_id);
  const farm = farmId ? await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ? AND active = 1').bind(farmId).first() : null;
  if (!farm) throw bad('Unknown farm');
  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) throw bad('A dropoff needs at least one line');

  const key = clean(body.client_key) || crypto.randomUUID();
  const existing = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  if (existing) return dropoffDetail(env, existing.id, { duplicate: true });

  // Validate every line before anything is written.
  const seen = new Set();
  const lines = raw.map((ln, i) => {
    const cultivar = clean(ln.cultivar);
    if (!cultivar) throw bad(`Line ${i + 1}: cultivar is required`);
    if (!TYPES.has(ln.type)) throw bad(`Line ${i + 1}: type must be tops or smalls`);
    const term = ln.term || farm.default_term;
    if (!TERMS.has(term)) throw bad(`Line ${i + 1}: term must be dropoff or sold`);
    const intake = ln.intake_lbs === '' || ln.intake_lbs == null ? null : posNum(ln.intake_lbs, `Line ${i + 1}: weight`);
    const k = `${cultivar.toLowerCase()}|${ln.type}|${term}`;
    if (seen.has(k)) throw bad(`Line ${i + 1}: ${cultivar} ${ln.type} is listed twice`);
    seen.add(k);
    return { cultivar, type: ln.type, term, intake, note: clean(ln.note) || null };
  });

  const today = pacificDay(new Date());
  for (const ln of lines) {
    ln.price = await priceFor(env, farmId, ln.cultivar, ln.type, today);
    ln.smallsPrice = ln.type === 'tops' ? await priceFor(env, farmId, ln.cultivar, 'smalls', today) : null;
  }

  const source = ['paper', 'telegram'].includes(body.source) ? body.source : 'app';
  const stmts = [
    env.DB.prepare('INSERT INTO cl_dropoffs (farm_id, dropped_by, note, source, client_key) VALUES (?, ?, ?, ?, ?)')
      .bind(farmId, clean(body.dropped_by) || null, clean(body.note) || null, source, key),
    ...lines.map((ln) => env.DB.prepare(
      `INSERT INTO cl_lots (dropoff_id, farm_id, cultivar, type, term, intake_lbs, weighed_at, price_per_lb, smalls_price_per_lb, note)
       VALUES ((SELECT id FROM cl_dropoffs WHERE client_key = ?), ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?, ?, ?)`
    ).bind(key, farmId, ln.cultivar, ln.type, ln.term, ln.intake, ln.intake, ln.price, ln.smallsPrice, ln.note)),
  ];
  await env.DB.batch(stmts);
  const row = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  return dropoffDetail(env, row.id);
}

export async function handleConsignD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  requireAuth(request, body, env, `consign-${action}`);
  if (OWNER_ACTIONS.has(action)) requireOwner(body, env);

  switch (action) {
    case 'saveFarm': return saveFarm(body, env);
    case 'savePricePoint': return savePricePoint(body, env);
    case 'saveDropoff': return saveDropoff(body, env);
    case 'dropoff': return dropoffDetail(env, Number(body.dropoff_id));
    default:
      throw createError('NOT_FOUND', `Unknown consign action: ${action}`);
  }
}
