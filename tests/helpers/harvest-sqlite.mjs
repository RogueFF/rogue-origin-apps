/**
 * A real SQLite database shaped like the harvest D1, for handler tests that
 * need queries to actually run (joins, datetime('now'), ORDER BY) rather than
 * be matched by pattern the way d1-mock.mjs does.
 *
 * Needs node:sqlite (Node >= 22.5). `sqliteAvailable` lets a suite skip itself
 * cleanly on an older runtime instead of failing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const modUrl = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
export const sqliteAvailable = !!DatabaseSync;

export const SEASON = new Date().getUTCFullYear();

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
  '0040-harvest-load-trailer.sql',
];

/** A fresh in-memory harvest database, and the env/ctx a handler expects. */
export function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
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

/** Run a handler with console output swallowed (the Telegram stub is chatty). */
export const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

/**
 * "Earlier today", in minutes ago, for anything whose meaning depends on the
 * Pacific calendar day (a trailer's bay is only reused on the same day). A
 * fixed 30 was yesterday whenever the suite ran just after midnight Pacific.
 * Always past the 5-minute trailer repeat window; `null` in the first few
 * minutes after midnight, when no such time exists — callers skip then.
 */
export function earlierTodayMins(ideal = 30) {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour12: false })
    .split(':').map(Number);
  const sinceMidnight = h * 60 + m;
  const mins = Math.min(ideal, sinceMidnight - 1);
  return mins >= 6 ? mins : null;
}

/** SQLite UTC text, `m` minutes ago. */
export const minsAgo = (m) =>
  new Date(Date.now() - m * 60000).toISOString().replace('T', ' ').slice(0, 19);

/** Insert a zone session directly. Returns its id. `closed` null = still open. */
export function seedSession(sqlite, { zone = 'Z4', cultivar = 'Sour Lifter', cut = 1, crew = null,
  opened = minsAgo(60), closed = null } = {}) {
  const r = sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
                                  occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(zone, cultivar, SEASON, cut, crew, opened, closed);
  return Number(r.lastInsertRowid);
}

export const sessions = (sqlite) => sqlite.prepare(
  "SELECT * FROM harvest_scan_log WHERE event_type='enter' ORDER BY id").all();
export const openSessions = (sqlite) => sessions(sqlite).filter(s => s.closed_at === null);
export const loads = (sqlite) => sqlite.prepare(
  "SELECT * FROM harvest_scan_log WHERE event_type='barn_load' ORDER BY id").all();
export const lastLoad = (sqlite) => loads(sqlite).at(-1);
