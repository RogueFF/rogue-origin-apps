// Hourly entry's line-scale panel (src/js/hourly-entry/line-scales.mjs), Koa 2026-11-24:
// per-trimmer tops beside the typed tops, the fill state, the day's switch. Made-up names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleHourAt, chipHtml, panelHtml, LINE_KEYS } from '../src/js/hourly-entry/line-scales.mjs';

const scales = { fillOn: false, slots: [{ slot: '9-10', lb: 2.35, fill: 'hand', rows: [
  { stationId: 'table10', personId: 2, name: 'Beto', cultivar: '2026 - Sour Lifter / Sungrown', lb: 1.1, min: 50 },
  { stationId: 'table2', personId: 1, name: 'Ana <b>', cultivar: 'Alpha', lb: 1.2, min: 48 },
  { stationId: 'table3', personId: 0, name: null, cultivar: '', lb: 0.05, min: 0 },
] }] };

test('hours line up with Hourly entry\'s ten rows', () => {
  assert.equal(LINE_KEYS.length, 10);
  assert.equal(scaleHourAt(scales, 2).slot, '9-10');
  assert.equal(scaleHourAt(scales, 0), null);
});

test('day view chip: only with weight', () => {
  assert.match(chipHtml(scaleHourAt(scales, 2), 'en'), /2\.4 lb/);
  assert.equal(chipHtml(null, 'en'), '');
});

test('editor panel: a row per seat in seat order, names escaped, total beside typed, the state and the switch', () => {
  const html = panelHtml(scaleHourAt(scales, 2), { lang: 'en', fillOn: false, typedTops: 3.1 });
  assert.ok(html.indexOf('>2<') < html.indexOf('>3<') && html.indexOf('>3<') < html.indexOf('>10<'), 'seats 2, 3, 10');
  assert.match(html, /Ana &lt;b&gt;/);
  assert.match(html, /no name tapped/);
  assert.match(html, /Sour Lifter</, 'short cultivar');
  assert.match(html, /Scales total: <b>2\.35 lb/);
  assert.match(html, /Typed tops: <b>3\.1 lb/);
  assert.match(html, /scale-sum differs/);
  assert.match(html, /switch is off/);
  assert.doesNotMatch(html, /checked/);
  const on = panelHtml(scaleHourAt(scales, 2), { lang: 'es', fillOn: true, typedTops: 3.1 });
  assert.match(on, /Ganan los tops escritos/);
  assert.match(on, /checked/);
  assert.match(panelHtml(null, { lang: 'en', fillOn: true }), /No scale weight/);
});
