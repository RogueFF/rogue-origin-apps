/**
 * Takedown by bay (Koa, 2026-10-05). Sour Lifter from two or three zones hangs
 * in every bay and the sticks carry no zone, so the takedown picker offers one
 * card per bay, cultivar and cut, with each zone's share by bins. A bay is
 * finished as a bay; a lot closes itself once every bay holding it is down.
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
  '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql', '0043-harvest-bay-done.sql',
];

function freshDb() {
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


import { bayFills, percentShares } from '../workers/src/lib/bay-fills.js';

function seedLot(sqlite, { zone, cultivar = 'Sour Lifter', daysAgo = 10, cut = 1 }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), 1)
  `).run(zone, cultivar, SEASON, cut, `-${daysAgo} days`, `-${daysAgo - 1} days`);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}
/** A barn load into `bay`, `minutesAgo` back (default about 9 days). */
function seedLoad(sqlite, lot, bay, { minutesAgo = 9 * 1440, bins = 24 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, is_test, occurred_at)
    VALUES ('barn_load', 'Z4', ?, ?, ?, ?, 1, datetime('now', ?))
  `).run(SEASON, bins, lot, bay, `-${minutesAgo} minutes`);
}
function seedTag(sqlite, lot, bay, serial, { minutesAgo = 60 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, bay, is_test, cultivar_code, printed_at)
    VALUES (?, ?, ?, 'Z4', 'Sour Lifter', 1, ?, ?, 1, 'SLIFT', datetime('now', ?))
  `).run(`26-SLIFT-${serial}`, SEASON, serial, lot, bay, `-${minutesAgo} minutes`);
}
const fillStart = (sqlite, bay) =>
  sqlite.prepare(`SELECT MIN(occurred_at) AS t FROM harvest_scan_log WHERE event_type = 'barn_load' AND bay = ?`).get(bay).t;
const done = (sqlite, lot) =>
  sqlite.prepare('SELECT takedown_done_at AS t FROM harvest_scan_log WHERE id = ?').get(lot).t;

const picker = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());
const finishBay = (env, ctx, fields) => handleHarvestD1(
  new Request('https://x/api/harvest?action=bay_finish&lang=en', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ cultivar: 'Sour Lifter', cut: '1', ...fields }).toString(),
  }), env, ctx).then(async r => ({ status: r.status, location: r.headers.get('location'), html: await r.text() }));

/** The radio bay cards: [{bay, value, html}]. */
const bayCardsIn = (html) => [...html.matchAll(/<label class="lot baycard[^"]*">[\s\S]*?<\/label>/g)].map(m => ({
  html: m[0],
  bay: Number(m[0].match(/data-bay="(\d+)"/)[1]),
  value: Number(m[0].match(/value="(\d+)"/)[1]),
}));
const chips = (cardHtml) => [...cardHtml.matchAll(/<span class="zchip">([^<]+) <b>(\d+)%<\/b><\/span>/g)].map(m => `${m[1]} ${m[2]}%`);

test('bayFills: a load 3+ days after the bay\'s last one starts a new fill; tags do not', () => {
  const at = (day, h = 12) => new Date(Date.UTC(2026, 8, day, h)).toISOString();
  const fills = bayFills([
    { bay: 10, occurred_at: at(28), session_id: 1 }, { bay: 10, occurred_at: at(29, 20), session_id: 2 },
    { bay: 10, occurred_at: at(29, 21), session_id: 1 },   // a tag typed with bay 10 landed before this: no split
    { bay: 10, occurred_at: at(30 + 8), session_id: 3 },   // 9 days on: the bay was refilled
  ]);
  const f = fills.get(10);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].loads.map(l => l.session_id), [1, 2, 1]);
  assert.equal(f[0].closed, true);
  assert.deepEqual(f[1].loads.map(l => l.session_id), [3]);
  assert.equal(f[1].closed, false);
});

test('percentShares always adds to 100', () => {
  const p = percentShares([{ share: 1560 / 2532 }, { share: 876 / 2532 }, { share: 96 / 2532 }]);
  assert.equal(p.reduce((t, n) => t + n, 0), 100);
  assert.deepEqual(p, [62, 34, 4]);
});

test('one card per bay, zones by bin share, sacks on the biggest zone', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedLot(sqlite, { zone: 'Z2' });
  const z1 = seedLot(sqlite, { zone: 'Z1' });
  for (let i = 0; i < 3; i++) seedLoad(sqlite, z2, 9);
  seedLoad(sqlite, z1, 9);
  const cards = bayCardsIn(await picker(env, ctx));
  assert.equal(cards.length, 1, 'one card for bay 9, not one per zone');
  assert.equal(cards[0].bay, 9);
  assert.equal(cards[0].value, z2, 'tags hang off the zone with the most bins');
  assert.deepEqual(chips(cards[0].html), ['Z2 75%', 'Z1 25%']);
  assert.match(cards[0].html, /96 bins/);
});

