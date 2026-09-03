/**
 * Supersack submit — premium trim can never outweigh biomass.
 *
 * A sack's Premium #1 Trim is a small share of its bulk Biomass (#2) trim:
 * across every clean 2026 row it runs about 0.17x biomass and never above
 * 0.27x. The only rows that ever broke that were the two weights typed into
 * each other's box (49 rows, 2026-07-27..09-02, all 2.5x-10x). The tracker
 * now refuses the swap before it touches a pool; this pins the API refusing
 * it too, so a stale page or any other caller cannot write it either.
 *
 * Run with `node --test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockDB, createMockRequest } from './helpers/d1-mock.mjs';
import { handleSupersackD1 } from '../workers/src/handlers/supersack-d1.js';

async function submit(body) {
  const db = createMockDB();
  const res = await handleSupersackD1(createMockRequest('submit', { method: 'POST', body }), { DB: db });
  return { status: res.status, body: JSON.parse(await res.text()), writes: db.getQueries().filter(q => /^\s*INSERT/i.test(q.sql)) };
}

const LIFTER = '2025 - Lifter / Sungrown';
const BLISS = '2025 - Berry Bliss / Sungrown';

describe('supersack submit — premium trim above biomass', () => {
  test('rejects a strain whose premium trim outweighs its biomass with a 400 and writes nothing', async () => {
    const r = await submit({ date: '2026-09-03', strains: { [LIFTER]: { sacks: 9, tops: 51, smalls: 40, biomass: 30, trim: 167.5 } } });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'VALIDATION_ERROR');
    assert.equal(r.writes.length, 0);
  });

  test('names every offending strain so the operator can find the box', async () => {
    const r = await submit({ date: '2026-09-03', strains: {
      [LIFTER]: { sacks: 9, tops: 51, smalls: 40, biomass: 30, trim: 167.5 },
      [BLISS]: { sacks: 4, tops: 20, smalls: 10, biomass: 80, trim: 12 },
    } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Lifter/);
    assert.doesNotMatch(r.body.error, /Berry Bliss/);
  });

  test('a multi-strain day is all-or-nothing: one swapped strain blocks every write', async () => {
    const r = await submit({ date: '2026-09-03', strains: {
      [BLISS]: { sacks: 4, tops: 20, smalls: 10, biomass: 80, trim: 12 },
      [LIFTER]: { sacks: 9, tops: 51, smalls: 40, biomass: 30, trim: 167.5 },
    } });
    assert.equal(r.status, 400);
    assert.equal(r.writes.length, 0);
  });

  test('accepts premium trim at or below biomass', async () => {
    const below = await submit({ date: '2026-09-03', strains: { [LIFTER]: { sacks: 9, tops: 51, smalls: 40, biomass: 167.5, trim: 30 } } });
    assert.equal(below.status, 200);
    assert.equal(below.writes.length, 1);
    // bind order matches the INSERT column list: date, strain, sacks, tops, smalls, biomass, trim, waste, raw
    assert.deepEqual(below.writes[0].params, ['2026-09-03', LIFTER, 9, 51, 40, 167.5, 30, 333 - 51 - 40 - 167.5 - 30, 333]);

    const equal = await submit({ date: '2026-09-03', strains: { [LIFTER]: { sacks: 9, tops: 51, smalls: 40, biomass: 30, trim: 30 } } });
    assert.equal(equal.status, 200);
    assert.equal(equal.writes.length, 1);
  });

  test('rejects the single-strain day-total fallback the same way', async () => {
    const r = await submit({ date: '2026-09-03', strain: LIFTER, supersack_count: 9, tops_lbs: 51, smalls_lbs: 40, biomass_lbs: 30, trim_lbs: 167.5 });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'VALIDATION_ERROR');
    assert.equal(r.writes.length, 0);
  });

  test('rejects ratio-split day totals when the per-strain weights are not supplied', async () => {
    // v2 payload: per-strain sacks/tops/smalls, biomass and trim only as day totals
    const r = await submit({ date: '2026-09-03', biomass_lbs: 30, trim_lbs: 167.5, strains: {
      [LIFTER]: { sacks: 9, tops: 51, smalls: 40 },
      [BLISS]: { sacks: 4, tops: 20, smalls: 10 },
    } });
    assert.equal(r.status, 400);
    assert.equal(r.writes.length, 0);
  });
  test('splits day totals across the strains by sack share when no per-strain weights are sent', async () => {
    // The tracker sends the two day totals only; the floor never weighs trim per strain.
    const r = await submit({ date: '2026-09-03', biomass_lbs: 100, trim_lbs: 20, strains: {
      [LIFTER]: { sacks: 3, tops: 30, smalls: 12 },
      [BLISS]: { sacks: 1, tops: 10, smalls: 4 },
    } });
    assert.equal(r.status, 200);
    assert.equal(r.writes.length, 2);
    const [lifter, bliss] = r.writes.map(w => w.params);
    // [date, strain, sacks, tops, smalls, biomass, trim, waste, raw]
    assert.deepEqual(lifter.slice(0, 7), ['2026-09-03', LIFTER, 3, 30, 12, 75, 15]);
    assert.deepEqual(bliss.slice(0, 7), ['2026-09-03', BLISS, 1, 10, 4, 25, 5]);
    assert.equal(lifter[8], 111);
    assert.equal(bliss[8], 37);
  });
});
