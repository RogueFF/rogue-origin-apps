/**
 * Line trimmer scales (Koa 2026-11-24, migration 0074), the Worker side.
 *
 *   · the crew list for the name tap has ids and names, never a card token
 *   · a name tap takes the person off any other seat; the seat reads back today only
 *   · a seat's hour totals are absolute: a resend never counts twice
 *   · scale hours feed that person's Mis números under typed hours; a scale-only
 *     half day is a part day
 *   · the fill writes tops only, into the lead's row, only with the day's switch on,
 *     never over typed tops, never without crew; a change cultivar gets its share
 *   · a hand save that changes the tops makes them typed; one that leaves the box
 *     alone keeps the scales; turning the day off puts filled tops back to 0
 *
 * Run with `node --test`. Made-up people and numbers.
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
const { lineTopsFill, slotKeyOfRow } = await import(url('workers/src/lib/line-fill.js'));

const splitSql = (text) => text.split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  const files = [join(REPO, 'workers/schema.sql'),
    ...readdirSync(join(REPO, 'workers/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => join(REPO, 'workers/migrations', f))];
  for (const f of files) for (const st of splitSql(readFileSync(f, 'utf8'))) { try { sqlite.exec(st); } catch { /* duplicate column etc. */ } }
  sqlite.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind) VALUES ('table1', 'Seat 1', 'table'), ('table2', 'Seat 2', 'table'), ('qc1', 'QC', 'qc')`);
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
const json = async (p) => (await p).json();
const data = async (p) => { const j = await json(p); return j.data ?? j; };

const G = 453.59237;
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const H1 = '7:00 AM – 8:00 AM', H2 = '8:00 AM – 9:00 AM';
const addPerson = async (env, name) => (await data(post(env, 'crewPersonAdd', { password: 'pw', name }))).person.id;
const save = (env, rows, stationId = 'table1', date = TODAY) => post(env, 'lineScaleSave', { stationId, date, rows });
const typeHour = (env, slot, o = {}) => post(env, 'addProduction', {
  date: TODAY, timeSlot: slot, trimmers1: 6, buckers1: 2, tzero1: 1, cultivar1: 'Alpha', tops1: 0, smalls1: 0, ...o });
const prodRow = (sqlite, slot = H1) => sqlite.prepare('SELECT * FROM monthly_production WHERE production_date = ? AND time_slot = ?').get(TODAY, slot);
const fillOn = (env, on = true) => post(env, 'lineScaleFillSet', { password: 'pw', date: TODAY, on });

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('fill rule (pure): no row, no crew, typed tops win; else the scales, with the change cultivar\'s share', () => {
  const scale = { g: 2 * G, byCultivar: { Alpha: 1.5 * G, Beta: 0.5 * G } };
  assert.equal(lineTopsFill(null, scale).state, 'noRow');
  assert.equal(lineTopsFill({ trimmers_line1: 0, buckers_line1: 0, tzero_line1: 0 }, scale).state, 'noCrew');
  assert.equal(lineTopsFill({ trimmers_line1: 6, tops_lbs1: 3.4, tops_source: null }, scale).state, 'hand');
  const f = lineTopsFill({ trimmers_line1: 6, tops_lbs1: 0, tops_source: null }, scale);
  assert.deepEqual(f, { state: 'fill', tops: 2, changeTops: null });
  const c = lineTopsFill({ trimmers_line1: 6, tops_lbs1: 0, change_cultivar: 'Beta' }, scale);
  assert.equal(c.changeTops, 0.5, 'the part on the change cultivar');
  assert.equal(lineTopsFill({ trimmers_line1: 6, tops_lbs1: 2, tops_source: 'scales' }, scale).state, 'same');
  assert.equal(lineTopsFill({ trimmers_line1: 6, tops_lbs1: 1.2, tops_source: 'scales' }, scale).state, 'fill', 'already filled: follows the scales');
});

test('slot keys: Hourly entry rows to crew_hours keys, a custom first slot included', () => {
  assert.equal(slotKeyOfRow(H1), '7-8');
  assert.equal(slotKeyOfRow('7:30 AM – 8:00 AM'), '7-8');
  assert.equal(slotKeyOfRow('12:30 PM – 1:00 PM'), '12-1');
  assert.equal(slotKeyOfRow('4:00 PM – 4:30 PM'), '4-4:30');
  assert.equal(slotKeyOfRow('nonsense'), null);
});

test('crew list: ids and names only, never a card token', async () => {
  const { env } = freshDb();
  await addPerson(env, 'Ana');
  await addPerson(env, 'Beto');
  const d = await data(get(env, 'action=lineCrew'));
  assert.deepEqual(d.people.map((p) => p.name), ['Ana', 'Beto']);
  for (const p of d.people) assert.deepEqual(Object.keys(p).sort(), ['id', 'name']);
  assert.ok(!JSON.stringify(d).includes('token'));
});

test('name tap: one seat per person; the seat reads back with the line\'s cultivars', async () => {
  const { env } = freshDb();
  const ana = await addPerson(env, 'Ana');
  await post(env, 'lineSeat', { stationId: 'table1', personId: ana });
  await post(env, 'lineSeat', { stationId: 'table2', personId: ana });
  const s1 = await data(get(env, 'action=lineState&stationId=table1'));
  const s2 = await data(get(env, 'action=lineState&stationId=table2'));
  assert.equal(s1.seat, null, 'moving seats takes Ana off seat 1');
  assert.equal(s2.seat.personId, ana);
  await typeHour(env, H1, { cultivar1: 'Alpha', changeCultivar: 'Beta', changeAt: '07:40', changeTops: 0 });
  assert.deepEqual(s2.hours, []);
  const s3 = await data(get(env, 'action=lineState&stationId=table2'));
  assert.deepEqual(s3.hours, [{ slot: '7-8', cultivar: 'Alpha', changeAt: '07:40', changeCultivar: 'Beta' }]);
  assert.equal((await get(env, 'action=lineState&stationId=qc1')).status, 400, 'a QC scale is not a seat');
  assert.equal((await post(env, 'lineSeat', { stationId: 'table1', personId: 999 })).status, 400);
  await post(env, 'lineSeat', { stationId: 'table2', personId: 0 });
  assert.equal((await data(get(env, 'action=lineState&stationId=table2'))).seat, null, 'tap out');
});

test('seat totals are absolute: a resend never counts twice; nobody tapped in is person 0', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  const rows = [{ slot: '7-8', personId: ana, cultivar: 'Alpha', g: 300, min: 40 }, { slot: '7-8', personId: 0, cultivar: '', g: 20, min: 0 }];
  assert.equal((await save(env, rows)).status, 200);
  assert.equal((await save(env, rows)).status, 200);
  const all = sqlite.prepare('SELECT person_id, cultivar, g, min FROM line_scale_hours ORDER BY person_id').all();
  assert.equal(all.length, 2, 'one row per key, even with person 0 and no cultivar');
  assert.equal(all[1].g, 300);
  await save(env, [{ slot: '7-8', personId: ana, cultivar: 'Alpha', g: 350, min: 45 }]);
  assert.equal(sqlite.prepare('SELECT g FROM line_scale_hours WHERE person_id = ?').get(ana).g, 350, 'a newer total replaces the old');
  const seat = await data(get(env, `action=lineScaleSeat&stationId=table1&date=${TODAY}`));
  assert.equal(seat.rows.length, 2);
  await save(env, [{ slot: '8-9', personId: ana, cultivar: 'Alpha', g: -3, min: 90 }]);
  const r = sqlite.prepare("SELECT g, min FROM line_scale_hours WHERE slot = '8-9'").get();
  assert.deepEqual([r.g, r.min], [0, 60], 'a shake below 0 counts as 0; minutes cap at the hour');
});

test('seat saves refuse bad input', async () => {
  const { env } = freshDb();
  assert.equal((await save(env, [{ slot: '7-8', personId: 0, g: 1 }], 'nope')).status, 400);
  assert.equal((await save(env, [{ slot: '6-7', personId: 0, g: 1 }])).status, 400);
  assert.equal((await save(env, [{ slot: '7-8', personId: 0, g: 6000 }])).status, 400);
  assert.equal((await save(env, [{ slot: '7-8', personId: 42, g: 1 }])).status, 400, 'unknown person');
  assert.equal((await save(env, [{ slot: '7-8', personId: 0, g: 1 }], 'table1', '2026-01-02')).status, 400, 'old date');
  assert.equal((await save(env, [])).status, 400);
});

test('Mis números: scale hours count for the person; a typed hour wins; a scale-only half day is part day', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  const beto = await addPerson(env, 'Beto');
  const full = [['7-8', 60], ['8-9', 60], ['9-10', 50], ['10-11', 60], ['11-12', 60], ['12-1', 30], ['1-2', 60], ['2-3', 50], ['3-4', 60]];
  await save(env, full.map(([slot, min]) => ({ slot, personId: ana, cultivar: 'Alpha', g: 0.5 * G, min })));
  await save(env, [{ slot: '7-8', personId: beto, cultivar: 'Alpha', g: 0.4 * G, min: 60 }], 'table2');
  const day = (id) => sqlite.prepare('SELECT * FROM crew_days WHERE work_date = ? AND person_id = ?').get(TODAY, id);
  assert.equal(Math.round(day(ana).tops_g), Math.round(9 * 0.5 * G));
  assert.equal(day(ana).work_min, 490);
  assert.equal(day(ana).full_day, 1);
  assert.equal(day(beto).full_day, 0, 'one hour is a part day, never ranked as full');
  assert.equal(day(beto).cell, '2', 'the seat number');
  // A lead types Ana's 7-8: that hour is the typed one.
  await post(env, 'crewHourSave', { password: 'pw', date: TODAY, personId: ana, slot: '7-8', lb: 0.9, min: 60 });
  assert.equal(Math.round(day(ana).tops_g), Math.round(8 * 0.5 * G + 0.9 * G));
  const mine = await data(get(env, `action=myNumbers&t=${sqlite.prepare('SELECT token FROM crew_people WHERE id = ?').get(ana).token}`));
  assert.equal(mine.days[0].date, TODAY);
});

test('fill: off by default; on, it fills the lead\'s row, tops only', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  await typeHour(env, H1);
  await save(env, [{ slot: '7-8', personId: ana, cultivar: 'Alpha', g: 1.5 * G, min: 60 }]);
  assert.equal(prodRow(sqlite).tops_lbs1, 0, 'switch off: nothing written');
  await fillOn(env);
  const r = prodRow(sqlite);
  assert.equal(r.tops_lbs1, 1.5);
  assert.equal(r.tops_source, 'scales');
  assert.deepEqual([r.trimmers_line1, r.buckers_line1, r.tzero_line1, r.cultivar1], [6, 2, 1, 'Alpha'], 'crew and cultivar untouched');
  await save(env, [{ slot: '7-8', personId: ana, cultivar: 'Alpha', g: 2 * G, min: 60 }]);
  assert.equal(prodRow(sqlite).tops_lbs1, 2, 'follows the scales');
  // An hour with scale weight but no row yet: nothing, until the lead types the crew.
  await save(env, [{ slot: '8-9', personId: ana, cultivar: 'Alpha', g: 0.7 * G, min: 30 }]);
  assert.equal(prodRow(sqlite, H2), undefined);
  await typeHour(env, H2);
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 0.7, 'a new row with crew picks up the scales');
  const hrs = await data(get(env, `action=lineScaleHours&date=${TODAY}`));
  assert.equal(hrs.fillOn, true);
  assert.equal(hrs.slots[0].fill, 'filled');
  assert.equal(hrs.slots[0].rows[0].name, 'Ana');
  assert.equal(hrs.slots[0].lb, 2);
});

test('fill: typed tops win; an untouched save keeps the scales; a changed one makes them typed', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  await fillOn(env);
  await typeHour(env, H1, { tops1: 3.3 });
  await save(env, [{ slot: '7-8', personId: ana, cultivar: 'Alpha', g: 1 * G, min: 60 }]);
  assert.equal(prodRow(sqlite).tops_lbs1, 3.3, 'typed tops are never overwritten');
  assert.equal((await data(get(env, `action=lineScaleHours&date=${TODAY}`))).slots[0].fill, 'hand');

  await typeHour(env, H2);
  await save(env, [{ slot: '8-9', personId: ana, cultivar: 'Alpha', g: 1 * G, min: 60 }]);
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 1);
  await save(env, [{ slot: '8-9', personId: ana, cultivar: 'Alpha', g: 1.4 * G, min: 60 }]);
  // The lead's form still shows 1 lb from when it opened, and they only add a note.
  await typeHour(env, H2, { tops1: 1, qcNotes: 'ok', topsTouched: false });
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 1.4, 'still the scales');
  assert.equal(prodRow(sqlite, H2).tops_source, 'scales');
  await typeHour(env, H2, { tops1: 1.8, topsTouched: true });
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 1.8);
  assert.equal(prodRow(sqlite, H2).tops_source, null, 'the lead typed it: typed from now on');
  await save(env, [{ slot: '8-9', personId: ana, cultivar: 'Alpha', g: 2 * G, min: 60 }]);
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 1.8);
});

test('fill: a cultivar change gets its share; turning the day off puts filled tops back to 0', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  await typeHour(env, H1, { cultivar1: 'Alpha', changeCultivar: 'Beta', changeAt: '07:40', changeTops: 0 });
  await save(env, [
    { slot: '7-8', personId: ana, cultivar: 'Alpha', g: 1.2 * G, min: 40 },
    { slot: '7-8', personId: ana, cultivar: 'Beta', g: 0.4 * G, min: 20 },
  ]);
  await fillOn(env);
  assert.deepEqual([prodRow(sqlite).tops_lbs1, prodRow(sqlite).change_tops_lbs], [1.6, 0.4]);
  await typeHour(env, H2, { tops1: 2.2 });
  await fillOn(env, false);
  assert.deepEqual([prodRow(sqlite).tops_lbs1, prodRow(sqlite).change_tops_lbs, prodRow(sqlite).tops_source], [0, 0, null]);
  assert.equal(prodRow(sqlite, H2).tops_lbs1, 2.2, 'typed tops stay');
  assert.equal((await post(env, 'lineScaleFillSet', { date: TODAY, on: true })).status, 401, 'the switch needs the farm password');
});

test('pickup marks carry the person', async () => {
  const { env, sqlite } = freshDb();
  const ana = await addPerson(env, 'Ana');
  const r = await post(env, 'scaleMark', { stationId: 'table1', kind: 'pickup', kg: 0.4536, cultivar: 'Alpha', bag: 'lb1', cycleS: 900, personId: ana });
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare('SELECT person_id FROM scale_marks').get().person_id, ana);
});
