/**
 * Where a supersack dried, and where it is stored.
 *
 * Koa, 2026-09-10: "can we add what bay it was hung/dried in, and what bay it's
 * stored in" — storage being "the same bays 1-12 along with a supermarket down
 * below (can be called Supermarket)".
 *
 * The drying bay was already recorded, and already on the scan page — as a
 * hint on the journey, where Koa could not tell it was there. Storage was
 * recorded nowhere. This suite holds the four things that make a location
 * honest rather than merely present:
 *
 * 1. ONE SPELLING PER PLACE. Storage arrives from phone keyboards and JSON
 *    clients; "supermarket" and "Supermarket" must never become two buckets,
 *    and a bay is bare digits.
 * 2. REFUSED, NEVER COERCED — and before a serial is spent, like the bay.
 * 3. AN OPENED OR VOIDED SACK IS NOT IN STORAGE. Hiding the form is not the
 *    guard; the server refuses.
 * 4. HANG BAYS COME FROM THE WHOLE LOT. Sacks hang off the lot's primary
 *    session, but a trailer is attributed to whichever session was open — a
 *    crew that leaves and comes back is a second session of the same lot.
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

const { handleHarvestD1, handleSackScan } = await import(
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
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
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

/** A zone session. Two with the same zone, cultivar and cut are one lot. */
function seedSession(sqlite, { zone = 'Z4', cultivar = 'Sour Lifter', cut = 1 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, datetime('now','-12 days'), datetime('now','-11 days'), 1)
  `).run(zone, cultivar, SEASON, cut);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** A trailer hung into a bay at the barn door, attributed to a session. */
function seedLoad(sqlite, session, bay) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 22, ?, ?, datetime('now','-12 days'), 1)
  `).run(SEASON, session, bay);
}

const alloc = (env, ctx, body) => handleHarvestD1(
  new Request('https://x/api/harvest?action=sack_alloc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx).then(async r => ({ status: r.status, body: await r.json() }));

const form = (env, ctx, action, fields, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}&lang=${lang}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));

const pickerHtml = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());

const scan = (env, ctx, id, lang = 'en') => handleSackScan(
  new Request(`https://x/s/${id}?lang=${lang}`), env, ctx).then(r => r.text());

const locationPanel = (html) => {
  const m = html.match(/<section class="sd-panel sd-location"[\s\S]*?<\/section>/);
  assert.ok(m, 'the scan page has a Location panel');
  return m[0];
};

const sacks = (sqlite) => sqlite.prepare('SELECT * FROM harvest_sacks ORDER BY serial').all();

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// ─── capture at takedown ─────────────────────────────────────────────────────

test('every spelling of the Supermarket is stored one way, and a bay is bare digits', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  for (const s of ['Supermarket', 'supermarket', ' SUPERMARKET ', 4, '04']) {
    const r = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: s });
    assert.equal(r.body.success, true, `storage ${JSON.stringify(s)}`);
  }
  assert.deepEqual(sacks(sqlite).map(s => s.storage),
    ['Supermarket', 'Supermarket', 'Supermarket', '4', '4']);
});

test('a storage that is not a bay or the Supermarket is refused before a serial is spent', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  for (const bad of ['barn', 'Super market', 0, 13, '4.5', -1]) {
    await assert.rejects(
      () => alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: bad }),
      /Storage must be a bay from 1 to 12, or the Supermarket/, `storage ${JSON.stringify(bad)} should be refused`);
  }
  // A burnt serial cannot be reclaimed, so the refusal has to come first.
  assert.equal(sacks(sqlite).length, 0);
});

test('no storage is null and stamps nothing; a storage stamps when', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9 });
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  const [a, b] = sacks(sqlite);
  assert.equal(a.storage, null);
  assert.equal(a.stored_at, null);
  assert.equal(b.storage, 'Supermarket');
  assert.match(b.stored_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('the takedown picker asks where the sacks go, and remembers the last answer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  const storageSelect = (html) => {
    const m = html.match(/<select id="storage"[\s\S]*?<\/select>/);
    assert.ok(m, 'the picker has a storage select');
    return m[0];
  };

  let sel = storageSelect(await pickerHtml(env, ctx));
  // Nothing to carry over: "Not yet", never a guessed place.
  assert.match(sel, /<option value="" selected>Not yet</);
  assert.match(sel, /<option value="Supermarket">Supermarket</);
  assert.equal((sel.match(/<option value="\d+"/g) || []).length, 12);

  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  sel = storageSelect(await pickerHtml(env, ctx));
  assert.match(sel, /<option value="Supermarket" selected>/);
  assert.doesNotMatch(sel, /<option value="" selected>/);
});

test('the takedown session shows the storage and posts it with every print', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);

  let r = await form(env, ctx, 'sack_session_start',
    { session_id: lot, cultivar: 'Sour Lifter', bay: 9, storage: 'supermarket' });
  assert.equal(r.status, 200);
  assert.match(r.html, /Stored in Supermarket/);
  assert.match(r.html, /storage: "Supermarket"/);

  r = await form(env, ctx, 'sack_session_start',
    { session_id: lot, cultivar: 'Sour Lifter', bay: 9, storage: '' });
  assert.match(r.html, /No storage set/);
  assert.match(r.html, /storage: null/);
});

// ─── the scan page ───────────────────────────────────────────────────────────

test('the scan page shows where it dried and where it is stored, at tile size', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  const panel = locationPanel(await scan(env, ctx, sacks(sqlite)[0].sack_id));

  assert.match(panel, /Dried in<\/span><strong class="tv">Bay 9</);
  assert.match(panel, /Top barn/);
  assert.match(panel, /Stored in<\/span><strong class="tv">Supermarket</);
  assert.match(panel, /since /);
  assert.match(panel, /action=sack_store/);
});

