/**
 * A partner farm's own page. Route: /api/consign-farm (POST only).
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage4.md, tasks 4 and "Access model".
 *
 * Opened by the private link (token) plus a 4-digit PIN. Never by the shared apps
 * password: this handler does not read a password at all. The farm id always comes
 * from the link's row, never from the request. The reply is farmView (allowlisted).
 *
 * Actions:
 *   status { token }        -> { needs_pin, locked, minutes_left, lang }
 *   setPin { token, pin }   -> the view; only while no PIN is set
 *   view   { token, pin }   -> the view
 * Unknown, revoked and malformed links all get the same UNAUTHORIZED reply.
 */
import { successResponse, parseBody } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { constantTimeEqual } from '../lib/auth.js';
import { pacificDay } from '../lib/pacific.js';
import { tokenHash, pinHash, validPin, validToken, lockState, sqlTime, MAX_TRIES, LOCK_MINUTES, MAX_LOCKOUTS } from '../lib/consign-access.js';
import { farmView } from '../lib/consign-farm-view.js';

const ok = (data) => successResponse({ success: true, data });
const notActive = () => createError('UNAUTHORIZED', 'This link is not active');
const bad = (msg, details) => createError('VALIDATION_ERROR', msg, details);

/** The live access row for a link, or the generic refusal. Looked up by hash, so no compare leaks. */
async function findAccess(env, token) {
  if (!validToken(token)) throw notActive();
  const row = await env.DB.prepare(
    `SELECT a.id, a.farm_id, a.pin_hash, a.failed_tries, a.locked_until, f.lang
     FROM cl_farm_access a JOIN cl_farms f ON f.id = a.farm_id
     WHERE a.token_hash = ? AND a.revoked_at IS NULL`
  ).bind(await tokenHash(token)).first();
  if (!row) throw notActive();
  return row;
}

const lockedError = (minutes) => createError('RATE_LIMITED', 'Too many wrong PINs', { locked: true, minutes_left: minutes });

/**
 * Check the PIN. The try is counted BEFORE the compare, in one atomic UPDATE that only
 * runs while the link is not locked (an expired lock starts the count over). So parallel
 * requests can never get more than MAX_TRIES guesses past the lock, and a correct PIN is
 * refused while locked. A correct PIN resets the count.
 *
 * Cap on total guesses: each lock adds one to `lockouts`; a correct PIN clears it. At
 * MAX_LOCKOUTS locks in a row the link is turned off (revoked) and needs a new link from
 * the owner. Only the one request that lands the fifth try reaches that UPDATE, so
 * parallel guesses count one lockout.
 */
async function checkPin(env, row, token, pin, now) {
  if (!validPin(pin)) throw bad('The PIN is 4 digits');
  if (!row.pin_hash) throw bad('Set a PIN first', { needs_pin: true });
  const at = sqlTime(now);
  const until = sqlTime(new Date(now.getTime() + LOCK_MINUTES * 60000));
  const expired = 'locked_until IS NOT NULL AND locked_until <= ?1';
  const next = `CASE WHEN ${expired} THEN 1 ELSE failed_tries + 1 END`;
  const tried = await env.DB.prepare(
    `UPDATE cl_farm_access SET
       failed_tries = ${next},
       locked_until = CASE WHEN ${next} >= ?2 THEN ?3 WHEN ${expired} THEN NULL ELSE locked_until END
     WHERE id = ?4 AND revoked_at IS NULL AND (locked_until IS NULL OR locked_until <= ?1)
     RETURNING failed_tries`
  ).bind(at, MAX_TRIES, until, row.id).first();
  if (!tried) {
    const cur = await env.DB.prepare('SELECT locked_until, revoked_at FROM cl_farm_access WHERE id = ?').bind(row.id).first();
    if (!cur || cur.revoked_at) throw notActive();
    throw lockedError(Math.max(1, lockState(cur, now).minutes_left));
  }
  const good = constantTimeEqual(await pinHash(token, row.id, pin), row.pin_hash);
  if (good) {
    await env.DB.prepare('UPDATE cl_farm_access SET failed_tries = 0, lockouts = 0, locked_until = NULL, last_seen_at = ? WHERE id = ?').bind(at, row.id).run();
    return;
  }
  if (tried.failed_tries >= MAX_TRIES) {
    const capped = await env.DB.prepare(
      `UPDATE cl_farm_access SET
         lockouts = lockouts + 1,
         revoked_at = CASE WHEN lockouts + 1 >= ?1 THEN ?2 ELSE revoked_at END
       WHERE id = ?3 AND revoked_at IS NULL
       RETURNING revoked_at`
    ).bind(MAX_LOCKOUTS, at, row.id).first();
    if (!capped || capped.revoked_at) throw notActive();
    throw lockedError(LOCK_MINUTES);
  }
  throw bad('Wrong PIN', { tries_left: MAX_TRIES - tried.failed_tries });
}

