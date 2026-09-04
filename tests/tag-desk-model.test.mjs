/**
 * Tag & Desk model — the rules Koa settled on 2026-09-03, pinned.
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDays, nextCheckAfter, addDays, localDay, zoneOf, deliveryDays, parsePrice,
  normalizeCard, toRawCard, buildModel, cardState, scanPlan, orderedMap, ulinePasteText, ULINE_QUICK_ORDER_URL, ulineQuickOrderUrl, amazonQueueUrl, walmartCartUrl,
} from '../src/js/tag-desk/model.js';

const card = (o) => ({ id: 1, item: 'Packing Tape', supplier: 'Uline', orderQty: 'x72', orderWhen: '36', deliveryTime: '1 Day', price: '$2.10', crumbtrail: 'Supply Rack > A-1', url: '', picture: '', imageFile: '', ...o });
const order = (day, vendor, items) => ({ id: Math.random(), vendor, orderedAt: `${day} 17:00:00`, placedBy: null, items });

// --- check days -------------------------------------------------------------
test('from a Thursday the next three checks are Fri, Mon, Wed', () => {
  assert.deepEqual(checkDays('2026-09-03'), { d1: '2026-09-04', d2: '2026-09-07', d3: '2026-09-09' });
  assert.equal(nextCheckAfter('2026-09-04'), '2026-09-07'); // a check day itself moves to the next one
  assert.equal(nextCheckAfter('2026-09-05'), '2026-09-07');
});

test('D1 timestamps are UTC without a marker; the farm day is Pacific', () => {
  assert.equal(localDay('2026-09-03 02:30:00'), '2026-09-02'); // 02:30 UTC is still Sep 2 in Oregon
  assert.equal(localDay('2026-09-03T18:00:00.000Z'), '2026-09-03');
});

// --- free-text fields -------------------------------------------------------
test('zones: Grove Rack is the Grove Bags Rack; the T-Zero rack and room stay apart; blanks are Unassigned', () => {
  assert.deepEqual(zoneOf('Grove Rack > A-1'), { zone: 'Grove bags rack', slot: 'A-1' });
  assert.deepEqual(zoneOf('Grove Bags Rack > E-2'), { zone: 'Grove bags rack', slot: 'E-2' });
  assert.equal(zoneOf('T-Zero Rack > B-1').zone, 'T-Zero rack');
  assert.equal(zoneOf('T-Zero Room').zone, 'T-Zero room');
  assert.deepEqual(zoneOf('  '), { zone: 'Unassigned', slot: '' });
  assert.equal(zoneOf('FULFILLEMENT Boxes').zone, 'Fulfillment');
});

test('delivery text and prices parse the 23 spellings safely', () => {
  assert.equal(deliveryDays('1 Day'), 1); assert.equal(deliveryDays('2 Weeks'), 14); assert.equal(deliveryDays('3-5 Days'), 5); assert.equal(deliveryDays(''), null);
  assert.equal(parsePrice('$.13/Pc'), 0.13); assert.equal(parsePrice('$1,234'), 1.234 /* comma read as decimal on purpose: no thousands here */); assert.equal(parsePrice('n/a'), null);
});

test('levels: fill − reorder is the refill; signal cards order what the card says', () => {
  const c = normalizeCard(card());
  assert.equal(c.suggested, 36); assert.equal(c.numericLevels, true); assert.equal(c.leadDays, 1);
  const s = normalizeCard(card({ orderQty: 'x4', orderWhen: 'Green Card Signal' }));
  assert.equal(s.suggested, 4); assert.equal(s.numericLevels, false); assert.equal(s.formula, 'card says x4');
});

test('gloves are priced by the box of 100 (Koa)', () => {
  const g = normalizeCard(card({ id: 25, item: 'Black Industrial Nitrile Gloves Large S-23309', price: '$.13/Pc' }));
  assert.equal(g.packSize, 100); assert.equal(g.unitPrice, 13);
  assert.equal(normalizeCard(card({ item: 'Bucking Gloves', price: '$4/Pc' })).packSize, null);
});

test('toRawCard round-trips the editor fields and carries the rest through', () => {
  const c = normalizeCard(card({ imageFile: 'keep-me' }));
  c.fill = 80; c.reorder = 30; c.slot = 'A-4';
  const raw = toRawCard(c, { imageFile: 'keep-me' });
  assert.equal(raw.orderQty, 'x80'); assert.equal(raw.orderWhen, '30'); assert.equal(raw.crumbtrail, 'Supply rack > A-4'); assert.equal(raw.imageFile, 'keep-me'); assert.equal(raw.supplier, 'Uline');
  c.numericLevels = false; assert.equal(toRawCard(c).orderWhen, 'Green Card Signal');
});

// --- cadence and the run-out rule ------------------------------------------
function modelWith(cards, orders, extra = {}) {
  return buildModel({ cards, cart: {}, orders, requests: [], today: '2026-09-03', ...extra });
}

