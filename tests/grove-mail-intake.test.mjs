/**
 * Grove email intake and delivery tracking through the real router on the
 * in-memory D1 (helpers/fake-d1.mjs). fetch is stubbed: the mail relay,
 * Telegram and 17TRACK all land in `sent`.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeEnv, call } from './helpers/fake-d1.mjs';
import { sha256Hex } from '../workers/src/lib/tracking-17track.js';
import { runGroveOverdueCheck } from '../workers/src/handlers/grove-intake.js';

const SECRET = 'hook-secret', KEY17 = '17track-key';
let sent, realFetch;
beforeEach(() => {
  sent = []; realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    let body = {}; try { body = JSON.parse(init?.body || '{}'); } catch { body = init?.body; }
    sent.push({ url: String(url), body, headers: init?.headers || {} });
    if (String(url).includes('17track')) return new Response(JSON.stringify({ code: 0, data: { accepted: [{ number: body[0]?.number }], rejected: [] } }));
    return new Response(JSON.stringify({ ok: true, success: true }));
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const env = () => Object.assign(fakeEnv(), { WEBHOOK_SECRET: SECRET, TRACK17_KEY: KEY17, TELEGRAM_BOT_TOKEN: '1:x', TELEGRAM_KOA_CHAT_ID: '42', MAIL_RELAY_URL: 'https://relay.test/exec', MAIL_RELAY_SECRET: 's', DAMON_EMAIL: 'damon@example.test' });
const fixture = (name) => { const raw = readFileSync(new URL(`./fixtures/grove-mail/${name}`, import.meta.url), 'utf8'); const m = /^Subject:\s*(.*)\r?\n\r?\n([\s\S]*)$/.exec(raw); return { subject: m[1], text: m[2] }; };
const mail = (name, extra = {}) => ({ from: 'orders@grovebags.com', receivedAt: '2026-10-14T16:00:00.000Z', messageId: `msg-${name}`, ...fixture(name), ...extra });
const post = (e, action, body) => call(e, action, body, { 'X-Webhook-Secret': SECRET });
const telegrams = () => sent.filter(s => s.url.includes('telegram')).map(s => s.body.text);
const req = (e, where = '1=1') => e.db.prepare(`SELECT * FROM kanban_reorder_requests WHERE ${where} ORDER BY id`).all();

test('groveMail refuses a bad secret and an empty body', async () => {
  const e = env();
  await assert.rejects(call(e, 'groveMail', mail('synthetic-order.txt')), (x) => x.code === 'UNAUTHORIZED');
  await assert.rejects(post(e, 'groveMail', { subject: 'x', receivedAt: '2026-10-14T16:00:00.000Z' }), (x) => x.code === 'VALIDATION_ERROR');
});

test('order confirmation: one request per size, closed as ordered by email, real qty in kanban_orders, expected = lead days out', async () => {
  const e = env();
  const r = await post(e, 'groveMail', mail('synthetic-order.txt'));
  assert.equal(r.status, 'applied'); assert.equal(r.kind, 'order');
  assert.deepEqual(r.requests.map(x => [x.cardId, x.qty, x.created]), [[99, 600, true], [21, 2500, true]]);
  const rows = req(e);
  assert.deepEqual(rows.map(x => [x.card_id, x.status, x.closed_by, x.qty_ordered, x.vendor_ref]), [[99, 'ordered', 'email', 600, '18234'], [21, 'ordered', 'email', 2500, '18234']]);
  assert.equal(rows[0].expected_at, '2026-10-21T16:00:00.000Z');          // 10 lb lane: lead 7 days
  assert.equal(rows[1].expected_at, '2026-12-28T16:00:00.000Z');          // 1 oz lane: lead 75 days
  const orders = e.db.prepare('SELECT placed_by, items_json FROM kanban_orders ORDER BY id').all();
  assert.deepEqual(orders.map(o => [o.placed_by, JSON.parse(o.items_json)[0].qty]), [['email', 600], ['email', 2500]]);
  const m = e.db.prepare('SELECT status, request_id, message_id FROM kanban_inbound_mail').get();
  assert.deepEqual({ ...m }, { status: 'applied', request_id: rows[0].id, message_id: 'msg-synthetic-order.txt' });
  assert.equal(telegrams().length, 0);                                     // nothing to ask Koa about
  // The lane shows the order in flight.
  const lane = (await call(e, 'getBinStatus&cardId=99')).lanes[0];
  assert.deepEqual({ stage: lane.order.stage, qty: lane.order.qtyOrdered, expectedAt: lane.order.expectedAt }, { stage: 'ordered', qty: 600, expectedAt: '2026-10-21T16:00:00.000Z' });
});

test('order confirmation answers the open Damon request (closes it, no duplicate row, order logged with the real qty)', async () => {
  const e = env();
  await call(e, 'addToCart', { cardId: 99 });                               // Damon request opens (relay email)
  const r = await post(e, 'groveMail', mail('synthetic-order.txt'));
  const nine = r.requests.find(x => x.cardId === 99);
  assert.deepEqual({ created: nine.created, closed: nine.closed }, { created: false, closed: true });
  assert.equal(req(e, 'card_id = 99').length, 1);
  assert.equal(req(e, 'card_id = 99')[0].closed_by, 'email');
  assert.equal(e.db.prepare(`SELECT COUNT(*) AS n FROM kanban_orders WHERE placed_by = 'email'`).get().n, 2);
});

test('order confirmation attaches to the request Damon closed by link instead of opening another', async () => {
  const e = env();
  await call(e, 'addToCart', { cardId: 99 });
  const { close_token } = e.db.prepare('SELECT close_token FROM kanban_reorder_requests').get();
  await call(e, 'closeReorderRequest', { token: close_token, closedBy: 'Damon' });   // logs the suggested qty
  const before = e.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n;
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  const rows = req(e, 'card_id = 99');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].closed_by, rows[0].qty_ordered, rows[0].vendor_ref], ['Damon', 600, '18234']);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, before + 1);   // only the 1 oz line is new
});

test('shipping notice: tracking lands on the same requests by Grove ref, 17TRACK registers once, lane reads shipped', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  const r = await post(e, 'groveMail', mail('synthetic-shipping.txt'));
  assert.equal(r.status, 'applied'); assert.equal(r.kind, 'shipping');
  const rows = req(e);
  assert.equal(rows.length, 2);
  for (const x of rows) assert.deepEqual([x.tracking_no, x.carrier, x.shipped_at, x.expected_at], ['1Z999AA10123456784', 'ups', '2026-10-13T12:00:00.000Z', '2026-10-17T12:00:00.000Z']);
  const reg = sent.filter(s => s.url.includes('17track'));
  assert.equal(reg.length, 1);
  assert.deepEqual(reg[0].body, [{ number: '1Z999AA10123456784', carrier: 100002 }]);
  assert.equal(reg[0].headers['17token'], KEY17);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 2);  // no second order row
  const lane = (await call(e, 'getBinStatus&cardId=99')).lanes[0];
  assert.deepEqual([lane.order.stage, lane.order.trackingNo, lane.order.carrier], ['shipped', '1Z999AA10123456784', 'ups']);
});

test('shipping notice with no line items follows the Grove ref; with no ref and no items it waits for Koa', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  const byRef = await post(e, 'groveMail', { from: 'x', receivedAt: '2026-10-14T16:00:00.000Z', messageId: 'm2', subject: 'Shipment from order #18234', text: 'Tracking: 1Z999AA10123456784' });
  assert.equal(byRef.status, 'applied'); assert.equal(byRef.requests.length, 2);
  const bare = await post(e, 'groveMail', { from: 'x', receivedAt: '2026-10-14T16:00:00.000Z', messageId: 'm3', subject: 'On the way', text: 'Tracking: 1Z999AA10123456785' });
  assert.equal(bare.status, 'needs_review'); assert.deepEqual(bare.missing, ['size']);
});

test('needs_review: a size line with no quantity is stored, Koa gets one line, nothing is applied; Mark as handled closes it', async () => {
  const e = env();
  const r = await post(e, 'groveMail', { from: 'x', receivedAt: '2026-10-14T16:00:00.000Z', messageId: 'm4', subject: 'Order #555', text: 'Custom 1 oz Bags\n$99.00' });
  assert.equal(r.status, 'needs_review'); assert.deepEqual(r.missing, ['qty']);
  assert.equal(req(e).length, 0);
  assert.equal(telegrams().length, 1); assert.match(telegrams()[0], /needs a look/); assert.match(telegrams()[0], /Missing: qty/);
  const review = (await call(e, 'getBinStatus')).review;
  assert.deepEqual(review.map(x => [x.id, x.subject, x.missing]), [[r.mailId, 'Order #555', ['qty']]]);
  await call(e, 'markMailHandled', { id: r.mailId, by: 'koa' });
  assert.equal((await call(e, 'getBinStatus')).review.length, 0);
  assert.equal(e.db.prepare('SELECT status, handled_by FROM kanban_inbound_mail').get().handled_by, 'koa');
  await assert.rejects(call(e, 'markMailHandled', { id: r.mailId }), (x) => x.code === 'NOT_FOUND');
});

test('the same Gmail message twice is a duplicate, not a second order', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  const again = await post(e, 'groveMail', mail('synthetic-order.txt'));
  assert.equal(again.status, 'duplicate');
  assert.equal(req(e).length, 2);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 2);
});

/** A signed 17TRACK push for `number`. */
async function push17(e, number, status, at = '2026-10-17T19:05:00Z') {
  const body = JSON.stringify({ event: 'TRACKING_UPDATED', data: { number, carrier: 100002, track_info: { latest_status: { status, sub_status: status }, latest_event: { time_iso: at } } } });
  return call(e, 'trackingEvent', body, { sign: await sha256Hex(`${body}/${KEY17}`) });
}

