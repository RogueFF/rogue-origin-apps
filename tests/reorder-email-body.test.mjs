/**
 * Unit tests for the reorder alert body.
 *
 * The handler acts off this email alone, so the order quantity has to be in it
 * — an alert naming only the item makes him look the amount up elsewhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReorderEmailBody } from '../workers/src/handlers/kanban-d1.js';

const URL = 'https://api.example.com/api/kanban?action=reorderRequest&token=abc123';
const CARD = {
  item: '10 LB GROVE BAGS',
  supplier: 'Grove',
  order_qty: 'x2 Cases',
  crumbtrail: 'Grove Bags Rack > E-1',
};

test('the order quantity appears — the point of the alert', () => {
  assert.match(buildReorderEmailBody(CARD, URL), /Order: x2 Cases/);
});

test('item, location and supplier are all present', () => {
  const body = buildReorderEmailBody(CARD, URL);
  assert.match(body, /Item: 10 LB GROVE BAGS/);
  assert.match(body, /Location: Grove Bags Rack > E-1/);
  assert.match(body, /Supplier: Grove/);
});

test('the close link is included verbatim', () => {
  assert.ok(buildReorderEmailBody(CARD, URL).includes(URL));
});

test('missing fields are omitted, not printed empty', () => {
  // Card 69 has no shelf position; an empty "Location:" line would look broken.
  const body = buildReorderEmailBody(
    { item: '1 LB Blank Bags', supplier: 'Grove', order_qty: 'x1 Case', crumbtrail: '' },
    URL
  );
  assert.doesNotMatch(body, /Location:/);
  assert.match(body, /Order: x1 Case/);
});

test('a card with no order quantity still produces a usable alert', () => {
  const body = buildReorderEmailBody({ item: 'Custom 1 Oz Bags', supplier: 'Grove' }, URL);
  assert.doesNotMatch(body, /Order:/);
  assert.match(body, /Item: Custom 1 Oz Bags/);
  assert.ok(body.includes(URL));
});

test('the re-scan note survives, so the handler knows why a second scan is quiet', () => {
  assert.match(buildReorderEmailBody(CARD, URL), /re-scanning this card won't send another email/i);
});

// ── Grove bins: with lane status the email leads with the order-by date ──────
const LANE = { onHand: 900, bins: 18, rate: 20, rateSource: 'ledger', orderBy: '2026-09-15', runOut: '2026-11-20', suggestedQty: 2500, config: { leadDays: 75, moq: 2500 } };

test('with lane status the first line is the order-by date', () => {
  const body = buildReorderEmailBody(CARD, URL, LANE);
  assert.match(body.split('\n')[0], /order by Sep 15/);
  assert.match(body, /Suggest: 2,500 \(MOQ\)/);
  assert.match(body, /On hand: 900 bags \(18 bins\)/);
  assert.match(body, /Using: ~140 \/ week \(from the usage ledger\)/);
  assert.match(body, /Runs out: ~Nov 20 · lead 75 days/);
  assert.match(body, /Location: Grove Bags Rack > E-1/);
  assert.ok(body.includes(URL));
  assert.doesNotMatch(body, /undefined|NaN|Infinity/);
});

test('rate source wording: season and seed', () => {
  assert.match(buildReorderEmailBody(CARD, URL, { ...LANE, rateSource: 'season' }), /\(last fall's pace\)/);
  assert.match(buildReorderEmailBody(CARD, URL, { ...LANE, rateSource: 'seed' }), /\(seed estimate\)/);
});

test('a suggestion above the MOQ is not labelled MOQ; a zero rate prints no cover or NaN', () => {
  const body = buildReorderEmailBody(CARD, URL, { ...LANE, suggestedQty: 3000, rate: 0, orderBy: null, runOut: null });
  assert.match(body, /Suggest: 3,000\b/);
  assert.doesNotMatch(body, /\(MOQ\)|months of cover|undefined|NaN|Infinity/);
  assert.match(body.split('\n')[0], /order by —/);
});

test('the two-argument form is unchanged', () => {
  assert.match(buildReorderEmailBody(CARD, URL), /was flagged for reorder/);
  assert.equal(buildReorderEmailBody(CARD, URL), buildReorderEmailBody(CARD, URL, null));
});