test('a zone in two bays stays open until both bays are down; reopen brings it back', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedLot(sqlite, { zone: 'Z2' });
  const z1 = seedLot(sqlite, { zone: 'Z1' });
  seedLoad(sqlite, z2, 9); seedLoad(sqlite, z2, 9);
  seedLoad(sqlite, z2, 10); seedLoad(sqlite, z1, 10);

  // Bay 9 down: Z2 still hangs in bay 10, so it stays open.
  let r = await finishBay(env, ctx, { bay: '9', fill_start: fillStart(sqlite, 9) });
  assert.equal(r.status, 200);
  assert.equal(done(sqlite, z2), null, 'Z2 is still hanging in bay 10');
  let cards = bayCardsIn(r.html);
  assert.deepEqual(cards.map(c => c.bay), [10], 'bay 9 left the list');
  assert.match(r.html, /Bay 9 \(Sour Lifter\) marked finished/);

  // Bay 10 down: every bay holding Z2 and Z1 is down, so both lots finish.
  r = await finishBay(env, ctx, { bay: '10', fill_start: fillStart(sqlite, 10) });
  assert.ok(done(sqlite, z2), 'Z2 finished once both its bays are down');
  assert.ok(done(sqlite, z1), 'Z1 finished with bay 10');
  assert.equal(bayCardsIn(r.html).length, 0);
  assert.match(r.html, /class="batch finished"[\s\S]*Bay 10/);

  // Reopen bay 10: its lots reopen and the card comes back.
  r = await finishBay(env, ctx, { bay: '10', fill_start: fillStart(sqlite, 10), reopen: '1' });
  assert.equal(r.status, 303);
  assert.match(r.location, /lot_resume&session_id=\d+&bay=10/);
  assert.equal(done(sqlite, z2), null);
  assert.equal(done(sqlite, z1), null);
  cards = bayCardsIn(await picker(env, ctx));
  assert.deepEqual(cards.map(c => c.bay), [10]);
});

test('a bay refilled after a takedown shows only what hangs there now', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const old = seedLot(sqlite, { zone: 'Z3', daysAgo: 20 });
  const fresh = seedLot(sqlite, { zone: 'Z14', daysAgo: 8 });
  seedLoad(sqlite, old, 4, { minutesAgo: 19 * 1440 });
  seedTag(sqlite, old, 4, 1, { minutesAgo: 10 * 1440 });   // bay 4 came down
  seedLoad(sqlite, fresh, 4, { minutesAgo: 8 * 1440 });     // and was refilled 11 days on
  seedTag(sqlite, fresh, 4, 2, { minutesAgo: 8 * 1440 - 30 }); // a stray tag mid-fill splits nothing
  seedLoad(sqlite, fresh, 4, { minutesAgo: 8 * 1440 - 60 });
  const cards = bayCardsIn(await picker(env, ctx));
  const bay4 = cards.find(c => c.bay === 4);
  assert.ok(bay4);
  assert.deepEqual(chips(bay4.html), ['Z14 100%']);
});

test('the takedown screen for a bay names the bay and its mix, and finishes the bay', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedLot(sqlite, { zone: 'Z2' });
  const z11 = seedLot(sqlite, { zone: 'Z11' });
  seedLoad(sqlite, z2, 9); seedLoad(sqlite, z11, 9);
  const withBay = await handleHarvestD1(new Request(
    `https://x/api/harvest?action=sack_session&session_id=${z2}&cultivar=Sour%20Lifter&bay=9&lang=en`), env, ctx).then(r => r.text());
  assert.match(withBay, /<span class="baybig">Bay 9<\/span>/);
  assert.match(withBay, /Z2 <b>50%<\/b>[\s\S]*Z11 <b>50%<\/b>/);
  assert.match(withBay, /action=bay_finish[\s\S]*Bay 9 is down/);
  assert.ok(!/action=lot_finish&lang=en" id="finishForm"/.test(withBay), 'no per-lot Finished in bay mode');

  // Resume from a bay card keeps that bay, even when the lot's last tag came out of another.
  seedTag(sqlite, z2, 10, 1);
  const resumed = await handleHarvestD1(new Request(
    `https://x/api/harvest?action=lot_resume&session_id=${z2}&bay=9&lang=en`), env, ctx).then(r => r.text());
  assert.match(resumed, /<span class="baybig">Bay 9<\/span>/);
});

test('a lot with no loads but a bay on its own row joins that bay (McLoughlin, tables)', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'MZ1', cultivar: 'Critical Berries', daysAgo: 1 });
  sqlite.prepare('UPDATE harvest_scan_log SET bay = 1 WHERE id = ?').run(id);
  const cards = bayCardsIn(await picker(env, ctx));
  const c = cards.find(x => x.value === id);
  assert.ok(c, 'offered as a bay card');
  assert.equal(c.bay, 1);
  assert.deepEqual(chips(c.html), ['MZ1 100%']);
  assert.ok(!/ 0 bins/.test(c.html), 'no bin count for a lot that was never scanned in');
});

test('a lot with no bay on any load keeps its zone card', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'Z7' });
  const html = await picker(env, ctx);
  assert.equal(bayCardsIn(html).length, 0);
  assert.match(html, new RegExp(`<label class="lot [^"]*">\\s*<input type="radio" name="session_id" value="${id}"`));
});
