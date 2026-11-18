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
import { normalizeSheetRead } from '../lib/consign-sheet.js';
import { dropoffPrompt, screenPrompt } from '../lib/consign-sheet-prompt.js';
import { getConfig } from '../lib/production-utils.js';
import { newToken, tokenHash, lockState, MAX_LOCKOUTS } from '../lib/consign-access.js';
import { staffView } from '../lib/consign-staff-view.js';

const OWNER_ACTIONS = new Set(['saveFarm', 'savePricePoint', 'setLotTerms', 'issueFarmAccess', 'revokeFarmAccess', 'savePayment']);

/** Is this the owner? Never throws. False when the secret is unset: never falls open. */
export function isOwner(body, env) {
  const secret = env && env.CONSIGN_OWNER_PASSWORD;
  const given = body && typeof body.owner_password === 'string' ? body.owner_password : '';
  return !!secret && typeof secret === 'string' && !!given && constantTimeEqual(given, secret);
}

function requireOwner(body, env) {
  if (!isOwner(body, env)) throw createError('UNAUTHORIZED', 'Owner password required');
}

/** An owner-only call: the actions above, plus voiding a payment. */
const ownerOnly = (action, body) => OWNER_ACTIONS.has(action) || (action === 'voidRow' && body.table === 'payment');

// Handlers return their reply's data; handleConsignD1 sends it, through the staff view for non-owners.
const ok = (data) => data;
const bad = (msg) => createError('VALIDATION_ERROR', msg);

const TERMS = new Set(['dropoff', 'sold']);
const TYPES = new Set(['tops', 'smalls']);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
/** A UNIQUE failure on client_key: a resend racing the first send. */
const isKeyClash = (e) => /UNIQUE constraint failed: \w+\.client_key/i.test(String(e && e.message));
const isNameClash = (e) => /UNIQUE constraint failed: cl_farms\.name/i.test(String(e && e.message));
/** A number as typed: a finite number, or a plain decimal string ("12.5"). Arrays, booleans, hex: NaN. */
const strictNum = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return NaN;
};
/** Largest weight one dropoff line may carry, in lb. */
const MAX_LINE_LBS = 100000;
const posNum = (v, label) => {
  const n = strictNum(v);
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
  try {
    if (id) {
      await env.DB.prepare('UPDATE cl_farms SET name = ?, contact = ?, default_term = ?, lang = ?, active = ? WHERE id = ?')
        .bind(name, clean(body.contact) || null, term, lang, active, id).run();
    } else {
      const r = await env.DB.prepare('INSERT INTO cl_farms (name, contact, default_term, lang, active) VALUES (?, ?, ?, ?, ?)')
        .bind(name, clean(body.contact) || null, term, lang, active).run();
      id = r.meta.last_row_id;
    }
  } catch (e) {
    if (isNameClash(e)) throw bad(`A farm named ${name} already exists`);
    throw e;
  }
  const farm = await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ?').bind(id).first();
  if (!farm) throw createError('NOT_FOUND', 'Farm not found');
  return ok({ farm });
}

/** Latest price point on or before a day. Returns null when none. */
async function priceFor(env, farmId, cultivar, type, day) {
  const row = await env.DB.prepare(
    'SELECT price_per_lb FROM cl_price_points WHERE farm_id = ? AND cultivar = ? COLLATE NOCASE AND type = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1'
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
      'UPDATE cl_lots SET price_per_lb = ? WHERE farm_id = ? AND cultivar = ? COLLATE NOCASE AND type = ? AND price_per_lb IS NULL AND voided_at IS NULL'
    ).bind(p, farmId, cultivar, body.type).run();
    lotsPriced += a.meta.changes;
    if (body.type === 'smalls') {
      const b = await env.DB.prepare(
        "UPDATE cl_lots SET smalls_price_per_lb = ? WHERE farm_id = ? AND cultivar = ? COLLATE NOCASE AND type = 'tops' AND smalls_price_per_lb IS NULL AND voided_at IS NULL"
      ).bind(p, farmId, cultivar).run();
      lotsPriced += b.meta.changes;
    }
  }
  const price_point = await env.DB.prepare('SELECT * FROM cl_price_points WHERE id = ?').bind(r.meta.last_row_id).first();
  return ok({ price_point, lots_priced: lotsPriced });
}

