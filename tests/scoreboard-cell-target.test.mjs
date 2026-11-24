/**
 * The line board's target for cell hours (Koa 2026-11-18: "fix the line board
 * target for cells").
 *
 * The cell log fills Hourly entry (fill_source 'cells', migration 0071) with
 * people on cells as trimmers. Graded against the line's strain target (lbs per
 * trimmer, buckers beside them) the TV read BEHIND all day on a crew that was on
 * its own goal (mock-up of 11/17). Now:
 *   · a cell hour is graded per person against the crew goal (crew_day_meta)
 *   · a line hour keeps the strain target; a mixed day grades each hour on its own
 *   · a typed day with no goal takes its cultivar's break-even rate (lib/cell-goal.js);
 *     a cultivar with none carries the last goal set; no goal ever = ungraded
 *   · the line's strain target leaves cell hours out of its running average
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleProductionD1 } = await import(url('workers/src/handlers/production/index.js'));
const { getCellGoal } = await import(url('workers/src/handlers/production/scoreboard.js'));

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(REPO, 'workers/schema.sql'), 'utf8'));
  // crew_day_meta (0065) and fill_source (0071) live in migrations
  for (const f of ['0065-crew-numbers.sql', '0071-cell-fill-hourly.sql']) {
    const sql = readFileSync(join(REPO, 'workers/migrations', f), 'utf8').split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
    for (const st of sql.split(';')) { const s = st.trim(); if (s) { try { sqlite.exec(s); } catch { /* already there */ } } }
  }
  const DB = {
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    prepare(q) {
      const bound = (...args) => ({
        all: async () => ({ results: sqlite.prepare(q).all(...args) }),
        first: async () => sqlite.prepare(q).get(...args) ?? null,
        run: async () => { const r = sqlite.prepare(q).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      });
      return { bind: bound, ...bound() };
    },
  };
  return { sqlite, env: { DB } };
}
const quiet = async (fn) => {
  const l = console.log, e = console.error, w = console.warn;
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; }
};
const board = async (env, date) => (await (await quiet(() => handleProductionD1(
  new Request(`https://x/api/production?action=scoreboard&date=${date}`), env))).json()).scoreboard;

const SLOTS = ['7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM', '10:00 AM – 11:00 AM'];
const DAY = '2026-11-17';
const STRAIN = '2026 - Sour Lifter / Sungrown';
const LINE_RATE = 1.25;

/** history that makes the strain's line target 1.25 lbs per trimmer-hour */
function seedLineHistory(sqlite) {
  sqlite.prepare('INSERT INTO monthly_production (production_date, time_slot, cultivar1, tops_lbs1, trimmers_line1, effective_trimmers_line1, buckers_line1) VALUES (?, ?, ?, ?, ?, ?, 4)')
    .run('2026-10-01', SLOTS[0], STRAIN, LINE_RATE * 100, 100, 100);
}
function row(sqlite, slot, { tops, people, cells = true, date = DAY, strain = STRAIN }) {
  sqlite.prepare('INSERT INTO monthly_production (production_date, time_slot, cultivar1, tops_lbs1, trimmers_line1, effective_trimmers_line1, buckers_line1, fill_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(date, slot, strain, tops, people, people, cells ? 0 : 3, cells ? 'cells' : null);
}
function goal(sqlite, date, lbHr, note = 'sheet') {
  sqlite.prepare('INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES (?, ?, NULL, ?)').run(date, lbHr, note);
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('a cell hour is graded per person against the crew goal, not the line target', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  goal(sqlite, DAY, 0.53);
  // 18 people on cells, 9.9 lb in the hour = 0.55 lb per person-hour
  row(sqlite, SLOTS[0], { tops: 9.9, people: 18 });
  row(sqlite, SLOTS[1], { tops: 9.0, people: 18 });
  const s = await board(env, DAY);
  assert.equal(s.targetBasis, 'cells');
  near(s.targetRate, 0.53, 'shown target');
  assert.deepEqual(s.cellGoal, { lbHr: 0.53, source: 'sheet', date: DAY });
  near(s.lastHourTarget, 18 * 0.53 * 1, 'last hour target');
  near(s.todayTarget, 2 * 18 * 0.53, 'today target');
  assert.ok(s.todayPercentage > 95 && s.todayPercentage < 105, `on pace, not ~45%: ${s.todayPercentage}`);
  assert.ok(s.hourlyRates.every((h) => h.basis === 'cells' && Math.abs(h.target - 0.53) < 1e-9));
});

test('a line day is unchanged: the strain target, per trimmer', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  goal(sqlite, DAY, 0.53);
  row(sqlite, SLOTS[0], { tops: 12, people: 10, cells: false });
  const s = await board(env, DAY);
  assert.equal(s.targetBasis, 'line');
  assert.equal(s.cellGoal, null);           // not even looked up on a line day
  assert.ok(Math.abs(s.targetRate - LINE_RATE) < 0.05, `line target ${s.targetRate}`);
  assert.equal(s.hourlyRates[0].basis, 'line');
});

