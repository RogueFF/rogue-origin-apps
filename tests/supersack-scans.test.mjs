// End-of-day form vs scan-out: a 2026+ sack leaves Shopify by its scan, so the
// form must never move the supersack count for it. 2025 must be byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// package.json is "type": "commonjs" and the page loads this .js as an ES
// module, so load the same file's source as an ES module here (no copy).
const SRC = readFileSync(new URL('../src/js/shared/supersack-scans.js', import.meta.url), 'utf8');
const {
  isScanCounted, scanCountsForRows, supersackOp, sacksRemaining, weightsWithoutScans, rowsForDay, scanRefresh,
} = await import('data:text/javascript,' + encodeURIComponent(SRC));

const T25 = '2025 - Sour Lifter / Sungrown';
const T26 = '2026 - Sour Lifter / Sungrown / 1st Cut';
const T26b = '2026 - Sour Lifter / Sungrown / 2nd Cut';
const D = '2026-10-06';

test('isScanCounted: by crop year in the title', () => {
  assert.equal(isScanCounted(T25), false);
  assert.equal(isScanCounted('2026 - Lifter'), true);
  assert.equal(isScanCounted('2027 - Lifter'), true);
  assert.equal(isScanCounted(T26), true);
});

test('isScanCounted: odd formats of a 2026 title still count as scanned (fail safe)', () => {
  for (const t of ['2026-Lifter', ' 2026 – Lifter', '2026 Lifter', 'Lifter 2026', 'Lifter (2026)'])
    assert.equal(isScanCounted(t), true, t);
});

test('isScanCounted: malformed or yearless titles are not scan-counted', () => {
  for (const t of ['', null, undefined, 'Lifter', '20 - Lifter', '2025-Lifter', 'Lifter 4000'])
    assert.equal(isScanCounted(t), false, String(t));
});

test('supersackOp: never an operation for a 2026 strain', () => {
  assert.equal(supersackOp(T26, 3, T26, D, 'new'), null);
  assert.equal(supersackOp(T26, 2, T26, D, 'edit'), null);
  assert.equal(supersackOp(T26, -2, T26, D, 'edit'), null);
  assert.equal(supersackOp(T26, 0, T26, D, 'edit'), null);
  // scans missing → count is 0; scans arrive later → delta grows; still nothing
  assert.equal(supersackOp(T26, 0, T26, D, 'new'), null);
  assert.equal(supersackOp('2026-Lifter', 5, '2026-Lifter', D, 'edit'), null);
});

// Expected strings copied from the ORIGINAL page (git HEAD) updatePool calls.
test('supersackOp: 2025 new entry is exactly the original subtract', () => {
  assert.deepEqual(supersackOp(T25, 3, T25, D, 'new'),
    { operation: 'subtract', amount: 3, note: `[Supersack Tracker] 3 supersacks opened — ${T25} (${D})` });
  assert.equal(supersackOp(T25, 0, T25, D, 'new'), null);   // original: only when s.sacks > 0
  assert.equal(supersackOp(T25, -1, T25, D, 'new'), null);
});

test('supersackOp: 2025 edit deltas are exactly the original correction both ways', () => {
  assert.deepEqual(supersackOp(T25, 2, T25, D, 'edit'),
    { operation: 'subtract', amount: 2, note: `[Supersack Tracker] Correction: ${T25} +2 sacks (${D})` });
  assert.deepEqual(supersackOp(T25, -3, T25, D, 'edit'),
    { operation: 'add', amount: 3, note: `[Supersack Tracker] Correction: ${T25} -3 sacks (${D})` });
  assert.equal(supersackOp(T25, 0, T25, D, 'edit'), null);
});

const rows = [
  { title: T25, productId: 111 },
  { title: T26, productId: 'gid://shopify/ProductVariant/222' },
  { title: T26b, productId: 333 },
  { title: '2026 - Gelato / Sungrown', productId: 444 },
];
const total = (r) => Object.values(r.counts).reduce((a, b) => a + b, 0) + r.unmapped.reduce((a, u) => a + u.sacks, 0);

