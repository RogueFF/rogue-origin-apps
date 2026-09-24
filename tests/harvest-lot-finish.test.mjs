/**
 * Closing a takedown lot out.
 *
 * Koa, 2026-09-15: "we might need to add a "Finished" button or something to
 * close out that batch. the batch of 15 1st cut is still open however its all
 * finished". Nothing recorded the end of a takedown, so a fully bagged lot sat
 * on the picker as STARTED for the whole picker window.
 *
 * What this suite holds:
 *
 * 1. A FINISHED LOT IS NOT A CANDIDATE. It leaves the radio list and sits in a
 *    collapsed Finished list, one press from Reopen.
 * 2. THE WHOLE LOT, NOTHING ELSE. A lot spans sessions (a second crew, a
 *    same-shift re-entry), so every one is stamped — and the next cut of the
 *    same zone is a different lot and is left alone.
 * 3. FINISHED ONLY WHILE EVERY SESSION IS. A crew re-entering afterwards has
 *    cut more, so the lot comes back by itself — in the picker AND the print
 *    guard, which must never disagree.
 * 4. THE SERVER REFUSES A TAG ON A FINISHED LOT, before a serial is spent. A
 *    disabled button is not the guard; a second phone on the old page is.
 * 5. IT TOUCHES NO SACK. Finished means no more tags, not that sacks left.
 * 6. PRESSING IT TWICE KEEPS THE FIRST TIME.
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
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
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
function seedSession(sqlite, { zone = 'Z8', cultivar = 'Sour Lifter', cut = 1 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, datetime('now','-12 days'), datetime('now','-11 days'), 1)
  `).run(zone, cultivar, SEASON, cut);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

// JSON actions throw to index.js's global catch, which answers { success: false }.
// Stand in for it, so a refusal reads the way the takedown screen receives it.
const alloc = (env, ctx, body) => handleHarvestD1(
  new Request('https://x/api/harvest?action=sack_alloc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx)
  .then(async r => ({ status: r.status, body: await r.json() }))
  .catch(e => ({ status: e.statusCode || 500, body: { success: false, error: e.message } }));

const finish = (env, ctx, sessionId, { reopen = false, lang = 'en' } = {}) => handleHarvestD1(
  new Request(`https://x/api/harvest?action=lot_finish&lang=${lang}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ session_id: String(sessionId), ...(reopen ? { reopen: '1' } : {}) }).toString(),
  }), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));

const picker = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());

const sessionScreen = (env, ctx, sessionId, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_session&session_id=${sessionId}&cultivar=Sour%20Lifter&lang=${lang}`),
  env, ctx).then(r => r.text());

/** Lots the operator can pick to start a takedown. */
const radios = (html) =>
  [...html.matchAll(/type="radio" name="session_id" value="(\d+)"/g)].map(m => Number(m[1]));
/** Lots offered a Finished button. */
const finishRows = (html) =>
  [...html.matchAll(/class="finishrow"[^>]*>\s*<input type="hidden" value="(\d+)"/g)].map(m => Number(m[1]));
/** Lots in the Finished list, offered Reopen. */
const reopenRows = (html) =>
  [...html.matchAll(/class="finishrow done">\s*<input type="hidden" value="(\d+)"/g)].map(m => Number(m[1]));

const stamps = (sqlite) => Object.fromEntries(sqlite.prepare(
  `SELECT id, takedown_done_at FROM harvest_scan_log WHERE event_type = 'enter'`).all()
  .map(r => [r.id, r.takedown_done_at]));

const tagged = async (env, ctx, lot, qty = 1) => {
  const r = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty, bay: 9, storage: 'Supermarket' });
  assert.equal(r.body.success, true, JSON.stringify(r.body));
  return r;
};

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// ─── the picker ──────────────────────────────────────────────────────────────

