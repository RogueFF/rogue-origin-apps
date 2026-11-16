import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSheetRead, parseWeight } from '../workers/src/lib/consign-sheet.js';

const CTX = {
  farms: [{ id: 3, name: 'Farm A' }, { id: 4, name: 'Farm B' }],
  cultivars: ['Alpha', 'Beta'],
  lots: [],
};
const LOTS = [
  { id: 11, cultivar: 'Alpha', type: 'tops', intake_lbs: 100, remainder_lbs: 100 },
  { id: 12, cultivar: 'Alpha', type: 'smalls', intake_lbs: 40, remainder_lbs: 40 },
  { id: 13, cultivar: 'Beta', type: 'tops', intake_lbs: 60, remainder_lbs: 20 },
];
const SCTX = { ...CTX, lots: LOTS, dropoff_id: 7 };

test('rule 1: garbage in never throws and is unreadable', () => {
  for (const raw of [null, undefined, 5, 'text', [], { rows: 'x' }, { nope: 1 }]) {
    for (const kind of ['dropoff', 'screen']) {
      const r = normalizeSheetRead(kind, raw, kind === 'screen' ? SCTX : CTX);
      assert.deepEqual(r.rows, []);
      assert.deepEqual(r.warnings, ['unreadable']);
      assert.equal(r.kind, kind);
    }
  }
  assert.doesNotThrow(() => normalizeSheetRead('dropoff', { rows: [null, 3, 'x', { tops: { value: {} } }] }, CTX));
  assert.doesNotThrow(() => normalizeSheetRead('dropoff', { rows: [] }, undefined));
});

test('rule 2/3: weights are bounded, rounded, parsed only from clean numbers', () => {
  assert.deepEqual(parseWeight(100), { value: 100, unsure: false });
  assert.deepEqual(parseWeight(12.345), { value: 12.3, unsure: false });
  assert.deepEqual(parseWeight('100'), { value: 100, unsure: false });
  assert.deepEqual(parseWeight('100.5 lb'), { value: 100.5, unsure: true });
  assert.deepEqual(parseWeight('1OO'), { value: null, unsure: true });
  assert.deepEqual(parseWeight(0), { value: null, unsure: true });
  assert.deepEqual(parseWeight(-4), { value: null, unsure: true });
  assert.deepEqual(parseWeight(5000), { value: 5000, unsure: false });
  assert.deepEqual(parseWeight(5000.1), { value: null, unsure: true });
  assert.deepEqual(parseWeight(Infinity), { value: null, unsure: true });
  assert.deepEqual(parseWeight(NaN), { value: null, unsure: true });
  assert.deepEqual(parseWeight(null), { value: null, unsure: false });
  assert.deepEqual(parseWeight(''), { value: null, unsure: false });
  assert.deepEqual(parseWeight({ a: 1 }), { value: null, unsure: true });
  // the model saying unsure wins even on a clean number
  assert.deepEqual(parseWeight(40, true), { value: 40, unsure: true });
  // zero is allowed where the caller says so (screening outputs)
  assert.deepEqual(parseWeight(0, false, { zero: true }), { value: 0, unsure: false });
  assert.deepEqual(parseWeight('0', false, { zero: true }), { value: 0, unsure: false });
});

const box = (value, extra = {}) => ({ value, unsure: false, ...extra });

