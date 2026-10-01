/**
 * The "What's coming" pipeline page.
 *
 * Koa, 2026-10-01: "so Nathan and Inaiah can see what cultivars are in the
 * pipeline, with expected dates on when they will be ready" — then: "we want to
 * take the whole bay down at once. Please don't mark it as bagging until we
 * initiate. also, only need to list a cultivar once, not by zone ... if they
 * are [in supersacks], they don't need to be listed in the pipeline again."
 *
 * What this suite holds:
 *
 * 1. ONE CARD PER CULTIVAR, across zones and cut days.
 * 2. A CULTIVAR WITH A SACK IS ONLY UNDER SUPERSACKS. A voided tag is not a sack.
 * 3. DRY IS NOT BAGGING. A lot the takedown picker calls READY, with no tag,
 *    is still Coming with a date — never "ready" or "bagging".
 * 4. THE DATE IS THE BAY'S. Everything in a bay shares the date of its newest
 *    load from an open lot + 10 days — including a load of a cultivar that is
 *    already bagged, because it hangs there and comes down with the bay.
 * 5. NO BAY RECORDED -> the lot's own cut day + 10 days.
 * 6. A BAGGED CULTIVAR STILL HANGING SAYS SO on its supersack card ("More
 *    drying"), with the same bay dates. Koa: Sour Lifter's 2 sacks were a
 *    small test lot while the crop is still on the racks.
 * 7. NO WEIGHTS. The page is public.
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

const SEASON = new Date().getUTCFullYear();

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
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

// Days are Pacific, as the page reads them: after 5pm PDT the UTC date is
// already tomorrow, and a UTC-dated seed would shift every "in N days" by one.
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const dayPlus = (n) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d; };
const isoDay = (n) => dayPlus(n).toISOString().slice(0, 10);
const fmt = (n) => dayPlus(n).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Cut at 19:00 UTC (noon Pacific), so the Pacific cut day is the seeded day.
function seedLot(sqlite, { zone, cultivar, cut = 1, daysAgo, finished = false }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, takedown_done_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, ? || ' 19:00:00', ? || ' 22:00:00', ?, 1)
  `).run(zone, cultivar, SEASON, cut, isoDay(-daysAgo), isoDay(-daysAgo), finished ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

// 20:00 UTC is 1pm Pacific, the same Pacific day as the seeded date.
function seedLoad(sqlite, sessionId, { bay, daysAgo, zone = 'Z1' }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, occurred_at, bins, attributed_zone_session_id, bay, is_test)
    VALUES ('barn_load', ?, ?, ? || ' 20:00:00', 24, ?, ?, 1)
  `).run(zone, SEASON, isoDay(-daysAgo), sessionId, bay);
}

let serial = 0;
function seedSack(sqlite, sessionId, cultivar, { voided = false } = {}) {
  serial++;
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, zone, zone_session_id, cultivar, season, serial, printed_at, voided_at, is_test)
    VALUES (?, 'R1', ?, ?, ?, ?, datetime('now'), ?, 1)
  `).run(`26-TEST-${serial}`, sessionId, cultivar, SEASON, serial, voided ? new Date().toISOString() : null);
}

const page = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=pipeline&lang=${lang}`), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));

/** Each section's cards, keyed by the section title. */
function sections(html) {
  return Object.fromEntries([...html.matchAll(/<section class="plane"[^>]*>([\s\S]*?)<\/section>/g)].map(([, s]) => [
    s.match(/<h2>([^<]*)<\/h2>/)[1],
    [...s.matchAll(/<article class="pcard"><h3>([^<]*)<\/h3><p class="pwhen"><strong>([^<]*)<\/strong> <span>([^<]*)<\/span><\/p>(?:<p class="pwhere">([^<]*)<\/p>)?(?:<p class="pmore">([^<]*)<\/p>)?/g)]
      .map(m => ({ cultivar: m[1], when: m[2], detail: m[3], where: m[4] ?? '', more: m[5] ?? '' })),
  ]));
}

let html, secs;
const coming = (cv) => secs['Coming'].find(c => c.cultivar === cv);

