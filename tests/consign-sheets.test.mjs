import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropoffSheet, screenSheet, screenableLots, sheetCode, DROPOFF_ROWS, SCREEN_ROWS } from '../src/js/consign/sheets.mjs';

const QR = '<svg data-qr="1"></svg>';
const pages = (html) => (html.match(/class="sh-page[ "]/g) || []).length;
const heads = (html) => (html.match(/class="sh-head"/g) || []).length;
const rowsOf = (html) => (html.match(/<tr class="sh-row/g) || []).length;
const farm = { id: 3, name: 'Farm A' };
const names = (n) => Array.from({ length: n }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);

test('the sizes the plan fixes', () => {
  assert.equal(DROPOFF_ROWS, 12);
  assert.equal(SCREEN_ROWS, 10);
});

test('sheet A: 0, 1, 12 cultivars fit one page; 13 make two, header repeated', () => {
  for (const n of [0, 1, 12]) {
    const h = dropoffSheet({ farm, cultivars: names(n), qrSvg: QR, code: 'DROP-F3' });
    assert.equal(pages(h), 1, `${n} cultivars`);
    assert.equal(rowsOf(h), 12);
    for (const c of names(n)) assert.ok(h.includes(`>${c}<`), c);
  }
  const h = dropoffSheet({ farm, cultivars: names(13), qrSvg: QR, code: 'DROP-F3' });
  assert.equal(pages(h), 2);
  assert.equal(heads(h), 2);
  assert.equal(rowsOf(h), 24);
  assert.equal((h.match(/data-qr="1"/g) || []).length, 2, 'QR on every page');
  assert.equal((h.match(/DROP-F3/g) || []).length, 2, 'code on every page');
  assert.ok(h.includes('C13'));
  assert.match(h, /1 \/ 2/);
  assert.equal((h.match(/class="sh-note"/g) || []).length, 1, 'dropoff note box once, on the last page');
});

test('sheet A without a farm: all blank, a farm box to write in', () => {
  const h = dropoffSheet({ farm: null, cultivars: [], qrSvg: QR, code: 'DROP' });
  assert.equal(pages(h), 1);
  assert.ok(!h.includes('Farm A'));
  assert.match(h, />DROP</);
});

test('sheet A is bilingual and carries the instruction', () => {
  const h = dropoffSheet({ farm, cultivars: ['Alpha'], qrSvg: QR, code: 'DROP-F3' });
  for (const s of ['Farm', 'Granja', 'Date', 'Fecha', 'Dropped by', 'Tops lb', 'Smalls lb', 'Note', 'Nota', 'Cross out', 'Tache']) assert.ok(h.includes(s), s);
});

const lot = (id, cultivar, type, status, intake, remainder, extra = {}) => ({
  id, cultivar, type, intake_lbs: intake, price_per_lb: 123.45, smalls_price_per_lb: 67.89,
  money: { status, intake_lbs: intake, remainder_lbs: remainder, pulled_lbs: intake == null ? 0 : intake - remainder, owed: 9999, value: 8888 },
  ...extra,
});
const dropoff = { id: 7, farm_name: 'Farm A', date: 'Nov 16, 2026', dropped_by: 'Sam' };

test('screenable lots: weighed or partly screened, in id order; the same rule as the worker', () => {
  const lots = [
    lot(5, 'B', 'tops', 'screening', 50, 20), lot(2, 'A', 'tops', 'weighed', 10, 10),
    lot(3, 'C', 'tops', 'dropped', null, 0), lot(4, 'D', 'tops', 'closed', 10, 0), lot(6, 'E', 'tops', 'voided', 10, 10),
  ];
  assert.deepEqual(screenableLots(lots).map((l) => l.id), [2, 5]);
});

test('sheet B: 1 and 10 lots one page, 11 lots two pages with the header repeated', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => lot(i + 1, `C${i + 1}`, i % 2 ? 'smalls' : 'tops', 'weighed', 10 + i, 10 + i));
  for (const n of [1, 10]) assert.equal(pages(screenSheet({ dropoff, lots: mk(n), qrSvg: QR, code: 'SCREEN-D7' })), 1, `${n} lots`);
  const h = screenSheet({ dropoff, lots: mk(11), qrSvg: QR, code: 'SCREEN-D7' });
  assert.equal(pages(h), 2);
  assert.equal(heads(h), 2);
  assert.equal(rowsOf(h), 11);
  assert.match(h, /<td class="sh-idx">11<\/td>/, 'numbering runs on across pages');
});

test('sheet B: a smalls row has no to-smalls box; a partly screened row prints what is left', () => {
  const h = screenSheet({ dropoff, lots: [lot(1, 'Alpha', 'tops', 'screening', 100, 40), lot(2, 'Alpha', 'smalls', 'weighed', 30, 30)], qrSvg: QR, code: 'SCREEN-D7' });
  const rows = h.split('<tr class="sh-row').slice(1);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /sh-box" data-box="to_smalls"/);
  assert.ok(!/data-box="to_smalls"/.test(rows[1]));
  assert.match(rows[1], /sh-na/);
  assert.match(rows[0], />40</);
  assert.match(rows[0], /left to screen/);
  assert.match(rows[1], />30</);
});

