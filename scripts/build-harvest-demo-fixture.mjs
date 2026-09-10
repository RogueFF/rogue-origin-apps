/**
 * Build the dashboard's worked-example fixture.
 *
 * The dashboard has to be legible before a single plant is cut, so it ships a
 * worked example. That example is NOT hand-written JSON: it is produced by
 * seeding an in-memory database with a plausible week and then calling the REAL
 * `?action=harvest_metrics` endpoint over it. Hand-authored fixtures drift from
 * the endpoint they pretend to come from; one the endpoint produced cannot.
 *
 * Nothing here touches production. The seed lives and dies inside this process.
 *
 *   node scripts/build-harvest-demo-fixture.mjs
 *
 * Rerun it whenever the metrics shape changes, and commit the result.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleHarvestD1 } = await import(url('workers/src/handlers/harvest-d1.js'));

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
];

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
const PW = 'fixture-password';
const env = { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: PW };
const ctx = { waitUntil() {} };

// ── a plausible fortnight ──────────────────────────────────────────────────
// Anchored to a fixed date so the fixture is reproducible: rebuilding it on a
// different day must not produce a different file for no reason.
const SEASON = 2026;
// Set in the recent past on purpose: `oldest_waiting_days` is measured against
// the clock, so a fortnight dated in the future produced a NEGATIVE "oldest
// sealed sack" — the one field here that is not frozen by the anchor.
const DAY0 = Date.UTC(2026, 7, 3);                     // Mon 3 Aug 2026
const at = (day, hUtc, m = 0) =>
  new Date(DAY0 + day * 86400000 + hUtc * 3600000 + m * 60000)
    .toISOString().replace('T', ' ').slice(0, 19);

const insSession = (zone, cultivar, cut, crew, opened, closed, headcount) => {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
                                  occurred_at, closed_at, headcount, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(zone, cultivar, SEASON, cut, crew, opened, closed, headcount);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
};
const insLoad = (zone, bins, crew, when, sessionId, bay) => sqlite.prepare(`
  INSERT INTO harvest_scan_log (event_type, zone, season, bins, crew, occurred_at,
                                attributed_zone_session_id, bay, is_test)
  VALUES ('barn_load', ?, ?, ?, ?, ?, ?, ?, 1)
`).run(zone, SEASON, bins, crew, when, sessionId, bay ?? null);

let serial = 0;
const insSack = (zone, cultivar, cut, sessionId, bay, printedAt, openedAt, storage = null) => {
  serial += 1;
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               zone_session_id, bay, printed_at, opened_at, storage, stored_at, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(`26-SL-${serial}`, SEASON, serial, zone, cultivar, cut, sessionId, bay, printedAt, openedAt || null,
         storage, storage ? printedAt : null);
};

/** One zone worked for a stretch, with trailers arriving at a believable pace. */
function cutZone({ zone, cultivar, crew, day, startH, hours, cutters, loads, gapMin, binsEach,
                  overnight, bay }) {
  const opened = at(day, startH);
  const closed = overnight ? at(day + 1, 15) : at(day, startH + hours);
  const id = insSession(zone, cultivar, 1, crew, opened, closed, cutters);
  for (let i = 0; i < loads; i++) {
    // A little jitter so the histogram is not a single spike.
    const jitter = [0, 6, -4, 11, -7, 3, 9][i % 7];
    insLoad(zone, binsEach[i % binsEach.length], crew,
      at(day, startH, 40 + i * gapMin + jitter), id, bay);
  }
  return id;
}

// Crew A works the low zones, crew B the high ones — each delivering to its own
// barn door. Two sessions deliberately run overnight, the way the last zone of
// a day always does, so the dashboard's exclusion note has something to report.
const s = [];
s.push(cutZone({ bay: 1, zone: 'Z1', cultivar: 'Sour Lifter', crew: 'A', day: 0, startH: 15, hours: 4, cutters: 6, loads: 5, gapMin: 46, binsEach: [22, 20, 24, 21, 18] }));
s.push(cutZone({ bay: 9, zone: 'Z9', cultivar: 'Sour Lifter', crew: 'B', day: 0, startH: 15, hours: 3, cutters: 5, loads: 4, gapMin: 52, binsEach: [19, 22, 20, 17] }));
s.push(cutZone({ bay: 2, zone: 'Z2', cultivar: 'Sour Lifter', crew: 'A', day: 1, startH: 15, hours: 5, cutters: 7, loads: 6, gapMin: 41, binsEach: [23, 24, 22, 25, 21, 19] }));
s.push(cutZone({ bay: 9, zone: 'Z11', cultivar: 'Sour Lifter', crew: 'B', day: 1, startH: 15, hours: 4, cutters: 5, loads: 4, gapMin: 58, binsEach: [18, 20, 19, 16], overnight: true }));
s.push(cutZone({ bay: 3, zone: 'Z3', cultivar: 'Sour Lifter', crew: 'A', day: 2, startH: 16, hours: 4, cutters: 6, loads: 5, gapMin: 44, binsEach: [21, 23, 20, 22, 17] }));
s.push(cutZone({ bay: 10, zone: 'Z12', cultivar: 'Sour Lifter', crew: 'B', day: 2, startH: 16, hours: 3, cutters: 6, loads: 4, gapMin: 49, binsEach: [20, 21, 18, 19], overnight: true }));
s.push(cutZone({ bay: 4, zone: 'Z19', cultivar: 'Lifter', crew: 'A', day: 3, startH: 15, hours: 5, cutters: 8, loads: 6, gapMin: 38, binsEach: [24, 26, 23, 25, 22, 20] }));
s.push(cutZone({ bay: 5, zone: 'Z20', cultivar: 'Lifter', crew: 'B', day: 3, startH: 15, hours: 4, cutters: 5, loads: 4, gapMin: 55, binsEach: [19, 21, 18, 20] }));
// Still hanging — nothing tagged out of these yet, so the rack board has a live
// bay to draw rather than a barn of finished ones.
s.push(cutZone({ bay: 6, zone: 'Z13', cultivar: 'Lifter', crew: 'A', day: 26, startH: 15, hours: 4, cutters: 6, loads: 5, gapMin: 47, binsEach: [21, 19, 23, 20, 18] }));
s.push(cutZone({ bay: 1, zone: 'Z21', cultivar: 'Sour Lifter', crew: 'B', day: 33, startH: 16, hours: 3, cutters: 5, loads: 4, gapMin: 51, binsEach: [20, 22, 19, 21] }));