test('rule 4: dropoff rows, cultivar matching, ticks and dropped empties', () => {
  const r = normalizeSheetRead('dropoff', {
    farm: 'farm a',
    rows: [
      { cultivar: '  alpha ', tops: box(100), smalls: box(null, { check: true }), note: 'wet' },
      { cultivar: 'Gamma', tops: box('1OO'), smalls: box(null) },
      { cultivar: '', tops: box(null), smalls: box(null) },
      { cultivar: 'x'.repeat(90), tops: box(5), smalls: box(null) },
      { cultivar: null, tops: box(null), smalls: box(12) },
    ],
  }, CTX);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.rows.length, 4);
  const [a, g, long, blank] = r.rows;
  assert.deepEqual(a, {
    cultivar: 'Alpha', cultivar_known: true,
    tops: { value: 100, unsure: false, on: true },
    smalls: { value: null, unsure: false, on: true },
    note: 'wet',
  });
  assert.equal(g.cultivar, 'Gamma');
  assert.equal(g.cultivar_known, false);
  assert.deepEqual(g.tops, { value: null, unsure: true, on: true });
  assert.deepEqual(g.smalls, { value: null, unsure: false, on: false });
  assert.equal(long.cultivar.length, 60);
  assert.equal(blank.cultivar, '');
  assert.equal(blank.cultivar_known, false);
  assert.equal(blank.smalls.value, 12);
});

test('rule 4: a cultivar the model was unsure of is not known, even when it matches', () => {
  const r = normalizeSheetRead('dropoff', { rows: [{ cultivar: 'Beta', cultivar_unsure: true, tops: box(3) }] }, CTX);
  assert.equal(r.rows[0].cultivar, 'Beta');
  assert.equal(r.rows[0].cultivar_known, false);
});

test('rule 4: at most 30 rows', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ cultivar: `C${i}`, tops: box(1) }));
  assert.equal(normalizeSheetRead('dropoff', { rows }, CTX).rows.length, 30);
});

test('rule 5: farm by exact name, else by DROP-F code, else null', () => {
  assert.equal(normalizeSheetRead('dropoff', { farm: ' FARM B ', rows: [] }, CTX).farm_id, 4);
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farm', code: 'DROP-F3', rows: [] }, CTX).farm_id, 3);
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farm', code: 'drop-f3', rows: [] }, CTX).farm_id, 3);
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farm', code: 'DROP-F99', rows: [] }, CTX).farm_id, null);
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farm', rows: [] }, CTX).farm_id, null);
  assert.equal(normalizeSheetRead('dropoff', { code: 'DROP', rows: [] }, CTX).farm_id, null);
});

test('a screening sheet photographed as a dropoff (or the wrong dropoff) is refused', () => {
  const a = normalizeSheetRead('dropoff', { code: 'SCREEN-D7', rows: [{ cultivar: 'Alpha', tops: box(1) }] }, CTX);
  assert.deepEqual(a.rows, []);
  assert.deepEqual(a.warnings, ['wrong_sheet']);
  const b = normalizeSheetRead('screen', { code: 'SCREEN-D8', rows: [{ index: 1, pulled: box(10), final: box(10) }] }, SCTX);
  assert.deepEqual(b.rows, []);
  assert.deepEqual(b.warnings, ['wrong_sheet']);
  const c = normalizeSheetRead('screen', { code: 'DROP-F3', rows: [{ index: 1, pulled: box(10), final: box(10) }] }, SCTX);
  assert.deepEqual(c.warnings, ['wrong_sheet']);
  // opened from one farm's QR, but the sheet printed for another farm
  const d = normalizeSheetRead('dropoff', { code: 'DROP-F4', rows: [{ cultivar: 'Alpha', tops: box(1) }] }, { ...CTX, farm_id: 3 });
  assert.deepEqual(d.warnings, ['wrong_sheet']);
  const e = normalizeSheetRead('dropoff', { code: 'DROP-F3', rows: [{ cultivar: 'Alpha', tops: box(1) }] }, { ...CTX, farm_id: 3 });
  assert.equal(e.farm_id, 3);
  assert.equal(e.rows.length, 1);
});

