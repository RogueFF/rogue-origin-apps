/**
 * Barn scoreboard: one grading basis + honest Bag Complete (review 2026-10-13,
 * L2-01 / L4-03 / L5-11).
 *
 *   · an hour logged with a blank strain is graded as the strain the crew was
 *     on (carried forward; leading blanks take the day's first strain), never
 *     at a 0.85 fallback
 *   · a day with no strain at all is ungraded (graded: false), not 0.85
 *   · todayTarget / todayPercentage / best / streak use the same per-hour
 *     targets as dailyGoal, so the badge and END OF DAY agree
 *   · streak is the current run, so a miss on the latest hour resets it
 *   · logBag / logPause / logResume reply success: true
 *   · a same-size bag within 90 s of the last one is a duplicate: no row
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleProductionD1 } = await import(url('workers/src/handlers/production/index.js'));

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(REPO, 'workers/schema.sql'), 'utf8'));
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
const post = async (env, action, body) => (await quiet(() => handleProductionD1(new Request(`https://x/api/production?action=${action}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env))).json();
const board = async (env, date) => (await (await quiet(() => handleProductionD1(
  new Request(`https://x/api/production?action=scoreboard&date=${date}`), env))).json()).scoreboard;

const SLOTS = [
  '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
  '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM',
];
const TODAY = '2026-11-17';
const PRIOR = '2026-11-16';

function addHour(sqlite, date, slot, { strain = '', tops = 0, trimmers = 0, changeTo = null, changeTops = null } = {}) {
  sqlite.prepare(`INSERT INTO monthly_production
      (production_date, time_slot, cultivar1, tops_lbs1, smalls_lbs1, trimmers_line1, buckers_line1,
       change_cultivar, change_tops_lbs, change_share)
    VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`)
    .run(date, slot, strain, tops, trimmers, changeTo, changeTops, changeTo ? 0.5 : null);
}
// A prior day of history so a strain has a real rate (lb / trimmer-hour).
function history(sqlite, strain, lbPerTrimmerHour, date = PRIOR) {
  for (const slot of ['7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM']) {
    addHour(sqlite, date, slot, { strain, trimmers: 10, tops: 10 * lbPerTrimmerHour });
  }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
// Recompute the day's target from the hourly rows the reply itself carries.
const sumTargets = (sb) => sb.hourlyRates.reduce((s, h) => s + h.effectiveTrimmers * h.target * h.multiplier, 0);

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

// ---------------------------------------------------------------- grading

test('blank leading and middle hours carry the strain forward, never 0.85', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  history(sqlite, 'Beta', 0.6, '2026-11-15');
  addHour(sqlite, TODAY, SLOTS[0], { strain: '', trimmers: 4, tops: 5 });        // leading blank
  addHour(sqlite, TODAY, SLOTS[1], { strain: 'Alpha', trimmers: 4, tops: 6 });
  addHour(sqlite, TODAY, SLOTS[2], { strain: '  ', trimmers: 4, tops: 5 });       // middle blank
  addHour(sqlite, TODAY, SLOTS[3], { strain: 'Beta', trimmers: 4, tops: 2.4 });
  addHour(sqlite, TODAY, SLOTS[4], { strain: '', trimmers: 4, tops: 2.5 });       // blank after Beta
  addHour(sqlite, TODAY, SLOTS[5], { strain: '', trimmers: 4 });                  // current hour, no tops yet

  const sb = await board(env, TODAY);
  assert.equal(sb.graded, true);
  assert.deepEqual(sb.hourlyRates.map((h) => h.strain), ['Alpha', 'Alpha', 'Alpha', 'Beta', 'Beta']);
  assert.ok(sb.hourlyRates.every((h) => h.target !== 0.85 && h.target > 0), 'no hour at the 0.85 fallback');
  const [a0, a1, a2, b3, b4] = sb.hourlyRates.map((h) => h.target);
  assert.equal(a0, a1, 'leading blank hour graded at Alpha');
  assert.equal(a2, a1, 'middle blank hour graded at Alpha');
  assert.equal(b4, b3, 'blank hour after Beta graded at Beta');
  assert.notEqual(a1, b3);
  assert.equal(sb.strain, 'Beta', 'current hour inherits Beta');
  assert.equal(sb.targetRate, b3);
  near(sb.currentHourTarget, 4 * b3 * 0.5, 'current hour target at Beta');
  near(sb.lastHourTarget, 4 * b3 * 1.0, 'last hour target at Beta');
});

test('a blank hour after a mid-hour change carries the strain it changed to', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  history(sqlite, 'Beta', 0.6, '2026-11-15');
  addHour(sqlite, TODAY, SLOTS[0], { strain: 'Alpha', trimmers: 4, tops: 5, changeTo: 'Beta', changeTops: 1 });
  addHour(sqlite, TODAY, SLOTS[1], { strain: '', trimmers: 4, tops: 2.4 });
  const sb = await board(env, TODAY);
  assert.deepEqual(sb.hourlyRates.map((h) => h.strain), ['Alpha', 'Beta']);
  assert.equal(sb.strain, 'Beta');
});

test('a day with no strain at all is ungraded, not graded at 0.85', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);  // yesterday had a strain; it is not borrowed
  addHour(sqlite, TODAY, SLOTS[0], { trimmers: 4, tops: 5 });
  addHour(sqlite, TODAY, SLOTS[1], { trimmers: 4, tops: 6 });
  addHour(sqlite, TODAY, SLOTS[2], { trimmers: 4 });

  const sb = await board(env, TODAY);
  assert.equal(sb.graded, false);
  assert.equal(sb.strain, '');
  assert.equal(sb.targetRate, 0);
  assert.equal(sb.todayTarget, 0);
  assert.equal(sb.todayPercentage, 0);
  assert.equal(sb.bestPercentage, 0);
  assert.equal(sb.avgPercentage, 0);
  assert.equal(sb.avgDelta, 0);
  assert.equal(sb.bestDelta, 0);
  assert.equal(sb.streak, 0);
  assert.equal(sb.lastHourTarget, 0);
  assert.equal(sb.currentHourTarget, 0);
  assert.equal(sb.dailyGoal, 0);
  assert.equal(sb.todayLbs, 11, 'pounds are still real');
  assert.equal(sb.hourlyRates.length, 2);
  assert.ok(sb.hourlyRates.every((h) => h.target === 0 && h.rate > 0));
  assert.ok(sb.projectedTotal > sb.todayLbs, 'END OF DAY still projects from the actual pace');
});

test('an empty day reports graded: false', async () => {
  const { env } = freshDb();
  const sb = await board(env, TODAY);
  assert.equal(sb.graded, false);
  assert.equal(sb.todayTarget, 0);
});

test('badge and END OF DAY on one basis: with the whole day logged, dailyGoal = todayTarget', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  // the review's case: a late 7:11 start whose first hour has no strain
  SLOTS.forEach((slot, i) => addHour(sqlite, TODAY, i === 0 ? '7:11 AM – 8:00 AM' : slot,
    { strain: i === 0 ? '' : 'Alpha', trimmers: 4, tops: 5 }));
  const sb = await board(env, TODAY);
  assert.equal(sb.graded, true);
  near(sb.todayTarget, sumTargets(sb), 'todayTarget is the sum of the hours shown');
  near(sb.dailyGoal, sb.todayTarget, 'dailyGoal = todayTarget when every slot is logged');
  near(sb.todayPercentage, (sb.todayLbs / sb.dailyGoal) * 100, 'badge % = actual / day goal');
  near(sb.projectedTotal, sb.todayLbs, 'nothing left to project');
});

test('two strains in a day: each hour keeps its own target in the day goal', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  history(sqlite, 'Beta', 0.6, '2026-11-15');
  SLOTS.forEach((slot, i) => addHour(sqlite, TODAY, slot, { strain: i < 5 ? 'Alpha' : 'Beta', trimmers: 4, tops: i < 5 ? 6 : 2.4 }));
  const sb = await board(env, TODAY);
  near(sb.dailyGoal, sb.todayTarget, 'morning Alpha hours are not re-goaled at Beta');
  near(sb.todayTarget, sumTargets(sb), 'todayTarget is the sum of the hours shown');
});

test('part day: logged part of dailyGoal = todayTarget, the rest at the active strain', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  history(sqlite, 'Beta', 0.6, '2026-11-15');
  addHour(sqlite, TODAY, SLOTS[0], { strain: '', trimmers: 4, tops: 5 });
  addHour(sqlite, TODAY, SLOTS[1], { strain: 'Alpha', trimmers: 4, tops: 6 });
  addHour(sqlite, TODAY, SLOTS[2], { strain: 'Beta', trimmers: 4, tops: 2 });
  const sb = await board(env, TODAY);
  const mult = { [SLOTS[3]]: 1, [SLOTS[4]]: 1, [SLOTS[5]]: 0.5, [SLOTS[6]]: 1, [SLOTS[7]]: 1, [SLOTS[8]]: 0.83, [SLOTS[9]]: 0.33 };
  const rest = Object.values(mult).reduce((s, m) => s + 4 * sb.targetRate * m, 0);
  near(sb.dailyGoal, sb.todayTarget + rest, 'dailyGoal = todayTarget + remaining hours at the active strain');
});

test('streak is the current run: it resets when the latest hour misses', async () => {
  const { sqlite, env } = freshDb();
  history(sqlite, 'Alpha', 1.5);
  addHour(sqlite, TODAY, SLOTS[0], { strain: 'Alpha', trimmers: 4, tops: 8 });   // well over
  addHour(sqlite, TODAY, SLOTS[1], { strain: 'Alpha', trimmers: 4, tops: 8 });   // well over
  addHour(sqlite, TODAY, SLOTS[3], { strain: 'Alpha', trimmers: 4, tops: 2 });   // well under (latest)
  let sb = await board(env, TODAY);
  const pct = sb.hourlyRates.map((h) => (h.rate / h.target) * 100);
  assert.ok(pct[0] >= 90 && pct[1] >= 90 && pct[2] < 90, `setup: ${pct}`);
  assert.equal(sb.streak, 0, 'a miss on the latest hour resets the streak');
  near(sb.bestPercentage, Math.max(...pct), 'best uses the same per-hour targets');

  addHour(sqlite, TODAY, SLOTS[4], { strain: 'Alpha', trimmers: 4, tops: 8 });   // over again
  sb = await board(env, TODAY);
  assert.equal(sb.streak, 1, 'the run restarts at the latest hour, not the earlier run of 2');
});

// ---------------------------------------------------------------- bag complete

const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const seedBag = (sqlite, secondsAgo, bagType) => sqlite.prepare(
  `INSERT INTO production_tracking (timestamp, bag_type, weight, source) VALUES (?, ?, 5, 'manual')`,
).run(new Date(Date.now() - secondsAgo * 1000).toISOString(), bagType);

test('logBag, logPause and logResume reply success: true', async () => {
  const { env } = freshDb();
  const bag = await post(env, 'logBag', { size: '5kg' });
  assert.equal(bag.success, true);
  assert.equal(bag.duplicate, false);
  assert.equal(bag.size, '5kg');
  const pause = await post(env, 'logPause', { reason: 'break' });
  assert.equal(pause.success, true);
  assert.ok(pause.pauseId);
  const resume = await post(env, 'logResume', { pauseId: pause.pauseId, duration: 120 });
  assert.equal(resume.success, true);
  assert.equal(resume.durationMinutes, 2);
});

test('a second same-size bag within 90 s is a duplicate and writes no row', async () => {
  const { sqlite, env } = freshDb();
  const first = await post(env, 'logBag', { size: '5kg' });
  const before = [count(sqlite, 'production_tracking'), count(sqlite, 'inventory_adjustments')];
  const second = await post(env, 'logBag', { size: '5 kg' });
  assert.equal(second.success, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.timestamp, first.timestamp, 'reply carries the original bag time');
  assert.deepEqual([count(sqlite, 'production_tracking'), count(sqlite, 'inventory_adjustments')], before);
});

test('a bag of a different size within 90 s is logged', async () => {
  const { sqlite, env } = freshDb();
  await post(env, 'logBag', { size: '5kg' });
  const n = count(sqlite, 'production_tracking');
  const other = await post(env, 'logBag', { size: '10lb' });
  assert.equal(other.success, true);
  assert.equal(other.duplicate, false);
  assert.equal(count(sqlite, 'production_tracking'), n + 1);
});

test('the 90 s window: 30 s after a bag is a duplicate, 91 s after is a new bag', async () => {
  const { sqlite, env } = freshDb();
  seedBag(sqlite, 30, '5 kg.');
  let n = count(sqlite, 'production_tracking');
  const dup = await post(env, 'logBag', { size: '5kg' });
  assert.equal(dup.duplicate, true);
  assert.equal(count(sqlite, 'production_tracking'), n);

  sqlite.exec('DELETE FROM production_tracking');
  seedBag(sqlite, 91, '5 kg.');
  n = count(sqlite, 'production_tracking');
  const fresh = await post(env, 'logBag', { size: '5kg' });
  assert.equal(fresh.duplicate, false);
  assert.equal(count(sqlite, 'production_tracking'), n + 1);

  sqlite.exec('DELETE FROM production_tracking');
  seedBag(sqlite, 30, '10 lb.');
  const tenAfterTen = await post(env, 'logBag', { size: '10 lb' });
  assert.equal(tenAfterTen.duplicate, true, '10 lb after 10 lb is a duplicate too');
});
