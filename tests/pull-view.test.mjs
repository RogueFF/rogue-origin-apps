// Water spider pull list (src/js/pull/view.mjs, order flow slice 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRows, rawFor, shortName } from '../src/js/pull/view.mjs';

const SL = '2026 - Sour Lifter / Sungrown';
const LI = '2026 - Lifter / Sungrown';

test('raw to bring: the SOP-028 rates (Lifter x4.4, everything else the Sour Lifter x5.8)', () => {
  assert.equal(rawFor({ cultivar: SL, targetG: 30 }), 175);
  assert.equal(rawFor({ cultivar: LI, targetG: 30 }), 130);
  assert.equal(rawFor({ cultivar: SL, targetG: 120 }), 700);
  assert.equal(rawFor({ cultivar: SL, targetG: 0 }), null);
});

test('rows: cells with work first; NEXT of the same cultivar is flagged', () => {
  const cells = [
    { stationId: 'table1', label: 'Cell 1', takesOrders: true, now: null, next: null },
    { stationId: 'table12', label: 'Cell 12', takesOrders: true,
      now: { orderName: '#1', cultivar: SL, bag: 'oz1', bags: 4, targetG: 120 },
      next: { orderName: '#2', cultivar: SL, bag: 'oz1', bags: 1, targetG: 30 } },
    { stationId: 'table5', label: 'Cell 5', takesOrders: false, now: null, next: null },
  ];
  const rows = pullRows(cells);
  assert.deepEqual(rows.map(r => r.stationId), ['table12', 'table1'], 'a cell that takes no orders is left out');
  assert.equal(rows[0].now.name, 'Sour Lifter');
  assert.equal(rows[0].now.rawG, 700);
  assert.equal(rows[0].next.sameAsNow, true);
  assert.equal(shortName(LI), 'Lifter');
});