test('expected next run-out needs three order days and unchanged levels', () => {
  const orders = [order('2026-08-07', 'Uline', [{ cardId: 1, item: 'x', qty: 36 }]), order('2026-08-14', 'Uline', [{ cardId: 1, item: 'x', qty: 36 }]), order('2026-08-21', 'Uline', [{ cardId: 1, item: 'x', qty: 36 }])];
  const M = modelWith([card()], orders);
  const c = M.byId[1];
  assert.equal(c.n, 3); assert.equal(c.medianGap, 7); assert.equal(c.expected, '2026-08-28');
  const M2 = modelWith([card()], orders.slice(1)); assert.equal(M2.byId[1].expected, null);
  const M3 = modelWith([card()], orders, { levelsChanged: { 1: '2026-08-20' } }); assert.equal(M3.byId[1].expected, null, 'levels changed after the second-last order → no forecast');
});

test('about to run out counts the card’s own lead days against the following check', () => {
  const mk = (expectedDay, lead) => { // three orders spaced so the forecast lands on expectedDay
    const gap = 7; const last = addDays(expectedDay, -gap);
    const orders = [order(addDays(last, -14), 'Amazon', [{ cardId: 9, item: 'x', qty: 1 }]), order(addDays(last, -7), 'Amazon', [{ cardId: 9, item: 'x', qty: 1 }]), order(last, 'Amazon', [{ cardId: 9, item: 'x', qty: 1 }])];
    const M = modelWith([card({ id: 9, supplier: 'Amazon', deliveryTime: `${lead} Days` })], orders);
    return cardState(M.byId[9], M, {});
  };
  // D2 = Mon Sep 7. A 1-day item due Sep 8 can wait; a 5-day item due Sep 11 cannot.
  assert.equal(mk('2026-09-08', 1), 'due');        // Sep 8 ≤ Sep 7 + 1
  assert.equal(mk('2026-09-09', 1), 'due-next');   // ≤ D3 Sep 9 + 1
  assert.equal(mk('2026-09-11', 5), 'due');        // Sep 11 ≤ Sep 7 + 5
  assert.equal(mk('2026-09-14', 5), 'due-next');   // ≤ Sep 9 + 5
  assert.equal(mk('2026-09-16', 1), 'ok');
});

test('silent = the last gap is more than 2.5× the median', () => {
  const orders = [order('2026-06-12', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }]), order('2026-06-19', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }]), order('2026-07-03', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }])];
  const M = modelWith([card()], orders);
  assert.equal(M.byId[1].silent, true); assert.equal(cardState(M.byId[1], M, {}), 'check');
});

test('a received item can only be due by the following check, never about to run out the same day', () => {
  const orders = [order('2026-08-20', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }]), order('2026-08-27', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }]), order('2026-09-03', 'Uline', [{ cardId: 1, item: 'x', qty: 1 }])];
  const M = modelWith([card()], orders);
  assert.equal(cardState(M.byId[1], M, { received: { 1: '2026-09-03' } }), 'due-next'); // Sep 3 + 7 = Sep 10 ≤ Sep 9 + 1
  const M2 = modelWith([card({ deliveryTime: '1 Day' })], orders.map(o => ({ ...o, orderedAt: o.orderedAt.replace('2026-08-20', '2026-08-06').replace('2026-08-27', '2026-08-20') })));
  assert.equal(cardState(M2.byId[1], M2, { received: { 1: '2026-09-03' } }), 'ok'); // median 14 → Sep 17
});

test('desk memory wins over the forecast: pushed-off is ok until its day, red card and not-shipped are due, receipts are on order', () => {
  const M = modelWith([card()], []);
  const c = M.byId[1];
  assert.equal(cardState(c, M, { dismissed: { 1: '2026-09-07' } }), 'ok');
  assert.equal(cardState(c, M, { dismissed: { 1: '2026-09-03' } }), 'no-history');
  assert.equal(cardState(c, M, { out: { 1: { at: 'x' } } }), 'due');
  assert.equal(cardState(c, M, { backorder: { 1: { at: 'x' } } }), 'due');
  assert.equal(cardState(c, M, { ordered: orderedMap({ Uline: { open: [1] } }) }), 'on-order');
});

// --- cart signals -----------------------------------------------------------
test('cart rows carry the scan evidence: legacy rows stack, tag rows are one scan, notes are alarms', () => {
  const cart = { Uline: [
    { cartId: 1, cardId: 1, qty: 72, addedAt: '2026-09-02 20:11:43', addedBy: null, note: null },
    { cartId: 2, cardId: 2, qty: 37, addedAt: '2026-09-03 01:00:00', addedBy: 'tag', note: 'RED CARD' },
  ] };
  const M = buildModel({ cards: [card(), card({ id: 2 })], cart, orders: [], requests: [], today: '2026-09-03' });
  assert.equal(M.byId[1].scanCount, 2, 'two green-card scans stacked to 72 on the old page');
  assert.equal(M.byId[2].scanCount, 1); assert.equal(M.byId[2].bumps, 1); assert.equal(M.byId[2].redCard, true);
  assert.equal(cardState(M.byId[1], M, {}), 'queued');
});

