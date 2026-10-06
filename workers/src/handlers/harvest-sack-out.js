/**
 * Sack scan-out — the JSON actions behind /salida. Contract:
 * docs/plans/2026-10-06-sack-scan-out-contract.md.
 *
 * Helpers that live in harvest-d1.js arrive as `deps` instead of being imported
 * back from it, so the two files never import each other.
 */
import { query, queryOne, execute } from '../lib/db.js';
import { successResponse } from '../lib/response.js';
import { IN_FLIGHT, inFlight, isLiveInFlight } from '../lib/inventory-debt.js';
import { parseSackPayload, proposeOrder } from '../lib/sack-out.js';
import { computeQueue } from './wholesale-d1.js';
import { variantTitle } from '../lib/supersack-inventory.js';

export const SACK_OUT_ACTIONS = new Set(['sack_out', 'sack_out_assign', 'sack_out_undo', 'sack_out_today']);

const UNDO_MS = 60 * 1000;
/** How long an undo waits for an in-flight -1 to settle; tests shorten these. */
export const UNDO_WAIT = { stepMs: 400, maxMs: 4000 };

const REFUSED = {
  en: 'Test mode: a real sack cannot be taken out here.',
  es: 'Modo de prueba: no se puede sacar una bolsa real aquí.',
};
const UNKNOWN_ORDER = { en: 'That order does not exist.', es: 'Ese pedido no existe.' };
const say = (c, m) => m[c?.ui?.lang === 'es' ? 'es' : 'en'];

/**
 * The cultivar code is already on the row (`cultivar_code`, written when the
 * tag was printed) — the same code printed in the bag number. Read it there
 * rather than looking it up again: `cultivarCode()` is an async DB read that
 * throws for an unknown cultivar, and a scan must not fail on that.
 */
const codeOf = (row) => (row && row.cultivar_code) || null;

/** Once a sack has weights it has been worked; it can no longer go back. */
const pastUndo = (s) => !!(s.weights_allocated_at || s.weights_source
  || ['tops_lbs', 'smalls_lbs', 'biomass_lbs', 'trim_lbs', 'waste_lbs'].some(c => s[c] != null));

/** opened_at is UTC text 'YYYY-MM-DD HH:MM:SS'; the undo window runs 60 s from it. */
function undoUntil(openedAt) {
  if (!openedAt) return null;
  const t = Date.parse(String(openedAt).replace(' ', 'T') + 'Z') + UNDO_MS;
  return Number.isFinite(t) && t > Date.now() ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

const sackShape = (s) => s && ({
  sack_id: s.sack_id, serial: s.serial, season: s.season, cultivar: s.cultivar,
  cultivar_code: codeOf(s), zone: s.zone, cut_number: s.cut_number,
  opened_at: s.opened_at, out_by: s.out_by,
});

const logged = (what, fallback) => (e) => { console.error(`[sack-out][${what}]`, e); return fallback; };

const getSack = (db, id) => queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [id]);

/** orders speak cultivar ids; a sack carries a name. Resolve, never guess. */
async function cultivarIdsFor(db, name) {
  const rows = await query(db, `
    SELECT id FROM cultivars WHERE lower(name) = lower(?)
    UNION SELECT cultivar_id AS id FROM cultivar_aliases WHERE lower(alias) = lower(?)
  `, [name, name]).catch(logged('cultivars', []));
  return rows.map(r => r.id);
}

const orderExists = async (db, id) => !!(await queryOne(db, `SELECT id FROM orders WHERE id = ?`, [id]).catch(logged('orders', null)));

async function orderInfo(db, id, source) {
  if (!id) return null;
  const o = await queryOne(db, `SELECT id, nickname, shopify_order_name FROM orders WHERE id = ?`, [id]).catch(logged('orders', null));
  return o ? { ...o, source: source ?? undefined } : { id, nickname: null, shopify_order_name: null, source: source ?? undefined };
}