test('a finished lot leaves the takedown list and waits under Finished, one press from Reopen', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  const other = seedSession(sqlite, { zone: 'Z4' });
  await tagged(env, ctx, lot, 2);

  let html = await picker(env, ctx);
  assert.deepEqual(radios(html).sort(), [lot, other].sort());
  assert.deepEqual(finishRows(html), [lot], 'only a lot with tags is offered Finished');
  assert.deepEqual(reopenRows(html), []);

  const r = await finish(env, ctx, lot);
  assert.equal(r.status, 200);
  assert.match(r.html, /Z8 · Sour Lifter Cut 1 marked finished — 2 sacks\./, 'the flash names the lot and its sacks');
  assert.deepEqual(radios(r.html), [other], 'a finished lot is not a takedown candidate');
  assert.deepEqual(finishRows(r.html), []);
  assert.deepEqual(reopenRows(r.html), [lot]);
  assert.match(r.html, /<details class="batch finished">/, 'the finished list is collapsed');

  html = await picker(env, ctx);
  assert.deepEqual(radios(html), [other], 'and it stays off on a fresh load');
});

test('a lot never started is not offered Finished — there is nothing to close out', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  const html = await picker(env, ctx);
  assert.deepEqual(radios(html), [lot]);
  assert.deepEqual(finishRows(html), []);
  assert.doesNotMatch(html, /Done taking a lot down\?/);
});

test('when every lot is finished the picker says so, rather than that none were ever cut', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot);
  const r = await finish(env, ctx, lot);
  assert.deepEqual(radios(r.html), []);
  assert.match(r.html, /Every lot from the last \d+ days is marked finished/);
  assert.doesNotMatch(r.html, /No harvest lots recorded/);
  assert.deepEqual(reopenRows(r.html), [lot], 'and the way back is still on the page');
});

test('reopen puts the lot back on the takedown list', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot);
  await finish(env, ctx, lot);
  const r = await finish(env, ctx, lot, { reopen: true });
  assert.equal(r.status, 200);
  assert.match(r.html, /reopened — it is back on the takedown list/);
  assert.deepEqual(radios(r.html), [lot]);
  assert.deepEqual(finishRows(r.html), [lot]);
  assert.deepEqual(reopenRows(r.html), []);
  assert.equal(stamps(sqlite)[lot], null);
});

// ─── which rows ──────────────────────────────────────────────────────────────

test('finishing stamps every session of the lot and nothing of the next cut or another zone', async () => {
  const { sqlite, env, ctx } = freshDb();
  const first = seedSession(sqlite);                       // crew A
  const second = seedSession(sqlite);                      // crew B, same lot
  const cut2 = seedSession(sqlite, { cut: 2 });            // same zone, a different lot
  const z4 = seedSession(sqlite, { zone: 'Z4' });
  const otherCultivar = seedSession(sqlite, { cultivar: 'Lifter' });
  await tagged(env, ctx, first);

  await finish(env, ctx, second);   // pressed from the lot's second session — still the whole lot
  const s = stamps(sqlite);
  assert.ok(s[first] && s[second], 'both sessions of the lot are stamped');
  assert.equal(s[cut2], null, 'cut 2 of the same zone is its own lot');
  assert.equal(s[z4], null);
  assert.equal(s[otherCultivar], null, 'a split zone holds other cultivars\' lots');
});

test('a crew re-entering after the lot was finished brings it back, in the picker and at the printer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot);
  await finish(env, ctx, lot);
  assert.equal((await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1 })).body.success, false);

  const again = seedSession(sqlite);   // more cut into the same lot
  const html = await picker(env, ctx);
  assert.equal(radios(html).filter(id => id === lot || id === again).length, 1, 'the lot is back as one candidate');
  assert.deepEqual(reopenRows(html), []);
  await tagged(env, ctx, lot);   // and the print guard agrees
});

test('pressing Finished twice keeps the first time', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot);
  await finish(env, ctx, lot);
  sqlite.prepare(`UPDATE harvest_scan_log SET takedown_done_at = '2026-09-11 01:00:00' WHERE id = ?`).run(lot);
  await finish(env, ctx, lot);
  assert.equal(stamps(sqlite)[lot], '2026-09-11 01:00:00');
});

// ─── printing ────────────────────────────────────────────────────────────────

test('the server refuses a tag on a finished lot before a serial is spent, and prints again once reopened', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot);
  await finish(env, ctx, lot);

  const r = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 3, bay: 9 });
  assert.equal(r.body.success, false);
  assert.match(r.body.error || r.body.message || JSON.stringify(r.body), /finished/i);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM harvest_sacks').get().n, 1, 'no serial spent');

  await finish(env, ctx, lot, { reopen: true });
  const ok = await tagged(env, ctx, lot);
  assert.deepEqual(ok.body.ids, ['' + String(SEASON).slice(-2) + '-SLIFT-2'], 'the sequence carries on');
});

