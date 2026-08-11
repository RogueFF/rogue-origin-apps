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
