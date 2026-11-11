/**
 * The bag/tag order queue, slice 1: read-only (design doc §2e; Koa 2026-11-10:
 * "Approve, start slice 1").
 *
 *   GET  ?action=orderQueue   today's open orders, FIFO with rush first, each line's route
 *   POST ?action=orderSync    Refresh: poll Shopify now (at most once per 20 s), then the queue
 *
 * No token, like cellBoard and rawBoard: it carries order number, cultivar, form,
 * bag size and counts only. No buyer field is stored, so none can be shown.
 * Assigning to a cell, printing and closing come in later slices.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { syncShopOrders } from '../../lib/order-sync.js';
import { shopifyConfigured, adminOrderUrl } from '../../lib/shopify.js';
import { pacificDay } from '../../lib/pacific.js';
import { fillSlots, loadCells, loadWaiting } from './order-flow.js';
import { planAssignments } from '../../lib/order-assign.js';
import { coaFiles, coaFor } from '../../lib/order-coa.js';

const OPEN_STATES = ['queued', 'assigned', 'trimming', 'ready', 'checked', 'hold'];
const CLOSE_MIN = 16 * 60 + 30;   // the floor's day ends 4:30 PM Pacific

const notReady = e => /no such table/i.test(String(e && e.message));

/** UTC ms of a Pacific wall-clock time on a Pacific date (DST-safe: Intl does the rules). */
export function pacificWallToUtc(day, minutes) {
  const [y, m, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60) + 8, minutes % 60);
  for (let i = 0; i < 2; i++) {
    const s = new Date(guess).toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
    const wall = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)),
      Number(s.slice(11, 13)), Number(s.slice(14, 16)));
    guess += Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) - wall;
  }
  return guess;
}

/**
 * An order is carried over when it was already waiting at the end of the last
 * production day (Mon-Sat; no Sunday production), so it isn't today's wave.
 */
export function carryCutoff(now = new Date()) {
  const today = pacificDay(now);
  const back = n => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();   // 0 = Sunday
  const prev = dow === 1 ? back(2) : dow === 0 ? back(1) : back(1);
  return pacificWallToUtc(prev, CLOSE_MIN);
}