test('delivered → the receive the Desk would log: leftover = ledger bins, boxes = qty / per box, baseline, Koa told; a repeat is a no-op', async () => {
  const e = env();
  await call(e, 'recount', { cardId: 99, sealedBins: 3 });                 // 150 on hand at 50/bin
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  await post(e, 'groveMail', mail('synthetic-shipping.txt'));
  sent.length = 0;
  const r = await push17(e, '1Z999AA10123456784', 'Delivered');
  assert.deepEqual([r.matched, r.applied, r.status], [true, true, 'Delivered']);
  // Both sizes rode the one shipment: 10 lb gets 6 boxes (12 bins) on top of its 3 bins, 1 oz gets its 2,500 (25 boxes × 100 → 50 bins) on nothing.
  const ev = e.db.prepare(`SELECT card_id, bins, bag_count, lot, by FROM kanban_bin_events WHERE kind = 'receive' ORDER BY id`).all();
  assert.deepEqual(ev.map(x => ({ ...x })), [{ card_id: 99, bins: 3 + 12, bag_count: 50, lot: '18234', by: 'tracking' }, { card_id: 21, bins: 50, bag_count: 50, lot: '18234', by: 'tracking' }]);
  const base = e.db.prepare(`SELECT bags, reason FROM kanban_baselines WHERE card_id = 99 ORDER BY id DESC LIMIT 1`).get();
  assert.deepEqual({ ...base }, { bags: 150 + 600, reason: 'receive' });
  assert.deepEqual(r.results.map(x => [x.cardId, x.applied]), [[99, true], [21, true]]);
  const rows = req(e, `tracking_no = '1Z999AA10123456784'`);
  assert.equal(rows.filter(x => x.delivered_at === '2026-10-17T19:05:00.000Z').length, 2);
  const t = telegrams();
  assert.equal(t.length, 1); assert.match(t[0], /600 10 lb delivered · lane now ~750 bags \(15 bins\)/); assert.match(t[0], /2,500 1 oz delivered/); assert.match(t[0], /UPS 1Z999AA10123456784/); assert.match(t[0], /view=grove/);
  // The same event again: nothing new.
  const again = await push17(e, '1Z999AA10123456784', 'Delivered');
  assert.deepEqual([again.applied, again.already], [false, true]);
  assert.equal(e.db.prepare(`SELECT COUNT(*) AS n FROM kanban_bin_events WHERE kind = 'receive'`).get().n, 2);
  const lane = (await call(e, 'getBinStatus&cardId=99')).lanes[0];
  assert.equal(lane.order.stage, 'delivered');
});