test('finishing touches no sack — not its storage, void state or inventory fields', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot, 3);
  sqlite.prepare(`UPDATE harvest_sacks SET voided_at = datetime('now') WHERE serial = 2`).run();
  const before = sqlite.prepare('SELECT * FROM harvest_sacks ORDER BY serial').all();
  const r = await finish(env, ctx, lot);
  assert.match(r.html, /marked finished — 2 sacks\./, 'a voided tag is not a sack');
  await finish(env, ctx, lot, { reopen: true });
  assert.deepEqual(sqlite.prepare('SELECT * FROM harvest_sacks ORDER BY serial').all(), before);
});

// ─── the takedown screen ─────────────────────────────────────────────────────

test('a note typed before PRINT TAG is saved on the tag that prints', async () => {
  // Koa, 2026-09-16: "the note should pertain to the next tag that gets printed,
  // not the previous".
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  const yy = String(SEASON).slice(-2);
  await tagged(env, ctx, lot, 1);

  const html = await sessionScreen(env, ctx, lot);
  const noteAt = html.indexOf('<details id="nextNote" class="nextnote">');
  assert.ok(noteAt > 0 && noteAt < html.indexOf('<button id="printBtn"'), 'the note box sits above PRINT TAG');
  assert.match(html, /<summary>Note for the next tag<\/summary>/);
  assert.doesNotMatch(html, /id="noteLink"|sack_note_save/, 'no note on the previous tag any more');

  const notes = () => sqlite.prepare('SELECT sack_id, note, is_test FROM harvest_sack_notes ORDER BY id').all()
    .map(r => [r.sack_id, r.note, r.is_test]);

  const r = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, note: '  torn at the seam  ' });
  assert.deepEqual(r.body.ids, [`${yy}-SLIFT-2`]);
  assert.equal(r.body.note_on, `${yy}-SLIFT-2`);
  assert.deepEqual(notes(), [[`${yy}-SLIFT-2`, 'torn at the seam', 1]], 'on the new tag, not #1 before it');

  const plain = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, note: '   ' });
  assert.equal(plain.body.note_on, null, 'a blank box is no note');
  assert.equal(notes().length, 1);

  const batch = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 3, note: 'wet' });
  assert.equal(batch.body.success, false, 'a batch is several bags and cannot share one note');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM harvest_sacks').get().n, 3, 'refused before any serial is spent');
  assert.equal(notes().length, 1);

  const { handleSackScan } = await import(
    join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///'));
  const page = await handleSackScan(new Request(`https://x/s/${yy}-SLIFT-2?lang=en`), env, ctx).then(res => res.text());
  assert.match(page, /torn at the seam/, "it is the same note the bag's page shows");
});

test('the last tag is the newest one, not the highest id as text — Void acts on it', async () => {
  // Found verifying this screen on the live Rainbow GMO Quik lot: with tags
  // #1-#20 it named #4 as the last tag, because "…-4" > "…-20" as text.
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  const yy = String(SEASON).slice(-2);
  const r = await tagged(env, ctx, lot, 12);
  assert.equal(r.body.last_sack_id, `${yy}-SLIFT-12`, 'as text, "-9" sorts after "-12"');
  assert.match(await sessionScreen(env, ctx, lot), new RegExp(`var lastId = "${yy}-SLIFT-12";`));

  const v = await handleHarvestD1(new Request('https://x/api/harvest?action=sack_void', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sack_id: `${yy}-SLIFT-12` }),
  }), env, ctx).then(res => res.json());
  assert.equal(v.last_sack_id, `${yy}-SLIFT-11`, 'after a void the next Void must reach #11, not #9');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM harvest_sacks WHERE voided_at IS NOT NULL').get().n, 1);
});