test('an unrecorded storage reads as not recorded, not as a place', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9 });
  const panel = locationPanel(await scan(env, ctx, sacks(sqlite)[0].sack_id));
  assert.match(panel, /Stored in<\/span><strong class="tv">—</);
  assert.match(panel, /not recorded/);
});

test('the scan page is Spanish for the crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 4, storage: '4' });
  const panel = locationPanel(await scan(env, ctx, sacks(sqlite)[0].sack_id, 'es'));
  assert.match(panel, /Ubicaci(ó|&#243;)n/);
  assert.match(panel, /Guardada en/);
  assert.match(panel, /Bah(í|&#237;)a 4/);
});

// ─── hang bays ───────────────────────────────────────────────────────────────

test('the lot\'s hang bays come from every session of the lot, not only the primary', async () => {
  const { sqlite, env, ctx } = freshDb();
  const primary = seedSession(sqlite);
  const sibling = seedSession(sqlite);                 // same zone, cultivar, cut: the crew came back
  const otherCut = seedSession(sqlite, { cut: 2 });    // a different lot entirely
  seedLoad(sqlite, primary, 9);
  seedLoad(sqlite, sibling, 5);
  seedLoad(sqlite, otherCut, 2);

  await alloc(env, ctx, { session_id: primary, cultivar: 'Sour Lifter', qty: 1, bay: 9 });
  const panel = locationPanel(await scan(env, ctx, sacks(sqlite)[0].sack_id));
  // Bay 5 only reaches this through the sibling session; bay 2 is cut 2's.
  assert.match(panel, /lot hung in bays 5, 9</);
});

test('a lot hung only in the bay the sack came out of adds nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  seedLoad(sqlite, lot, 9);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9 });
  const panel = locationPanel(await scan(env, ctx, sacks(sqlite)[0].sack_id));
  assert.doesNotMatch(panel, /lot hung/);
  assert.match(panel, /Top barn/);
});

// ─── moving a sack ───────────────────────────────────────────────────────────

test('a sack can be moved, and re-saving the same place does not reset "since"', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  const id = sacks(sqlite)[0].sack_id;
  const OLD = '2026-01-01 00:00:00';
  sqlite.prepare('UPDATE harvest_sacks SET stored_at = ? WHERE sack_id = ?').run(OLD, id);

  let r = await form(env, ctx, 'sack_store', { sack_id: id, storage: 'SUPERMARKET' });
  assert.equal(r.status, 200);
  assert.equal(sacks(sqlite)[0].stored_at, OLD, 'same place, so "since" must stand');

  r = await form(env, ctx, 'sack_store', { sack_id: id, storage: '3' });
  assert.equal(r.status, 200);
  assert.match(r.html, /Stored in Bay 3\./);
  assert.equal(sacks(sqlite)[0].storage, '3');
  assert.notEqual(sacks(sqlite)[0].stored_at, OLD);

  r = await form(env, ctx, 'sack_store', { sack_id: id, storage: '' });
  assert.match(r.html, /Storage cleared\./);
  assert.equal(sacks(sqlite)[0].storage, null);
  assert.equal(sacks(sqlite)[0].stored_at, null);
});

test('moving to a place that does not exist is refused and changes nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  const id = sacks(sqlite)[0].sack_id;
  const r = await form(env, ctx, 'sack_store', { sack_id: id, storage: '13' });
  assert.ok(r.status >= 400, `got ${r.status}`);
  assert.equal(sacks(sqlite)[0].storage, 'Supermarket');
});

test('an opened or voided sack cannot be moved — refused by the server, not just hidden', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 2, bay: 9, storage: 'Supermarket' });
  const [a, b] = sacks(sqlite);
  sqlite.prepare("UPDATE harvest_sacks SET opened_at = datetime('now') WHERE sack_id = ?").run(a.sack_id);
  sqlite.prepare("UPDATE harvest_sacks SET voided_at = datetime('now') WHERE sack_id = ?").run(b.sack_id);

  for (const s of [a, b]) {
    assert.doesNotMatch(await scan(env, ctx, s.sack_id), /action=sack_store/, `${s.sack_id} form hidden`);
    const r = await form(env, ctx, 'sack_store', { sack_id: s.sack_id, storage: '3' });
    assert.ok(r.status >= 400, `${s.sack_id}: got ${r.status}`);
  }
  assert.deepEqual(sacks(sqlite).map(s => s.storage), ['Supermarket', 'Supermarket']);
});

// ─── example tags and the printed tag ────────────────────────────────────────

test('the example tag shows a location, and moving it saves nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const panel = locationPanel(await scan(env, ctx, '26-SLIFT-142'));
  assert.match(panel, /Dried in<\/span><strong class="tv">Bay 7</);
  assert.match(panel, /Stored in<\/span><strong class="tv">Supermarket</);

  const r = await form(env, ctx, 'sack_store', { sack_id: '26-SLIFT-142', storage: '3' });
  assert.equal(r.status, 200);
  assert.match(r.html, /not saved/);
  assert.equal(sacks(sqlite).length, 0);
});

test('storage never prints on the tag — a printed place that later changes is worse than none', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9, storage: 'Supermarket' });
  const id = sacks(sqlite)[0].sack_id;
  const label = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=sack_label&id=${id}`), env, ctx).then(r => r.text());
  assert.match(label, /Bay 9/);
  assert.doesNotMatch(label, /Supermarket/);
});
