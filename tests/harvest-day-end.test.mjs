/**
 * The end-of-day close.
 *
 * The crew does not leave the last zone of the day — they stop, and pick up in
 * that same zone next morning. Nothing closed that session, so open-to-close
 * contained a night and the ledger withheld cutter-hours for it.
 *
 * The rule is right; the arithmetic makes it fatal. A zone is ~1 acre, ~1,936
 * plants, ~88 trailers — a day and a half to two days of cutting. So NEARLY
 * EVERY LOT spans a night, nearly every lot reports nothing, and the crew rate
 * the dashboard is built around reads empty for the whole season: honest, and
 * indistinguishable from broken.
 *
 * One scan fixes it, and this suite holds the two things that make the scan
 * safe to hand a crew lead: it closes THEIR crew's zone and nobody else's, and
 * scanning it when nothing is open is a person being careful, not a fault.
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

const { handleDayEndScan } = await import(mod('workers/src/handlers/harvest-d1.js'));
const worker = (await import(mod('workers/src/index.js'))).default;

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

const hoursAgo = (h) =>
  new Date(Date.now() - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);

const openSession = (sqlite, o) => {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
                                  occurred_at, headcount, is_test)
    VALUES ('enter', ?, ?, ?, 1, ?, ?, ?, 1)
  `).run(o.zone, o.cultivar || 'Sour Lifter', SEASON, o.crew ?? null,
         o.opened ?? hoursAgo(5), o.headcount ?? 6);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
};

/** Scan /fin with a crew cookie, the way the lead's phone carries it. */
const scanFin = (env, ctx, crew, lang = 'en') => handleDayEndScan(
  new Request(`https://x/fin?lang=${lang}`,
    crew ? { headers: { cookie: `rf_crew=${crew}` } } : undefined), env, ctx);

const closedAt = (sqlite, id) =>
  sqlite.prepare('SELECT closed_at FROM harvest_scan_log WHERE id = ?').get(id).closed_at;

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('it closes the scanning crew open zone', async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = openSession(sqlite, { zone: 'Z4', crew: 'A' });

  const html = await (await scanFin(env, ctx, 'A')).text();
  assert.ok(closedAt(sqlite, id), 'the session has to actually close');
  assert.match(html, /Closed Z4/);
  assert.match(html, /After 5\.0 hours/, 'and say how long, so a wrong scan is visible');
});

test('it closes only that crew, never the other one', async () => {
  // THE REASON THIS IS SCOPED. Two crews cut at once. A card that closed
  // whatever was open would end crew B's day the moment crew A finished, and
  // B's next trailer would arrive with no session to attach to — which drops
  // those bins off the lot entirely.
  const { sqlite, env, ctx } = freshDb();
  const a = openSession(sqlite, { zone: 'Z4', crew: 'A' });
  const b = openSession(sqlite, { zone: 'Z7', crew: 'B' });

  await scanFin(env, ctx, 'A');
  assert.ok(closedAt(sqlite, a));
  assert.equal(closedAt(sqlite, b), null, 'crew B is still cutting');
});

test('it says when someone else is still open', async () => {
  // The person holding this card is the one who can walk over and tell them.
  const { sqlite, env, ctx } = freshDb();
  openSession(sqlite, { zone: 'Z4', crew: 'A' });
  openSession(sqlite, { zone: 'Z7', crew: 'B' });

  const html = await (await scanFin(env, ctx, 'A')).text();
  assert.match(html, /Z7[\s\S]*still open/);
});

test('an untagged phone closes the untagged zone, not a tagged crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  const tagged = openSession(sqlite, { zone: 'Z4', crew: 'A' });
  const untagged = openSession(sqlite, { zone: 'Z9', crew: null });

  await scanFin(env, ctx, null);
  assert.ok(closedAt(sqlite, untagged));
  assert.equal(closedAt(sqlite, tagged), null);
});

test('scanning twice is fine and says so plainly', async () => {
  // Scanning again, or scanning after the crew already moved on, is a person
  // being careful. It must not read as a fault.
  const { sqlite, env, ctx } = freshDb();
  const id = openSession(sqlite, { zone: 'Z4', crew: 'A' });

  await scanFin(env, ctx, 'A');
  const first = closedAt(sqlite, id);

  const res = await scanFin(env, ctx, 'A');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Nothing was open/);
  assert.equal(closedAt(sqlite, id), first, 'and it does not move the close time');
});

test('it never re-closes a session that already ended', async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = openSession(sqlite, { zone: 'Z4', crew: 'A', opened: hoursAgo(30) });
  sqlite.prepare('UPDATE harvest_scan_log SET closed_at = ? WHERE id = ?').run(hoursAgo(20), id);

  await scanFin(env, ctx, 'A');
  assert.equal(closedAt(sqlite, id), hoursAgo(20));
});

test('the crew reads it in Spanish', async () => {
  const { sqlite, env, ctx } = freshDb();
  openSession(sqlite, { zone: 'Z4', crew: 'A' });
  const html = await (await scanFin(env, ctx, 'A', 'es')).text();
  assert.match(html, /Se cerró/);
  assert.match(html, /Mañana vuelve a escanear/);
});

test('fin answers through the worker, the way a scanned QR reaches it', async () => {
  // The 2026-09-04 lesson: every test called the API directly, which is the one
  // path where the routing bug could not exist.
  const { sqlite, env, ctx } = freshDb();
  const id = openSession(sqlite, { zone: 'Z4', crew: 'A' });
  const res = await worker.fetch(
    new Request('https://x/fin?lang=en', { headers: { cookie: 'rf_crew=A' } }), env, ctx);
  assert.equal(res.status, 200);
  assert.ok(closedAt(sqlite, id));
});