test('rule 6: screen rows match by printed index or cultivar + type; unknown dropped', () => {
  const r = normalizeSheetRead('screen', {
    code: 'SCREEN-D7',
    rows: [
      { index: 1, cultivar: 'Alpha', type: 'tops', pulled: box(100), final: box(80), to_smalls: box(10), biomass: box(9), mold: box(1), finished: { value: true, unsure: false } },
      { index: 9, cultivar: 'beta', type: 'tops', pulled: box(20), final: box(20), finished: { value: false } },
      { index: 2, cultivar: 'Alpha', type: 'smalls', pulled: box(40), final: box(39), to_smalls: box(5), mold: box(0) },
      { index: 5, cultivar: 'Zeta', type: 'tops', pulled: box(1) },
    ],
  }, SCTX);
  assert.deepEqual(r.warnings, ['unknown_row']);
  assert.deepEqual(r.rows.map((x) => x.lot_id), [11, 13, 12]);
  const [a, b, s] = r.rows;
  assert.deepEqual(a, {
    lot_id: 11,
    pulled: { value: 100, unsure: false },
    final: { value: 80, unsure: false },
    to_smalls: { value: 10, unsure: false },
    biomass: { value: 9, unsure: false },
    mold: { value: 1, unsure: false },
    finishes: { value: true, unsure: false },
  });
  assert.deepEqual(b.biomass, { value: null, unsure: false });
  assert.deepEqual(b.finishes, { value: false, unsure: false });
  assert.deepEqual(s.to_smalls, { value: 0, unsure: false }, 'smalls lot forced to 0');
  assert.deepEqual(s.mold, { value: 0, unsure: false }, 'zero is a real screening number');
});

test('rule 6: the index wins unless its cultivar contradicts; a lot is matched once', () => {
  const r = normalizeSheetRead('screen', {
    rows: [
      { index: 1, cultivar: 'Beta', type: 'tops', pulled: box(20) }, // index 1 is Alpha: falls back to Beta tops (13)
      { index: 3, pulled: box(15) }, // index alone: 13 again -> duplicate, dropped
      { index: 3.5, pulled: box(1) },
    ],
  }, SCTX);
  assert.deepEqual(r.rows.map((x) => x.lot_id), [13]);
  assert.deepEqual(r.warnings, ['duplicate_row', 'unknown_row']);
});

test('rule 6: a finished tick the model is unsure of stays unsure; junk is not true', () => {
  const r = normalizeSheetRead('screen', {
    rows: [
      { index: 1, pulled: box(5), finished: { value: 'yes', unsure: false } },
      { index: 2, pulled: box(5), finished: { value: true, unsure: true } },
    ],
  }, SCTX);
  assert.deepEqual(r.rows[0].finishes, { value: false, unsure: true });
  assert.deepEqual(r.rows[1].finishes, { value: true, unsure: true });
});

test('rule 6: a screen row with nothing written is dropped', () => {
  const r = normalizeSheetRead('screen', { rows: [{ index: 1, pulled: box(null), final: box(null) }] }, SCTX);
  assert.deepEqual(r.rows, []);
});

test('rule 7: free text trimmed, control characters stripped, capped', () => {
  const r = normalizeSheetRead('dropoff', {
    dropped_by: ' Sam\u0000\u0007 ',
    note: `a\u001b[31m${'y'.repeat(400)}`,
    date: '2026-11-16',
    rows: [{ cultivar: 'Al\u0000pha', tops: box(1), note: '\tok\n' }],
  }, CTX);
  assert.equal(r.dropped_by, 'Sam');
  assert.equal(r.note.length, 300);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r.note));
  assert.equal(r.rows[0].cultivar, 'Alpha');
  assert.equal(r.rows[0].note, 'ok');
  assert.equal(r.date, '2026-11-16');
  assert.equal(normalizeSheetRead('dropoff', { date: 'yesterday', rows: [] }, CTX).date, null);
  assert.equal(normalizeSheetRead('dropoff', { dropped_by: 42, rows: [] }, CTX).dropped_by, '');
});