test('delivered after the Desk already received: delivered_at is set, no second baseline', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-order.txt'));
  await post(e, 'groveMail', mail('synthetic-shipping.txt'));
  await new Promise(r => setTimeout(r, 5));
  await call(e, 'receiveBins', { cardId: 99, leftoverBins: 2, boxes: 6, by: 'desk' });
  await call(e, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: 25, by: 'desk' });
  const r = await push17(e, '1Z999AA10123456784', 'Delivered', new Date(Date.now() + 1000).toISOString());
  assert.deepEqual([r.matched, r.applied], [true, false]);
  assert.deepEqual(r.results.map(x => x.alreadyReceived), [true, true]);
  assert.equal(e.db.prepare(`SELECT COUNT(*) AS n FROM kanban_bin_events WHERE kind = 'receive'`).get().n, 2);
  assert.ok(e.db.prepare(`SELECT delivered_at FROM kanban_reorder_requests WHERE card_id = 99`).get().delivered_at);
  assert.match(telegrams().pop(), /already received/);
});

test('tracking events: a bad signature is refused; an in-transit status changes nothing; unknown numbers are reported, not errors', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-shipping.txt'));
  const body = JSON.stringify({ event: 'TRACKING_UPDATED', data: { number: '1Z999AA10123456784', track_info: { latest_status: { status: 'Delivered' } } } });
  await assert.rejects(call(e, 'trackingEvent', body, { sign: 'nope' }), (x) => x.code === 'UNAUTHORIZED');
  await assert.rejects(call(e, 'trackingEvent', body), (x) => x.code === 'UNAUTHORIZED');
  const transit = await push17(e, '1Z999AA10123456784', 'InTransit');
  assert.deepEqual([transit.matched, transit.applied], [true, false]);
  assert.equal((await push17(e, '1Z000000000000000000', 'Delivered')).matched, false);
  // Manual report with the webhook secret (Koa / a bot), no 17TRACK involved.
  const manual = await call(e, 'trackingEvent', { number: '1z999aa10123456784', status: 'Delivered' }, { 'X-Webhook-Secret': SECRET });
  assert.equal(manual.applied, true);
});