// One trailer that arrived with nothing open — the failure the barn screen warns
// about, kept in the example so the alarm tile is not a surprise the first time.
insLoad('Z3', 17, 'A', at(4, 23, 30), null);

// Takedowns. The window is 6–21 days, so the example deliberately covers all
// three verdicts the takedown picker can give — otherwise the chart's own
// warning bands would never have a bar in them and the first real green or
// overdue lot would be the first time anyone saw what one looks like.
// `store` is where the sacks went. Chosen so the board draws every storage
// shape: the Supermarket, a bay holding ONLY sacks (7, 12), a bay hanging a
// fresh fill that also holds sacks (6), and one lot with nothing recorded.
const takedowns = [
  { i: 0, zone: 'Z1',  cv: 'Sour Lifter', bay: 1,  day: 10, n: 6, opened: 3, store: 'Supermarket' },  // 10.8 d
  { i: 1, zone: 'Z9',  cv: 'Sour Lifter', bay: 9,  day: 10, n: 5, opened: 2, store: '12' },           // 10.8 d
  { i: 2, zone: 'Z2',  cv: 'Sour Lifter', bay: 2,  day: 12, n: 7, opened: 2, store: 'Supermarket' },  // 11.8 d
  { i: 3, zone: 'Z11', cv: 'Sour Lifter', bay: 9,  day: 12, n: 5, opened: 0, store: '7' },            // 11.8 d
  { i: 4, zone: 'Z3',  cv: 'Sour Lifter', bay: 3,  day: 7,  n: 4, opened: 0, store: null },           //  5.8 d — too green
  { i: 5, zone: 'Z12', cv: 'Sour Lifter', bay: 10, day: 25, n: 6, opened: 1, store: '6' },            // 23.8 d — overdue
  { i: 6, zone: 'Z19', cv: 'Lifter',      bay: 4,  day: 13, n: 8, opened: 1, store: 'Supermarket' },  // 10.8 d
];
for (const t of takedowns) {
  for (let k = 0; k < t.n; k++) {
    insSack(t.zone, t.cv, 1, s[t.i], t.bay,
      at(t.day, 18, k * 9),
      k < t.opened ? at(t.day + 9 + k * 4, 19, 20) : null,
      t.store);
  }
}

// ── run the real endpoint ──────────────────────────────────────────────────
const res = await handleHarvestD1(
  new Request(`https://x/api/harvest?action=harvest_metrics&season=${SEASON}`,
    { headers: { authorization: PW } }), env, ctx);
if (res.status !== 200) {
  console.error(`endpoint returned ${res.status}`, await res.text());
  process.exit(1);
}
const body = await res.json();
const data = body.data ?? body;

// The example must never be mistakable for the farm's own figures.
data.is_demo = true;
data.generated_at = '2026-10-22T18:00:00.000Z';

const out = join(REPO, 'workers/src/lib/harvest-demo-fixture.js');
writeFileSync(out, `/**
 * Worked example for the harvest dashboard — GENERATED, do not hand-edit.
 *
 * Produced by scripts/build-harvest-demo-fixture.mjs, which seeds an in-memory
 * database with a plausible fortnight and calls the real ?action=harvest_metrics
 * over it. That is the point: a hand-written fixture drifts from the endpoint it
 * claims to come from, and the dashboard would then demonstrate a shape the
 * season never produces.
 *
 * These are invented figures. The page labels them as such wherever it draws
 * them, and nothing here has ever been in the production database.
 */
export const DEMO_METRICS = ${JSON.stringify(data, null, 0)};
`, 'utf8');

console.log(`wrote ${out}`);
console.log(`  ${data.counts.lots} lots · ${data.counts.loads} loads · ${data.counts.bins} bins · `
  + `${data.counts.sacks} sacks (${data.counts.sacks_opened} opened) · ${data.feed_total} events`);
console.log(`  dry days: ${data.dry_days.map(d => d.days).join(', ')}`);
console.log(`  overnight sessions excluded from dwell: ${data.dwell_excluded_overnight}`);
console.log(`  loads with no lot: ${data.counts.loads_unattributed}`);