before(async () => {
  if (!DatabaseSync) return;
  const { sqlite, env, ctx } = freshDb();
  // Sour Lifter across three zones and two cut days, all in bay 9. The newest
  // load into bay 9 is 2 days ago, so the bay is due in 8 days.
  const sl1 = seedLot(sqlite, { zone: 'Z1', cultivar: 'Sour Lifter', daysAgo: 4 });
  const sl2 = seedLot(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter', daysAgo: 4 });
  const sl3 = seedLot(sqlite, { zone: 'Z11', cultivar: 'Sour Lifter', daysAgo: 3 });
  seedLoad(sqlite, sl1, { bay: 9, daysAgo: 4 });
  seedLoad(sqlite, sl2, { bay: 9, daysAgo: 3 });
  seedLoad(sqlite, sl3, { bay: 9, daysAgo: 2 });
  // Strawberry Doughnuts: cut 8 days ago (the picker's READY), no tag. It hangs
  // in bay 10, whose newest load (1 day ago) is a bagged cultivar's leftover.
  const sd = seedLot(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', daysAgo: 8 });
  seedLoad(sqlite, sd, { bay: 10, daysAgo: 8 });
  const opqDone = seedLot(sqlite, { zone: 'Z8', cultivar: 'Orange Pineapple Quik', daysAgo: 15, finished: true });
  for (let i = 0; i < 3; i++) seedSack(sqlite, opqDone, 'Orange Pineapple Quik');
  const opqLeft = seedLot(sqlite, { zone: 'Z8', cultivar: 'Orange Pineapple Quik', cut: 2, daysAgo: 1 });
  seedLoad(sqlite, opqLeft, { bay: 10, daysAgo: 1, zone: 'Z8' });
  // Lifter: no bay recorded.
  seedLot(sqlite, { zone: 'Z21', cultivar: 'Lifter', daysAgo: 3 });
  // Purple Snowman: still an open lot, but tagged (spelled two ways) -> supersacks only.
  const ps = seedLot(sqlite, { zone: 'R1', cultivar: 'Purple Snowman', daysAgo: 9 });
  seedSack(sqlite, ps, 'Purple Snowman');
  seedSack(sqlite, ps, ' purple snowman ');
  // Spruce Dough: its only tag was voided -> still Coming.
  const sp = seedLot(sqlite, { zone: 'Z10', cultivar: 'Spruce Dough', daysAgo: 3 });
  seedSack(sqlite, sp, 'Spruce Dough', { voided: true });

  const r = await page(env, ctx);
  assert.equal(r.status, 200);
  // The shared page chrome has its own CSS and scripts; the page is the .pipe block.
  html = r.html.slice(r.html.indexOf('<div class="pipe">'));
  secs = sections(html);
});

test('one card per cultivar, across zones and cut days', { skip: !DatabaseSync }, () => {
  const all = [...secs['Coming'], ...secs['Already in supersacks']].map(c => c.cultivar.toLowerCase());
  assert.equal(all.length, new Set(all).size);
  assert.equal(coming('Sour Lifter').where, 'Bay 9');
});

test('a cultivar with a sack is only under supersacks; a voided tag is not a sack', { skip: !DatabaseSync }, () => {
  assert.deepEqual(secs['Coming'].map(c => c.cultivar).sort(),
    ['Lifter', 'Sour Lifter', 'Spruce Dough', 'Strawberry Doughnuts']);
  assert.deepEqual(secs['Already in supersacks'].map(c => [c.cultivar, c.when]),
    [['Orange Pineapple Quik', '3'], ['Purple Snowman', '2']]);
});

test('dry is not bagging: a picker-READY lot with no tag is still Coming with a date', { skip: !DatabaseSync }, () => {
  assert.doesNotMatch(html, /\bbagging\b|\bready\b/i);
  assert.match(coming('Strawberry Doughnuts').when, /^~/);
});

test("the date is the bay's: newest open-lot load + 10, bagged leftovers included", { skip: !DatabaseSync }, () => {
  assert.equal(coming('Sour Lifter').when, `~${fmt(8)}`);
  assert.equal(coming('Sour Lifter').detail, 'in 8 days');
  // Bay 10's newest load is the OPQ leftover from a day ago, not SD's own load.
  assert.equal(coming('Strawberry Doughnuts').when, `~${fmt(9)}`);
  assert.equal(coming('Strawberry Doughnuts').where, 'Bay 10');
});

test('no bay recorded falls back to the cut day + 10', { skip: !DatabaseSync }, () => {
  assert.equal(coming('Lifter').when, `~${fmt(7)}`);
  assert.equal(coming('Lifter').where, 'bay not recorded');
});

test('a bagged cultivar still hanging says so on its supersack card', { skip: !DatabaseSync }, () => {
  const bag = (cv) => secs['Already in supersacks'].find(c => c.cultivar === cv);
  assert.equal(bag('Orange Pineapple Quik').more, `More drying ~${fmt(9)} · Bay 10`);
  assert.equal(bag('Purple Snowman').more, `More drying ~${fmt(1)} · bay not recorded`);
});

test('no weights on a public page', { skip: !DatabaseSync }, () => {
  assert.doesNotMatch(html, /\blbs?\b|pounds|\btops\b|\$\d/i);
});

test('Spanish renders both sections', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter', daysAgo: 1 });
  const { html: es } = await page(env, ctx, 'es');
  assert.match(es, /Por venir/);
  assert.match(es, /Ya en supersacos/);
  assert.match(es, /en 9 días/);
});
