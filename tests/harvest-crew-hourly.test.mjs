/**
 * The crew report, on the hour.
 *
 * Koa, 2026-09-22: starting numbers in the morning, then an update every hour,
 * each one timestamped, carrying the crew counts AND the sticks hung.
 *
 * The page writes harvest_hourly — the table built for the WhatsApp bot that
 * never got a live phone — rather than a new one, so the dashboard rollups and
 * the bot keep reading a single set of rows. These tests pin the parts that
 * would quietly corrupt a day if they slipped:
 *
 *   · a correction merges per field. The barn lead who realises at 11:20 that
 *     the 10-11 sticks were 14, not 12, sends one box. A full-row write would
 *     blank the five crew counts that hour already had.
 *   · barn and hour are asked every submission, and a bad one is refused
 *     rather than filed under whatever the form happened to default to.
 *   · the radioed cutter count and the zone scans are shown side by side and
 *     allowed to disagree. One is a radio call, the other is who scanned in;
 *     a silent overwrite would destroy both.
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

const { handleHarvestD1 } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
  '0032-harvest-hourly.sql', '0033-harvest-sms-queue.sql', '0034-harvest-channel.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      // Split on /\r?\n/, not '\n': the hourly migrations are CRLF, and a line
      // ending in '\r' defeats /--.*$/ — the comment survives, and the first
      // semicolon inside it splits half a sentence off as a statement.
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  const DB = {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
            first: async () => sqlite.prepare(sql).get(...args) ?? null,
            run: async () => {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
            },
          };
        },
      };
    },
  };
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: 'test-password' }, ctx: { waitUntil() {} } };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

const page = (env, ctx, qs = '') => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=crew&lang=en${qs}`), env, ctx));

const send = (env, ctx, fields) => quiet(() => handleHarvestD1(new Request(
  'https://x/api/harvest?action=crew_set&lang=en',
  { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields) }), env, ctx));

const hourly = (sqlite) => sqlite.prepare(
  `SELECT * FROM harvest_hourly ORDER BY harvest_date, hour_start, barn`).all();

const FULL = {
  barn: 'upper', hour: '09:00', cutters: '12', cutter_water_spiders: '2',
  drivers: '3', hangers: '8', hanging_water_spiders: '1', racks: '14',
};

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('the crew page is the hourly report now, not the roster form', async () => {
  const { sqlite, env, ctx } = freshDb();

  const html = await (await page(env, ctx)).text();

  assert.match(html, /Hourly crew report/);
  assert.match(html, /Which barn\?/, 'barn is asked every time');
  assert.match(html, /Upper Barn/);
  assert.match(html, /Bottom Barn/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM harvest_crew_roster').get().n, 0,
    'the roster chain is no longer written');
});

test('the first report of the day is the morning head count', async () => {
  const { env, ctx } = freshDb();

  const html = await (await page(env, ctx, '&barn=upper')).text();

  assert.match(html, /First report today — the starting numbers/);
  assert.match(html, /No reports yet today/);
});

test('a submission lands one row, stamped, with the sticks', async () => {
  const { sqlite, env, ctx } = freshDb();

  await send(env, ctx, FULL);

  const rows = hourly(sqlite);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.barn, 'upper');
  assert.equal(r.hour_start, '09:00');
  assert.equal(r.cutters, 12);
  assert.equal(r.hangers, 8);
  assert.equal(r.racks, 14, 'sticks are racks — one unit, stored once');
  assert.equal(r.status, 'complete');
  assert.ok(r.answered_at, 'every update is timestamped');
  assert.equal(r.reported_by, 'web');
});

test('a correction merges per field — one box cannot blank the rest', async () => {
  const { sqlite, env, ctx } = freshDb();
  await send(env, ctx, FULL);
  const before_ = hourly(sqlite)[0];

  // 11:20, the lead realises the sticks were 16 rather than 14.
  await send(env, ctx, { barn: 'upper', hour: '09:00', racks: '16' });

  const rows = hourly(sqlite);
  assert.equal(rows.length, 1, 'the same barn-hour, not a second row');
  assert.equal(rows[0].racks, 16, 'the correction landed');
  assert.equal(rows[0].cutters, 12, 'and the crew counts survived it');
  assert.equal(rows[0].hangers, 8);
  assert.notEqual(rows[0].answered_at, null);
  assert.ok(rows[0].answered_at >= before_.answered_at, 'restamped to the latest update');
});

test('notes append rather than replace', async () => {
  const { sqlite, env, ctx } = freshDb();
  await send(env, ctx, { ...FULL, notes: 'se rompio un rack' });
  await send(env, ctx, { barn: 'upper', hour: '09:00', notes: 'llego tarde el chofer' });

  assert.match(hourly(sqlite)[0].notes, /se rompio un rack; llego tarde el chofer/);
});

test('each hour and each barn is its own row', async () => {
  const { sqlite, env, ctx } = freshDb();

  await send(env, ctx, FULL);
  await send(env, ctx, { ...FULL, hour: '10:00', racks: '11' });
  await send(env, ctx, { ...FULL, barn: 'bottom', racks: '7' });

  const rows = hourly(sqlite);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => `${r.hour_start} ${r.barn} ${r.racks}`),
    ['09:00 bottom 7', '09:00 upper 14', '10:00 upper 11']);
});

test('a missing barn is refused, and nothing is filed', async () => {
  const { sqlite, env, ctx } = freshDb();

  const html = await (await send(env, ctx, { hour: '09:00', cutters: '12' })).text();

  assert.match(html, /Pick the barn/);
  assert.equal(hourly(sqlite).length, 0);
});

test('a nonsense hour is refused rather than filed under a default', async () => {
  const { sqlite, env, ctx } = freshDb();

  const html = await (await send(env, ctx, { barn: 'upper', hour: 'lunch', cutters: '12' })).text();

  assert.match(html, /Pick the hour/);
  assert.equal(hourly(sqlite).length, 0);
});

test('the radioed cutters sit beside what the zones say, disagreement and all', async () => {
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, headcount, is_test)
    VALUES ('enter', 'R1', 'Purple Snowman', ?, 1, 3, 1)
  `).run(new Date().getUTCFullYear());
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, headcount, is_test)
    VALUES ('enter', 'Z10', 'Strawberry Cream', ?, 1, 4, 1)
  `).run(new Date().getUTCFullYear());

  const html = await (await page(env, ctx, '&barn=upper')).text();

  assert.match(html, /Open zones now/);
  assert.match(html, /<strong>R1<\/strong> Purple Snowman 3/);
  assert.match(html, /= <strong>7<\/strong> cutters by scan/,
    'the scan total is shown so a radioed 12 can be compared against it');
});

test('a closed zone is not counted as open', async () => {
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, headcount, is_test, closed_at)
    VALUES ('enter', 'R1', 'Purple Snowman', ?, 1, 3, 1, datetime('now'))
  `).run(new Date().getUTCFullYear());

  const html = await (await page(env, ctx, '&barn=upper')).text();

  assert.match(html, /No zone is open right now/);
});

test("today's log lists every hour sent, with a running stick total", async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);
  await send(env, ctx, { ...FULL, hour: '10:00', racks: '11' });

  const html = await (await page(env, ctx, '&barn=upper')).text();

  assert.match(html, /Total sticks today: <strong>25<\/strong>/);
  assert.match(html, /9-10/, 'hours read the way the crew says them');
  assert.match(html, /10-11/);
});

test('an hour already sent says so before it is overwritten', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);

  const html = await (await page(env, ctx, '&barn=upper&hour=09%3A00')).text();

  assert.match(html, /This hour was already sent at/);
  assert.match(html, /saving again updates it/);
});

test('the crew carries to the next hour, and the sticks never do', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);                       // 9-10: 12 cutters, 14 sticks

  const html = await (await page(env, ctx, '&barn=upper&hour=10%3A00')).text();

  assert.match(html, /id="cutters"[^>]*value="12"/, 'the crew is already in the boxes');
  assert.match(html, /id="hangers"[^>]*value="8"/);
  assert.match(html, /id="racks"[^>]*value=""/,
    'sticks start empty — a carried 14 would be filed as another 14 by anyone tapping through');
  assert.match(html, /Crew carried from 9-10/, 'and the page says where those numbers came from');
});

test('an hour already answered shows its own numbers, not the previous hour', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);
  await send(env, ctx, { ...FULL, hour: '10:00', cutters: '9', racks: '11' });

  const html = await (await page(env, ctx, '&barn=upper&hour=10%3A00')).text();

  assert.match(html, /id="cutters"[^>]*value="9"/);
  assert.match(html, /id="racks"[^>]*value="11"/, 'its own sticks are shown so a correction is visible');
  assert.doesNotMatch(html, /Crew carried from/);
});

test('each barn carries its own crew, never the other barn', async () => {
  const { env, ctx } = freshDb();
  await send(env, ctx, FULL);                                          // upper: 12 cutters
  await send(env, ctx, { ...FULL, barn: 'bottom', cutters: '4', hangers: '2', racks: '3' });

  const html = await (await page(env, ctx, '&barn=bottom&hour=10%3A00')).text();

  assert.match(html, /id="cutters"[^>]*value="4"/);
  assert.match(html, /id="hangers"[^>]*value="2"/);
});

test('test rows and real rows never mix', async () => {
  const { sqlite, env, ctx } = freshDb();
  await send(env, ctx, FULL);                                   // test mode
  const live = { ...env, HARVEST_TEST_MODE: 'false' };
  await send(live, ctx, { ...FULL, racks: '99' });              // live

  const rows = hourly(sqlite);
  assert.equal(rows.length, 2, 'the same barn-hour exists once per mode');
  assert.deepEqual(rows.map(r => `${r.is_test}:${r.racks}`).sort(), ['0:99', '1:14']);

  // Asserted against the log table, not the whole document: the page embeds a
  // base64 logo, and "99" occurs inside it by chance.
  const html = await (await page(env, ctx, '&barn=upper')).text();
  const log = html.slice(html.indexOf('<table class="hourly-log"'));
  assert.doesNotMatch(log, /<strong>99<\/strong>/, 'the test-mode page never shows the live row');
  assert.match(html, /Total sticks today: <strong>14<\/strong>/, 'and totals only its own');
});