test('the takedown screen offers Finished on an open lot, and on a finished one says so with PRINT TAG off', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite);
  await tagged(env, ctx, lot, 2);

  let html = await sessionScreen(env, ctx, lot);
  assert.match(html, /id="finishForm"/);
  assert.match(html, /Finished with this lot/);
  assert.doesNotMatch(html, /class="notice"/);
  assert.match(html, /<button id="printBtn" class="bigbtn">/);
  assert.match(html, /var locked = false;/);

  await finish(env, ctx, lot);
  html = await sessionScreen(env, ctx, lot);
  assert.match(html, /class="notice">This lot was marked finished on /);

  // Start takedown POSTs to the same screen. A finished lot is not a radio,
  // but a picker left open from before it was finished can still send one.
  const posted = await handleHarvestD1(new Request('https://x/api/harvest?action=sack_session_start&lang=en', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ session_id: String(lot), cultivar: 'Sour Lifter', bay: '9', storage: 'Supermarket' }).toString(),
  }), env, ctx).then(res => res.text());
  assert.match(posted, /class="notice">This lot was marked finished on /);
  assert.match(posted, /<button id="printBtn" class="bigbtn" disabled>/);
  assert.match(html, /name="reopen" value="1"/);
  assert.doesNotMatch(html, /id="finishForm"/);
  assert.match(html, /<button id="printBtn" class="bigbtn" disabled>/);
  assert.match(html, /<button id="batchBtn" class="btn" disabled>/);
  assert.match(html, /var locked = true;/, 'a void re-enabling the buttons must not undo the lock');
});

test('every new string renders in both languages', async () => {
  const { sqlite, env, ctx } = freshDb();
  const done = seedSession(sqlite, { zone: 'Z4' });
  const open = seedSession(sqlite);
  await tagged(env, ctx, done);
  await tagged(env, ctx, open);
  for (const lang of ['es', 'en']) {
    const flash = await finish(env, ctx, done, { lang });
    // Scripts name their string table by key (T.confirmFinish), so only what a
    // person reads is checked — the confirm text itself is asserted below.
    const shown = (flash.html + await sessionScreen(env, ctx, open, lang) + await sessionScreen(env, ctx, done, lang))
      .replace(/<script>[\s\S]*?<\/script>/g, '');
    if (lang === 'es') assert.match(flash.html + await sessionScreen(env, ctx, open, lang), /¿Marcar Z/);
    for (const key of ['finishLot', 'finishLotHelp', 'confirmFinish', 'finishSection', 'finishSectionHelp',
                       'markFinished', 'finishedLots', 'finishedOn', 'reopenLot', 'lotFinished',
                       'lotFinishedNotice']) {
      assert.doesNotMatch(shown, new RegExp(`\\b${key}\\b`), `${lang}: ${key} rendered as a raw key`);
    }
    await finish(env, ctx, done, { reopen: true, lang });
  }
  assert.match(await finish(env, ctx, done, { lang: 'es' }).then(r => r.html), /Lotes terminados \(1\)/);
});

test('a missing lot is refused with an error page, not a stamp', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite);
  const r = await finish(env, ctx, 'abc');
  assert.ok(r.status >= 400);
  const missing = await finish(env, ctx, 9999);
  assert.ok(missing.status >= 400);
  assert.ok(Object.values(stamps(sqlite)).every(v => v === null));
});

// ─── test mode never touches a real row ──────────────────────────────────────

