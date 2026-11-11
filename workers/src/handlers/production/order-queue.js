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
import { shopifyConfigured } from '../../lib/shopify.js';
import { pacificDay } from '../../lib/pacific.js';

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
  try { result = await syncShopOrders(env, { now }); } catch (e) {
    if (notReady(e)) return errorResponse('The order queue is not set up yet (migration 0058)', 'NOT_READY', 503);
    throw e;
  }
  const res = await getOrderQueue({}, env, now);
  if (!res.ok) return res;
  return successResponse({ ...(await res.json()), refresh: result });
}