test('a scan is idempotent by construction and Grove goes to Damon', () => {
  const M = buildModel({ cards: [card(), card({ id: 3, supplier: 'Grove', item: 'Custom 1 oz bags' })], cart: { Uline: [{ cartId: 1, cardId: 1, qty: 36, addedAt: 'x' }] }, orders: [], requests: [], today: '2026-09-03' });
  assert.deepEqual(scanPlan(M.byId[1]), { outcome: 'already' });
  assert.equal(scanPlan(M.byId[1], { red: true }).call, 'note');
  assert.equal(scanPlan(M.byId[3]).outcome, 'requested');
  assert.deepEqual(scanPlan(null), { outcome: 'unknown' });
  const fresh = buildModel({ cards: [card()], cart: {}, orders: [], requests: [], today: '2026-09-03' });
  assert.deepEqual(scanPlan(fresh.byId[1]), { outcome: 'queued', call: 'addToCart', qty: 36 });
});

test('Uline quick-order paste text is one MODEL QTY per line; cards without a model are named, not pasted', () => {
  const r = ulinePasteText([{ model: 'S-23309-L', qty: 5 }, { model: null, qty: 1, item: 'Bucking Gloves' }, { model: 'S-423', qty: 36 }]);
  assert.equal(r.text, 'S-23309-L 5\nS-423 36'); assert.equal(r.lines, 2); assert.equal(r.missing.length, 1); assert.equal(r.missing[0].item, 'Bucking Gloves');
  assert.equal(ULINE_QUICK_ORDER_URL, 'https://www.uline.com/QuickOrder');
  assert.equal(ulineQuickOrderUrl(r.text), 'https://www.uline.com/QuickOrder#ro=S-23309-L%205%0AS-423%2036');
  assert.equal(decodeURIComponent(ulineQuickOrderUrl(r.text).split('#ro=')[1]), r.text);
  assert.equal(ulineQuickOrderUrl(''), 'https://www.uline.com/QuickOrder');
  const m = normalizeCard(card({ url: 'https://www.uline.com/Product/Detail/S-23309-L/Disposable-Nitrile-Gloves/Uline-Black-Industrial-Nitrile-Gloves-Powder-Free-4-Mil-Large' }));
  assert.equal(m.model, 'S-23309-L');
});

test('Amazon and Walmart cart links come from the product URLs; cards without an id are named', () => {
  const a = normalizeCard(card({ supplier: 'Amazon', url: 'https://www.amazon.com/Reli-ProGrade/dp/B0BHF5WFHW/ref=sr_1_1?crid=X&th=1' }));
  const a2 = normalizeCard(card({ id: 2, supplier: 'Amazon', url: 'https://www.amazon.com/gp/product/B01FV0F5HG?ref=ppx' }));
  const a3 = normalizeCard(card({ id: 3, supplier: 'Amazon', url: 'https://www.amazon.com/s?k=trash+bags' }));
  assert.equal(a.asin, 'B0BHF5WFHW'); assert.equal(a2.asin, 'B01FV0F5HG'); assert.equal(a3.asin, null);
  const r = amazonQueueUrl([{ asin: a.asin, qty: 2 }, { asin: a3.asin, qty: 1, item: 'Trash bags' }, { asin: a2.asin, qty: 1 }]);
  assert.equal(r.url, 'https://www.amazon.com/dp/B0BHF5WFHW#ro=' + encodeURIComponent('B0BHF5WFHW 2\nB01FV0F5HG 1'));
  assert.equal(r.count, 2); assert.equal(r.missing[0].item, 'Trash bags');
  assert.equal(amazonQueueUrl([{ asin: null, qty: 1 }]).url, null);
  const w = normalizeCard(card({ supplier: 'Walmart', url: 'https://www.walmart.com/ip/Great-Value-Paper-Towels/14600911831?athcpid=1' }));
  const w2 = normalizeCard(card({ id: 2, supplier: 'Walmart', url: 'https://www.walmart.com/ip/899409911' }));
  assert.equal(w.wmId, '14600911831'); assert.equal(w2.wmId, '899409911');
  assert.equal(walmartCartUrl([{ wmId: w.wmId, qty: 3 }, { wmId: w2.wmId, qty: 1 }]).url, 'https://affil.walmart.com/cart/addToCart?items=14600911831|3,899409911|1');
});

test('hidden cards leave the model; an open Grove request shows as requested', () => {
  const M = buildModel({ cards: [card(), card({ id: 3, supplier: 'Grove' })], cart: {}, orders: [], requests: [{ id: 9, cardId: 3, status: 'open', requestedAt: '2026-08-11 22:00:00' }], today: '2026-09-03', archived: [1] });
  assert.equal(M.cards.length, 1); assert.equal(cardState(M.byId[3], M, {}), 'requested');
});
