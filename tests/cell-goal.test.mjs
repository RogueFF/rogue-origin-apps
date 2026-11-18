/**
 * The day's crew goal, one answer for the barn TV, the crew board and Mis números
 * (Koa 2026-11-18, via the cell hub: "Yes, use cell goal"): lib/cell-goal.js.
 *
 *   · no goal yet: the break-even rate for the day's cultivar (Sour Lifter 0.48,
 *     Lifter 0.51), mid-shift, before any sheet is loaded
 *   · a goal set on the Cell hourly log (farm password) beats the default, and a
 *     typed save keeps it; clearing it goes back to the default
 *   · a sheet load's goal wins after the day, and setting one then is refused
 *   · the TV, the crew board and Mis números all read the same number
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleProductionD1 } = await import(url('workers/src/handlers/production/index.js'));
const { dayGoal, tieRateFor, CELL_TIE_RATES } = await import(url('workers/src/lib/cell-goal.js'));

const splitSql = (text) => text.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  const files = [join(REPO, 'workers/schema.sql'),
    ...readdirSync(join(REPO, 'workers/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => join(REPO, 'workers/migrations', f))];
  for (const f of files) for (const st of splitSql(readFileSync(f, 'utf8'))) { try { sqlite.exec(st); } catch { /* duplicate column etc. */ } }
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
  return { sqlite, env: { DB, ORDERS_PASSWORD: 'pw' } };
}
const quiet = async (fn) => {
  const l = console.log, e = console.error, w = console.warn;
  console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; console.warn = w; }
};
const post = (env, action, body) => quiet(() => handleProductionD1(new Request(`https://x/api/production?action=${action}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env));
const get = async (env, qs) => {
  const j = await (await quiet(() => handleProductionD1(new Request(`https://x/api/production?${qs}`), env))).json();
  return j.data || j;
};

const DATE = '2026-11-18';
const H1 = '7:00 AM – 8:00 AM';
const SL = '2026 - Sour Lifter / Sungrown', LIFTER = '2026 - Lifter / Sungrown';
const addPerson = async (env, name) => (await (await post(env, 'crewPersonAdd', { password: 'pw', name })).json()).person.id;
const setGoal = (env, lbHr, password = 'pw') => post(env, 'crewGoalSet', { password, date: DATE, lbHr });

/** A typed cell day: one person, a full day on table1, the room on `cultivar`. */
async function typedDay(env, sqlite, cultivar) {
  const a = await addPerson(env, 'Ana');
  await post(env, 'setRoomSmalls', { date: DATE, slot: H1, smalls: 1, cultivar });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: H1, stationId: 'table1', lb: 0.6, min: 60, seq: 1 });
  sqlite.prepare('UPDATE crew_days SET full_day = 1 WHERE work_date = ?').run(DATE);   // the board ranks full days
  return a;
}
/** The goal as the TV, the crew board and Mis números each see it. */
async function goalsSeen(env, sqlite) {
  // Ana's own token: a bare LIMIT 1 can read the token index and hand back anyone's.
  const token = sqlite.prepare("SELECT token FROM crew_people WHERE name = 'Ana'").get().token;
  const board = await get(env, 'action=crewBoard');
  const mine = await get(env, `action=myNumbers&t=${token}`);
  const cell = await get(env, `action=cellHourly&date=${DATE}`);
  return { board: board.byDay[DATE]?.room?.goal?.lbHr ?? null, mine: mine.days.find((d) => d.date === DATE)?.target ?? null, cellLog: cell.goal?.lbHr ?? null };
}

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('the tie rates live in one list; Sour Lifter is matched before Lifter', () => {
  assert.equal(tieRateFor(SL).lbHr, 0.48);
  assert.equal(tieRateFor(LIFTER).lbHr, 0.51);
  assert.equal(tieRateFor('Cherry Wine'), null);
  assert.deepEqual(CELL_TIE_RATES.map((t) => t.label), ['Sour Lifter', 'Lifter']);
});

test('no goal yet: the day takes its cultivar\'s break-even rate, everywhere', async () => {
  const { env, sqlite } = freshDb();
  // the last sheet's goal was 0.77; the old code copied it onto the typed day
  await post(env, 'crewLoadDay', { password: 'pw', date: '2026-11-16', target: 0.77, roomRate: 0.5,
    people: [{ name: 'Old', cell: '1', fullDay: true, hours: [{ slot: '7–8', g: 300, min: 60 }] }] });
  await typedDay(env, sqlite, SL);
  assert.deepEqual(await dayGoal(env.DB, DATE), { lbHr: 0.48, source: 'default', date: DATE, cultivar: 'Sour Lifter' });
  assert.deepEqual(await goalsSeen(env, sqlite), { board: 0.48, mine: 0.48, cellLog: 0.48 });

  const lifter = freshDb();
  await typedDay(lifter.env, lifter.sqlite, LIFTER);
  assert.equal((await dayGoal(lifter.env.DB, DATE)).lbHr, 0.51);
});

test('a goal set on the cell log beats the default, survives typed saves, and clears back', async () => {
  const { env, sqlite } = freshDb();
  const a = await typedDay(env, sqlite, SL);
  assert.equal((await setGoal(env, 0.6, 'nope')).status, 401);
  const r = await (await setGoal(env, 0.6)).json();
  assert.deepEqual((r.data || r).goal, { lbHr: 0.6, source: 'set', date: DATE });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: H1, stationId: 'table1', lb: 0.7, min: 60, seq: 1 });
  sqlite.prepare('UPDATE crew_days SET full_day = 1 WHERE work_date = ?').run(DATE);
  assert.deepEqual(await goalsSeen(env, sqlite), { board: 0.6, mine: 0.6, cellLog: 0.6 });
  assert.equal((await setGoal(env, 12)).status, 400);
  await setGoal(env, null);
  assert.equal((await dayGoal(env.DB, DATE)).source, 'default');
  const meta = sqlite.prepare('SELECT room_lb_hr FROM crew_day_meta WHERE work_date = ?').get(DATE);
  assert.ok(meta.room_lb_hr > 0, 'the room rate is untouched');
});

test('a sheet load wins after the day; setting a goal then is refused', async () => {
  const { env, sqlite } = freshDb();
  await typedDay(env, sqlite, SL);
  await setGoal(env, 0.6);
  await post(env, 'crewLoadDay', { password: 'pw', date: DATE, target: 0.55, roomRate: 0.5,
    people: [{ name: 'Ana', cell: '1', fullDay: true, hours: [{ slot: '7–8', g: 300, min: 60 }] }] });
  assert.deepEqual(await dayGoal(env.DB, DATE), { lbHr: 0.55, source: 'sheet', date: DATE });
  assert.deepEqual(await goalsSeen(env, sqlite), { board: 0.55, mine: 0.55, cellLog: 0.55 });
  assert.equal((await setGoal(env, 0.7)).status, 409);
  assert.equal((await dayGoal(env.DB, DATE)).lbHr, 0.55);
});

test('a cultivar with no tie rate carries the last real goal, never a copied one', async () => {
  const { env, sqlite } = freshDb();
  sqlite.prepare("INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES ('2026-11-16', 0.77, 0.5, 'sheet')").run();
  sqlite.prepare("INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES ('2026-11-17', 0.9, 0.5, 'typed: room rate of the typed hours')").run();
  await typedDay(env, sqlite, 'Cherry Wine');
  assert.deepEqual(await dayGoal(env.DB, DATE), { lbHr: 0.77, source: 'carried', date: '2026-11-16' });
});
