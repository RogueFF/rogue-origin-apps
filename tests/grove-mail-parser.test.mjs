/**
 * Grove email parser (pure): every fixture in tests/fixtures/grove-mail against
 * expected.json, plus the synthetic variants that pin one rule each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseGroveMail, findTracking, lineQuantity, parseDateLoose, findVendorRef, htmlToText } from '../workers/src/lib/grove-mail.js';

const DIR = new URL('./fixtures/grove-mail/', import.meta.url);
const LANES = [{ cardId: 21, bagsPerBox: 500 }, { cardId: 56, bagsPerBox: 100 }, { cardId: 54, bagsPerBox: 100 }, { cardId: 69, bagsPerBox: 100 }, { cardId: 99, bagsPerBox: 100 }];
const RECEIVED = '2026-10-14T16:00:00.000Z';

/** "Subject: …\n\nbody" → { subject, text }. */
function loadFixture(name) {
  const raw = readFileSync(new URL(name, DIR), 'utf8');
  const m = /^Subject:\s*(.*)\r?\n\r?\n([\s\S]*)$/.exec(raw);
  return { subject: m ? m[1] : '', text: m ? m[2] : raw, receivedAt: RECEIVED };
}

const expected = JSON.parse(readFileSync(new URL('expected.json', DIR), 'utf8'));
const fixtures = readdirSync(DIR).filter(f => /^(real|synthetic)-.*\.txt$/.test(f));

test('every fixture has an expectation (a real one dropped in without a line here is a mistake)', () => {
  for (const f of fixtures) assert.ok(expected[f], `${f} has no entry in expected.json`);
});

for (const f of fixtures) {
  test(`fixture ${f}`, () => {
    const want = expected[f];
    const got = parseGroveMail(loadFixture(f), LANES);
    for (const k of Object.keys(want)) {
      if (k === 'items') assert.deepEqual(got.items.map(({ cardId, qty, cases }) => ({ cardId, qty, cases })), want.items, 'items');
      else assert.deepEqual(got[k], want[k], k);
    }
  });
}

test('tracking: UPS 1Z wins; digit forms go by length, and a carrier word settles ties', () => {
  assert.deepEqual(findTracking('UPS: 1z999aa10123456784'), { trackingNo: '1Z999AA10123456784', carrier: 'ups' });
  assert.deepEqual(findTracking('FedEx 123456789012'), { trackingNo: '123456789012', carrier: 'fedex' });
  assert.deepEqual(findTracking('tracking 123456789012345'), { trackingNo: '123456789012345', carrier: 'fedex' });
  assert.deepEqual(findTracking('USPS 9400111899223033218420'), { trackingNo: '9400111899223033218420', carrier: 'usps' });
  assert.deepEqual(findTracking('9405511899223197428490 via Priority Mail'), { trackingNo: '9405511899223197428490', carrier: 'usps' });
  assert.deepEqual(findTracking('FedEx Ground 61290012345678901234'), { trackingNo: '61290012345678901234', carrier: 'fedex' });
  assert.deepEqual(findTracking('Order #18234 total $3,069.00'), { trackingNo: null, carrier: null });
  // A Grove order number is never 12 digits, and a phone number has dashes: neither reads as FedEx.
  assert.equal(findTracking('call 541-555-0100 re order 18234').trackingNo, null);
});