test('scanCountsForRows: by variant id, gid vs plain, two cuts on their own rows', () => {
  const by = [{ season: 2026, cultivar: 'Sour Lifter', strain_titles: [T26, T26b],
    by_variant: [{ shopify_variant_id: '222', sacks: 2 }, { shopify_variant_id: 'gid://shopify/ProductVariant/333', sacks: 1 }],
    no_variant: [] }];
  const r = scanCountsForRows(rows, by);
  assert.equal(r.counts[T26], 2);
  assert.equal(r.counts[T26b], 1);
  assert.deepEqual(r.unmapped, []);
  assert.equal(total(r), 3);
});

test('scanCountsForRows: no-variant sacks land only on a single matching row', () => {
  const by = [
    { season: 2026, cultivar: 'Gelato', strain_titles: ['2026 - Gelato / Sungrown'], by_variant: [], no_variant: [{}, {}] },
    { season: 2026, cultivar: 'Sour Lifter', strain_titles: [T26, T26b], by_variant: [], no_variant: [{}] },
    { season: 2026, cultivar: 'Nowhere', strain_titles: [], by_variant: [], no_variant: [{}, {}, {}] },
  ];
  const r = scanCountsForRows(rows, by);
  assert.equal(r.counts['2026 - Gelato / Sungrown'], 2);
  assert.equal(r.counts[T26], 0);           // two rows → not the first one
  assert.equal(r.counts[T26b], 0);
  assert.deepEqual(r.unmapped.map(u => [u.cultivar, u.sacks, u.reason]),
    [['Sour Lifter', 1, 'no_variant_several_rows'], ['Nowhere', 3, 'no_form_row']]);
  assert.equal(total(r), 6);                // nothing dropped
});

test('scanCountsForRows: a variant id on a 2025 row is reported, not silently swallowed', () => {
  const by = [{ season: 2026, cultivar: 'X', strain_titles: [], by_variant: [{ shopify_variant_id: '111', sacks: 4 }], no_variant: [] }];
  const r = scanCountsForRows(rows, by);
  assert.equal(r.counts[T25], undefined);
  assert.equal(total(r), 4);
});

test('sacksRemaining: 2026 not subtracted twice; 2025 is poolValue - sacks', () => {
  assert.equal(sacksRemaining(T26, 10, 3), 10);
  assert.equal(sacksRemaining(T25, 10, 3), 7);
});

test('weightsWithoutScans: only 2026 strains with output and no scanned sack', () => {
  const e = [{ title: T26, tops: 5 }, { title: T26b, smalls: 1 }, { title: T25, tops: 9 }, { title: '2026 - Gelato / Sungrown' }];
  assert.deepEqual(weightsWithoutScans(e, { [T26b]: 2 }), [T26]);
});