/** Every row the view needs, for this farm only, named columns only. */
async function loadView(env, farmId, now) {
  const all = async (sql) => (await env.DB.prepare(sql).bind(farmId).all()).results;
  const farm = await env.DB.prepare('SELECT id, name, lang FROM cl_farms WHERE id = ?').bind(farmId).first();
  if (!farm) throw notActive();
  return farmView({
    farm,
    price_points: await all('SELECT id, farm_id, cultivar, type, price_per_lb, effective_from FROM cl_price_points WHERE farm_id = ?'),
    dropoffs: await all('SELECT id, farm_id, dropped_at, voided_at FROM cl_dropoffs WHERE farm_id = ? AND voided_at IS NULL'),
    lots: await all(
      `SELECT id, dropoff_id, farm_id, cultivar, type, term, intake_lbs, price_per_lb, smalls_price_per_lb, closed_at, note, note_visible, absorb_loss, voided_at
       FROM cl_lots WHERE farm_id = ? AND voided_at IS NULL`
    ),
    runs: await all(
      `SELECT r.id, r.lot_id, r.pulled_lbs, r.final_lbs, r.to_smalls_lbs, r.biomass_lbs, r.mold_lbs, r.voided_at
       FROM cl_screen_runs r JOIN cl_lots l ON l.id = r.lot_id WHERE l.farm_id = ? AND r.voided_at IS NULL`
    ),
    sold: await all(
      `SELECT s.id, s.lot_id, s.lbs, s.kind, s.voided_at
       FROM cl_sold s JOIN cl_lots l ON l.id = s.lot_id WHERE l.farm_id = ? AND s.voided_at IS NULL`
    ),
    payments: await all('SELECT id, farm_id, paid_on, amount, method, reference, voided_at FROM cl_payments WHERE farm_id = ? AND voided_at IS NULL'),
    today: pacificDay(now),
  });
}

async function status(body, env, now) {
  const row = await findAccess(env, body.token);
  const lock = lockState(row, now);
  return ok({ needs_pin: !row.pin_hash, locked: lock.locked, minutes_left: lock.minutes_left, lang: row.lang === 'es' ? 'es' : 'en' });
}

async function setPin(body, env, now) {
  const row = await findAccess(env, body.token);
  if (!validPin(body.pin)) throw bad('The PIN is 4 digits');
  if (row.pin_hash) throw bad('A PIN is already set for this link');
  const at = sqlTime(now);
  const hash = await pinHash(body.token, row.id, body.pin);
  // WHERE pin_hash IS NULL: of two racing first opens, only one sets the PIN.
  const r = await env.DB.prepare(
    `UPDATE cl_farm_access SET pin_hash = ?, pin_set_at = ?, last_seen_at = ?, failed_tries = 0, locked_until = NULL
     WHERE id = ? AND pin_hash IS NULL AND revoked_at IS NULL`
  ).bind(hash, at, at, row.id).run();
  if (!r.meta.changes) throw bad('A PIN is already set for this link');
  return ok(await loadView(env, row.farm_id, now));
}

async function view(body, env, now) {
  const row = await findAccess(env, body.token);
  await checkPin(env, row, body.token, body.pin, now);
  return ok(await loadView(env, row.farm_id, now));
}

/**
 * @param {object} [opts] opts.now: clock, for tests. The live Worker uses the real time.
 */
export async function handleConsignFarmD1(request, env, _ctx, { now = () => new Date() } = {}) {
  if (request.method !== 'POST') throw createError('NOT_FOUND', 'Not found');
  const body = await parseBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw notActive();
  const action = new URL(request.url).searchParams.get('action') || body.action;
  const at = now();
  switch (action) {
    case 'status': return status(body, env, at);
    case 'setPin': return setPin(body, env, at);
    case 'view': return view(body, env, at);
    default: throw createError('NOT_FOUND', 'Unknown action');
  }
}
