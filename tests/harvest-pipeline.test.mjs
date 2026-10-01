/**
 * The "What's coming" pipeline page.
 *
 * Koa, 2026-10-01: "so Nathan and Inaiah can see what cultivars are in the
 * pipeline, with expected dates on when they will be ready".
 *
 * What this suite holds:
 *
 * 1. ONE CARD PER CULTIVAR + CUT DAY. Zones of the same cultivar cut the same
 *    day are one thing coming, listed together.
 * 2. THE TAKEDOWN PICKER'S OWN BADGE PICKS THE LANE. Too green -> Still drying,
 *    ready -> Dry, next up, tags printed -> Bagging now. The two screens can
 *    never disagree about what is dry.
 * 3. A FINISHED LOT IS GONE. It is no longer in the pipeline.
 * 4. THE EXPECTED DATE IS THE CUT DAY PLUS THE TYPICAL DRY CYCLE (10 days).
 * 5. NO WEIGHTS. The page is public; it shows cultivar, zone and dates only.
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

// Cut at 19:00 UTC (noon Pacific), so the Pacific cut day is the seeded day.
function seedLot(sqlite, { zone, cultivar, cut = 1, daysAgo, finished = false }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, takedown_done_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, ? || ' 19:00:00', ? || ' 22:00:00', ?, 1)
  `).run(zone, cultivar, SEASON, cut, isoDay(-daysAgo), isoDay(-daysAgo), finished ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function seedSack(sqlite, sessionId, cultivar, serial) {
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, zone, zone_session_id, cultivar, season, serial, printed_at, is_test)
    VALUES (?, 'R1', ?, ?, ?, ?, datetime('now'), 1)
  `).run(`26-TEST-${serial}`, sessionId, cultivar, SEASON, serial);
}

const page = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=pipeline&lang=${lang}`), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));

/** Each lane's cards, as { title, cards: [{ cultivar, where, when }] }. */
function lanes(html) {
  return [...html.matchAll(/<section class="plane"[^>]*>([\s\S]*?)<\/section>/g)].map(([, s]) => ({
    title: s.match(/<h2>([^<]*)<\/h2>/)[1],
    cards: [...s.matchAll(/<article class="pcard"><h3>([^<]*)<\/h3><p class="pwhen"><strong>([^<]*)<\/strong> <span>([^<]*)<\/span><\/p><p class="pwhere">([^<]*)<\/p>/g)]
      .map(m => ({ cultivar: m[1], when: m[2], detail: m[3], where: m[4] })),
  }));
}

const fmt = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

let html;
before(async () => {
  if (!DatabaseSync) return;
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter', daysAgo: 3 });
  seedLot(sqlite, { zone: 'Z11', cultivar: 'Sour Lifter', daysAgo: 3 });
  seedLot(sqlite, { zone: 'Z1', cultivar: 'Sour Lifter', daysAgo: 3 });
  seedLot(sqlite, { zone: 'Z21', cultivar: 'Lifter', daysAgo: 3 });
  seedLot(sqlite, { zone: 'Z8', cultivar: 'Rainbow Cake', daysAgo: 8 });
  const started = seedLot(sqlite, { zone: 'R1', cultivar: 'Purple Snowman', cut: 2, daysAgo: 9 });
  seedSack(sqlite, started, 'Purple Snowman', 1);
  seedSack(sqlite, started, 'Purple Snowman', 2);
  seedLot(sqlite, { zone: 'Z10', cultivar: 'Strawberry Cream', daysAgo: 12, finished: true });
  const r = await page(env, ctx);
  assert.equal(r.status, 200);
  html = r.html;
});

test('zones of one cultivar cut the same day are one card', { skip: !DatabaseSync }, () => {
  const drying = lanes(html).find(l => l.title === 'Still drying');
  const sl = drying.cards.filter(c => c.cultivar === 'Sour Lifter');
  assert.equal(sl.length, 1);
  assert.match(sl[0].where, /^Z1, Z2, Z11 · cut 1 · /);
  assert.deepEqual(drying.cards.map(c => c.cultivar).sort(), ['Lifter', 'Sour Lifter']);
});

test("the lane is the takedown picker's own badge", { skip: !DatabaseSync }, () => {
  const by = Object.fromEntries(lanes(html).map(l => [l.title, l.cards.map(c => c.cultivar)]));
  assert.deepEqual(by['Bagging now'], ['Purple Snowman']);
  assert.deepEqual(by['Dry — next up'], ['Rainbow Cake']);
  assert.deepEqual(by['Still drying'].sort(), ['Lifter', 'Sour Lifter']);
});

test('a finished lot is no longer in the pipeline', { skip: !DatabaseSync }, () => {
  assert.doesNotMatch(html, /Strawberry Cream/);
});

test('expected date is the cut day plus 10 days', { skip: !DatabaseSync }, () => {
  const sl = lanes(html).find(l => l.title === 'Still drying').cards.find(c => c.cultivar === 'Sour Lifter');
  assert.equal(sl.when, `~${fmt(dayPlus(7))}`);
  assert.equal(sl.detail, 'in 7 days');
  const bagging = lanes(html).find(l => l.title === 'Bagging now').cards[0];
  assert.equal(bagging.detail, '2 sacks so far');
});

test('no weights on a public page', { skip: !DatabaseSync }, () => {
  // The shared page chrome mentions lbs in its CSS and scripts; the page is the .pipe block.
  const body = html.slice(html.indexOf('<div class="pipe">'));
  assert.ok(body.includes('Purple Snowman'));
  assert.doesNotMatch(body, /\blbs?\b|pounds|\btops\b|\$\d/i);
});

test('Spanish renders the same lanes', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter', daysAgo: 1 });
  const { html: es } = await page(env, ctx, 'es');
  assert.equal(lanes(es).length, 3);
  assert.match(es, /Todavía secando/);
  assert.match(es, /mañana|en 9 días/);
});