/**
 * The queue is computed only when a scan needs a proposal — an explicit
 * order_id or a repeat scan skips it entirely, so a burst of retries is cheap.
 */
async function optionsFor(db, cultivar) {
  const ids = await cultivarIdsFor(db, cultivar);
  if (!ids.length) return { proposed: null, options: [] };
  let queue = null;
  try { queue = await computeQueue(db); } catch (e) { console.error('[sack-out][queue]', e); }
  const { proposed, options } = proposeOrder(ids, queue);
  const filled = [];
  for (const o of options) filled.push({ ...(await orderInfo(db, o.id)), sacks_needed: o.sacks_needed });
  filled.forEach(o => delete o.source);
  return { proposed, options: filled };
}

function refused(env, deps, s) {
  // Real rows are untouchable in test mode, and the example sacks never write.
  return (deps.isTestMode(env) && Number(s.is_test) === 0) || deps.demoKey(s.sack_id);
}

/** A repeat scan answers with what the sack is already doing, and how to change it. */
async function alreadyOut(db, s) {
  const { options } = await optionsFor(db, s.cultivar);
  return successResponse({ success: true, state: 'already_out', sack: sackShape(s),
    order: await orderInfo(db, s.out_order_id, s.out_order_source), order_options: options,
    candidates: [], undo_until: undoUntil(s.opened_at) });
}

