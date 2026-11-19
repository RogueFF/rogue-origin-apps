/**
 * Cell log -> Hourly entry fill (Koa 2026-11-18, via the hub): lib/cell-fill.js.
 *
 *   · the mapping (pure): tops = the cells' tops, smalls = the room's, cultivar =
 *     the room's (else the cell cultivar with most tops), trimmers = cells in use,
 *     effective = person-minutes / the hour's minutes, buckers 0, T-Zero 0
 *   · switch off (the default): a cell save writes nothing to monthly_production
 *   · switch on: the day fills now and every save rewrites its hour (idempotent);
 *     an emptied hour is removed; turning off removes only filled rows
 *   · a hand-typed Hourly entry row is never overwritten; a hand save on a
 *     filled row makes it a hand row
 *   · the switch needs the farm password
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
const { cellHourToProductionRow } = await import(url('workers/src/lib/cell-fill.js'));

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
const get = (env, qs) => quiet(() => handleProductionD1(new Request(`https://x/api/production?${qs}`), env));

const DATE = '2026-11-10';
const H1 = '7:00 AM – 8:00 AM', H2 = '8:00 AM – 9:00 AM';
const addPerson = async (env, name) => (await (await post(env, 'crewPersonAdd', { password: 'pw', name })).json()).person.id;
const typeTops = (env, personId, stationId, lb, slot = H1, min = 60, seq = 1) =>
  post(env, 'crewHourSave', { password: 'pw', date: DATE, personId, slot, stationId, lb, min, seq });
const prodRow = (sqlite, slot = H1) => sqlite.prepare('SELECT * FROM monthly_production WHERE production_date = ? AND time_slot = ?').get(DATE, slot);
const fillOn = (env, on = true) => post(env, 'cellFillSet', { password: 'pw', date: DATE, on });

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('mapping: cells in use, person-minutes, the cells\' tops, the room\'s smalls and cultivar', () => {
  const row = cellHourToProductionRow({
    slotMinutes: 60,
    people: [{ personId: 1, stationId: 'table1', min: 60 }, { personId: 2, stationId: 'table2', min: 20 }, { personId: 3, stationId: 'table2', min: 40 }],
    cells: [{ stationId: 'table1', tops: 0.62, cultivar: 'Sour Lifter' }, { stationId: 'table2', tops: 0.55, cultivar: null }],
    room: { smalls: 4.04, cultivar: '2026 - Sour Lifter / Sungrown' },
  });
  assert.equal(row.trimmers_line1, 2, 'two cells in use (a cover is one cell)');
  assert.equal(row.effective_trimmers_line1, 2, '(60 + 20 + 40) / 60');
  assert.equal(row.tops_lbs1, 1.2);
  assert.equal(row.smalls_lbs1, 4);
  assert.equal(row.cultivar1, '2026 - Sour Lifter / Sungrown');
  assert.equal(row.buckers_line1, 0);
  assert.equal(row.tzero_line1, 1, 'one T-Zero op runs the smalls every filled hour');
  assert.deepEqual(row.mixedCultivars, ['2026 - Sour Lifter / Sungrown', 'Sour Lifter']);
});

test('mapping: no room cultivar takes the cell cultivar with most tops; an empty hour is null', () => {
  const row = cellHourToProductionRow({ slotMinutes: 50, people: [{ personId: 1, stationId: 'table1', min: 50 }],
    cells: [{ stationId: 'table1', tops: 0.4, cultivar: 'Lifter' }, { stationId: 'table2', tops: 0.1, cultivar: 'Sour Lifter' }] });
  assert.equal(row.cultivar1, 'Lifter');
  assert.equal(row.effective_trimmers_line1, 1);
  assert.equal(cellHourToProductionRow({ slotMinutes: 60, people: [], cells: [], room: {} }), null);
  assert.equal(cellHourToProductionRow({ slotMinutes: 60, people: [{ personId: 1, stationId: 'table1', min: 0 }], cells: [{ stationId: 'table1', tops: null }] }), null);
  assert.equal(cellHourToProductionRow({ slotMinutes: 60, people: [], cells: [], room: { smalls: 3 } }), null, 'pounds with no crew never fill');
});

test('room smalls with no cell typed fill nothing; the hour fills once a cell is typed', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  await fillOn(env);
  await post(env, 'setRoomSmalls', { date: DATE, slot: H1, smalls: 3 });
  assert.equal(prodRow(sqlite), undefined);
  await typeTops(env, a, 'table1', 0.6);
  const r = prodRow(sqlite);
  assert.deepEqual([r.trimmers_line1, r.tops_lbs1, r.smalls_lbs1], [1, 0.6, 3]);
  assert.equal(r.tzero_line1, 1, 'the filled hour carries the T-Zero op (Koa 2026-11-18)');
});

test('a hand row that lands after the read is still left alone (one-statement upsert)', async () => {
  const { env, sqlite } = freshDb();
  const { fillHour } = await import(url('workers/src/lib/cell-fill.js'));
  const a = await addPerson(env, 'Ana');
  await typeTops(env, a, 'table1', 0.6);
  await fillOn(env);
  sqlite.prepare("UPDATE monthly_production SET fill_source = NULL, trimmers_line1 = 9, tops_lbs1 = 4 WHERE production_date = ?").run(DATE);
  // The hand save races the fill: the fill's read still sees no row (stubbed here),
  // so only the upsert's WHERE stands between it and the hand numbers.
  const raced = { ...env.DB, prepare: (q) => (/SELECT id, fill_source/.test(q)
    ? { bind: () => ({ first: async () => null }) } : env.DB.prepare(q)) };
  const res = await fillHour(raced, DATE, H1, '7-8', 60, { force: true });
  assert.equal(res.state, 'hand');
  assert.deepEqual([prodRow(sqlite).trimmers_line1, prodRow(sqlite).tops_lbs1], [9, 4]);
});

test('switch off (the default): cell saves never write Hourly entry', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  assert.equal((await typeTops(env, a, 'table1', 0.6)).status, 200);
  await post(env, 'setRoomSmalls', { date: DATE, slot: H1, smalls: 3 });
  assert.equal(prodRow(sqlite), undefined);
  const d = await (await get(env, `action=cellHourly&date=${DATE}`)).json();
  assert.equal((d.data || d).fill.on, false);
});

test('switch on: fills the day now, every save rewrites its hour, an emptied hour is removed', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana'), b = await addPerson(env, 'Beto');
  await typeTops(env, a, 'table1', 0.6);
  await post(env, 'setRoomSmalls', { date: DATE, slot: H1, smalls: 3, cultivar: '2026 - Lifter / Sungrown' });
  const on = await (await fillOn(env)).json();
  assert.equal(on.states[H1], 'filled');
  let r = prodRow(sqlite);
  assert.deepEqual([r.fill_source, r.trimmers_line1, r.tops_lbs1, r.smalls_lbs1, r.cultivar1, r.effective_trimmers_line1], ['cells', 1, 0.6, 3, '2026 - Lifter / Sungrown', 1]);

  await typeTops(env, b, 'table2', 0.5);
  await typeTops(env, b, 'table2', 0.5);          // same save twice: one row, same values
  r = prodRow(sqlite);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM monthly_production').get().n, 1);
  assert.deepEqual([r.trimmers_line1, r.tops_lbs1], [2, 1.1]);

  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: H1, clear: true });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: b, slot: H1, clear: true });
  await post(env, 'setRoomSmalls', { date: DATE, slot: H1, smalls: null });
  assert.equal(prodRow(sqlite), undefined, 'the cell log emptied: the filled row goes');
});

test('a hand-typed Hourly entry row wins; the page sees both numbers', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  const hand = await post(env, 'addProduction', { date: DATE, timeSlot: H1, trimmers1: 12, tops1: 5.2, smalls1: 2, cultivar1: 'Lifter' });
  assert.equal(hand.status, 200);
  await fillOn(env);
  await typeTops(env, a, 'table1', 0.6);
  const r = prodRow(sqlite);
  assert.deepEqual([r.fill_source, r.trimmers_line1, r.tops_lbs1], [null, 12, 5.2], 'hand row untouched');
  const d = await (await get(env, `action=cellHourly&date=${DATE}`)).json();
  const s = (d.data || d).fill.slots.find((x) => x.slot === H1);
  assert.equal(s.state, 'hand');
  assert.equal(s.hourly.tops, 5.2);
  assert.equal(s.cells.tops, 0.6);
});

test('a hand save on a filled row makes it a hand row; the fill leaves it after that', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  await fillOn(env);
  await typeTops(env, a, 'table1', 0.6);
  assert.equal(prodRow(sqlite).fill_source, 'cells');
  await post(env, 'addProduction', { date: DATE, timeSlot: H1, trimmers1: 1, tops1: 0.7, cultivar1: 'Lifter' });
  assert.equal(prodRow(sqlite).fill_source, null);
  await typeTops(env, a, 'table1', 0.9);
  assert.equal(prodRow(sqlite).tops_lbs1, 0.7, 'the hand value stands');
});

test('turning the day off removes only the filled rows; the switch needs the password', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  await post(env, 'addProduction', { date: DATE, timeSlot: H2, trimmers1: 10, tops1: 4 });
  await typeTops(env, a, 'table1', 0.6);
  assert.equal((await post(env, 'cellFillSet', { date: DATE, on: true })).status, 401);
  await fillOn(env);
  assert.equal(prodRow(sqlite).fill_source, 'cells');
  await fillOn(env, false);
  assert.equal(prodRow(sqlite), undefined);
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 4, 'the hand row stays');
  await typeTops(env, a, 'table1', 0.8);
  assert.equal(prodRow(sqlite), undefined, 'off again: saves write nothing');
});