/** Load lots (with runs, sold, money) for a WHERE clause on cl_lots aliased l. */
async function loadLots(env, where, args) {
  // Skip .bind() when there is nothing to bind.
  const q = (sql) => { const st = env.DB.prepare(sql); return args.length ? st.bind(...args) : st; };
  const lots = (await q(
    `SELECT l.*, f.name AS farm_name, d.dropped_at FROM cl_lots l
     JOIN cl_farms f ON f.id = l.farm_id JOIN cl_dropoffs d ON d.id = l.dropoff_id
     WHERE ${where} ORDER BY l.id`
  ).all()).results;
  if (!lots.length) return [];
  const runs = (await q(
    `SELECT r.* FROM cl_screen_runs r JOIN cl_lots l ON l.id = r.lot_id WHERE ${where} ORDER BY r.id`
  ).all()).results;
  const sold = (await q(
    `SELECT s.* FROM cl_sold s JOIN cl_lots l ON l.id = s.lot_id WHERE ${where} ORDER BY s.id`
  ).all()).results;
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

/** A required number >= 0 (a final weight): empty is missing, not 0. */
const reqNonNeg = (v, label) => {
  if (v === '' || v == null) throw bad(`${label} is required`);
  const n = strictNum(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_LINE_LBS) throw bad(`${label} must be a number, 0 or more`);
  return n;
};

/**
 * A dropoff line's final (lot finished at dropoff) -> the screening run it saves.
 * Same rule as a screening run (checkRun): the outputs must add up to the intake within
 * the tolerance. No intake: the intake is the final plus its losses (accepted as weighed).
 */
function finalRun(fin, type, intake, at) {
  if (fin === null || typeof fin !== 'object' || Array.isArray(fin)) throw bad(`${at}: final must be a set of weights`);
  const loss = (v, label) => {
    const n = v === '' || v == null ? 0 : strictNum(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_LINE_LBS) throw bad(`${at}: ${label} must be a number, 0 or more`);
    return n;
  };
  const run = {
    final_lbs: reqNonNeg(fin.final_lbs, `${at}: final weight`),
    to_smalls_lbs: loss(fin.to_smalls_lbs, 'turned to smalls'),
    biomass_lbs: loss(fin.biomass_lbs, 'biomass'),
    mold_lbs: loss(fin.mold_lbs, 'mold'),
  };
  if (type === 'smalls' && run.to_smalls_lbs > 0) throw bad(`${at}: a smalls lot cannot turn into smalls`);
  const out = round2(run.final_lbs + run.to_smalls_lbs + run.biomass_lbs + run.mold_lbs);
  run.pulled_lbs = intake == null ? posNum(out, `${at}: weight`) : intake;
  if (run.pulled_lbs > MAX_LINE_LBS) throw bad(`${at}: weight must be ${MAX_LINE_LBS} lb or less`);
  if (run.final_lbs > run.pulled_lbs + screenTolerance(run.pulled_lbs)) {
    throw bad(`${at}: the final weight (${run.final_lbs} lb) is more than the ${run.pulled_lbs} lb dropped off`);
  }
  const chk = checkRun(run, type);
  if (!chk.ok) throw bad(`${at}: outputs are off by ${chk.diff} lb (allowed ${chk.tolerance} lb)`);
  run.diff = chk.diff;
  return run;
}

async function saveDropoff(body, env) {
  // A resend of a save that already landed is answered first, whatever changed since.
  const key = clean(body.client_key) || crypto.randomUUID();
  const existing = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  if (existing) return dropoffDetail(env, existing.id, { duplicate: true });

  const farmId = Number(body.farm_id);
  const farm = farmId ? await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ? AND active = 1').bind(farmId).first() : null;
  if (!farm) throw bad('Unknown farm');
  const raw = Array.isArray(body.lines) ? body.lines : [];
  if (!raw.length) throw bad('A dropoff needs at least one line');

  // Validate every line before anything is written.
  const seen = new Set();
  const lines = raw.map((ln, i) => {
    const cultivar = clean(ln.cultivar);
    if (!cultivar) throw bad(`Line ${i + 1}: cultivar is required`);
    if (!TYPES.has(ln.type)) throw bad(`Line ${i + 1}: type must be tops or smalls`);
    const term = ln.term || farm.default_term;
    if (!TERMS.has(term)) throw bad(`Line ${i + 1}: term must be dropoff or sold`);
    let intake = ln.intake_lbs === '' || ln.intake_lbs == null ? null : posNum(ln.intake_lbs, `Line ${i + 1}: weight`);
    if (intake > MAX_LINE_LBS) throw bad(`Line ${i + 1}: weight must be ${MAX_LINE_LBS} lb or less`);
    const k = `${cultivar.toLowerCase()}|${ln.type}|${term}`;
    if (seen.has(k)) throw bad(`Line ${i + 1}: ${cultivar} ${ln.type} is listed twice`);
    seen.add(k);
    let run = null;
    if (ln.final != null) {
      run = finalRun(ln.final, ln.type, intake, `Line ${i + 1}`);
      intake = run.pulled_lbs;
    }
    return { cultivar, type: ln.type, term, intake, run, note: clean(ln.note) || null };
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
  // Finished at dropoff: the lot closes and gets its one run in the same batch. The run finds
  // its lot by dropoff key + cultivar + type + term (unique within a dropoff, checked above);
  // a miss is a NULL lot_id, which fails NOT NULL and rolls the whole dropoff back.
  lines.forEach((ln, i) => {
    if (!ln.run) return;
    const r = ln.run;
    const lotId = `(SELECT id FROM cl_lots WHERE dropoff_id = (SELECT id FROM cl_dropoffs WHERE client_key = ?) AND cultivar = ? AND type = ? AND term = ?)`;
    stmts.push(
      env.DB.prepare(`UPDATE cl_lots SET closed_at = datetime('now') WHERE id = ${lotId}`).bind(key, ln.cultivar, ln.type, ln.term),
      env.DB.prepare(
        `INSERT INTO cl_screen_runs (lot_id, pulled_lbs, final_lbs, to_smalls_lbs, biomass_lbs, mold_lbs, diff_lbs, client_key)
         VALUES (${lotId}, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(key, ln.cultivar, ln.type, ln.term, r.pulled_lbs, r.final_lbs, r.to_smalls_lbs, r.biomass_lbs, r.mold_lbs, r.diff, `${key}#${i}`),
    );
  });
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (!isKeyClash(e)) throw e;
    // Only a resend of THIS dropoff is a duplicate; any other key clash is a real failure.
    const won = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
    if (!won) throw e;
    return dropoffDetail(env, won.id, { duplicate: true });
  }
  const row = await env.DB.prepare('SELECT id FROM cl_dropoffs WHERE client_key = ?').bind(key).first();
  return dropoffDetail(env, row.id);
}

const nonNeg = (v, label) => {
  const n = v === '' || v == null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`${label} cannot be negative`);
  return n;
};
const history = (env, tbl, rowId, action, before, after, actor) => env.DB.prepare(
  'INSERT INTO cl_history (tbl, row_id, action, before_json, after_json, actor) VALUES (?, ?, ?, ?, ?, ?)'
).bind(tbl, rowId, action, JSON.stringify(before ?? null), JSON.stringify(after ?? null), clean(actor) || 'staff');

async function oneLot(env, lotId) {
  const [lot] = await loadLots(env, 'l.id = ?', [Number(lotId)]);
  if (!lot) throw createError('NOT_FOUND', 'Lot not found');
  return lot;
}
const liveLot = (lot) => { if (lot.voided_at) throw bad('This lot was voided'); return lot; };

async function setWeight(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const intake = posNum(body.intake_lbs, 'Weight');
  if (lot.closed_at) throw bad('This lot is closed');
  if (intake + screenTolerance(intake) < lot.money.pulled_lbs) {
    throw bad(`Weight cannot be below the ${lot.money.pulled_lbs} lb already pulled for screening`);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE cl_lots SET intake_lbs = ?, weighed_at = COALESCE(weighed_at, datetime('now')) WHERE id = ?").bind(intake, lot.id),
    history(env, 'cl_lots', lot.id, 'setWeight', { intake_lbs: lot.intake_lbs }, { intake_lbs: intake }, body.actor),
  ]);
  return ok({ lot: await oneLot(env, lot.id) });
}

async function saveScreenRun(body, env) {
  const key = clean(body.client_key) || crypto.randomUUID();
  const dup = await env.DB.prepare('SELECT lot_id FROM cl_screen_runs WHERE client_key = ?').bind(key).first();
  if (dup) return ok({ lot: await oneLot(env, dup.lot_id), duplicate: true });
  const lot = liveLot(await oneLot(env, body.lot_id));

  if (lot.intake_lbs == null) throw bad('Weigh this lot before screening it');
  if (lot.closed_at) throw bad('This lot is closed');
  const run = {
    pulled_lbs: posNum(body.pulled_lbs, 'Pounds pulled'),
    final_lbs: nonNeg(body.final_lbs, 'Final weight'),
    to_smalls_lbs: nonNeg(body.to_smalls_lbs, 'Turned to smalls'),
    biomass_lbs: nonNeg(body.biomass_lbs, 'Biomass'),
    mold_lbs: nonNeg(body.mold_lbs, 'Mold'),
  };
  if (lot.type === 'smalls' && run.to_smalls_lbs > 0) throw bad('A smalls lot cannot turn into smalls');
  const left = lot.money.remainder_lbs;
  if (run.pulled_lbs > left + screenTolerance(lot.intake_lbs)) {
    throw bad(`Only ${left} lb is left to screen, cannot pull more than that`);
  }
  const chk = checkRun(run, lot.type);
  if (!chk.ok) throw bad(`Outputs are off by ${chk.diff} lb (allowed ${chk.tolerance} lb)`);

  const stmts = [env.DB.prepare(
    'INSERT INTO cl_screen_runs (lot_id, pulled_lbs, final_lbs, to_smalls_lbs, biomass_lbs, mold_lbs, diff_lbs, note, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(lot.id, run.pulled_lbs, run.final_lbs, run.to_smalls_lbs, run.biomass_lbs, run.mold_lbs, chk.diff, clean(body.note) || null, key)];
  if (body.finishes_lot) stmts.push(env.DB.prepare("UPDATE cl_lots SET closed_at = datetime('now') WHERE id = ?").bind(lot.id));
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (!isKeyClash(e)) throw e;
    return ok({ lot: await oneLot(env, lot.id), duplicate: true });
  }
  return ok({ lot: await oneLot(env, lot.id) });
}

/**
 * Close a lot whose runs already cover its intake (two partial runs, or a run voided
 * and re-entered, with "finishes the lot" never ticked). Staff action, logged.
 */
async function closeLot(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  if (lot.closed_at) return ok({ lot, already: true });
  const m = lot.money;
  if (!(m.pulled_lbs > 0) || m.remainder_lbs > screenTolerance(m.intake_lbs)) {
    throw bad(`${m.remainder_lbs} lb is still left to screen; screen it before closing the lot`);
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE cl_lots SET closed_at = datetime('now') WHERE id = ?").bind(lot.id),
    history(env, 'cl_lots', lot.id, 'closeLot', { closed_at: null }, { remainder_lbs: m.remainder_lbs }, body.actor),
  ]);
  return ok({ lot: await oneLot(env, lot.id) });
}

async function saveSold(body, env) {
  const key = clean(body.client_key) || crypto.randomUUID();
  const dup = await env.DB.prepare('SELECT lot_id FROM cl_sold WHERE client_key = ?').bind(key).first();
  if (dup) return ok({ lot: await oneLot(env, dup.lot_id), duplicate: true });
  const lot = liveLot(await oneLot(env, body.lot_id));
  if (lot.term !== 'sold') throw bad('Sold pounds are only tracked on consignment (owed as sold) lots');
  const lbs = posNum(body.lbs, 'Pounds sold');
  const kind = body.kind === 'smalls' ? 'smalls' : 'main';
  const m = lot.money;
  const left = kind === 'smalls' ? round2(m.payable_smalls_lbs - m.sold_smalls_lbs) : round2(m.payable_main_lbs - m.sold_main_lbs);
  if (lbs > left + 0.005) throw bad(`Only ${left} lb is left on hand for this lot`);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body.sold_on || '') ? body.sold_on : pacificDay(new Date());
  try {
    await env.DB.prepare('INSERT INTO cl_sold (lot_id, sold_on, lbs, kind, note, client_key) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(lot.id, day, lbs, kind, clean(body.note) || null, key).run();
  } catch (e) {
    if (!isKeyClash(e)) throw e;
    return ok({ lot: await oneLot(env, lot.id), duplicate: true });
  }
  return ok({ lot: await oneLot(env, lot.id) });
}

async function farmTotalsFor(env, farmId) {
  const lots = await loadLots(env, 'l.farm_id = ? AND l.voided_at IS NULL', [farmId]);
  const payments = (await env.DB.prepare('SELECT * FROM cl_payments WHERE farm_id = ? ORDER BY paid_on DESC, id DESC').bind(farmId).all()).results;
  return { lots, payments, totals: farmTotals(lots.map((l) => l.money), payments) };
}

async function savePayment(body, env) {
  const key = clean(body.client_key) || crypto.randomUUID();
  let row = await env.DB.prepare('SELECT * FROM cl_payments WHERE client_key = ?').bind(key).first();
  const duplicate = !!row;
  if (!row) {
    const farmId = Number(body.farm_id);
    if (!farmId || !(await env.DB.prepare('SELECT id FROM cl_farms WHERE id = ?').bind(farmId).first())) throw bad('Unknown farm');
    const amount = posNum(body.amount, 'Amount');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(body.paid_on || '') ? body.paid_on : pacificDay(new Date());
    try {
      await env.DB.prepare('INSERT INTO cl_payments (farm_id, paid_on, amount, method, reference, note, client_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(farmId, day, amount, clean(body.method) || null, clean(body.reference) || null, clean(body.note) || null, key).run();
    } catch (e) {
      if (!isKeyClash(e)) throw e;
    }
    row = await env.DB.prepare('SELECT * FROM cl_payments WHERE client_key = ?').bind(key).first();
  }
  const { totals } = await farmTotalsFor(env, row.farm_id);
  return ok({ payment: row, totals, ...(duplicate ? { duplicate } : {}) });
}

const VOID_TABLES = { dropoff: 'cl_dropoffs', lot: 'cl_lots', run: 'cl_screen_runs', sold: 'cl_sold', payment: 'cl_payments' };

async function voidRow(body, env) {
  const tbl = Object.hasOwn(VOID_TABLES, body.table) ? VOID_TABLES[body.table] : null;
  if (!tbl) throw bad('Unknown table');
  const reason = clean(body.reason);
  if (!reason) throw bad('A reason is required to void an entry');
  const id = Number(body.id);
  const row = await env.DB.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).bind(id).first();
  if (!row) throw createError('NOT_FOUND', 'Entry not found');
  if (row.voided_at) return ok({ ok: true, already: true });
  const stmts = [
    env.DB.prepare(`UPDATE ${tbl} SET voided_at = datetime('now'), void_reason = ? WHERE id = ?`).bind(reason, id),
    history(env, tbl, id, 'void', row, { void_reason: reason }, body.actor),
  ];
  if (body.table === 'dropoff') {
    const lots = (await env.DB.prepare('SELECT * FROM cl_lots WHERE dropoff_id = ? AND voided_at IS NULL').bind(id).all()).results;
    for (const l of lots) stmts.push(history(env, 'cl_lots', l.id, 'void', l, { void_reason: reason, with_dropoff: id }, body.actor));
    stmts.push(env.DB.prepare("UPDATE cl_lots SET voided_at = datetime('now'), void_reason = ? WHERE dropoff_id = ? AND voided_at IS NULL").bind(reason, id));
  }
  if (body.table === 'run') {
    stmts.push(env.DB.prepare('UPDATE cl_lots SET closed_at = NULL WHERE id = ?').bind(row.lot_id));
  }
  await env.DB.batch(stmts);
  return ok({ ok: true });
}

async function setLotTerms(body, env) {
  const lot = liveLot(await oneLot(env, body.lot_id));
  const next = {
    term: body.term == null ? lot.term : body.term,
    price_per_lb: body.price_per_lb == null ? lot.price_per_lb : posNum(body.price_per_lb, 'Price per lb'),
    smalls_price_per_lb: body.smalls_price_per_lb == null ? lot.smalls_price_per_lb : posNum(body.smalls_price_per_lb, 'Smalls price per lb'),
    // Shows the lot's note on the farm's own page. Off by default.
    note_visible: body.note_visible == null ? (Number(lot.note_visible) === 1 ? 1 : 0) : (body.note_visible === true || body.note_visible === 1 ? 1 : 0),
  };
  if (!TERMS.has(next.term)) throw bad('term must be dropoff or sold');
  if (next.term === 'dropoff' && lot.sold.some((s) => !s.voided_at)) throw bad('Void the sold entries before changing this lot to owed on dropoff');
  const before = { term: lot.term, price_per_lb: lot.price_per_lb, smalls_price_per_lb: lot.smalls_price_per_lb, note_visible: Number(lot.note_visible) === 1 ? 1 : 0 };
  await env.DB.batch([
    env.DB.prepare('UPDATE cl_lots SET term = ?, price_per_lb = ?, smalls_price_per_lb = ?, note_visible = ? WHERE id = ?').bind(next.term, next.price_per_lb, next.smalls_price_per_lb, next.note_visible, lot.id),
    history(env, 'cl_lots', lot.id, 'setLotTerms', before, next, body.actor || 'owner'),
  ]);
  return ok({ lot: await oneLot(env, lot.id) });
}

async function listFarms(env) {
  const farms = (await env.DB.prepare('SELECT * FROM cl_farms ORDER BY active DESC, name').all()).results;
  const lots = await loadLots(env, 'l.voided_at IS NULL', []);
  const payments = (await env.DB.prepare('SELECT * FROM cl_payments').all()).results;
  return ok(farms.map((f) => ({
    ...f,
    ...farmTotals(lots.filter((l) => l.farm_id === f.id).map((l) => l.money), payments.filter((p) => p.farm_id === f.id)),
  })));
}

async function farmDetail(body, env) {
  const farmId = Number(body.farm_id);
  const farm = await env.DB.prepare('SELECT * FROM cl_farms WHERE id = ?').bind(farmId).first();
  if (!farm) throw createError('NOT_FOUND', 'Farm not found');
  const today = pacificDay(new Date());
  // Current price per cultivar and type: newest effective row on or before today.
  const price_points = (await env.DB.prepare(
    `SELECT p.* FROM cl_price_points p WHERE p.farm_id = ? AND p.effective_from <= ?
       AND p.id = (SELECT q.id FROM cl_price_points q WHERE q.farm_id = p.farm_id AND q.cultivar = p.cultivar AND q.type = p.type
                   AND q.effective_from <= ? ORDER BY q.effective_from DESC, q.id DESC LIMIT 1)
     ORDER BY p.cultivar, p.type DESC`
  ).bind(farmId, today, today).all()).results;
  const { lots, payments, totals } = await farmTotalsFor(env, farmId);
  const dropoffs = (await env.DB.prepare('SELECT * FROM cl_dropoffs WHERE farm_id = ? AND voided_at IS NULL ORDER BY dropped_at DESC, id DESC').bind(farmId).all()).results
    .map((d) => ({ ...d, lots: lots.filter((l) => l.dropoff_id === d.id) }));
  return ok({ farm, price_points, dropoffs, payments: payments.filter((p) => !p.voided_at), totals, access: await accessState(env, farmId) });
}

/* ---------- the farm's own page: link + PIN (stage 4). Owner only. ---------- */

/** State of the farm's newest link, for the staff page. Named columns only: never a hash. */
async function accessState(env, farmId) {
  const row = await env.DB.prepare(
    `SELECT issued_at, last_seen_at, locked_until, revoked_at, lockouts, CASE WHEN pin_hash IS NULL THEN 0 ELSE 1 END AS pin_set
     FROM cl_farm_access WHERE farm_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(farmId).first();
  if (!row) return null;
  return {
    active: !row.revoked_at,
    pin_set: row.pin_set === 1,
    issued_at: row.issued_at,
    last_seen_at: row.last_seen_at || null,
    locked: !row.revoked_at && lockState(row, new Date()).locked,
    // Turned off by the cap on wrong PINs, not by the owner.
    auto_off: !!row.revoked_at && Number(row.lockouts) >= MAX_LOCKOUTS,
  };
}

/**
 * A new private link for a farm. Every earlier link of the farm stops working in the same
 * batch (its PIN goes with it). The link is returned once and never stored: only its hash.
 * The history row records that a link was issued, with no link and no hash.
 */
async function issueFarmAccess(body, env) {
  const farmId = Number(body.farm_id);
  if (!farmId || !(await env.DB.prepare('SELECT id FROM cl_farms WHERE id = ?').bind(farmId).first())) throw bad('Unknown farm');
  const link = newToken();
  await env.DB.batch([
    env.DB.prepare("UPDATE cl_farm_access SET revoked_at = datetime('now') WHERE farm_id = ? AND revoked_at IS NULL").bind(farmId),
    env.DB.prepare('INSERT INTO cl_farm_access (farm_id, token_hash) VALUES (?, ?)').bind(farmId, await tokenHash(link)),
    history(env, 'cl_farms', farmId, 'issueFarmAccess', null, { farm_id: farmId }, body.actor || 'owner'),
  ]);
  return ok({ token: link });
}

/** Turn the farm's link off, with no replacement. */
async function revokeFarmAccess(body, env) {
  const farmId = Number(body.farm_id);
  if (!farmId) throw bad('Unknown farm');
  const r = await env.DB.batch([
    env.DB.prepare("UPDATE cl_farm_access SET revoked_at = datetime('now') WHERE farm_id = ? AND revoked_at IS NULL").bind(farmId),
    history(env, 'cl_farms', farmId, 'revokeFarmAccess', null, { farm_id: farmId }, body.actor || 'owner'),
  ]);
  return ok({ revoked: r[0].meta.changes, access: await accessState(env, farmId) });
}

async function openWork(env) {
  const lots = await loadLots(env, 'l.voided_at IS NULL AND l.closed_at IS NULL', []);
  return ok({
    to_weigh: lots.filter((l) => l.money.status === 'dropped'),
    to_screen: lots.filter((l) => l.money.status === 'weighed' || l.money.status === 'screening'),
    needs_price: (await loadLots(env, 'l.voided_at IS NULL', [])).filter((l) => l.money.needs_price),
  });
}

/* ---------- readSheet: read a photo of a printed sheet. Never writes. ---------- */

const SHEET_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The API takes images up to 5 MB of base64; 3.75 MB decoded stays under that.
const SHEET_MAX_BYTES = 3.75 * 1024 * 1024;
const SHEET_MODEL = 'claude-sonnet-5-5';
const SHEET_TIMEOUT_MS = 25000;
// Models that take server-side refusal fallbacks (fallbacks: "default").
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5-2']);
const SHEET_FAIL = 'Could not read the sheet. Enter the numbers by hand.';
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

async function pricedCultivars(env, farmId) {
  const rows = (await env.DB.prepare(
    'SELECT DISTINCT cultivar FROM cl_price_points WHERE farm_id = ? AND effective_from <= ? ORDER BY cultivar'
  ).bind(farmId, pacificDay(new Date())).all()).results;
  return rows.map((r) => r.cultivar);
}

/** The lots a screening sheet prints rows for, in printed order. Same rule as src/js/consign/sheets.js. */
const screenable = (lots) => lots.filter((l) => l.money.status === 'weighed' || l.money.status === 'screening');

async function sheetModel(env) {
  const v = await getConfig(env, 'consign.sheet_model');
  return typeof v === 'string' && /^claude-[a-z0-9-]{1,40}$/.test(v) ? v : SHEET_MODEL;
}

/** One call to the Claude API. Any failure becomes the same friendly error: no upstream text leaves here. */
async function askClaude(env, prompt, image, mediaType) {
  const model = await sheetModel(env);
  const ms = Number(env.CONSIGN_SHEET_TIMEOUT_MS) > 0 ? Number(env.CONSIGN_SHEET_TIMEOUT_MS) : SHEET_TIMEOUT_MS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const fallback = FALLBACK_MODELS.has(model);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: prompt.system,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: prompt.schema } },
        ...(fallback ? { fallbacks: 'default' } : {}),
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt.user },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error('upstream');
    const out = await res.json();
    if (out.stop_reason === 'refusal' || out.stop_reason === 'max_tokens') throw new Error('stopped');
    const text = (out.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('unparsable');
      return JSON.parse(m[0]);
    }
  } catch {
    // Deliberately no logging: the error could carry the model's reply or upstream body.
    throw createError('INTERNAL_ERROR', SHEET_FAIL);
  } finally {
    clearTimeout(timer);
  }
}

async function readSheet(body, env) {
  const kind = body.kind;
  if (kind !== 'dropoff' && kind !== 'screen') throw bad('kind must be dropoff or screen');
  if (!SHEET_MEDIA.has(body.media_type)) throw bad('The photo must be a JPEG, PNG or WebP image');
  const image = typeof body.image_b64 === 'string' ? body.image_b64 : '';
  if (!image) throw bad('A photo is required');
  if ((image.length * 3) / 4 > SHEET_MAX_BYTES) throw bad('The photo is too large');
  if (image.length % 4 !== 0 || !B64.test(image)) throw bad('The photo could not be read as an image');

  const farms = (await env.DB.prepare('SELECT id, name FROM cl_farms WHERE active = 1 ORDER BY name').all()).results;
  let ctx;
  if (kind === 'dropoff') {
    const farmId = Number(body.farm_id) || null;
    if (farmId) {
      const farm = farms.find((f) => f.id === farmId);
      if (!farm) throw bad('Unknown farm');
      ctx = { farms: [farm], cultivars: await pricedCultivars(env, farmId), lots: [], farm_id: farmId };
    } else {
      ctx = { farms, cultivars: [], lots: [] };
    }
  } else {
    const id = Number(body.dropoff_id) || 0;
    const d = id ? await env.DB.prepare(
      'SELECT d.id, d.voided_at, f.id AS farm_id, f.name AS farm_name FROM cl_dropoffs d JOIN cl_farms f ON f.id = d.farm_id WHERE d.id = ?'
    ).bind(id).first() : null;
    if (!d || d.voided_at) throw bad('Unknown dropoff');
    const all = await loadLots(env, 'l.dropoff_id = ?', [id]);
    const open = new Set(screenable(all.filter((l) => !l.voided_at)).map((l) => l.id));
    let printed;
    if (body.lot_ids != null) {
      // The sheet's QR carries the lots it printed, in order: number the rows from those,
      // so a lot weighed or closed since printing cannot shift the rows onto other lots.
      const ids = Array.isArray(body.lot_ids) ? body.lot_ids : [];
      const byId = new Map(all.map((l) => [l.id, l]));
      if (!ids.length || ids.length > 50 || ids.some((x) => !Number.isInteger(x) || !byId.has(x)) || new Set(ids).size !== ids.length) {
        throw bad('This sheet does not match this dropoff');
      }
      printed = ids.map((x) => byId.get(x));
    } else {
      printed = all.filter((l) => open.has(l.id));
    }
    if (!printed.some((l) => open.has(l.id))) throw bad('Nothing on this dropoff is ready to screen');
    ctx = {
      farms: [{ id: d.farm_id, name: d.farm_name }],
      cultivars: [],
      lots: printed.map((l) => ({
        id: l.id, cultivar: l.cultivar, type: l.type, term: l.term, intake_lbs: l.intake_lbs,
        remainder_lbs: l.money.remainder_lbs, open: open.has(l.id),
      })),
      refLots: all.map((l) => ({ id: l.id, cultivar: l.cultivar, type: l.type, open: open.has(l.id) })),
      dropoff_id: id,
    };
  }
  if (!env.ANTHROPIC_API_KEY) throw createError('INTERNAL_ERROR', 'Sheet reading is not set up');

  const prompt = kind === 'dropoff' ? dropoffPrompt(ctx) : screenPrompt(ctx);
  const raw = await askClaude(env, prompt, image, body.media_type);
  let read = normalizeSheetRead(kind, raw, ctx);
  // A sheet with no farm chosen: match cultivars once the farm is known (the prompt never saw any).
  if (kind === 'dropoff' && !ctx.farm_id && read.farm_id) {
    read = normalizeSheetRead(kind, raw, { ...ctx, cultivars: await pricedCultivars(env, read.farm_id) });
  }
  return ok({ read });
}

export async function handleConsignD1(request, env, _ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  requireAuth(request, body, env, `consign-${action}`);
  if (ownerOnly(action, body)) requireOwner(body, env);
  // A wrong owner password on anything else is a staff call, not an error: a stale password
  // in the page never blocks staff work. The envelope's `owner` tells the page which it got.
  const owner = isOwner(body, env);
  const data = await route(action, body, env);
  return successResponse({ success: true, data: owner ? data : staffView(action, data), owner });
}

function route(action, body, env) {
  switch (action) {
    case 'saveFarm': return saveFarm(body, env);
    case 'savePricePoint': return savePricePoint(body, env);
    case 'saveDropoff': return saveDropoff(body, env);
    case 'dropoff': return dropoffDetail(env, Number(body.dropoff_id));
    case 'setWeight': return setWeight(body, env);
    case 'saveScreenRun': return saveScreenRun(body, env);
    case 'closeLot': return closeLot(body, env);
    case 'saveSold': return saveSold(body, env);
    case 'savePayment': return savePayment(body, env);
    case 'voidRow': return voidRow(body, env);
    case 'setLotTerms': return setLotTerms(body, env);
    case 'farms': return listFarms(env);
    case 'farm': return farmDetail(body, env);
    case 'open': return openWork(env);
    case 'readSheet': return readSheet(body, env);
    case 'issueFarmAccess': return issueFarmAccess(body, env);
    case 'revokeFarmAccess': return revokeFarmAccess(body, env);
    default:
      throw createError('NOT_FOUND', `Unknown consign action: ${action}`);
  }
}
