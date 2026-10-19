/**
 * Grove email intake + delivery tracking (design §9b / §10b).
 *
 *   groveMail        POST (secret)  one forwarded Grove email → request fields, order row, tracking registered
 *   trackingEvent    POST (signed)  17TRACK push; on Delivered → the same receive the Desk would log
 *   markMailHandled  POST           Koa closes a needs_review mail
 *   runGroveOverdueCheck            daily: requests past expected_at + 3 days with no delivery → one line to Koa
 *
 * Lives beside kanban-d1.js rather than inside it: the lane math and receive
 * path are imported from there, and kanban-d1 imports the router actions from
 * here. Both only call across at request time, so the cycle is harmless.
 */
import { query, queryOne } from '../lib/db.js';
import { successResponse, parseBody } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { DAY } from '../lib/bin-math.js';
import { parseGroveMail } from '../lib/grove-mail.js';
import { notifyKoa } from '../lib/grove-notify.js';
import { register17, verify17Signature, parse17Event } from '../lib/tracking-17track.js';
import { laneRows, laneRow, computeLane, applyReceive } from './kanban-d1.js';

/** Days a shipment takes when the carrier gave no estimate (UPS Ground from Grove is a week). */
const TRANSIT_DAYS = 7;
/** An expected date this many days gone with no delivery is overdue. */
export const OVERDUE_GRACE_DAYS = 3;
/** A Damon-closed request older than this is not the one an email is about. */
const ATTACH_WINDOW_DAYS = 120;

const iso = (d) => new Date(d).toISOString();
const plusDays = (at, days) => iso(new Date(at).getTime() + days * DAY);
const fmtMD = (at) => at ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
const fmtN = (x) => (Number(x) || 0).toLocaleString('en-US');

/** Header or ?secret= must equal WEBHOOK_SECRET (same rule as orderUsage). */
function checkSecret(request, env, tag) {
  const secret = env.WEBHOOK_SECRET;
  if (!secret) { console.warn(`[grove][${tag}] WEBHOOK_SECRET unset — endpoint open`); return; }
  const header = request.headers.get('X-Webhook-Secret');
  const param = new URL(request.url).searchParams.get('secret');
  if (header !== secret && param !== secret) throw createError('UNAUTHORIZED', 'bad secret');
}

const REQ_COLS = `id, card_id AS cardId, status, requested_at AS requestedAt, closed_at AS closedAt, closed_by AS closedBy,
  qty_ordered AS qtyOrdered, tracking_no AS trackingNo, carrier, expected_at AS expectedAt, vendor_ref AS vendorRef,
  shipped_at AS shippedAt, delivered_at AS deliveredAt`;

/**
 * The request an email about `cardId` belongs to, in this order: the one with
 * the same Grove ref · the open one · the latest Damon-closed one that nothing
 * has been received against (within the attach window) · a new one, closed as
 * ordered by 'email'. Returns { req, created, wasOpen }.
 */
async function requestFor(env, cardId, vendorRef, at) {
  const db = env.DB;
  let req = null;
  if (vendorRef) req = await queryOne(db, `SELECT ${REQ_COLS} FROM kanban_reorder_requests WHERE card_id = ? AND vendor_ref = ? AND delivered_at IS NULL ORDER BY id DESC LIMIT 1`, [cardId, vendorRef]);
  if (!req) req = await queryOne(db, `SELECT ${REQ_COLS} FROM kanban_reorder_requests WHERE card_id = ? AND status = 'open'`, [cardId]);
  const wasOpen = !!req && req.status === 'open';
  if (!req) {
    const since = plusDays(at, -ATTACH_WINDOW_DAYS);
    req = await queryOne(db, `SELECT ${REQ_COLS} FROM kanban_reorder_requests r
      WHERE r.card_id = ? AND r.status = 'ordered' AND r.delivered_at IS NULL AND r.vendor_ref IS NULL AND r.closed_at > ?
        AND COALESCE(r.closed_by, '') <> 'receive'
        AND r.closed_at > COALESCE((SELECT MAX(at) FROM kanban_bin_events WHERE card_id = ? AND kind = 'receive'), '')
      ORDER BY r.closed_at DESC LIMIT 1`, [cardId, since, cardId]);
  }
  if (req) return { req, created: false, wasOpen };
  const token = crypto.randomUUID().replace(/-/g, '');
  const r = await db.prepare(`INSERT INTO kanban_reorder_requests (card_id, close_token, requested_at, status, notify_state, closed_at, closed_by)
    VALUES (?, ?, ?, 'ordered', 'sent', ?, 'email')`).bind(cardId, token, at, at).run();
  const id = r.meta?.last_row_id;
  return { req: await queryOne(db, `SELECT ${REQ_COLS} FROM kanban_reorder_requests WHERE id = ?`, [id]), created: true, wasOpen: false };
}

