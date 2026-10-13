import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bayScreenGroups } from '../workers/src/lib/bay-fills.js';

test('bayScreenGroups: one group per bay, bays ascending, rows by bins, sacks today and last tag per bay', () => {
  const cards = [
    { bay: 3, cultivar: 'Rainbow Cake', cut: 1, bins: 240, sacks: 4, fillStart: '2026-10-04 15:00:00', primary: { id: 11 }, groups: [{ zone: 'Z8', share: 1 }], doneAt: null },
    { bay: 3, cultivar: 'Sauciere', cut: 1, bins: 144, sacks: 0, fillStart: '2026-10-04 15:00:00', primary: { id: 12 }, groups: [{ zone: 'R1', share: 1 }], doneAt: null },
    { bay: 3, cultivar: 'Animal Muffins', cut: 1, bins: 384, sacks: 12, fillStart: '2026-10-04 15:00:00', primary: { id: 13 }, groups: [{ zone: 'R1', share: 0.81 }, { zone: 'Z10', share: 0.19 }], doneAt: null },
    { bay: 1, cultivar: 'Critical Berries', cut: 1, bins: 0, sacks: 0, fillStart: '2026-10-05 15:00:00', primary: { id: 14 }, groups: [{ zone: 'MZ1', share: 1 }], doneAt: null },
  ];
  const tags = [
    { sack_id: '26-RCAKE-4', bay: 3, cultivar: 'Rainbow Cake', cut_number: 1, printed_at: '2026-10-12 17:00:00', printed_day: '2026-10-12' },
    { sack_id: '26-AM-12', bay: 3, cultivar: 'Animal Muffins', cut_number: 1, printed_at: '2026-10-12 16:00:00', printed_day: '2026-10-12' },
    { sack_id: '26-AM-11', bay: 3, cultivar: 'Animal Muffins', cut_number: 1, printed_at: '2026-10-11 16:00:00', printed_day: '2026-10-11' },
  ];
  const g = bayScreenGroups(cards, tags, { today: '2026-10-12' });
  assert.deepEqual(g.map(x => x.bay), [1, 3]);
  assert.deepEqual(g[1].rows.map(r => r.cultivar), ['Animal Muffins', 'Rainbow Cake', 'Sauciere']);
  assert.equal(g[1].lastTag.sack_id, '26-RCAKE-4');
  assert.equal(g[1].lastTag.cultivar, 'Rainbow Cake');
  assert.equal(g[1].sacksToday, 2);
  assert.equal(g[0].lastTag, null);
  assert.equal(g[0].sacksToday, 0);
  assert.equal(g[0].rows[0].noLoads, true, 'zero bins = never scanned at the door');
  assert.equal(g[1].rows[0].noLoads, false);
  // Each row knows its own last tag (newest first), for the row drawer's reprint/void.
  assert.equal(g[1].rows[0].lastTag.sack_id, '26-AM-12');
  assert.equal(g[1].rows[2].lastTag, null);
});

test('bayScreenGroups: finished bays sort after active ones, ties by bay number', () => {
  const cards = [
    { bay: 2, cultivar: 'A', cut: 1, bins: 10, sacks: 0, fillStart: 'x', primary: { id: 1 }, groups: [], doneAt: '2026-10-11 20:00:00' },
    { bay: 5, cultivar: 'B', cut: 1, bins: 10, sacks: 0, fillStart: 'x', primary: { id: 2 }, groups: [], doneAt: null },
    { bay: 4, cultivar: 'C', cut: 1, bins: 10, sacks: 0, fillStart: 'x', primary: { id: 3 }, groups: [], doneAt: null },
  ];
  const g = bayScreenGroups(cards, [], { today: '2026-10-12' });
  assert.deepEqual(g.map(x => x.bay), [4, 5, 2]);
  assert.equal(g[2].finished, true);
  assert.equal(g[0].finished, false);
});