test('overdue: past expected + 3 days with no delivery → one line to Koa, once; delivered or received orders are left alone', async () => {
  const e = env();
  await post(e, 'groveMail', mail('synthetic-order.txt'));           // 10 lb expected Oct 21, 1 oz expected Dec 28
  sent.length = 0;
  assert.deepEqual(await runGroveOverdueCheck(e, new Date('2026-10-23T14:00:00Z')), []);
  const flagged = await runGroveOverdueCheck(e, new Date('2026-10-25T14:00:00Z'));
  assert.equal(flagged.length, 1);
  assert.match(telegrams()[0], /Grove order overdue: 600 10 lb expected Oct 21/);
  assert.deepEqual(await runGroveOverdueCheck(e, new Date('2026-10-26T14:00:00Z')), []);     // told once
  const lane = (await call(e, 'getBinStatus&cardId=99')).lanes[0];
  assert.equal(lane.order.stage, new Date() > new Date('2026-10-24T12:00:00Z') ? 'overdue' : 'ordered');
  // Received on the Desk → not overdue any more (and not shown as in flight).
  await call(e, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: 5 });
  const one = (await call(e, 'getBinStatus&cardId=21')).lanes[0];
  assert.equal(one.order, null);
  assert.deepEqual(await runGroveOverdueCheck(e, new Date('2027-02-01T14:00:00Z')), []);
});
