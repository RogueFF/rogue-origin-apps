/**
 * Person-first hourly entry (crew-hourly.html), Koa 2026-11-17 via the hub.
 *
 *   · reads and writes need the farm password; no card token in any response
 *   · a typed hour wins over a sheet hour for that person and hour; a sheet
 *     reload replaces sheet hours only and never removes a typed one
 *   · full day from typed hours: every 7-8..3-4 slot the room worked, as long as
 *     the longest anyone worked it; a cover makes both people part day
 *   · each person's rate uses only their own minutes and tops
 *   · Mis números and the crew board read the result straight away
 *   · the migration backfills sheet rows already loaded
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

const migration = (f) => readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
  .split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
const run = (sqlite, sql) => { for (const st of sql.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); } };
function freshDb({ skipCrewHours = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  run(sqlite, migration('0065-crew-numbers.sql'));
  run(sqlite, migration('0050-cell-hourly.sql'));
  if (!skipCrewHours) { run(sqlite, migration('0069-crew-hours.sql')); run(sqlite, migration('0070-crew-hours-station.sql')); }
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

const DATE = '2026-11-18';
const FULL = [['7-8', 60], ['8-9', 60], ['9-10', 50], ['10-11', 60], ['11-12', 60], ['12-1', 30], ['1-2', 60], ['2-3', 50], ['3-4', 60]];
const G = 453.59237;
async function addPerson(env, name) { return (await json(post(env, 'crewPersonAdd', { password: 'pw', name }))).person.id; }
async function typeDay(env, id, cell, lbPerHour, slots = FULL) {
  for (const [slot, min] of slots) {
    const r = await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: id, slot, cell, lb: lbPerHour * min / 60, min });
    assert.equal(r.status, 200, `save ${slot}`);
  }
}
const dayRow = (sqlite, id, date = DATE) => sqlite.prepare('SELECT * FROM crew_days WHERE work_date = ? AND person_id = ?').get(date, id);

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('every action needs the farm password', async () => {
  const { env } = freshDb();
  for (const [action, body] of [['crewHourDay', { date: DATE }], ['crewHourSave', { date: DATE, personId: 1, slot: '7-8', lb: 0.3, min: 60 }], ['crewPersonAdd', { name: 'X' }]]) {
    assert.equal((await post(env, action, body)).status, 401, `${action} without a password`);
    assert.equal((await post(env, action, { ...body, password: 'nope' })).status, 401, `${action} with a wrong password`);
  }
});

test('adding a person makes a card but never returns its token; the day read has no tokens either', async () => {
  const { env, sqlite } = freshDb();
  const id = await addPerson(env, 'Nueva');
  assert.equal(await addPerson(env, 'nueva'), id, 'same name (any case) is the same person');
  await typeDay(env, id, '3', 0.5, FULL.slice(0, 1));
  const raw = await (await post(env, 'crewHourDay', { password: 'pw', date: DATE })).text();
  const { token } = sqlite.prepare('SELECT token FROM crew_people WHERE id = ?').get(id);
  assert.ok(token && !raw.includes(token), 'a card token leaked');
  const add = await (await post(env, 'crewPersonAdd', { password: 'pw', name: 'Otra' })).text();
  assert.ok(!/token/i.test(add));
});

test('typed full day: ranked, rate from own tops and minutes, live on Mis números and the crew board', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana'), b = await addPerson(env, 'Beto');
  await typeDay(env, a, '1', 0.6);
  await typeDay(env, b, '2', 0.4);
  const ra = dayRow(sqlite, a);
  assert.equal(ra.full_day, 1);
  assert.equal(ra.work_min, 490);
  assert.ok(Math.abs(ra.tops_g / G / (ra.work_min / 60) - 0.6) < 0.001);
  assert.equal(ra.cell, '1');
  const board = (await json(get(env, 'action=crewBoard')));
  assert.equal(board.day, DATE);
  assert.deepEqual(board.byDay[DATE].ranked.map((p) => p.name), ['Ana', 'Beto']);
  assert.ok(board.room.rate.lbHr > 0.4 && board.room.rate.lbHr < 0.6, 'a typed-only day gets a room rate');
  const { token } = sqlite.prepare('SELECT token FROM crew_people WHERE id = ?').get(b);
  const mine = await json(get(env, `action=myNumbers&t=${token}`));
  assert.equal(mine.days[0].rank, 2);
  assert.equal(mine.days[0].hourly.length, 9);
});

test('a cover: the one who left and the one who covered are both part day, each on their own minutes', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana'), b = await addPerson(env, 'Beto'), c = await addPerson(env, 'Cata');
  await typeDay(env, a, '1', 0.6);
  // Beto leaves cell 2 at 2:20 (20 of 50 min); Cata covers cell 2 for the rest of the day
  await typeDay(env, b, '2', 0.5, FULL.slice(0, 7));
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: b, slot: '2-3', cell: '2', lb: 0.15, min: 20 });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: c, slot: '2-3', cell: '2', lb: 0.2, min: 30 });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: c, slot: '3-4', cell: '2', lb: 0.4, min: 60 });
  assert.equal(dayRow(sqlite, a).full_day, 1);
  assert.equal(dayRow(sqlite, b).full_day, 0, 'left early');
  assert.equal(dayRow(sqlite, c).full_day, 0, 'covered part of the day');
  assert.equal(dayRow(sqlite, b).work_min, 400);
  assert.equal(dayRow(sqlite, c).work_min, 90);
  const d = await json(post(env, 'crewHourDay', { password: 'pw', date: DATE }));
  const at23 = d.hours.filter((h) => h.slot === '2-3' && h.cell === '2').map((h) => [h.name, h.min]).sort();
  assert.deepEqual(at23, [['Beto', 20], ['Cata', 30]]);
  const board = await json(get(env, 'action=crewBoard'));
  assert.deepEqual(board.byDay[DATE].ranked.map((p) => p.name), ['Ana']);
  assert.deepEqual(board.byDay[DATE].part.map((p) => p.name).sort(), ['Beto', 'Cata']);
});

test('a slot the whole room skipped (a meeting) does not make anyone a part day', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  await typeDay(env, a, '1', 0.5, FULL.filter(([s]) => s !== '9-10').map(([s, m]) => [s, s === '10-11' ? 80 : m]));
  assert.equal(dayRow(sqlite, a).full_day, 1);
});

test('typed wins over a sheet hour; a sheet reload keeps typed hours and replaces sheet hours', async () => {
  const { env, sqlite } = freshDb();
  const sheet = (g) => ({ date: DATE, target: 0.53, roomRate: 0.5, password: 'pw', note: 'sheet',
    people: [{ name: 'Ana', cell: '1', fullDay: true, hours: FULL.map(([slot, min]) => ({ slot, g, min })) }] });
  await post(env, 'crewLoadDay', sheet(200));
  const a = sqlite.prepare("SELECT id FROM crew_people WHERE name = 'Ana'").get().id;
  assert.equal(dayRow(sqlite, a).tops_g, 1800);
  assert.equal(dayRow(sqlite, a).full_day, 1, 'sheet-only day keeps the sheet call');

  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', cell: '1', lb: 1, min: 60 });
  assert.ok(Math.abs(dayRow(sqlite, a).tops_g - (1600 + G)) < 0.2, 'typed 7-8 replaced the sheet 7-8');

  await post(env, 'crewLoadDay', sheet(100));
  assert.ok(Math.abs(dayRow(sqlite, a).tops_g - (800 + G)) < 0.2, 'reload replaced sheet hours, typed 7-8 stayed');
  const meta = sqlite.prepare('SELECT target_lb_hr, room_lb_hr FROM crew_day_meta WHERE work_date = ?').get(DATE);
  assert.equal(meta.room_lb_hr, 0.5, 'a sheet load sets the day meta and a typed save leaves it');

  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', clear: true });
  assert.equal(dayRow(sqlite, a).tops_g, 900, 'clearing the typed hour brings the sheet hour back');
});

test('a sheet reload without a person drops their sheet hours but not their typed ones', async () => {
  const { env, sqlite } = freshDb();
  const both = { date: DATE, password: 'pw', people: [
    { name: 'Ana', cell: '1', hours: [{ slot: '7–8', g: 200, min: 60 }] },
    { name: 'Beto', cell: '2', hours: [{ slot: '7–8', g: 150, min: 60 }] }] };
  await post(env, 'crewLoadDay', both);
  const b = sqlite.prepare("SELECT id FROM crew_people WHERE name = 'Beto'").get().id;
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: b, slot: '8-9', cell: '2', lb: 0.4, min: 60 });
  await post(env, 'crewLoadDay', { ...both, people: both.people.slice(0, 1) });
  const rb = dayRow(sqlite, b);
  assert.equal(rb.work_min, 60, 'only the typed 8-9 is left');
  assert.equal(JSON.parse(rb.hours_json)[0].slot, '8-9');
});

test('bad input is refused', async () => {
  const { env } = freshDb();
  const a = await addPerson(env, 'Ana');
  for (const bad of [{ slot: '5-6' }, { lb: 12 }, { lb: -1 }, { min: 121 }, { personId: 9999 }]) {
    const r = await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', cell: '1', lb: 0.3, min: 60, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test('the migration backfills hours already loaded from the sheets', async () => {
  const { sqlite, env } = freshDb({ skipCrewHours: true });
  sqlite.prepare("INSERT INTO crew_people (name, token) VALUES ('Ana', 'tok_aaaaaaaaaaaaaaaaaaaa')").run();
  sqlite.prepare(`INSERT INTO crew_days (work_date, person_id, cell, hours_json, tops_g, work_min, full_day)
    VALUES ('2026-11-13', 1, '5', '[{"slot":"7–8","g":300,"min":60},{"slot":"3–4 SL","g":100,"min":60},{"slot":"4–4:30","g":0,"min":0}]', 400, 120, 0)`).run();
  run(sqlite, migration('0069-crew-hours.sql'));
  run(sqlite, migration('0070-crew-hours-station.sql'));
  const rows = sqlite.prepare('SELECT slot, src, cell, g, min FROM crew_hours ORDER BY slot').all();
  assert.deepEqual(rows.map((r) => [r.slot, r.src, r.cell, r.g, r.min]), [['3-4', 'sheet', '5', 100, 60], ['7-8', 'sheet', '5', 300, 60]]);
  assert.equal(sqlite.prepare('SELECT sheet_full_day FROM crew_days').get().sheet_full_day, 0);
  // a typed save on that date keeps the sheet's numbers for the other hours
  await post(env, 'crewHourSave', { password: 'pw', date: '2026-11-13', personId: 1, slot: '8-9', cell: '5', lb: 0.5, min: 60 });
  assert.equal(dayRow(sqlite, 1, '2026-11-13').work_min, 180);
});

// ---- inside the cell hourly log (Koa 2026-11-18): people per cell, one number per cell-hour ----
const cellTops = (sqlite, station, slot = '7:00 AM – 8:00 AM') =>
  sqlite.prepare('SELECT tops_lbs FROM cell_hourly WHERE production_date = ? AND time_slot = ? AND station_id = ?').get(DATE, slot, station)?.tops_lbs ?? null;

test('a person typed on a cell: the log slot name works, the cell total is derived, the cell number shows', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  const r = await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7:00 AM – 8:00 AM', stationId: 'table5', lb: 0.6, min: 60 });
  assert.equal(r.status, 200);
  assert.equal(cellTops(sqlite, 'table5'), 0.6);
  const d = await json(post(env, 'crewHourDay', { password: 'pw', date: DATE }));
  const h = d.hours.find((x) => x.personId === a);
  assert.deepEqual([h.slot, h.stationId, h.cell, h.seq], ['7-8', 'table5', '5', 1]);
  assert.equal(d.slots[0].long, '7:00 AM – 8:00 AM');
  assert.equal(dayRow(sqlite, a).cell, '5');
});

test('a cover: two people on one cell-hour add up to the cell total; the cover is seq 2', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana'), b = await addPerson(env, 'Beto');
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', stationId: 'table5', lb: 0.2, min: 20, seq: 1 });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: b, slot: '7-8', stationId: 'table5', lb: 0.35, min: 40, seq: 2 });
  assert.equal(cellTops(sqlite, 'table5'), 0.55);
  const d = await json(post(env, 'crewHourDay', { password: 'pw', date: DATE }));
  assert.equal(d.hours.find((x) => x.personId === b).seq, 2);
});

test('moving a person to another cell takes them off the old one for that hour', async () => {
  const { env, sqlite } = freshDb();
  const a = await addPerson(env, 'Ana');
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', stationId: 'table5', lb: 0.6, min: 60 });
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', stationId: 'table6', lb: 0.6, min: 60 });
  assert.equal(cellTops(sqlite, 'table5'), null, 'old cell emptied');
  assert.equal(cellTops(sqlite, 'table6'), 0.6);
  await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: a, slot: '7-8', clear: true });
  assert.equal(cellTops(sqlite, 'table6'), null, 'clearing the person clears the cell total');
});

test('the cell log no longer takes typed tops (one number), but its notes and cultivar still save', async () => {
  const { env, sqlite } = freshDb();
  const t = await post(env, 'setCellHourly', { date: DATE, slot: '7:00 AM – 8:00 AM', stationId: 'table5', tops: 1.2 });
  assert.equal(t.status, 400);
  const n = await post(env, 'setCellHourly', { date: DATE, slot: '7:00 AM – 8:00 AM', stationId: 'table5', notes: 'ok', cultivar: 'Sour Lifter' });
  assert.equal(n.status, 200);
  assert.equal(sqlite.prepare('SELECT notes FROM cell_hourly').get().notes, 'ok');
  const bad = await post(env, 'crewHourSave', { password: 'pw', date: DATE, personId: await addPerson(env, 'Ana'), slot: '7-8', stationId: 'table99', lb: 0.3, min: 60 });
  assert.equal(bad.status, 400, 'unknown cell');
});
