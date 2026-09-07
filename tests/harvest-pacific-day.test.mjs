/**
 * A day is a Pacific day.
 *
 * Timestamps are stored UTC, and every "today" in the harvest handler used to
 * ask SQLite for a UTC day: `date(occurred_at) = date('now')`. The barn's day
 * is not a UTC day. **5pm Pacific is already tomorrow in UTC** — 4pm once the
 * clocks go back — so:
 *
 *   - "Carga #3 hoy" reset mid-afternoon, while trailers were still arriving;
 *   - and, far worse, a supersack opened after 5pm was grouped into the NEXT
 *     day's allocation, pairing its weights with a different day's floor
 *     output. That one is silent, and the nightly replay repeats the same
 *     wrong pairing rather than correcting it.
 *
 * Harvest runs from about October into November, straight across the DST
 * change, so the offset cannot be hard-coded either: -7 is wrong for half the
 * season and -8 for the other half.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1, pacificDayRange } = await import(mod('workers/src/handlers/harvest-d1.js'));

const PW = 'test-password';
const SEASON = new Date().getUTCFullYear();

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const clean = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const st of clean.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  // The floor's own table. `strain` is the Shopify product title, which is
  // where the season comes from — a title with no year cannot be attributed.
  sqlite.exec(`CREATE TABLE supersack_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, strain TEXT, sacks_opened INTEGER,
    tops_lbs REAL, smalls_lbs REAL, biomass_lbs REAL, trim_lbs REAL, waste_lbs REAL)`);
  sqlite.exec(`INSERT INTO cultivars (id, name, sku_prefix) VALUES (1, 'Sour Lifter', 'SLIFT')`);
  sqlite.exec(`INSERT INTO cultivar_aliases (alias, cultivar_id)
               VALUES ('${SEASON} - Sour Lifter / Sungrown', 1)`);
  const DB = {
    async batch(x) { return Promise.all(x.map(s => s.run())); },
    prepare(sql) {
      return { bind(...a) {
        return {
          all: async () => ({ results: sqlite.prepare(sql).all(...a) }),
          first: async () => sqlite.prepare(sql).get(...a) ?? null,
          run: async () => { const r = sqlite.prepare(sql).run(...a);
            return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
        };
      } };
    },
  };
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: PW }, ctx: { waitUntil() {} } };
}

const call = (env, ctx, qs, init) => handleHarvestD1(
  new Request(`https://x/api/harvest?${qs}`, init), env, ctx);

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// ─── the range itself ────────────────────────────────────────────────────────

test('a summer harvest day runs 07:00 UTC to 07:00 UTC', () => {
  // PDT, UTC-7. Midnight Pacific on the 14th is 07:00 UTC the same morning.
  assert.deepEqual(pacificDayRange('2026-10-14'),
    ['2026-10-14 07:00:00', '2026-10-15 07:00:00']);
});

test('after the clocks go back the same day runs 08:00 to 08:00', () => {
  // PST, UTC-8. DST ended 1 Nov 2026, and harvest runs straight through it —
  // a hard-coded -7 would put every November day an hour out.
  assert.deepEqual(pacificDayRange('2026-11-10'),
    ['2026-11-10 08:00:00', '2026-11-11 08:00:00']);
});

test('the day the clocks change is 25 hours long, and the range says so', () => {
  // 1 Nov 2026: starts in PDT (-7), ends in PST (-8). This is the case that
  // breaks when one offset is measured and applied to both ends — the day
  // reads 24 hours and an hour of the barn's evening lands in the wrong one.
  const [start, end] = pacificDayRange('2026-11-01');
  assert.equal(start, '2026-11-01 07:00:00');
  assert.equal(end, '2026-11-02 08:00:00');
  const hours = (Date.parse(end.replace(' ', 'T') + 'Z')
               - Date.parse(start.replace(' ', 'T') + 'Z')) / 3600000;
  assert.equal(hours, 25);
});

test('the spring-forward day is 23 hours', () => {
  const [start, end] = pacificDayRange('2026-03-08');
  assert.equal(start, '2026-03-08 08:00:00');
  assert.equal(end, '2026-03-09 07:00:00');
});

test('consecutive days meet exactly, with no gap and no overlap', () => {
  // The ranges are half-open, so a sack opened at the seam belongs to exactly
  // one day. A gap would lose it; an overlap would allocate it twice.
  for (const [a, b] of [['2026-10-14', '2026-10-15'], ['2026-11-01', '2026-11-02']]) {
    assert.equal(pacificDayRange(a)[1], pacificDayRange(b)[0], `${a} → ${b}`);
  }
});

// ─── what it fixes ───────────────────────────────────────────────────────────

/** 5:30pm Pacific on a PDT day — 00:30 UTC the NEXT calendar day. */
const EVENING_PACIFIC_DAY = '2026-10-14';
const EVENING_UTC = '2026-10-15 00:30:00';