test('in test mode, every write to a real bag or lot is refused — the row is untouched', async () => {
  // Koa, 2026-09-18: turning test mode on for a day of practice, "we also need
  // to preserve the rainbow GMO data though". Test mode marks what it CREATES
  // as test data, but a real tag scanned on a test day would otherwise be
  // voided, opened or re-stored for real.
  const { sqlite, env, ctx } = freshDb();          // HARVEST_TEST_MODE: 'true'
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', 'Z8', 'Rainbow GMO Quik', ?, 1, datetime('now','-12 days'), datetime('now','-11 days'), 0)
  `).run(SEASON);
  const realLot = Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, cultivar_code, zone, cultivar, cut_number,
                               zone_session_id, storage, printed_at, is_test)
    VALUES ('26-RAINGQ-7', ?, 7, 'RAINGQ', 'Z8', 'Rainbow GMO Quik', 1, ?, 'Supermarket', datetime('now','-2 days'), 0)
  `).run(SEASON, realLot);
  const before = sqlite.prepare("SELECT * FROM harvest_sacks WHERE sack_id = '26-RAINGQ-7'").get();

  const form = (action, fields) => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}&lang=en`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }), env, ctx).then(async r => ({ status: r.status, html: await r.text() }));
  const json = (action, body) => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx).then(r => r.json()).catch(e => ({ success: false, error: e.message }));

  const store = await form('sack_store', { sack_id: '26-RAINGQ-7', storage: '4' });
  assert.ok(store.status >= 400);
  assert.match(store.html, /real bag/i);
  assert.ok((await form('sack_note', { sack_id: '26-RAINGQ-7', note: 'x' })).status >= 400);
  assert.ok((await form('sack_open', { sack_id: '26-RAINGQ-7' })).status >= 400);
  assert.ok((await form('sack_weigh', { sack_id: '26-RAINGQ-7', tops_lbs: '20', smalls_lbs: '10' })).status >= 400);
  assert.ok((await form('lot_finish', { session_id: String(realLot) })).status >= 400);
  assert.equal((await json('sack_void', { sack_id: '26-RAINGQ-7' })).success, false);
  assert.equal((await json('sack_alloc', { session_id: realLot, cultivar: 'Rainbow GMO Quik', qty: 1 })).success, false);

  assert.deepEqual(sqlite.prepare("SELECT * FROM harvest_sacks WHERE sack_id = '26-RAINGQ-7'").get(), before);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM harvest_sacks').get().n, 1, 'no test tag on a real lot');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM harvest_sack_notes').get().n, 0);
  assert.equal(sqlite.prepare("SELECT takedown_done_at FROM harvest_scan_log WHERE id = ?").get(realLot).takedown_done_at, null);

  // Reading it is still fine: the bag's page has to work when a tag is scanned.
  const { handleSackScan } = await import(
    join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///'));
  const page = await handleSackScan(new Request('https://x/s/26-RAINGQ-7?lang=en'), env, ctx).then(r => r.text());
  assert.match(page, /Rainbow GMO Quik/);

  // And a test lot of its own still works normally.
  const testLot = seedSession(sqlite, { cultivar: 'Sour Lifter' });
  assert.equal((await json('sack_alloc', { session_id: testLot, cultivar: 'Sour Lifter', qty: 1 })).success, true);
});

test('test mode can be flipped from the dashboard, and the setting outranks the deployment', async () => {
  // Koa, 2026-09-18: "is there a button i can use to turn test mode on/off?"
  const { sqlite, env, ctx } = freshDb();
  const live = { ...env, HARVEST_TEST_MODE: 'false', ORDERS_PASSWORD: 'pw' };   // deployed live
  const call = (method, body, auth = 'pw') => handleHarvestD1(new Request('https://x/api/harvest?action=test_mode', {
    method,
    headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), live, ctx).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
    .catch(e => ({ status: e.statusCode || 500, body: { success: false, error: e.message } }));

  const first = await call('GET');
  assert.equal(first.body.data?.test_mode ?? first.body.test_mode, false);
  assert.match(first.body.data?.source ?? first.body.source, /deployed/);

  assert.notEqual((await call('POST', { on: true }, null)).status, 200, 'the switch is password-gated');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM harvest_settings").get().n, 0);

  assert.equal((await call('POST', { on: true })).status, 200);
  assert.equal(sqlite.prepare("SELECT value FROM harvest_settings WHERE key='test_mode'").get().value, 'true');

  // The setting, not wrangler.toml, is what the crew screens now follow.
  const after = await call('GET');
  assert.equal(after.body.data?.test_mode ?? after.body.test_mode, true);
  assert.match(after.body.data?.source ?? after.body.source, /setting/);

  const tagged = await handleHarvestD1(new Request('https://x/api/harvest?action=sack_alloc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: seedSession(sqlite), cultivar: 'Sour Lifter', qty: 1 }),
  }), live, ctx).then(r => r.json());
  assert.equal(tagged.success, true);
  assert.equal(sqlite.prepare('SELECT is_test FROM harvest_sacks ORDER BY id DESC LIMIT 1').get().is_test, 1,
    'a tag printed while the switch is on is test data, even on a live deployment');

  await call('POST', { on: false });
  const back = await call('GET');
  assert.equal(back.body.data?.test_mode ?? back.body.test_mode, false, 'and it flips back');
});