test('quantities: cases × bags per box, bare bag counts, "case of N" on the line, qty below the line', () => {
  assert.deepEqual(lineQuantity('10 LB Grove Bags - Case of 100 × 6', 50), { qty: 600, cases: 6, count: 6, unit: 'cases', perBox: 100 });
  assert.deepEqual(lineQuantity('6 cases 10 lb bags', 100), { qty: 600, cases: 6, count: 6, unit: 'cases', perBox: 100 });
  assert.deepEqual(lineQuantity('Custom 1 oz bags  Qty: 2,500', 500), { qty: 2500, cases: 5, count: 2500, unit: 'bags', perBox: 500 });
  assert.deepEqual(lineQuantity('1 lb bags x 300', 100), { qty: 300, cases: 3, count: 300, unit: 'bags', perBox: 100 });
  assert.deepEqual(lineQuantity('500 bags 1 oz', 500), { qty: 500, cases: 1, count: 500, unit: 'bags', perBox: 500 });
  assert.equal(lineQuantity('5 boxes of 1 oz bags', null).qty, null);          // cases with no box size: not a bag count
  assert.equal(lineQuantity('Custom 1 oz Bags', 500).count, null);
  const r = parseGroveMail({ subject: 'Order #1', text: 'Custom 1 oz Bags\nQuantity: 4 cases\n$1.00\n1 LB blank bags\nQty 200', receivedAt: RECEIVED }, LANES);
  assert.deepEqual(r.items.map(i => [i.cardId, i.qty, i.cases]), [[21, 2000, 4], [69, 200, 2]]);
  assert.deepEqual(r.missing, []);
});

test('missing: a size line with no quantity, a mail with nothing the ladder places, a shipping mail with no items or ref', () => {
  const noQty = parseGroveMail({ subject: 'Order #2', text: 'Custom 1 oz Bags\n$99', receivedAt: RECEIVED }, LANES);
  assert.equal(noQty.kind, 'order'); assert.deepEqual(noQty.missing, ['qty']); assert.equal(noQty.items[0].qty, null);
  const unknown = parseGroveMail({ subject: 'Order #3', text: '3 oz bags × 2\nThanks', receivedAt: RECEIVED }, LANES);
  assert.equal(unknown.kind, 'unknown'); assert.deepEqual(unknown.missing, ['size', 'size:unplaced']); assert.equal(unknown.unknownSizes.length, 1);
  const bareShip = parseGroveMail({ subject: 'Your package shipped', text: 'Tracking: 1Z999AA10123456784', receivedAt: RECEIVED }, LANES);
  assert.equal(bareShip.kind, 'shipping'); assert.deepEqual(bareShip.missing, ['size']); assert.equal(bareShip.shippedAt, RECEIVED);
  const shipByRef = parseGroveMail({ subject: 'Shipment from order #18234', text: 'Tracking: 1Z999AA10123456784', receivedAt: RECEIVED }, LANES);
  assert.deepEqual(shipByRef.missing, []); assert.equal(shipByRef.vendorRef, '18234');
});

test('dates: loose formats, year from the mail date, January read in December rolls forward', () => {
  assert.equal(parseDateLoose('Shipped on October 13, 2026'), '2026-10-13');
  assert.equal(parseDateLoose('Oct 17', RECEIVED), '2026-10-17');
  assert.equal(parseDateLoose('13 Oct 2026'), '2026-10-13');
  assert.equal(parseDateLoose('10/13/2026'), '2026-10-13');
  assert.equal(parseDateLoose('2026-10-13'), '2026-10-13');
  assert.equal(parseDateLoose('Jan 4', '2026-12-28T00:00:00.000Z'), '2027-01-04');
  assert.equal(parseDateLoose('Oct 17'), null);                                  // no year, no reference
  assert.equal(parseDateLoose('nothing here', RECEIVED), null);
});

test('vendor ref: subject "#18234", "Order 18234", "Invoice GB-1234"; html bodies parse too', () => {
  assert.equal(findVendorRef('Order #18234 confirmed', ''), '18234');
  assert.equal(findVendorRef('Grove Bags', 'Your order 18235 has shipped'), '18235');
  assert.equal(findVendorRef('Invoice GB-1234', ''), 'GB-1234');
  assert.equal(findVendorRef('Hello', 'no numbers'), null);
  const html = '<p>Order <b>#18236</b></p><table><tr><td>10 LB Grove Bags - Case of 100</td><td>&times; 6</td></tr></table>';
  assert.equal(htmlToText(html).includes('× 6'), true);
  const r = parseGroveMail({ subject: 'x', html, receivedAt: RECEIVED }, LANES);
  assert.deepEqual(r.items.map(i => [i.cardId, i.qty]), [[99, 600]]); assert.equal(r.vendorRef, '18236');
});
