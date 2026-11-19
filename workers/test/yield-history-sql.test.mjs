/**
 * YIELD_HISTORY_SQL — clean days only. Run against a real SQLite so the rule
 * is tested as written, not re-described. Skips where node:sqlite is absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YIELD_HISTORY_SQL } from '../src/handlers/supersack-d1.js';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node */ }

const SL = '2026 - Sour Lifter / Sungrown / 1st Cut';
const L = '2026 - Lifter / Sungrown / 1st Cut';
// date, strain, sacks, tops, smalls, trim, raw
const ROWS = [
  ['2026-10-21', SL, 19, 95, 95, 65, 665],        // clean
  ['2026-10-22', SL, 20, 80, 72, 26, 700],        // clean, two strains each with tops
  ['2026-10-22', L, 3, 21, 0, 4, 105],
  ['2026-10-27', SL, 26, 130, 80, 56, 910],       // DIRTY: Lifter's tops rode in here
  ['2026-10-27', L, 5, 0, 0, 11, 175],
  ['2026-10-28', SL, 0, 0, 40, 0, 0],             // clean: a smalls lump, no sacks opened
  ['2026-10-29', SL, 10, 400, 0, 0, 350],         // DIRTY: tops > half the raw weight
  ['2026-10-30', SL, 10, 50, 0, 0, 350],          // DIRTY: a strainless row that day
  ['2026-10-30', 'Unknown', 2, 4, 0, 0, 70],
];

test('only clean days count, for every strain and every output', { skip: !DatabaseSync }, () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE supersack_entries (date TEXT, strain TEXT, sacks_opened INTEGER,
    tops_lbs REAL, smalls_lbs REAL, trim_lbs REAL, raw_lbs REAL)`);
  const ins = db.prepare('INSERT INTO supersack_entries VALUES (?,?,?,?,?,?,?)');
  for (const r of ROWS) ins.run(...r);
  const out = Object.fromEntries(db.prepare(YIELD_HISTORY_SQL).all().map(r => [r.strain, { ...r }]));

  assert.deepEqual(Object.keys(out).sort(), [L, SL].sort());
  // Sour Lifter: 10-21 + 10-22 sacks and tops; the 10-27 gain is gone with the day.
  assert.equal(out[SL].tops_sacks, 39);
  assert.equal(out[SL].tops_lbs, 175);
  assert.equal(out[SL].smalls_lbs, 95 + 72 + 40);
  assert.equal(out[SL].trim_lbs, 65 + 26);
  assert.equal(out[SL].tops_first, '2026-10-21');
  assert.equal(out[SL].tops_last, '2026-10-22');
  assert.equal(out[SL].run_last, '2026-10-28');
  // Lifter: only its clean day — the 5 sacks with no tops are not a zero yield.
  assert.equal(out[L].tops_sacks, 3);
  assert.equal(out[L].tops_lbs, 21);
  assert.equal(out[L].trim_lbs, 4);
});