test('a sack opened after 5pm allocates to the day the floor called it', async () => {
  // THE BUG. `date(opened_at)` on this row reads 2026-10-15, so the sack was
  // grouped with the next day's floor weights — a wrong pairing that nothing
  // downstream can detect, and that the nightly replay reproduces exactly.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               opened_at, is_test)
    VALUES ('26-SL-1', ?, 1, 'Z4', 'Sour Lifter', 1, ?, 1)`).run(SEASON, EVENING_UTC);
  sqlite.prepare(`
    INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs)
    VALUES (?, ?, 1, 100, 20, 30, 10, 5)`).run(EVENING_PACIFIC_DAY, `${SEASON} - Sour Lifter / Sungrown`);

  const res = await call(env, ctx, `action=allocate&date=${EVENING_PACIFIC_DAY}`);
  const body = await res.json();
  const data = body.data ?? body;
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(data.allocated) && data.allocated.length === 1,
    `the evening sack has to be in the day the floor typed: ${JSON.stringify(data)}`);
  assert.equal(data.allocated[0].sacks, 1);

  const row = sqlite.prepare(`SELECT tops_lbs, weights_source FROM harvest_sacks`).get();
  assert.equal(row.tops_lbs, 100);
  assert.equal(row.weights_source, 'allocated');
});

test('the same sack does not also land in the next day', async () => {
  // The mirror of the test above. If the range were inclusive at both ends, or
  // still keyed on the UTC date, this day would claim it too — and the second
  // allocation would overwrite the first with another day's weights.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               opened_at, is_test)
    VALUES ('26-SL-1', ?, 1, 'Z4', 'Sour Lifter', 1, ?, 1)`).run(SEASON, EVENING_UTC);
  sqlite.prepare(`
    INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs)
    VALUES ('2026-10-15', ?, 1, 999, 1, 1, 1, 1)`).run(`${SEASON} - Sour Lifter / Sungrown`);

  const body = await (await call(env, ctx, 'action=allocate&date=2026-10-15')).json();
  const data = body.data ?? body;
  assert.equal((data.allocated || []).length, 0, 'that sack belongs to the 14th');
});

test('the load counter does not reset in the middle of the afternoon', async () => {
  // Trailers arrive into the evening. Under `date(occurred_at) = date('now')`
  // the count restarted at 1 the moment UTC rolled over, which is 5pm on the
  // barn floor — the crew reads "Carga #1 hoy" on the eighth load of the day.
  const { sqlite, env, ctx } = freshDb();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const [start] = pacificDayRange(today);
  const startMs = Date.parse(start.replace(' ', 'T') + 'Z');
  const at = (h) => new Date(startMs + h * 3600000).toISOString().replace('T', ' ').slice(0, 19);

  // Three loads spread across one Pacific day: mid-morning, and two after the
  // UTC date has already turned over.
  for (const h of [10, 17.5, 19]) {
    sqlite.prepare(`
      INSERT INTO harvest_scan_log (event_type, zone, season, bins, occurred_at, is_test)
      VALUES ('barn_load', 'Z4', ?, 20, ?, 1)`).run(SEASON, at(h));
  }

  const html = await (await call(env, ctx, 'action=barn_intake&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'zone=Z4&bins=20',
  }).catch(() => call(env, ctx, 'action=barn_intake&lang=en'))).text();
  void html;

  const res = await call(env, ctx, 'action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'zone=Z4&bins=20',
  });
  const out = await res.text();
  assert.match(out, /Load #4 today/, `the fourth load of one Pacific day: ${out.slice(0, 400)}`);
});
