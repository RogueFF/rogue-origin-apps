/**
 * A gap in a bay's loads is not a takedown (2026-10-19). On 10/16 a few loads
 * were scanned into bays 8 and 12 a week after the Lifter went in; the gap
 * rule read each as a refill, closed the Lifter's fill and the screen dropped
 * it with its lots still open, no tags printed and no bay-done row. A later
 * load may only close a fill that shows signs of having come down.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bayFills, fillIsDown } from '../workers/src/lib/bay-fills.js';

const at = (day, h = 12, m = 0) => `2026-10-${String(day).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
const lot = (id, extra = {}) => ({ id, zone: 'Z19', cultivar: 'Lifter', cut_number: 1, takedown_done_at: null, session_ids: [id], ...extra });
const sessions = (...lots) => {
  const m = new Map();
  for (const l of lots) for (const id of l.session_ids) m.set(id, l);
  return m;
};

// Bay 12 as scanned: Lifter on 10/9, two loads of a 2nd cut on 10/16.
const bay12 = [
  { bay: 12, occurred_at: at(9, 15, 51), session_id: 1470, bins: 24 },
  { bay: 12, occurred_at: at(9, 19, 57), session_id: 1665, bins: 24 },
  { bay: 12, occurred_at: at(16, 18, 17), session_id: 1879, bins: 24 },
  { bay: 12, occurred_at: at(16, 18, 25), session_id: 1879, bins: 24 },
];

test('bayFills: a load after the gap joins the fill when nothing says the bay came down', () => {
  const fills = bayFills(bay12, { isDown: () => false });
  const f = fills.get(12);
  assert.equal(f.length, 1, 'one fill: the Lifter never came down, the 2nd cut hangs beside it');
  assert.equal(f[0].startMs, Date.parse('2026-10-09T15:51:00Z'), 'the fill keeps its first load as its start');
  assert.deepEqual(f[0].loads.map(l => l.session_id), [1470, 1665, 1879, 1879]);
  assert.equal(f[0].closed, false);
});

test('bayFills: the same gap splits the bay when the first fill did come down', () => {
  const seen = [];
  const fills = bayFills(bay12, { isDown: (bay, fill) => { seen.push([bay, fill.loads.length]); return true; } });
  const f = fills.get(12);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].loads.map(l => l.session_id), [1470, 1665]);
  assert.equal(f[0].closed, true);
  assert.deepEqual(f[1].loads.map(l => l.session_id), [1879, 1879]);
  assert.deepEqual(seen, [[12, 2]], 'asked once, at the gap, about the fill as it stood');
});

test('bayFills: without an isDown the gap rule stands alone (the picker before 2026-10-19)', () => {
  assert.equal(bayFills(bay12).get(12).length, 2);
});

test('fillIsDown: a bay-done row for the fill is proof', () => {
  const lifter = lot(1470);
  const isDown = fillIsDown({ lotOfSession: sessions(lifter), tags: [],
    done: [{ bay: 12, cultivar: 'Lifter', cut_number: 1, fill_start: at(9, 15, 51) }] });
  const fill = { startMs: Date.parse('2026-10-09T15:51:00Z'), loads: bay12.slice(0, 1) };
  assert.equal(isDown(12, fill), true);
  assert.equal(isDown(11, fill), false, 'another bay\'s row says nothing about this one');
  const other = fillIsDown({ lotOfSession: sessions(lifter), tags: [],
    done: [{ bay: 12, cultivar: 'Lifter', cut_number: 1, fill_start: at(1, 9) }] });
  assert.equal(other(12, fill), false, 'a row for an earlier fill of the bay is not this fill');
});

test('fillIsDown: a tag printed in that bay off one of the fill\'s lots is proof; other tags are not', () => {
  const lifter = lot(1470, { session_ids: [1470, 1499] });   // a merged lot: tags hang off 1470, loads may sit on 1499
  const sl = lot(840, { zone: 'Z3', cultivar: 'Sour Lifter' });
  const lotOfSession = sessions(lifter, sl);
  const fill = { startMs: Date.parse('2026-10-09T15:51:00Z'), loads: [{ bay: 12, occurred_at: at(9, 15, 51), session_id: 1499 }] };
  const tag = (over) => ({ sack_id: '26-LFT-1', bay: 12, printed_at: at(17, 16), zone_session_id: 1470, ...over });
  const down = (tags) => fillIsDown({ lotOfSession, tags, done: [] })(12, fill);
  assert.equal(down([tag()]), true, 'a sack came out of this bay from this lot');
  assert.equal(down([tag({ bay: 11 })]), false, 'the lot was bagged out of another bay');
  assert.equal(down([tag({ printed_at: at(9, 15, 50) })]), false, 'printed before the fill started: the previous fill\'s sack');
  assert.equal(down([tag({ zone_session_id: 840 })]), false, 'a different lot\'s sack, however the bay was typed');
  assert.equal(down([tag({ zone_session_id: 9999 })]), false, 'a lot the picker does not know');
});

test('fillIsDown: every lot in the fill finished is proof; one still open is not', () => {
  const a = lot(1470, { takedown_done_at: at(17, 22) });
  const b = lot(1665, { zone: 'Z15', takedown_done_at: null });
  const fill = { startMs: Date.parse('2026-10-09T15:51:00Z'), loads: bay12.slice(0, 2) };
  assert.equal(fillIsDown({ lotOfSession: sessions(a, b), tags: [], done: [] })(12, fill), false);
  assert.equal(fillIsDown({ lotOfSession: sessions(a, { ...b, takedown_done_at: at(17, 22) }), tags: [], done: [] })(12, fill), true);
  assert.equal(fillIsDown({ lotOfSession: new Map(), tags: [], done: [] })(12, fill), false, 'no known lot is no proof');
});
