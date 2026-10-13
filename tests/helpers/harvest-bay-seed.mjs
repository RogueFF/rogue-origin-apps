/**
 * The takedown-by-bay database: the harvest D1 through migration 0043 (bay
 * done), plus seeders for lots, barn loads and tags. Shared by the bay
 * takedown and lot_add suites.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql', '0043-harvest-bay-done.sql',
];

export function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name, sku_prefix) VALUES (1, 'Sour Lifter', 'SLIFT')");
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' }, ctx: { waitUntil() {} } };
}

/** A zone session, dry and ready. Two with the same zone, cultivar and cut are one lot. */
export function seedLot(sqlite, { zone, cultivar = 'Sour Lifter', daysAgo = 10, cut = 1 }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 1)
  `).run(zone, cultivar, SEASON, cut, `-${daysAgo} days`, `-${daysAgo - 1} days`);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}
/** A barn load into `bay`, `minutesAgo` back (default about 9 days). */
export function seedLoad(sqlite, lot, bay, { minutesAgo = 9 * 1440, bins = 24 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, is_test, occurred_at)
    VALUES ('barn_load', 'Z4', ?, ?, ?, ?, 1, datetime('now', ?))
  `).run(SEASON, bins, lot, bay, `-${minutesAgo} minutes`);
}
export function seedTag(sqlite, lot, bay, serial, { minutesAgo = 60 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, bay, is_test, cultivar_code, printed_at)
    VALUES (?, ?, ?, 'Z4', 'Sour Lifter', 1, ?, ?, 1, 'SLIFT', datetime('now', ?))
  `).run(`26-SLIFT-${serial}`, SEASON, serial, lot, bay, `-${minutesAgo} minutes`);
}