test('rule 8: no model keys pass through', () => {
  const evil = {
    farm: 'Farm A', extra: 'x', __proto__: { polluted: 1 }, sql: 'DROP TABLE',
    rows: [{ cultivar: 'Alpha', tops: { value: 1, unsure: false, html: '<b>' }, smalls: {}, price: 99, lot_id: 5 }],
  };
  const r = normalizeSheetRead('dropoff', evil, CTX);
  assert.deepEqual(Object.keys(r).sort(), ['date', 'dropped_by', 'farm_from', 'farm_id', 'kind', 'note', 'rows', 'warnings']);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['cultivar', 'cultivar_known', 'note', 'smalls', 'tops']);
  assert.deepEqual(Object.keys(r.rows[0].tops).sort(), ['on', 'unsure', 'value']);
  const s = normalizeSheetRead('screen', { rows: [{ index: 1, pulled: box(1), lot_id: 999, extra: 1 }] }, SCTX);
  assert.deepEqual(Object.keys(s.rows[0]).sort(), ['biomass', 'final', 'finishes', 'lot_id', 'mold', 'pulled', 'to_smalls']);
  assert.equal(s.rows[0].lot_id, 11);
});

test('an unknown kind is unreadable', () => {
  const r = normalizeSheetRead('payments', { rows: [{}] }, CTX);
  assert.deepEqual(r.warnings, ['unreadable']);
  assert.deepEqual(r.rows, []);
});

test('farm_from says where the farm came from: the printed code, the handwriting, or nowhere', () => {
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farm B', code: 'DROP-F3', rows: [] }, CTX).farm_from, 'name');
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farmm', code: 'DROP-F3', rows: [] }, CTX).farm_from, 'code');
  assert.equal(normalizeSheetRead('dropoff', { farm: 'Farmm', rows: [] }, CTX).farm_from, null);
  assert.equal(normalizeSheetRead('screen', { rows: [] }, SCTX).farm_from, null);
});

test('a screen row the model could not read at all comes back, every box unsure', () => {
  const r = normalizeSheetRead('screen', { rows: [{ index: 1, pulled: box(null, { unsure: true }), final: box(null, { unsure: true }) }] }, SCTX);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].pulled, { value: null, unsure: true });
});

test('a printed lot that is no longer open takes no numbers', () => {
  const lots = [{ ...LOTS[0], open: false }, LOTS[1]];
  const r = normalizeSheetRead('screen', { rows: [{ index: 1, pulled: box(5) }, { index: 2, pulled: box(5) }] }, { ...SCTX, lots });
  assert.deepEqual(r.rows.map((x) => x.lot_id), [12]);
  assert.deepEqual(r.warnings, ['lot_changed']);
});

test('the printed lot reference wins over the row number; a reference to a lot no longer open takes nothing', () => {
  // Printed when lots were [11, 13]; lot 12 was weighed since, so today's open order is [11, 12, 13].
  const refLots = [...LOTS.map((l) => ({ ...l, open: true })), { id: 14, cultivar: 'Alpha', type: 'tops', open: false }];
  const ctx = { ...SCTX, refLots };
  const r = normalizeSheetRead('screen', { rows: [
    { index: 2, lot_ref: 'L13', cultivar: 'Beta', type: 'tops', pulled: box(20), final: box(20) },
    { index: 1, lot_ref: 'l14', cultivar: 'Alpha', type: 'tops', pulled: box(5), final: box(5) },
  ] }, ctx);
  assert.deepEqual(r.rows.map((x) => x.lot_id), [13]);
  assert.deepEqual(r.warnings, ['lot_changed']);
});

test('a lot reference that is unreadable, unknown or contradicts the row falls back to the row number', () => {
  const ctx = { ...SCTX, refLots: LOTS.map((l) => ({ ...l, open: true })) };
  const r = normalizeSheetRead('screen', { rows: [
    { index: 1, lot_ref: 'L99', cultivar: 'Alpha', type: 'tops', pulled: box(5) },
    { index: 2, lot_ref: 'L13', cultivar: 'Alpha', type: 'smalls', pulled: box(5) },
    { index: 3, lot_ref: '1?', pulled: box(5) },
  ] }, ctx);
  assert.deepEqual(r.rows.map((x) => x.lot_id), [11, 12, 13]);
});
