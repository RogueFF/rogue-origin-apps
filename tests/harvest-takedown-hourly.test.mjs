/**
 * The takedown report, on the hour (?action=bajada).
 *
 * Koa, 2026-10-05: "a digital one they can fill out with their phones. You
 * should be able to capture bags per hour through the supersack tag printer,
 * and they can manually fill out the other columns." Takedown is its own crew,
 * so this is its own page and table — the hanging crew page is untouched.
 *
 * What these pin:
 *   · sacks per hour come from the tags, counted in the Pacific hour they were
 *     printed — voided tags out, the other mode's tags out, yesterday's tags out
 *     even when their UTC date is today;
 *   · a correction merges per field, and notes append (same rule as the crew page);
 *   · the crew carries to the next hour and the sticks never do;
 *   · a bad hour is refused rather than filed under a default.
 *
 * The sack counts are tested against the loader with a fixed `now`, because
 * the handler runs on the real clock and a sack seeded "now" can land in a
 * different Pacific hour than the test expects.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, modUrl, sqliteAvailable, SEASON } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1 } = await import(modUrl('workers/src/handlers/harvest-d1.js'));
const { loadTakedownHourly, takedownHourlyBody } = await import(
  modUrl('workers/src/handlers/harvest-takedown-hourly.js'));

before((t) => { if (!sqliteAvailable) t.skip('node:sqlite unavailable (Node < 22.5)'); });

// 10:07 Pacific (PDT, UTC-7) on 2026-10-05.
const NOW = new Date('2026-10-05T17:07:00Z');

let serial = 0;
function sack(sqlite, { printed, cultivar = 'Strawberry Doughnuts', zone = 'Z10', cut = 1, bay = 10,
  voided = null, isTest = 1 }) {
  serial += 1;
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, bay, printed_at, voided_at, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`T-${serial}`, SEASON, serial, zone, cultivar, cut, bay, printed, voided, isTest);
}

const page = (env, ctx, qs = '') => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=bajada&lang=en${qs}`), env, ctx));

const send = (env, ctx, fields) => quiet(() => handleHarvestD1(new Request(
  'https://x/api/harvest?action=bajada_set&lang=en',
  { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields) }), env, ctx));

const rows = (sqlite) => sqlite.prepare(
  'SELECT * FROM harvest_takedown_hourly ORDER BY harvest_date, hour_start').all();

const FULL = {
  hour: '09:00', takedown: '4', drivers: '1', water_spiders: '2',
  weight_checkers: '1', stick_removers: '2', hangers: '2', sticks_down: '30',
};

const hourOf = (data, h) => data.hours.find(x => x.hour_start === h);

test('sacks per hour come from the tags, in the Pacific hour they printed', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 15:30:00' });                       // 8:30 PDT
  sack(sqlite, { printed: '2026-10-05 15:45:00' });                       // 8:45
  sack(sqlite, { printed: '2026-10-05 16:15:00' });                       // 9:15
  sack(sqlite, { printed: '2026-10-05 16:20:00' });                       // 9:20
  sack(sqlite, { printed: '2026-10-05 16:40:00', cultivar: 'Rainbow Cake', zone: 'Z8' }); // 9:40

  const data = await loadTakedownHourly(env.DB, env, {}, 1, NOW);

  assert.equal(hourOf(data, '08:00').sacks, 2);
  assert.equal(hourOf(data, '09:00').sacks, 3);
  assert.equal(data.totalSacks, 5);
});

test('two lots in one hour are both listed, with their own counts and bay', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });
  sack(sqlite, { printed: '2026-10-05 16:20:00' });
  sack(sqlite, { printed: '2026-10-05 16:40:00', cultivar: 'Rainbow Cake', zone: 'Z8', bay: 9 });

  const lots = hourOf(await loadTakedownHourly(env.DB, env, {}, 1, NOW), '09:00').lots;

  assert.deepEqual(lots.map(l => `${l.n} ${l.cultivar} ${l.zone} c${l.cut} b${l.bay}`),
    ['2 Strawberry Doughnuts Z10 c1 b10', '1 Rainbow Cake Z8 c1 b9']);
});

test('voided tags, the other mode, and other days are not counted', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });                                  // counts
  sack(sqlite, { printed: '2026-10-05 16:16:00', voided: '2026-10-05 16:17:00' });   // voided
  sack(sqlite, { printed: '2026-10-05 16:18:00', isTest: 0 });                       // live tag, test page
  sack(sqlite, { printed: '2026-10-05 06:30:00' });          // 23:30 PDT Oct 4 — UTC date is today
  sack(sqlite, { printed: '2026-10-06 07:30:00' });          // 00:30 PDT Oct 6 — tomorrow

  const data = await loadTakedownHourly(env.DB, env, {}, 1, NOW);

  assert.equal(data.totalSacks, 1);
  assert.deepEqual(data.hours.filter(h => h.sacks).map(h => h.hour_start), ['09:00']);
});

test('the first minutes after Pacific midnight belong to today', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 07:05:00' });          // 00:05 PDT Oct 5

  const data = await loadTakedownHourly(env.DB, env, {}, 1, NOW);

  assert.equal(hourOf(data, '00:00').sacks, 1);
});

test('the table shows sacks per takedown person, and a dash with nobody counted', async () => {
  const { sqlite, env, ctx } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });
  sack(sqlite, { printed: '2026-10-05 16:20:00' });
  sack(sqlite, { printed: '2026-10-05 15:30:00' });
  // Rows written straight in: the handler would stamp them with the real day.
  sqlite.prepare(`INSERT INTO harvest_takedown_hourly (season, harvest_date, hour_start, takedown, sticks_down, answered_at, is_test)
    VALUES (2026, '2026-10-05', '09:00', 4, 30, '2026-10-05 17:01:00', 1)`).run();

  const data = await loadTakedownHourly(env.DB, env, {}, 1, NOW);
  const html = takedownHourlyBody({ lang: 'en' }, data);
  const table = html.slice(html.indexOf('<table'));

  assert.match(table, /9-10<\/strong>.*?<\/td><td>4<\/td><td class="sticks">30<\/td><td class="sacks">2<\/td>/);
  assert.match(table, /<td class="per">0\.5<\/td>/, '2 sacks / 4 on takedown');
  assert.match(table, /8-9<\/strong><\/td><td>—<\/td><td class="sticks">—<\/td><td class="sacks">1<\/td>/,
    'an hour with tags but no report still shows its sacks');
  assert.match(html, /Sacks today: <strong>3<\/strong>/);
  assert.match(html, /Sticks today: <strong>30<\/strong>/);
});

test('the page asks the six roles in the paper sheet\'s order', async () => {
  const { env, ctx } = freshDb();

  const html = await (await page(env, ctx)).text();

  const order = ['takedown', 'drivers', 'water_spiders', 'weight_checkers', 'stick_removers', 'hangers', 'sticks_down']
    .map(k => html.indexOf(`id="${k}"`));
  assert.ok(order.every(i => i > 0), 'every field is on the form');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in the sheet\'s order');
  assert.match(html, /Hourly takedown report/);
});

test('a submission lands one row for today, stamped', async () => {
  const { sqlite, env, ctx } = freshDb();

  await send(env, ctx, FULL);

  const r = rows(sqlite);
  assert.equal(r.length, 1);
  assert.equal(r[0].hour_start, '09:00');
  assert.equal(r[0].takedown, 4);
  assert.equal(r[0].stick_removers, 2);
  assert.equal(r[0].sticks_down, 30);
  assert.equal(r[0].is_test, 1);
  assert.ok(r[0].answered_at);
});

test('a correction merges per field, and notes append', async () => {
  const { sqlite, env, ctx } = freshDb();
  await send(env, ctx, { ...FULL, notes: 'se atoro la impresora' });

  await send(env, ctx, { hour: '09:00', sticks_down: '34', notes: 'faltaban bolsas' });

  const r = rows(sqlite);
  assert.equal(r.length, 1, 'the same hour, not a second row');
  assert.equal(r[0].sticks_down, 34);
  assert.equal(r[0].takedown, 4, 'the crew survived the one-box correction');
  assert.equal(r[0].notes, 'se atoro la impresora; faltaban bolsas');
});

test('a nonsense hour is refused, and nothing is filed', async () => {
  const { sqlite, env, ctx } = freshDb();

  const html = await (await send(env, ctx, { ...FULL, hour: 'lunch' })).text();

  assert.match(html, /Pick the hour/);
  assert.equal(rows(sqlite).length, 0);
});

test('the crew carries to the next hour, and the sticks never do', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);

  const html = await (await page(env, ctx, '&hour=10%3A00')).text();

  assert.match(html, /id="takedown"[^>]*value="4"/);
  assert.match(html, /id="stick_removers"[^>]*value="2"/);
  assert.match(html, /id="sticks_down"[^>]*value=""/, 'a carried 30 would be filed as another 30');
  assert.match(html, /Crew carried from 9-10/);
});

test('test rows and real rows never mix', async () => {
  const { sqlite, env, ctx } = freshDb();
  await send(env, ctx, FULL);
  await send({ ...env, HARVEST_TEST_MODE: 'false' }, ctx, { ...FULL, sticks_down: '99' });

  assert.deepEqual(rows(sqlite).map(r => `${r.is_test}:${r.sticks_down}`).sort(), ['0:99', '1:30']);
});

test('each role carries its own last number, so a one-box hour does not blank the crew', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);                                    // 9-10: the whole crew
  await send(env, ctx, { hour: '10:00', takedown: '6', sticks_down: '40' });   // 10-11: only takedown changed

  const html = await (await page(env, ctx, '&hour=11%3A00')).text();

  assert.match(html, /id="takedown"[^>]*value="6"/, 'the newest takedown count');
  assert.match(html, /id="drivers"[^>]*value="1"/, 'drivers carried from 9-10, not blanked by 10-11');
  assert.match(html, /id="stick_removers"[^>]*value="2"/);
  assert.match(html, /id="sticks_down"[^>]*value=""/);
});

test('sticks per sack only counts hours where sticks were reported', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });                       // 9-10: 2 sacks, 30 sticks
  sack(sqlite, { printed: '2026-10-05 16:20:00' });
  for (const m of ['10', '20', '30', '40']) sack(sqlite, { printed: `2026-10-05 15:${m}:00` }); // 8-9: 4 sacks, no report
  sqlite.prepare(`INSERT INTO harvest_takedown_hourly (season, harvest_date, hour_start, takedown, sticks_down, answered_at, is_test)
    VALUES (2026, '2026-10-05', '09:00', 4, 30, '2026-10-05 17:01:00', 1)`).run();

  const data = await loadTakedownHourly(env.DB, env, {}, 1, NOW);
  const html = takedownHourlyBody({ lang: 'en' }, data);

  assert.equal(data.totalSacks, 6, 'the day total still counts every tag');
  assert.match(html, /sticks per sack <strong>15<\/strong> \(1 hour with sticks\)/,
    '30 sticks over the 2 sacks of the reported hour, not over all 6');
});

test('sticks per sack is a dash when no hour has both', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });

  const html = takedownHourlyBody({ lang: 'en' }, await loadTakedownHourly(env.DB, env, {}, 1, NOW));

  assert.match(html, /sticks per sack —/);
});

test('the breaks are marked on their hours, in the picker and the day table', async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { printed: '2026-10-05 16:15:00' });          // 9-10 (10-min break)
  sack(sqlite, { printed: '2026-10-05 19:10:00' });          // 12-1 (30-min lunch)
  sack(sqlite, { printed: '2026-10-05 18:10:00' });          // 11-12, no break

  const html = takedownHourlyBody({ lang: 'es' }, await loadTakedownHourly(env.DB, env, {}, 1, NOW));

  assert.match(html, /<option value="09:00"[^>]*>9-10 · descanso 10 min<\/option>/);
  assert.match(html, /<option value="12:00"[^>]*>12-1 · comida 30 min<\/option>/);
  assert.match(html, /<option value="14:00"[^>]*>2-3 · descanso 10 min<\/option>/);
  assert.match(html, /<option value="11:00"[^>]*>11-12<\/option>/, 'an hour without a break has no label');
  const table = html.slice(html.indexOf('<table'));
  assert.match(table, /9-10<\/strong><br><span class="hint">descanso 10 min<\/span>/);
  assert.match(table, /12-1<\/strong><br><span class="hint">comida 30 min<\/span>/);
  assert.doesNotMatch(table, /11-12<\/strong><br>/);
});