test('sheet B: unweighed lots go to "weigh first" with no boxes; closed and voided are left off', () => {
  const h = screenSheet({ dropoff, lots: [lot(1, 'Alpha', 'tops', 'weighed', 10, 10), lot(2, 'Beta', 'tops', 'dropped', null, 0), lot(3, 'Gone', 'tops', 'voided', 5, 5), lot(4, 'Done', 'tops', 'closed', 5, 0)], qrSvg: QR, code: 'SCREEN-D7' });
  assert.equal(rowsOf(h), 1);
  const [, weighFirst] = h.split('class="sh-weighfirst"');
  assert.ok(weighFirst && weighFirst.includes('Beta'));
  assert.ok(!h.includes('Gone') && !h.includes('Done'));
  for (const s of ['Farm A', 'Nov 16, 2026', 'Sam', 'SCREEN-D7', 'Pulled', 'Final', 'Biomass', 'Mold', 'Moho', 'Finished']) assert.ok(h.includes(s), s);
});

test('no price or money appears on either sheet', () => {
  const lots = [lot(1, 'Alpha', 'tops', 'weighed', 10, 10)];
  const all = dropoffSheet({ farm: { ...farm, price: 5 }, cultivars: ['Alpha'], qrSvg: QR, code: 'DROP-F3' })
    + screenSheet({ dropoff, lots, qrSvg: QR, code: 'SCREEN-D7' });
  assert.ok(!all.includes('$'));
  for (const n of ['123.45', '67.89', '9999', '8888', '9,999', '8,888']) assert.ok(!all.includes(n), n);
  assert.ok(!/price|precio/i.test(all));
});

test('names are escaped', () => {
  const h = dropoffSheet({ farm: { id: 1, name: '<b>F&A</b>' }, cultivars: ['<img src=x>'], qrSvg: QR, code: 'DROP-F1' })
    + screenSheet({ dropoff: { ...dropoff, farm_name: '<i>x</i>', dropped_by: '"q"' }, lots: [lot(1, '<script>', 'tops', 'weighed', 1, 1)], qrSvg: QR, code: 'SCREEN-D7' });
  assert.ok(!/<b>F|<img|<script>|<i>x/.test(h));
  assert.ok(h.includes('&lt;img src=x&gt;'));
  assert.ok(h.includes('&lt;b&gt;F&amp;A&lt;/b&gt;'));
});

test('sheet codes', () => {
  assert.equal(sheetCode('dropoff'), 'DROP');
  assert.equal(sheetCode('dropoff', 3), 'DROP-F3');
  assert.equal(sheetCode('screen', 7), 'SCREEN-D7');
});

test('sheet B prints the term only on look-alike rows (same cultivar and type)', () => {
  const h = screenSheet({ dropoff, lots: [
    lot(1, 'Alpha', 'tops', 'weighed', 10, 10, { term: 'dropoff' }),
    lot(2, 'Alpha', 'tops', 'weighed', 5, 5, { term: 'sold' }),
    lot(3, 'Beta', 'tops', 'weighed', 5, 5, { term: 'sold' }),
  ], qrSvg: QR, code: 'SCREEN-D7' });
  const rows = h.split('<tr class="sh-row').slice(1);
  assert.match(rows[0], /dropoff/);
  assert.match(rows[1], />sold</);
  assert.ok(!/>sold<|>dropoff</.test(rows[2]));
});

test('sheet B prints a lot reference on every row', () => {
  const h = screenSheet({ dropoff, lots: [lot(1042, 'Alpha', 'tops', 'weighed', 10, 10), lot(7, 'Beta', 'smalls', 'weighed', 5, 5)], qrSvg: QR, code: 'SCREEN-D7' });
  assert.match(h, /<span class="sh-ref">L7<\/span>/);
  assert.match(h, /<span class="sh-ref">L1042<\/span>/);
});

test('sheet A: a Final column beside each weight, one letter page at 12 rows, two at 13', () => {
  const h = dropoffSheet({ farm, cultivars: names(12), qrSvg: QR, code: 'DROP-F3' });
  const heads = [...h.matchAll(/<th[^>]*>.*?<span class="sh-en">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Cultivar', 'Tops lb', 'Tops final', 'Smalls lb', 'Smalls final', 'Note']);
  for (const es of ['Tops final', 'Smalls final']) assert.ok(h.includes(es));
  assert.ok(h.includes('Final de tops') && h.includes('Final de smalls'), 'Spanish under each Final');
  // Every row: name + 4 weight boxes + note.
  const firstRow = h.match(/<tr class="sh-row">([\s\S]*?)<\/tr>/)[1];
  assert.equal((firstRow.match(/<td/g) || []).length, 6);
  assert.equal((firstRow.match(/data-box="(tops|tops_final|smalls|smalls_final)"/g) || []).length, 4);
  assert.equal((h.match(/<col /g) || []).length, 6);
  const widths = [...h.matchAll(/<col style="width:(\d+)%">/g)].map((m) => Number(m[1]));
  assert.equal(widths.reduce((a, b) => a + b, 0), 100);
  assert.ok(Math.min(...widths.slice(1, 5)) >= 13, 'weight boxes wide enough to write in');
  assert.equal(pages(h), 1);
  assert.equal(pages(dropoffSheet({ farm, cultivars: names(13), qrSvg: QR, code: 'DROP-F3' })), 2);
});

test('sheet A: the instruction says when to fill Final, and no prices', () => {
  const h = dropoffSheet({ farm, cultivars: ['Alpha'], qrSvg: QR, code: 'DROP-F3' });
  assert.match(h, /Fill Final only if it was checked at dropoff/);
  assert.match(h, /empty if it will be screened later/);
  assert.match(h, /Llene Final solo si se revisó en la entrega/);
  assert.ok(!/\$|price|precio/i.test(h));
});