// Structural: every supersack inventory write in the page goes through the
// load-order-proof guard, so a future edit cannot reintroduce the double subtract.
test('page: every supersack updatePool call is behind guardedSupersackOp', () => {
  const html = readFileSync(new URL('../src/pages/supersack-entry.html', import.meta.url), 'utf8');
  const calls = [...html.matchAll(/await updatePool\(([^;]*)\);/g)].map(m => m[1]);
  const supersack = calls.filter(c => /,\s*true\s*\)?$/.test(c.trim()) || /productId/.test(c.split(',')[0]));
  // the two form paths (new/edit) plus the recent-changes correction (entry.isSupersack)
  for (const c of supersack) {
    if (/entry\.isSupersack/.test(c)) continue;
    assert.match(c, /^s\.productId,\s*op\.operation,\s*op\.amount,\s*op\.note,\s*true$/, c);
  }
  assert.equal(supersack.filter(c => /^s\.productId/.test(c)).length, 2);
  const ops = [...html.matchAll(/const op = (\w+)\(/g)].map(m => m[1]);
  assert.deepEqual(ops, ['guardedSupersackOp', 'guardedSupersackOp']);
  assert.ok(!/SS\(\)\.supersackOp\(/.test(html.replace(/function guardedSupersackOp[\s\S]*?\n  }\n/, '')),
    'supersackOp called outside the guard');
  // the guard carries its own year rule, not only the module's
  assert.match(html, /function yearScanCounted\(/);
  assert.match(html, /function guardedSupersackOp\([^)]*\)\s*{\s*\n\s*if \(yearScanCounted\(/);
});

test('page: the inline year guard agrees with the module on every title shape', () => {
  const html = readFileSync(new URL('../src/pages/supersack-entry.html', import.meta.url), 'utf8');
  const src = html.match(/function yearScanCounted\([\s\S]*?\n  }\n/)[0];
  const yearScanCounted = new Function(`${src}; return yearScanCounted;`)();
  for (const t of [T25, T26, T26b, '2027 - X', '2026-X', 'X 2026', 'X (2026)', '2025-X', 'X', '', null, 'X 4000', '20 - X'])
    assert.equal(yearScanCounted(t), isScanCounted(t), String(t));
});

// ---- rowsForDay: which rows a day has (2nd Cut gets its own row) ----
const BP1 = '2026 - Blue Pineapple / Sungrown / 1st Cut';
const BP2 = '2026 - Blue Pineapple / Sungrown / 2nd Cut';
const L25 = '2025 - Lifter / Sungrown';
const L25b = '2025 - Lifter / Sungrown / Greenhouse';
const VARS = [
  { id: 'gid://shopify/ProductVariant/11', title: BP1 },
  { id: 'gid://shopify/ProductVariant/12', title: BP2 },
  { id: 21, title: L25 }, { id: 22, title: L25b }, { id: 31, title: T26 },
];
const scansOn = (...vs) => [{ season: 2026, cultivar: 'x', strain_titles: [], no_variant: [],
  by_variant: vs.map(([id, sacks]) => ({ shopify_variant_id: id, sacks })) }];
// The page's mapping before this change, for the 2025 equality check.
const oldMap = (strains, variants) => {
  const out = [];
  for (const s of strains) {
    const t = variants.find(v => v.title === s)?.title
      || variants.find(v => v.title.toLowerCase().includes(s.toLowerCase().trim()))?.title || s;
    if (!out.includes(t)) out.push(t);
  }
  return out;
};
const titles = (d) => d.rows.map(r => r.title);

test('rowsForDay: 2025 rows are exactly the old mapping, scans or not', () => {
  for (const strains of [['2025 - Lifter'], [L25b], ['Lifter', 'Nope'], ['2025 - Lifter / Sungrown', 'lifter']]) {
    const d = rowsForDay({ scoreboardStrains: strains, variants: VARS, scans: scansOn([22, 4]) });
    assert.deepEqual(titles(d), oldMap(strains, VARS), strains.join('|'));
    assert.ok(d.rows.every(r => !r.fromScans && r.strain));
  }
});

test('rowsForDay: cut-less 2026 strain with scans only on 2nd Cut uses the 2nd Cut row', () => {
  const d = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple / Sungrown'], variants: VARS, scans: scansOn(['12', 3]) });
  assert.deepEqual(d.rows, [{ title: BP2, variantId: 'gid://shopify/ProductVariant/12', fromScans: false,
    strain: '2026 - Blue Pineapple / Sungrown', poundsOn: null }]);
});

test('rowsForDay: scans on both cuts give both rows; pounds stay on the matched one', () => {
  const d = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple / Sungrown'], variants: VARS, scans: scansOn([11, 2], [12, 3]) });
  assert.deepEqual(titles(d), [BP1, BP2]);
  assert.equal(d.rows[0].strain, '2026 - Blue Pineapple / Sungrown');
  assert.deepEqual([d.rows[1].fromScans, d.rows[1].strain, d.rows[1].poundsOn], [true, null, BP1]);
});

test('rowsForDay: a scanned variant the scoreboard never named gets a fromScans row', () => {
  const d = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple / Sungrown'], variants: VARS, scans: scansOn([11, 1], [31, 5]) });
  assert.deepEqual(titles(d), [BP1, T26]);
  assert.deepEqual([d.rows[1].fromScans, d.rows[1].strain, d.rows[1].poundsOn], [true, null, null]);
  // and the twin of a scoreboard row points its pounds at that row
  const e = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple / Sungrown'], variants: VARS, scans: [] });
  assert.deepEqual(titles(e), [BP1]);
  const f = rowsForDay({ scoreboardStrains: [], variants: VARS, scans: scansOn([12, 1]) });
  assert.deepEqual(f.rows, [{ title: BP2, variantId: 'gid://shopify/ProductVariant/12', fromScans: true, strain: null, poundsOn: null }]);
});

test('rowsForDay: no scans keeps first-match; no duplicate rows', () => {
  const d = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple', 'Blue Pineapple / Sungrown'], variants: VARS, scans: [] });
  assert.deepEqual(titles(d), [BP1]);
  const g = rowsForDay({ scoreboardStrains: ['2026 - Blue Pineapple', BP2], variants: VARS, scans: scansOn([11, 1], [12, 1], ['gid://shopify/ProductVariant/12', 2]) });
  assert.deepEqual(titles(g).slice().sort(), [BP1, BP2]);
  assert.equal(new Set(titles(g)).size, titles(g).length);
  assert.ok(g.rows.every(r => r.strain), 'a scoreboard-named row carries its strain');
});

test('rowsForDay: a scanned variant id not in the variant list is reported, not dropped', () => {
  const d = rowsForDay({ scoreboardStrains: [], variants: VARS, scans: scansOn([99, 2], [11, 1]) });
  assert.deepEqual(d.missing, ['99']);
  assert.deepEqual(titles(d), [BP1]);
});

// ---- scanRefresh: the re-read on save ----
test('scanRefresh: same, more, fewer, different date, fetch failed', () => {
  const loaded = { date: D, ok: true, counts: { [T26]: 2, [T26b]: 1 } };
  assert.deepEqual(scanRefresh({ date: D, loaded, fresh: { date: D, ok: true, counts: { [T26]: 2, [T26b]: 1 } } }), { ok: true, reason: 'same', delta: 0 });
  assert.deepEqual(scanRefresh({ date: D, loaded, fresh: { date: D, ok: true, counts: { [T26]: 4, [T26b]: 2 } } }), { ok: true, reason: 'more', delta: 3 });
  assert.deepEqual(scanRefresh({ date: D, loaded, fresh: { date: D, ok: true, counts: { [T26]: 1 } } }), { ok: true, reason: 'fewer', delta: -2 });
  assert.equal(scanRefresh({ date: D, loaded, fresh: { date: '2026-10-05', ok: true, counts: { [T26]: 9 } } }).reason, 'wrong_date');
  assert.equal(scanRefresh({ date: D, loaded, fresh: { date: '2026-10-05', ok: true, counts: {} } }).ok, false);
  assert.deepEqual(scanRefresh({ date: D, loaded, fresh: null }), { ok: false, reason: 'fetch_failed', delta: 0 });
  // loaded for another date: the fresh count is all new
  assert.equal(scanRefresh({ date: D, loaded: { ...loaded, date: '2026-10-05' }, fresh: { date: D, ok: true, counts: { [T26]: 2 } } }).delta, 2);
});

test('page: the submit re-reads the scans for the save date before building the save', () => {
  const html = readFileSync(new URL('../src/pages/supersack-entry.html', import.meta.url), 'utf8');
  const sub = html.slice(html.indexOf("submitBtn.addEventListener('click'"));
  const reread = sub.indexOf('await loadScans(saveDate, 6000)');
  assert.ok(reread > 0 && reread < sub.indexOf('weightsWithoutScans('), 're-read before the save is built');
  assert.match(html, /scanState\.ok && scanState\.date !== dateInput\.value/);
});

test('page: a refused scan-owned correction restores the row before returning', () => {
  const html = readFileSync(new URL('../src/pages/supersack-entry.html', import.meta.url), 'utf8');
  assert.match(html, /if \(entry\.isSupersack && isScanRow\(entry\.title \|\| entry\.name\)\) \{\s*restoreEditRow\(row\);[^}]*?\.scanOwned, 'error'\);\s*return;/);
  assert.match(html, /if \(!productId\) \{\s*restoreEditRow\(row\);/);
  assert.match(html, /function restoreEditRow\(row\) \{\s*row\.classList\.remove\('saving', 'editing'\);[\s\S]*?_originalAmountHtml[\s\S]*?pencil\.style\.display = ''/);
  // and no pencil is offered on a scan-owned supersack entry at all
  assert.match(html, /const editable = [^;]*&& !\(e\.isSupersack && isScanRow\(e\.title \|\| e\.name\)\)/);
});