test('a mixed day grades each hour on its own basis', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  goal(sqlite, DAY, 0.5);
  row(sqlite, SLOTS[0], { tops: 12, people: 10, cells: false });   // line hour
  row(sqlite, SLOTS[1], { tops: 5, people: 10, cells: true });     // cell hour
  const s = await board(env, DAY);
  const [line, cell] = s.hourlyRates;
  assert.equal(line.basis, 'line');
  assert.ok(Math.abs(line.target - LINE_RATE) < 0.05);
  assert.equal(cell.basis, 'cells');
  near(cell.target, 0.5, 'cell hour target');
  near(s.todayTarget, 10 * line.target + 10 * 0.5, 'today target = each hour on its basis');
  assert.equal(s.targetBasis, 'cells');     // the latest hour is a cell hour
});

test('a typed day with no goal: its cultivar\'s break-even rate, else the last goal set', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  goal(sqlite, '2026-11-13', 0.51);
  goal(sqlite, '2026-11-16', 0.77);
  goal(sqlite, '2026-11-20', 0.9);          // a later day never counts
  goal(sqlite, DAY, 0.77, 'typed: room rate of the typed hours');   // copied forward by older code: ignored
  row(sqlite, SLOTS[0], { tops: 9, people: 18 });   // Sour Lifter
  assert.deepEqual(await getCellGoal(env, DAY), { lbHr: 0.48, source: 'default', date: DAY, cultivar: 'Sour Lifter' });
  near((await board(env, DAY)).targetRate, 0.48, 'Sour Lifter break-even');

  const other = freshDb();
  seedLineHistory(other.sqlite);
  goal(other.sqlite, '2026-11-16', 0.77);
  row(other.sqlite, SLOTS[0], { tops: 9, people: 18, strain: 'Cherry Wine' });
  assert.deepEqual(await getCellGoal(other.env, DAY), { lbHr: 0.77, source: 'carried', date: '2026-11-16' });
  near((await board(other.env, DAY)).targetRate, 0.77, 'carried goal');

  const fresh = freshDb();
  seedLineHistory(fresh.sqlite);
  row(fresh.sqlite, SLOTS[0], { tops: 9, people: 18, strain: 'Cherry Wine' });
  const u = await board(fresh.env, DAY);
  assert.equal(u.graded, false);            // no fair target: no verdict, never the line target
  assert.equal(u.todayTarget, 0);
  assert.equal(u.hourlyRates[0].target, 0);
  assert.equal(u.todayLbs, 9);
});

test('the line target leaves cell hours out of its running average', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  goal(sqlite, '2026-11-10', 0.53);
  // a past cell day at 0.5 lb per person would drag a blended average far down
  for (const slot of SLOTS) row(sqlite, slot, { tops: 9, people: 18, date: '2026-11-12' });
  row(sqlite, SLOTS[0], { tops: 12, people: 10, cells: false });
  const s = await board(env, DAY);
  assert.equal(s.targetBasis, 'line');
  assert.ok(Math.abs(s.targetRate - LINE_RATE) < 0.08, `line target stays ~1.25, got ${s.targetRate}`);
});

// Koa 2026-11-24: back on the line from 12:30 that day. Each hour keeps its own
// basis, and an hour with buckers entered is always a line hour.
test('a split day (cells in the morning, line from 12:30): the line hours grade per trimmer', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  const D = '2026-11-24';
  goal(sqlite, D, 0.48);
  row(sqlite, SLOTS[0], { tops: 10, people: 20, date: D });                  // cell hour (filled)
  row(sqlite, SLOTS[1], { tops: 14, people: 12, cells: false, date: D });    // line hour (typed, buckers)
  const s = await board(env, D);
  const [cell, line] = s.hourlyRates;
  assert.equal(cell.basis, 'cells');
  near(cell.target, 0.48, 'morning cell hour on the crew goal');
  assert.equal(line.basis, 'line');
  assert.ok(Math.abs(line.target - LINE_RATE) < 0.05, `line hour on the strain target: ${line.target}`);
  assert.equal(s.targetBasis, 'line');     // the latest hour is a line hour
  assert.ok(Math.abs(s.targetRate - LINE_RATE) < 0.05);
});

test('an hour with buckers entered is a line hour even if the cell fill wrote it', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  const D = '2026-11-24';
  goal(sqlite, D, 0.48);
  sqlite.prepare('INSERT INTO monthly_production (production_date, time_slot, cultivar1, tops_lbs1, trimmers_line1, effective_trimmers_line1, buckers_line1, fill_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(D, SLOTS[0], STRAIN, 14, 12, 12, 8, 'cells');
  const s = await board(env, D);
  assert.equal(s.hourlyRates[0].basis, 'line');
  assert.equal(s.targetBasis, 'line');
});

test('a line-only day after 11/24 grades on the line target, never the crew goal', { skip: !DatabaseSync }, async () => {
  const { sqlite, env } = freshDb();
  seedLineHistory(sqlite);
  const D = '2026-11-25';
  goal(sqlite, D, 0.48);
  row(sqlite, SLOTS[0], { tops: 12, people: 10, cells: false, date: D });
  row(sqlite, SLOTS[1], { tops: 13, people: 10, cells: false, date: D });
  const s = await board(env, D);
  assert.ok(s.hourlyRates.every((h) => h.basis === 'line'));
  assert.equal(s.targetBasis, 'line');
  assert.equal(s.cellGoal, null);
});
