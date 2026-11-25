// The Cells board's seat panel (src/js/cells/seat-detail.mjs), Koa 2026-11-25:
// tap a card for that seat's hour-by-hour and key metrics. Made-up names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatSummary, detailHtml, G_PER_LB } from '../src/js/cells/seat-detail.mjs';

const lb = (x) => x * G_PER_LB;
const rows = [
  { slot: '1-2', personId: 5, cultivar: '2026 - Lifter / Sungrown', g: lb(1.5), min: 60 },
  { slot: '2-3', personId: 5, cultivar: '2026 - Lifter / Sungrown', g: lb(0.9), min: 50 },
  { slot: '12-1', personId: 0, cultivar: '', g: lb(0.1), min: 0 },
  { slot: '12-1', personId: 5, cultivar: '2026 - Lifter / Sungrown', g: lb(0.4), min: 30 },
];
const pickups = [{ g: 453.6, cycleS: 1500, personId: 5 }, { g: 483.5, cycleS: 1957, personId: 5 }];

test('summary: today, pace over named minutes, batches, best hour, hours at goal', () => {
  const s = seatSummary(rows, pickups, { 5: 'Diego' }, 1.1);
  assert.deepEqual(s.hours.map((h) => h.key), ['12-1', '1-2', '2-3'], "in the day's order");
  assert.equal(Math.round(s.totalLb * 100), 290);
  assert.equal(Math.round(s.pace * 100), Math.round((2.8 / (140 / 60)) * 100), 'named rows only');
  assert.equal(s.batches.n, 2);
  assert.equal(Math.round(s.batches.avgMin), 29);
  assert.equal(s.best.key, '1-2');
  assert.deepEqual(s.atGoal, { n: 1, of: 3 });
  assert.deepEqual(s.hours[0].people, [null, 'Diego'], 'a no-name row shows as no name');
});

test('panel: tiles, a row per hour, the current hour marked, names escaped, goal bars', () => {
  const s = seatSummary(rows, pickups, { 5: 'Diego <b>' }, 1.1);
  const html = detailHtml(s, { lang: 'en', seat: 'Cell 1', current: '2-3' });
  assert.match(html, /Diego &lt;b&gt;/);
  assert.match(html, /<tr class="now">\s*<td class="h">2–3/);
  assert.match(html, /sd-bar met/);
  assert.match(html, /sd-bar short/);
  assert.match(html, /2\.90 lb/);
  const es = detailHtml(s, { lang: 'es', seat: 'Cell 1' });
  assert.match(es, /Lotes/);
  assert.match(detailHtml(seatSummary([], [], {}, null), { lang: 'en', seat: 'Cell 2' }), /Nothing weighed/);
});