/** Write what one email says onto one request; log the kanban_orders row when this is the order being placed. */
async function applyToRequest(env, lane, parsed, item, at) {
  const cardId = lane.card_id;
  const { req, created, wasOpen } = await requestFor(env, cardId, parsed.vendorRef, at);
  const qty = item?.qty != null ? item.qty : req.qtyOrdered;
  const sets = { qty_ordered: qty ?? null, vendor_ref: parsed.vendorRef || req.vendorRef || null };
  if (parsed.kind === 'shipping') {
    sets.tracking_no = parsed.trackingNo; sets.carrier = parsed.carrier; sets.shipped_at = parsed.shippedAt || at;
    sets.expected_at = parsed.expectedAt || plusDays(sets.shipped_at, TRANSIT_DAYS);
  } else if (!req.trackingNo) {
    sets.expected_at = parsed.expectedAt || req.expectedAt || plusDays(parsed.orderedAt || at, lane.lead_days);
  }
  const stmts = [];
  if (wasOpen) { sets.status = 'ordered'; sets.closed_at = at; sets.closed_by = 'email'; }
  const cols = Object.keys(sets);
  stmts.push(env.DB.prepare(`UPDATE kanban_reorder_requests SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(c => sets[c]), req.id));
  // The order row: once, when the email is what places (or first confirms) the order.
  if ((wasOpen || created) && qty != null) {
    stmts.push(env.DB.prepare('INSERT INTO kanban_orders (vendor, placed_by, items_json, ordered_at) VALUES (?, ?, ?, ?)')
      .bind(lane.supplier || 'Grove', 'email', JSON.stringify([{ cardId, item: lane.item, qty }]), parsed.orderedAt || at));
  }
  await env.DB.batch(stmts);
  return { id: req.id, cardId, item: lane.item, qty, trackingNo: sets.tracking_no || req.trackingNo || null, expectedAt: sets.expected_at || req.expectedAt || null, created, closed: wasOpen };
}

async function storeMail(env, m, status, parsed, requestId, at) {
  const r = await env.DB.prepare(`INSERT INTO kanban_inbound_mail (message_id, received_at, from_addr, subject, body_text, parsed_json, status, request_id, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(m.messageId, m.receivedAt, m.from, m.subject, m.text, JSON.stringify(parsed), status, requestId, at).run();
  return r.meta?.last_row_id;
}

/**
 * POST ?action=groveMail&secret=…  { from, subject, text, html?, receivedAt, messageId? }
 * → { status: 'applied' | 'needs_review' | 'duplicate', requests: [...], missing: [...] }
 */
export async function groveMail(body, request, env, ctx) {
  checkSecret(request, env, 'groveMail');
  const at = iso(Date.now());
  const recv = body.receivedAt && !isNaN(new Date(body.receivedAt)) ? iso(body.receivedAt) : at;
  const m = {
    messageId: body.messageId ? String(body.messageId).slice(0, 200) : null,
    receivedAt: recv, from: body.from ? String(body.from).slice(0, 320) : null,
    subject: body.subject ? String(body.subject).slice(0, 500) : '',
    text: String(body.text || '').slice(0, 20000), html: body.html ? String(body.html).slice(0, 60000) : null,
  };
  if (!m.text && !m.html) throw createError('VALIDATION_ERROR', 'text or html is required');
  if (m.messageId) {
    const dup = await queryOne(env.DB, 'SELECT id, status, request_id AS requestId FROM kanban_inbound_mail WHERE message_id = ?', [m.messageId]);
    if (dup) return successResponse({ success: true, status: 'duplicate', mailId: dup.id, storedStatus: dup.status, requestId: dup.requestId });
  }
  const lanes = await laneRows(env, null);
  const parsed = parseGroveMail({ subject: m.subject, text: m.text, html: m.html, from: m.from, receivedAt: m.receivedAt },
    lanes.map(l => ({ cardId: l.card_id, bagsPerBox: l.bags_per_box })));
  const laneOf = (id) => lanes.find(l => l.card_id === id);

  // What the parser could not settle, plus a size it placed on a card with no lane.
  const missing = [...parsed.missing];
  for (const it of parsed.items) if (!laneOf(it.cardId)) missing.push(`lane:${it.cardId}`);
  let targets = parsed.items.filter(it => laneOf(it.cardId)).map(it => ({ lane: laneOf(it.cardId), item: it }));
  if (parsed.kind === 'shipping' && !parsed.items.length && parsed.vendorRef) {
    // "Your order #18234 shipped" with no line items: the requests that order confirmation wrote.
    const reqs = await query(env.DB, `SELECT card_id AS cardId FROM kanban_reorder_requests WHERE vendor_ref = ? AND delivered_at IS NULL`, [parsed.vendorRef]);
    targets = reqs.filter(r => laneOf(r.cardId)).map(r => ({ lane: laneOf(r.cardId), item: null }));
    if (!targets.length) missing.push('request');
  }
  if (!missing.length && !targets.length) missing.push('size');

  if (missing.length) {
    const mailId = await storeMail(env, m, 'needs_review', { ...parsed, missing }, null, at);
    const job = notifyKoa(env, `Grove email needs a look: "${m.subject}"\nMissing: ${missing.join(', ')}. Open the Desk → Grove to receive it by hand or mark it handled.`);
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    return successResponse({ success: true, status: 'needs_review', mailId, missing, parsed });
  }

  const results = [];
  for (const { lane, item } of targets) results.push(await applyToRequest(env, lane, parsed, item, at));
  const mailId = await storeMail(env, m, 'applied', parsed, results[0]?.id ?? null, at);

  // Delivery callbacks: register the number once. A failure is logged, not fatal
  // — the daily overdue check and the Desk's Receive button still cover the lane.
  if (parsed.kind === 'shipping' && parsed.trackingNo) {
    const job = register17(env, { trackingNo: parsed.trackingNo, carrier: parsed.carrier })
      .then(r => console.log(`[grove][groveMail] 17TRACK ${parsed.trackingNo}: ${r.already ? 'already registered' : 'registered'}`))
      .catch(e => console.error('[grove][groveMail] 17TRACK register failed', e));
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  }
  return successResponse({ success: true, status: 'applied', mailId, kind: parsed.kind, requests: results });
}

/**
 * POST ?action=trackingEvent — 17TRACK push (header `sign`), or a manual
 * { number, status, at? } carrying WEBHOOK_SECRET so Koa or a bot can report a
 * delivery by hand. Handles the raw body itself: the signature is over the bytes.
 */
export async function trackingEvent(request, env, ctx) {
  const raw = await request.text();
  const sign = request.headers.get('sign');
  let signed = false;
  if (sign && env.TRACK17_KEY) signed = await verify17Signature(raw, sign, env.TRACK17_KEY);
  if (!signed) {
    const secret = env.WEBHOOK_SECRET;
    const header = request.headers.get('X-Webhook-Secret');
    const param = new URL(request.url).searchParams.get('secret');
    if (!secret || (header !== secret && param !== secret)) throw createError('UNAUTHORIZED', 'bad signature');
  }
  let body; try { body = JSON.parse(raw); } catch { throw createError('VALIDATION_ERROR', 'body must be JSON'); }
  const ev = parse17Event(body) || (body?.number ? { event: 'manual', number: String(body.number).trim().toUpperCase(), carrier: body.carrier || null, status: body.status || null, subStatus: null, at: body.at && !isNaN(new Date(body.at)) ? iso(body.at) : null } : null);
  if (!ev) throw createError('VALIDATION_ERROR', 'no tracking number in the event');

  // One shipment can carry several sizes: every request on the number is delivered together.
  const reqs = await query(env.DB, `SELECT ${REQ_COLS} FROM kanban_reorder_requests WHERE UPPER(tracking_no) = ? AND status = 'ordered' ORDER BY id`, [ev.number]);
  if (!reqs.length) return successResponse({ success: true, matched: false, number: ev.number, status: ev.status });
  const ids = reqs.map(r => r.id);
  if (ev.status !== 'Delivered') return successResponse({ success: true, matched: true, requestIds: ids, status: ev.status, applied: false });
  const pending = reqs.filter(r => !r.deliveredAt);
  if (!pending.length) return successResponse({ success: true, matched: true, requestIds: ids, status: 'Delivered', applied: false, already: true });

  const deliveredAt = ev.at || iso(Date.now());
  const results = [], lines = [];
  for (const req of pending) {
    const lane = await laneRow(env, req.cardId);
    const since = req.shippedAt || req.closedAt || req.requestedAt;
    const received = await queryOne(env.DB, `SELECT id FROM kanban_bin_events WHERE card_id = ? AND kind = 'receive' AND at > ? LIMIT 1`, [req.cardId, since]);
    await env.DB.prepare('UPDATE kanban_reorder_requests SET delivered_at = ? WHERE id = ?').bind(deliveredAt, req.id).run();
    if (received) {
      lines.push(`${fmtN(req.qtyOrdered)} ${lane.item} delivered · already received on the Desk, nothing changed.`);
      results.push({ requestId: req.id, cardId: req.cardId, applied: false, alreadyReceived: true });
      continue;
    }
    const before = await computeLane(env, lane);
    const boxes = req.qtyOrdered ? Math.ceil(req.qtyOrdered / lane.bags_per_box) : 0;
    const r = await applyReceive(env, lane, { leftover: before.bins, boxes, lot: req.vendorRef || ev.number, by: 'tracking' });
    lines.push(boxes
      ? `${fmtN(req.qtyOrdered)} ${lane.item} delivered · lane now ~${fmtN(r.lane.onHand)} bags (${r.lane.bins} bins) · Receive on the Desk to correct.`
      : `${lane.item} delivered but the order quantity is unknown · lane unchanged at ~${fmtN(before.onHand)} bags · Receive on the Desk with the real box count.`);
    results.push({ requestId: req.id, cardId: req.cardId, applied: true, lane: r.lane });
  }
  const job = notifyKoa(env, `${lines.join('\n')}\n${String(ev.carrier || '').toUpperCase()} ${ev.number}`.trim());
  if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  return successResponse({ success: true, matched: true, requestIds: ids, status: 'Delivered', applied: results.some(r => r.applied), deliveredAt, results });
}

/** POST ?action=markMailHandled { id, by? } — a needs_review mail Koa dealt with. */
export async function markMailHandled(body, env) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw createError('VALIDATION_ERROR', 'id must be a positive integer');
  const at = iso(Date.now());
  const r = await env.DB.prepare(`UPDATE kanban_inbound_mail SET status = 'ignored', handled_at = ?, handled_by = ? WHERE id = ? AND status = 'needs_review'`)
    .bind(at, body.by ? String(body.by).slice(0, 100) : 'desk', id).run();
  if (!r.meta?.changes) throw createError('NOT_FOUND', 'no mail waiting for review with that id');
  return successResponse({ success: true, id });
}

/** Mails waiting on Koa, newest first, for the Desk strip. */
export async function reviewMail(env) {
  const rows = await query(env.DB, `SELECT id, received_at AS receivedAt, from_addr AS fromAddr, subject, parsed_json AS parsedJson
    FROM kanban_inbound_mail WHERE status = 'needs_review' ORDER BY received_at DESC LIMIT 20`);
  return rows.map(r => { let p = {}; try { p = JSON.parse(r.parsedJson || '{}'); } catch { p = {}; }
    return { id: r.id, receivedAt: r.receivedAt, from: r.fromAddr, subject: r.subject, missing: p.missing || [], kind: p.kind || 'unknown' }; });
}

/**
 * The order in flight for a lane, for the Desk tile: the latest 'ordered'
 * request nothing has been received against. Stage: ordered → shipped →
 * delivered, or overdue when expected_at + grace has passed with no delivery.
 * A request with no email behind it (Damon's link) still shows, with the
 * expected date estimated from the lane's lead time.
 */
export async function inFlightOrder(env, row, today = new Date()) {
  const cardId = row.card_id;
  const since = plusDays(today, -ATTACH_WINDOW_DAYS);
  const r = await queryOne(env.DB, `SELECT ${REQ_COLS} FROM kanban_reorder_requests r
    WHERE r.card_id = ? AND r.status = 'ordered' AND COALESCE(r.closed_by, '') <> 'receive' AND r.closed_at > ?
      AND (r.delivered_at IS NOT NULL OR r.closed_at > COALESCE((SELECT MAX(at) FROM kanban_bin_events WHERE card_id = ? AND kind = 'receive'), ''))
    ORDER BY r.closed_at DESC LIMIT 1`, [cardId, since, cardId]);
  if (!r) return null;
  // Delivered: show for three days, then let the tile go back to the lane.
  if (r.deliveredAt && new Date(r.deliveredAt).getTime() < today.getTime() - 3 * DAY) return null;
  const expectedAt = r.expectedAt || (r.closedAt ? plusDays(r.closedAt, row.lead_days) : null);
  const overdue = !r.deliveredAt && !!expectedAt && new Date(expectedAt).getTime() + OVERDUE_GRACE_DAYS * DAY < today.getTime();
  const stage = r.deliveredAt ? 'delivered' : overdue ? 'overdue' : r.trackingNo ? 'shipped' : 'ordered';
  return { id: r.id, stage, qtyOrdered: r.qtyOrdered, trackingNo: r.trackingNo, carrier: r.carrier, vendorRef: r.vendorRef,
    orderedAt: r.closedAt, shippedAt: r.shippedAt, expectedAt, expectedEstimated: !r.expectedAt, deliveredAt: r.deliveredAt, closedBy: r.closedBy };
}

/**
 * Daily: every undelivered request past expected_at + grace that nobody has
 * received against gets one line to Koa, once. Returns the ids flagged.
 */
export async function runGroveOverdueCheck(env, today = new Date()) {
  const cutoff = plusDays(today, -OVERDUE_GRACE_DAYS);
  const rows = await query(env.DB, `SELECT r.id, r.card_id AS cardId, r.qty_ordered AS qtyOrdered, r.expected_at AS expectedAt, r.tracking_no AS trackingNo, r.carrier, k.item
    FROM kanban_reorder_requests r JOIN kanban_cards k ON k.id = r.card_id
    WHERE r.status = 'ordered' AND r.delivered_at IS NULL AND r.overdue_notified_at IS NULL AND r.expected_at IS NOT NULL AND r.expected_at < ?
      AND r.closed_at > COALESCE((SELECT MAX(at) FROM kanban_bin_events WHERE card_id = r.card_id AND kind = 'receive'), '')`, [cutoff]);
  const flagged = [];
  for (const r of rows) {
    const where = r.trackingNo ? ` · ${String(r.carrier || '').toUpperCase()} ${r.trackingNo}` : ' · no tracking number yet';
    await notifyKoa(env, `Grove order overdue: ${r.qtyOrdered ? `${fmtN(r.qtyOrdered)} ` : ''}${r.item} expected ${fmtMD(r.expectedAt)}, not delivered${where}.`);
    await env.DB.prepare('UPDATE kanban_reorder_requests SET overdue_notified_at = ? WHERE id = ?').bind(iso(today), r.id).run();
    flagged.push(r.id);
  }
  return flagged;
}

/** Router hook: the one action that must see the raw body runs before parseBody. */
export const RAW_BODY_ACTIONS = new Set(['trackingEvent']);
export { parseBody };