export async function getOrderQueue(params, env, now = new Date()) {
  let orders, lines, sync;
  try {
    [orders, lines, sync] = await Promise.all([
      env.DB.prepare(
        `SELECT * FROM shop_orders WHERE state IN (${OPEN_STATES.map(() => '?').join(', ')})
         ORDER BY rush DESC, placed_at ASC, id ASC`).bind(...OPEN_STATES).all(),
      env.DB.prepare(
        `SELECT l.* FROM shop_order_lines l JOIN shop_orders o ON o.id = l.order_id
         WHERE o.state IN (${OPEN_STATES.map(() => '?').join(', ')}) ORDER BY l.order_id, l.sort, l.id`).bind(...OPEN_STATES).all(),
      env.DB.prepare(`SELECT * FROM shop_sync WHERE id = 1`).first(),
    ]);
  } catch (e) {
    if (notReady(e)) return errorResponse('The order queue is not set up yet (migration 0058)', 'NOT_READY', 503);
    throw e;
  }
  const byOrder = new Map();
  for (const l of lines.results || []) {
    (byOrder.get(l.order_id) || byOrder.set(l.order_id, []).get(l.order_id)).push({
      id: l.id, title: l.title, variant: l.variant_title, cultivar: l.cultivar, floorCultivar: l.floor_cultivar,
      form: l.form, bag: l.bag, qty: l.qty, qtyOpen: l.qty_open, route: l.route, why: l.route_why,
    });
  }
  // Slice 2 (0061): each order's cell, its baskets, and for a waiting order the
  // cell that frees a slot first. Before 0061 these are simply absent.
  const jobsBy = new Map(), slotBy = new Map(), labels = new Map();
  let waitBy = new Map();
  try {
    const jobs = (await env.DB.prepare(
      `SELECT j.* FROM cell_jobs j JOIN shop_orders o ON o.id = j.order_id
       WHERE o.state IN (${OPEN_STATES.map(() => '?').join(', ')}) AND j.state != 'cancelled' ORDER BY j.seq`
    ).bind(...OPEN_STATES).all()).results || [];
    for (const j of jobs) (jobsBy.get(j.order_id) || jobsBy.set(j.order_id, []).get(j.order_id)).push(j);
    const cells = await loadCells(env);
    for (const c of cells) {
      labels.set(c.stationId, c.label);
      const firsts = [...new Set(c.rows.map(r => r.order_id))];
      firsts.forEach((id, i) => slotBy.set(id, i === 0 ? 'NOW' : 'NEXT'));
    }
    const waiting = await loadWaiting(env);
    if (waiting.length) {
      const plan = planAssignments({ cells: cells.filter(c => c.takesOrders), orders: waiting });
      waitBy = new Map(plan.waiting.map(w => [w.orderId, w]));
    }
  } catch (e) { if (!notReady(e)) throw e; }
  const roster = (await env.DB.prepare(`SELECT station_id, label FROM cell_roster`).all().catch(() => ({ results: [] }))).results || [];
  const scales = new Set(((await env.DB.prepare(`SELECT station_id FROM scale_stations WHERE kind = 'table' AND active = 1`).all().catch(() => ({ results: [] }))).results || []).map(r => r.station_id));
  for (const r of roster) if (!labels.has(r.station_id)) labels.set(r.station_id, r.label);
  const cellOf = (o) => {
    const js = jobsBy.get(o.id) || [];
    if (!js.length) {
      const w = waitBy.get(o.id);
      return w && w.stationId ? { waiting: true, stationId: w.stationId, label: labels.get(w.stationId) || w.stationId, inMin: w.inMin } : null;
    }
    const station = js[js.length - 1].station_id;
    return {
      stationId: station, label: labels.get(station) || station, slot: slotBy.get(o.id) || null, why: js[0].why,
      scale: scales.has(station),   // no scale: bag/tag taps Basket done
      baskets: js.length, done: js.filter(j => j.state === 'done').length,
      started: js.some(j => j.started_at), nowJobId: (js.find(j => j.state === 'queued') || {}).id || null,
    };
  };
  // COA on file per cultivar (slice 4): information on the card only, never a block, and silent
  // until COAs are mirrored to R2 (on hold: Koa 2026-11-11).
  let files = [];
  try { files = await coaFiles(env); } catch { /* R2 down: no COA chips this read */ }
  const coaOf = ls => {
    const cults = [...new Set(ls.filter(l => l.cultivar && (l.form === 'tops' || l.form === 'smalls')).map(l => l.cultivar))];
    const r = cults.map(c => ({ cultivar: c, ...coaFor(c, files) }));
    return { checked: files.length > 0, missing: r.filter(x => !x.file).map(x => x.cultivar), count: r.filter(x => x.file).length };
  };
  const cutoff = carryCutoff(now);
  const today = pacificDay(now);
  const fulfilledToday = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shop_orders WHERE state = 'fulfilled' AND fulfilled_at >= ?`
  ).bind(new Date(pacificWallToUtc(today, 0)).toISOString().replace('T', ' ').slice(0, 19)).first();
  const list = (orders.results || []).map((o, i) => {
    const ls = (byOrder.get(o.id) || []).filter(l => l.qtyOpen > 0);
    return {
      id: o.id, name: o.name, placedAt: o.placed_at, rush: o.rush === 1, rushWhy: o.rush_why,
      intakeTag: o.intake_tag, state: o.state, fifo: i + 1,
      carriedOver: Date.parse(o.placed_at) < cutoff,
      changedInShopify: !!o.shop_changed_at,
      lines: ls,
      cellLines: ls.filter(l => l.route === 'cell').length,
      cultivars: [...new Set(ls.filter(l => l.route === 'cell').map(l => l.cultivar))],
      confirmedAt: o.confirmed_at || null, readyAt: o.ready_at || null, collectedAt: o.collected_at || null,
      cell: cellOf(o),
      coa: coaOf(ls),
      shopifyUrl: adminOrderUrl(env, o.shop_gid),
    };
  }).filter(o => o.lines.length);
  return successResponse({
    serverNow: now.getTime(),
    configured: shopifyConfigured(env),
    sync: sync ? { lastTryAt: sync.last_try_at, lastOkAt: sync.last_ok_at, lastError: sync.last_error, count: sync.last_count } : null,
    fulfilledToday: (fulfilledToday && fulfilledToday.n) || 0,
    orders: list,
  });
}

export async function orderSync(body, env, now = new Date()) {
  let result;
  try { result = await syncShopOrders(env, { now }); await fillSlots(env); } catch (e) {
    if (notReady(e)) return errorResponse('The order queue is not set up yet (migration 0058)', 'NOT_READY', 503);
    throw e;
  }
  const res = await getOrderQueue({}, env, now);
  if (!res.ok) return res;
  return successResponse({ ...(await res.json()), refresh: result });
}