async function sackOut(c, deps) {
  const { db, env, ctx, body } = c;
  const empty = { sack: null, order: null, order_options: [], candidates: [] };
  const p = parseSackPayload(body, deps.normalizeSackId, deps.getSeason());
  if (p.notATag) return successResponse({ success: true, state: 'not_a_tag', ...empty });
  const isTest = deps.isTestMode(env) ? 1 : 0;
  if (p.ambiguous !== undefined) {
    const c = await query(db, `
      SELECT sack_id, cultivar, serial FROM harvest_sacks
      WHERE serial = ? AND season = ? AND is_test = ? AND voided_at IS NULL ORDER BY cultivar
    `, [p.ambiguous, deps.getSeason(), isTest]);
    if (c.length !== 1) return successResponse({ success: true, state: c.length ? 'ambiguous' : 'not_found', ...empty, candidates: c });
    p.id = c[0].sack_id;
  }
  let s = await getSack(db, p.id);
  if (!s) return successResponse({ success: true, state: 'not_found', ...empty });
  if (refused(env, deps, s)) {
    return successResponse({ success: false, state: 'refused', message: say(c, REFUSED), ...empty });
  }
  if (s.voided_at) return successResponse({ success: true, state: 'voided', ...empty, sack: sackShape(s) });
  if (s.opened_at) return alreadyOut(db, s);

  const by = body.by === 'typed' ? 'typed' : 'scan';
  let orderId = null, source = null, options = [];
  if (body.order_id === 'stock') { source = null; }
  else if (body.order_id) {
    orderId = String(body.order_id); source = 'manual';
    if (!(await orderExists(db, orderId))) return successResponse({ success: false, state: 'unknown_order', message: say(c, UNKNOWN_ORDER), ...empty, sack: sackShape(s) });
  }
  if (!body.order_id || body.order_id === null) {
    const o = await optionsFor(db, s.cultivar);
    options = o.options;
    if (o.proposed) { orderId = o.proposed.id; source = 'queue'; }
  }
  const took = await deps.takeSackOut(db, env, ctx, s, { by, orderId, orderSource: source });
  // true/'out' → out; false/'already' → already_out; 'busy' → settling with Shopify, the page retries.
  if (took === 'busy') return successResponse({ success: true, state: 'busy', ...empty, sack: sackShape(s) });
  s = await getSack(db, p.id);
  if (!(took === true || took === 'out')) return alreadyOut(db, s);
  return successResponse({
    success: true, state: 'out', sack: sackShape(s),
    order: await orderInfo(db, orderId, source), order_options: options, candidates: [],
    undo_until: new Date(Date.now() + UNDO_MS).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

async function sackOutAssign(c, deps) {
  const { db, env, body } = c;
  const s = await getSack(db, String(body.sack_id || ''));
  if (!s || !s.opened_at || s.voided_at) return successResponse({ success: true, state: 'not_out', sack: sackShape(s), order: null, order_options: [] });
  if (refused(env, deps, s)) return successResponse({ success: false, state: 'refused', message: say(c, REFUSED), sack: null, order: null, order_options: [] });
  const orderId = body.order_id && body.order_id !== 'stock' ? String(body.order_id) : null;
  if (orderId && !(await orderExists(db, orderId))) return successResponse({ success: false, state: 'unknown_order', message: say(c, UNKNOWN_ORDER), sack: sackShape(s), order: null, order_options: [] });
  await execute(db, `UPDATE harvest_sacks SET out_order_id = ?, out_order_source = ? WHERE sack_id = ?`,
    [orderId, orderId ? 'manual' : null, s.sack_id]);
  const after = await getSack(db, s.sack_id);
  const { options } = await optionsFor(db, after.cultivar);
  return successResponse({ success: true, state: 'out', sack: sackShape(after),
    order: await orderInfo(db, orderId, orderId ? 'manual' : null), order_options: options });
}

/**
 * Put a sack back. The -1 is in one of three states and each is undone
 * differently: counted → add the one back; failed → nothing was taken, clear
 * the error; in flight → nobody knows, so the row is left marked for a person
 * to check rather than guessing (a +1 on a -1 that never landed doubles it).
 */
async function sackOutUndo(c, deps) {
  const { db, env, ctx, body } = c;
  const id = String(body.sack_id || '');
  let s = await getSack(db, id);
  if (!s || !s.opened_at || s.voided_at) return successResponse({ success: true, state: 'not_out', sack: sackShape(s) });
  if (refused(env, deps, s)) return successResponse({ success: false, state: 'refused', message: say(c, REFUSED), sack: null });
  if (pastUndo(s)) return successResponse({ success: true, state: 'too_late', sack: sackShape(s) });
  // A mis-scan is undone within seconds, while the -1 (1–3 s) is usually still
  // in flight: wait for it to settle before deciding how to put the sack back.
  const wait = deps.undoWait || UNDO_WAIT;
  // Only a LIVE marker is a call that may still answer; a stale or
  // "check Shopify" one never will, so waiting on it only stalls the crew.
  for (let t = 0; isLiveInFlight(s.shopify_sync_error) && t < wait.maxMs; t += wait.stepMs) {
    await new Promise(r => setTimeout(r, wait.stepMs));
    s = await getSack(db, id);
    if (!s || !s.opened_at || s.voided_at) return successResponse({ success: true, state: 'not_out', sack: sackShape(s) });
  }
  if (pastUndo(s)) return successResponse({ success: true, state: 'too_late', sack: sackShape(s) });
  const counted = !!s.shopify_synced_at;
  const unknown = String(s.shopify_sync_error || '').startsWith(IN_FLIGHT);
  const addBack = counted && !deps.isTestMode(env);
  await execute(db, `
    UPDATE harvest_sacks SET opened_at = NULL, out_by = NULL, out_order_id = NULL, out_order_source = NULL,
      shopify_synced_at = NULL, shopify_sync_error = ?
    WHERE sack_id = ? AND opened_at IS NOT NULL
  `, [addBack ? inFlight('undo out') : (unknown ? `${s.shopify_sync_error} — undone; check Shopify` : null), s.sack_id]);
  if (addBack) {
    ctx.waitUntil((async () => {
      const r = await deps.adjustSupersackCount(env, {
        db, season: s.season, cultivar: s.cultivar, zone: s.zone, cut: s.cut_number,
        variantId: s.shopify_variant_id, delta: 1, note: `[Harvest] ${s.sack_id} scan-out undone`,
      });
      await execute(db, `UPDATE harvest_sacks SET shopify_sync_error = ? WHERE sack_id = ? AND opened_at IS NULL`,
        [r.ok ? null : `undo add-back failed: ${r.error}`, s.sack_id]);
    })().catch(e => console.error('[sack-out][undo]', e)));
  }
  return successResponse({ success: true, state: 'undone', sack: sackShape(await getSack(db, s.sack_id)) });
}

export async function sackOutToday(db, env, params, deps) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params?.date || '') ? params.date : deps.pacificToday();
  const isTest = deps.isTestMode(env) ? 1 : 0;
  const [from, to] = deps.pacificDayRange(date);
  const rows = await query(db, `
    SELECT * FROM harvest_sacks WHERE is_test = ? AND voided_at IS NULL
      AND opened_at >= ? AND opened_at < ? ORDER BY opened_at
  `, [isTest, from, to]);
  let queue = null;
  // sacks_needed stays null when the queue cannot be computed.
  if (rows.some(r => r.out_order_id)) { try { queue = await computeQueue(db); } catch (e) { console.error('[sack-out][queue]', e); } }
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.season}|${r.cultivar}|${r.out_order_id || ''}`;
    if (!groups.has(k)) {
      let need = null;
      const block = (queue?.blocks || []).find(b => b.orderId === r.out_order_id);
      if (block) {
        const ids = await cultivarIdsFor(db, r.cultivar);
        const pass = (block.passes || []).find(p => ids.map(String).includes(String(p.cultivarId)));
        need = pass?.sacksNeeded ?? null;
      }
      const o = await orderInfo(db, r.out_order_id);
      if (o) delete o.source;
      groups.set(k, { season: r.season, cultivar: r.cultivar, cultivar_code: codeOf(r),
        order: o, sacks_today: 0, sacks_needed: need, sacks: [] });
    }
    const g = groups.get(k);
    g.sacks_today++;
    g.sacks.push({ sack_id: r.sack_id, serial: r.serial, zone: r.zone, cut_number: r.cut_number, opened_at: r.opened_at, out_by: r.out_by, can_undo: !pastUndo(r) });
  }
  const chipRows = await query(db, `
    SELECT cultivar, cultivar_code, COUNT(*) AS n FROM harvest_sacks
    WHERE is_test = ? AND season = ? AND opened_at IS NULL AND voided_at IS NULL AND printed_at IS NOT NULL
    GROUP BY cultivar, cultivar_code ORDER BY cultivar
  `, [isTest, deps.getSeason()]);
  const strain = new Map();
  for (const r of rows) {
    const k = `${r.season}|${r.cultivar}|${r.cut_number}`;
    if (!strain.has(k)) strain.set(k, { season: r.season, cultivar: r.cultivar, cut_number: r.cut_number, sacks: 0, titles: new Set() });
    const e = strain.get(k);
    e.sacks++;
    // The floor names strains the way the Shopify variants are titled.
    e.titles.add(variantTitle(r.season, r.cultivar, undefined, r.cut_number));
  }
  return {
    success: true, date, tz: 'UTC', is_test: !!isTest, total: rows.length, groups: [...groups.values()],
    chips: chipRows.map(c => ({ code: codeOf(c), cultivar: c.cultivar, in_inventory: c.n })),
    by_strain: [...strain.values()].map(e => ({ season: e.season, cultivar: e.cultivar, cut_number: e.cut_number, sacks: e.sacks, strain_titles: [...e.titles] })),
  };
}

export async function handleSackOutAction(action, c, deps) {
  switch (action) {
    case 'sack_out': return sackOut(c, deps);
    case 'sack_out_assign': return sackOutAssign(c, deps);
    case 'sack_out_undo': return sackOutUndo(c, deps);
    case 'sack_out_today': return successResponse(await sackOutToday(c.db, c.env, c.params, deps));
  }
}
