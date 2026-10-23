/**
 * Tags by bay (Koa, 2026-10-12): GET ?action=bay_tags is one screen with every
 * bay as a drawer and a PRINT per cultivar hanging in it, so switching
 * cultivar in a 17-cultivar retail bay is one tap, not a round trip through
 * the picker. This suite covers the server render only.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshDb, seedLot, seedLoad, seedTag, sqliteAvailable } from './helpers/harvest-bay-seed.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleHarvestD1 } = await import(mod('workers/src/handlers/harvest-d1.js'));

const API = 'https://x/api/harvest';
const post = (env, ctx, action, body) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
const postForm = (env, ctx, action, fields) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString() }), env, ctx);
const page = async (env, ctx, lang = 'en') =>
  handleHarvestD1(new Request(`${API}?action=bay_tags&lang=${lang}`), env, ctx);
const drawerBays = (html) => [...html.matchAll(/<details class="baydrawer[^"]*" data-bay="(\d+)"/g)].map(m => m[1]);

test('bay_tags renders one drawer per bay with a PRINT button per cultivar', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const b = seedLot(sqlite, { zone: 'Z8', cultivar: 'Rainbow Cake' });
  const c = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  seedLoad(sqlite, b, 3, { minutesAgo: 8 * 1440, bins: 240 });
  seedLoad(sqlite, c, 4, { minutesAgo: 6 * 1440, bins: 480 });
  const res = await page(env, ctx);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.deepEqual(drawerBays(html), ['3', '4']);
  // PRINT sits beside the name and still carries the strain on a second line.
  const btn = (cv) => html.indexOf(`<span class="printword">PRINT</span><span class="printcv">${cv}</span>`);
  assert.ok(btn('Rainbow Cake') > -1, 'a PRINT per cultivar, the cultivar inside .printcv');
  assert.ok(btn('Rainbow Cake') < btn('Puff Pastries'), 'rows by bins');
  assert.ok(btn('Sour Lifter') > -1);
  assert.match(html, /<div class="cvtop">\s*<button class="cvname"[\s\S]*?<\/button>\s*<button class="bigbtn printbtn"/,
    'name and PRINT share one row; the drawer is a block below it');
  assert.match(html, new RegExp(`data-session="${b}" data-cultivar="Rainbow Cake" data-cut="1" data-bay="3"`));
  assert.equal((html.match(/class="btn alt addcv"/g) || []).length, 2);
  assert.equal((html.match(/name="all" value="1"/g) || []).length, 2);
  assert.match(html, /"Critical Berries"/, 'the season list rides the page for the add sheet');
  assert.match(html, /"Lifter":\["Z14","Z15","Z19","Z20","Z21"\]/, 'any planted cultivar, with every zone it grows in');
  assert.match(html, /id="addList"/, 'matches are tappable rows on the page');
  assert.doesNotMatch(html, /<datalist/, 'no native datalist: phones show it late or not at all');
  assert.match(html, /"Angel Cake":\["MZ1","MZ2"\]/);
  // Per-cultivar Finished form carries what bay_finish needs.
  assert.match(html, /name="fill_start" value="\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
});

test('bay_tags: a hand-added lot shows "no loads scanned"; a finished bay sorts last with Reopen', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB')`);
  const added = await post(env, ctx, 'lot_add', { bay: 1, cultivar: 'Critical Berries' });
  assert.equal(added.status, 200);
  const fin = await postForm(env, ctx, 'bay_finish', { bay: '3', all: '1' });
  assert.equal(fin.status, 200);
  const html = await (await page(env, ctx)).text();
  assert.deepEqual(drawerBays(html), ['1', '3'], 'active bay 1 before finished bay 3');
  assert.match(html, /no loads scanned/);
  assert.match(html, /name="reopen" value="1"/);
  assert.match(html, /name="all" value="1"><input type="hidden" name="reopen" value="1">/, 'whole-bay reopen form');
  assert.match(html, />Reopen whole bay 3</);
  // A finished bay offers no PRINT.
  const bay3 = html.slice(html.indexOf('<details class="baydrawer finished" data-bay="3"'));
  const end = bay3.indexOf('<dialog');
  const drawer = bay3.slice(0, end > -1 ? end : undefined);
  assert.match(drawer, /class="bigbtn printbtn" type="button" disabled/);
  assert.doesNotMatch(drawer, /Whole bay 3 down/, 'no Whole bay down on a finished bay');
  // Each finished row keeps its own Reopen inside the drawer.
  const row = drawer.slice(drawer.indexOf('class="cvdrawer"'), drawer.indexOf('class="btn alt addcv"'));
  assert.match(row, /name="cultivar" value="Puff Pastries">[\s\S]*?name="reopen" value="1">/);
});

test('bay_tags shows the Spanish strings with lang=es', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { env, ctx } = freshDb();
  const res = await page(env, ctx, 'es');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Etiquetas por bahía/);
});

test('bay_tags: Whole bay down with back=bay_tags returns to the bay screen', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const b = seedLot(sqlite, { zone: 'R1', cultivar: 'Sauciere' });
  seedLoad(sqlite, a, 3, { minutesAgo: 5 * 1440, bins: 24 });
  seedLoad(sqlite, b, 3, { minutesAgo: 5 * 1440, bins: 24 });
  const html = await (await page(env, ctx)).text();
  const forms = html.match(/<form method="POST" action="[^"]*bay_finish[\s\S]*?<\/form>/g) || [];
  assert.ok(forms.length >= 3, 'per-cultivar and whole-bay forms');
  assert.ok(forms.every(f => f.includes('name="back" value="bay_tags"')), 'every finish form comes back here');
  // A finish redirects (303) so a refresh cannot re-POST it; the flash rides along.
  const follow = async (res) => {
    assert.equal(res.status, 303);
    const loc = res.headers.get('Location');
    assert.match(loc, /action=bay_tags&lang=en/);
    return { loc, html: await (await handleHarvestD1(new Request(new URL(loc, 'https://x')), env, ctx)).text() };
  };
  const res = await postForm(env, ctx, 'bay_finish', { bay: '3', all: '1', back: 'bay_tags' });
  const { loc, html: after } = await follow(res);
  assert.match(loc, /flash=Bay%203%20down/);
  assert.match(after, /<h1>Tags by bay<\/h1>/);
  assert.match(after, /<div class="flash">✅ Bay 3 down — 2 cultivars finished\.<\/div>/);
  // One cultivar's Finished also comes back here.
  const c = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, c, 4, { minutesAgo: 5 * 1440, bins: 48 });
  const fill = (await (await page(env, ctx)).text()).match(/data-bay="4" data-fill="([^"]+)"/)[1];
  const one = await postForm(env, ctx, 'bay_finish', { bay: '4', cultivar: 'Sour Lifter', cut: '1', fill_start: fill, back: 'bay_tags' });
  const oneAfter = (await follow(one)).html;
  assert.match(oneAfter, /<h1>Tags by bay<\/h1>/);
  assert.match(oneAfter, /✅ Bay 4 \(Sour Lifter\) marked finished/);
  // Nothing open: a warning, not a ✅.
  const none = await follow(await postForm(env, ctx, 'bay_finish', { bay: '9', all: '1', back: 'bay_tags' }));
  assert.match(none.html, /<div class="notice">⚠️ Bay 9: nothing open to finish\.<\/div>/);
  // Reopen from here redirects back here, not to the session screen.
  const re = await postForm(env, ctx, 'bay_finish', { bay: '4', cultivar: 'Sour Lifter', cut: '1', fill_start: fill, reopen: '1', back: 'bay_tags' });
  assert.equal(re.status, 303);
  assert.match(re.headers.get('Location'), /action=bay_tags&lang=en/);
});

test('bay_tags: one cultivar and one sack read singular', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 5, { minutesAgo: 5 * 1440, bins: 24 });
  const alloc = await post(env, ctx, 'sack_alloc', { session_id: a, cultivar: 'Sour Lifter', qty: 1, bay: 5 });
  assert.equal(alloc.status, 200);
  const html = await (await page(env, ctx)).text();
  assert.match(html, /\b1 cultivar\b/);
  assert.doesNotMatch(html, /\b1 cultivars\b/);
  assert.match(html, /\b1 sack today\b/);
  assert.match(html, /\b1 sack\b/);
  assert.doesNotMatch(html, /\b1 sacks\b/);
  const es = await (await page(env, ctx, 'es')).text();
  assert.match(es, /\b1 variedad\b/);
  assert.match(es, /\b1 bolsa hoy\b/);
});

test('bay_tags shows ?flash= escaped and capped', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { env, ctx } = freshDb();
  const res = await handleHarvestD1(new Request(`${API}?action=bay_tags&lang=en&flash=${encodeURIComponent('<b>No variant</b>' + 'x'.repeat(400))}`), env, ctx);
  const html = await res.text();
  const shown = html.match(/<div class="notice">⚠️ ([^<]*)<\/div>/);
  assert.ok(shown, 'the flash is shown as a warning');
  assert.match(shown[1], /^&lt;b&gt;No variant&lt;\/b&gt;x+$/);
  assert.equal(shown[1].replace(/&lt;|&gt;/g, '.').length, 300, 'capped at 300 characters');
});

test('bay_tags: storage defaults per bay from that bay’s newest tag today', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Puff Pastries', 'PUFF')`);
  const a = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  const b = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  seedLoad(sqlite, b, 4, { minutesAgo: 8 * 1440, bins: 72 });
  const alloc = await post(env, ctx, 'sack_alloc', { session_id: a, cultivar: 'Sour Lifter', qty: 1, bay: 3, storage: 'Supermarket' });
  assert.equal(alloc.status, 200);
  const chip = (html, bay) => html.match(new RegExp(`<span class="storagechip"[^>]*data-bay="${bay}" data-value="([^"]*)">([^<]*)</span>`));
  const html = await (await page(env, ctx)).text();
  assert.deepEqual(chip(html, 3).slice(1), ['Supermarket', 'Supermarket'], 'bay 3 keeps its own storage');
  assert.deepEqual(chip(html, 4).slice(1), ['', 'No storage set'], 'bay 4 is not set, not bay 3 place');
  const es = await (await page(env, ctx, 'es')).text();
  assert.equal(chip(es, 4)[2], 'Sin lugar para guardar');
  // A null storage (chip not set) is accepted by sack_alloc.
  const none = await post(env, ctx, 'sack_alloc', { session_id: b, cultivar: 'Puff Pastries', qty: 1, bay: 4, storage: null });
  assert.equal(none.status, 200);
  // No global default left on the page.
  assert.doesNotMatch(html, /storageHintLast|lastStorage/);
});

test('bay_tags: a batch has its own plural message in both languages', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { env, ctx } = freshDb();
  const en = await (await page(env, ctx)).text();
  assert.ok(en.includes('"printedOkN":"✓ {n} tags printed ({first}–{last})"'));
  const es = await (await page(env, ctx, 'es')).text();
  assert.ok(es.includes('"printedOkN":"✓ {n} etiquetas impresas ({first}–{last})"'));
});

test('sack_void answers each tag with its bay, so the bay screen can pick the row’s new last tag', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 5, { minutesAgo: 5 * 1440, bins: 24 });
  seedLoad(sqlite, a, 6, { minutesAgo: 5 * 1440, bins: 24 });
  await post(env, ctx, 'sack_alloc', { session_id: a, cultivar: 'Sour Lifter', qty: 1, bay: 5 });
  const b = await (await post(env, ctx, 'sack_alloc', { session_id: a, cultivar: 'Sour Lifter', qty: 1, bay: 6 })).json();
  const v = await (await post(env, ctx, 'sack_void', { sack_id: b.ids[0] })).json();
  assert.ok(v.tags.length >= 2);
  assert.deepEqual(v.tags.map(x => x.bay).sort(), [5, 6]);
  const html = await (await page(env, ctx)).text();
  assert.match(html, /function newestInRow\(/, 'the void picks the row’s new last from d.tags by bay and fill');
});

test('bay_tags: ?open=N renders that bay open, ?warn= shows as a notice beside an ok flash', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries' });
  const b = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, a, 3, { minutesAgo: 8 * 1440, bins: 72 });
  seedLoad(sqlite, b, 4, { minutesAgo: 6 * 1440, bins: 480 });
  const html = await (await handleHarvestD1(new Request(
    `${API}?action=bay_tags&lang=en&open=4&ok=1&flash=${encodeURIComponent('Cream Cake added to bay 4')}&warn=${encodeURIComponent('no variant')}`), env, ctx)).text();
  assert.match(html, /<details class="baydrawer[^"]*" data-bay="4" data-fill="[^"]*" open>/, 'bay 4 open');
  assert.match(html, /<details class="baydrawer[^"]*" data-bay="3" data-fill="[^"]*">/, 'bay 3 still closed');
  assert.match(html, /class="flash">✅ Cream Cake added to bay 4/);
  assert.match(html, /class="notice">⚠️ no variant/);
  // The add sheet's success redirect carries all three, so a clean add is never silent.
  assert.match(html, /ok=1&open=/, 'client redirect carries ok and open');
  assert.match(html, /addedOk/);
});

// A bay's drawer as rendered: from its <details> to the next drawer or the dialogs.
const drawer = (html, bay) => {
  const from = html.indexOf(`data-bay="${bay}"`);
  assert.ok(from > -1, `bay ${bay} is on the screen`);
  const rest = html.slice(from);
  const next = rest.slice(1).search(/<details class="baydrawer|<dialog/);
  return next > -1 ? rest.slice(0, next + 1) : rest;
};
const printsIn = (d) => [...d.matchAll(/<span class="printcv">([^<]+)<\/span>/g)].map(m => m[1]);
const fillStartsIn = (d) => [...new Set([...d.matchAll(/name="fill_start" value="([^"]+)"/g)].map(m => m[1]))];

test('bay_tags: a late load into a bay that never came down joins what hangs there (bays 8 and 12, 2026-10-16)', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  // Bay 12: Lifter hung 10 days ago; no tag, no Finished. Two loads of a 2nd cut arrived 3 days ago.
  const lifter = seedLot(sqlite, { zone: 'Z19', cultivar: 'Lifter', daysAgo: 10 });
  for (let i = 0; i < 4; i++) seedLoad(sqlite, lifter, 12, { minutesAgo: 10 * 1440 - i * 30 });
  const sl2 = seedLot(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', cut: 2, daysAgo: 3 });
  seedLoad(sqlite, sl2, 12, { minutesAgo: 3 * 1440 });
  seedLoad(sqlite, sl2, 12, { minutesAgo: 3 * 1440 - 8 });
  // Bay 8: Lifter 9 days ago, a McLoughlin cultivar added by hand, GMO Belly 3 days ago.
  const z20 = seedLot(sqlite, { zone: 'Z20', cultivar: 'Lifter', daysAgo: 9 });
  for (let i = 0; i < 3; i++) seedLoad(sqlite, z20, 8, { minutesAgo: 9 * 1440 - i * 20 });
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB')`);
  assert.equal((await post(env, ctx, 'lot_add', { bay: 8, cultivar: 'Critical Berries' })).status, 200);
  const gmo = seedLot(sqlite, { zone: 'Z10', cultivar: 'GMO Belly', daysAgo: 3 });
  seedLoad(sqlite, gmo, 8, { minutesAgo: 3 * 1440 });

  // Bay 12's Lifter started coming down today, after the 2nd cut arrived: those tags prove nothing about the gap.
  seedTag(sqlite, lifter, 12, 1, { minutesAgo: 90 });
  seedTag(sqlite, lifter, 12, 2, { minutesAgo: 60 });

  const html = await (await page(env, ctx)).text();
  assert.deepEqual(drawerBays(html), ['8', '12']);
  const b12 = drawer(html, 12);
  assert.deepEqual(printsIn(b12), ['Lifter', 'Sour Lifter'], 'the Lifter keeps its PRINT; the 2nd cut hangs beside it');
  const lifterStart = sqlite.prepare(`SELECT MIN(occurred_at) AS t FROM harvest_scan_log WHERE event_type = 'barn_load' AND bay = 12`).get().t;
  assert.deepEqual(fillStartsIn(b12), [lifterStart], 'one fill, the one the bay has had since the Lifter went in');
  const b8 = drawer(html, 8);
  assert.deepEqual(printsIn(b8).sort(), ['Critical Berries', 'GMO Belly', 'Lifter']);
  assert.match(b8, /no loads scanned/, 'the hand-added lot is still there too');
});

test('bay_tags: Whole bay down with no tag printed still lets the next loads refill the bay', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const old = seedLot(sqlite, { zone: 'Z3', daysAgo: 20 });
  seedLoad(sqlite, old, 5, { minutesAgo: 19 * 1440 });
  const fin = await postForm(env, ctx, 'bay_finish', { bay: '5', all: '1' });   // tags went out under another bay
  assert.equal(fin.status, 200);
  // In the story the bay was finished ten days ago; the refill below is dated eight days back.
  sqlite.exec(`UPDATE harvest_bay_done SET done_at = datetime('now', '-10 days')`);
  sqlite.exec(`UPDATE harvest_scan_log SET takedown_done_at = datetime('now', '-10 days') WHERE takedown_done_at IS NOT NULL`);
  const fresh = seedLot(sqlite, { zone: 'Z20', cultivar: 'Lifter', daysAgo: 8 });
  seedLoad(sqlite, fresh, 5, { minutesAgo: 8 * 1440 });
  const html = await (await page(env, ctx)).text();
  assert.deepEqual(drawerBays(html), ['5']);
  assert.deepEqual(printsIn(drawer(html, 5)), ['Lifter'], 'the finished fill stays off the screen');
});

test('a hand-added session never leads its lot: tags and the harvest date stay on the crewed session', async (t) => {
  // Z21 Lifter: the crew scanned the zone sign on Oct 13 (session with a crew),
  // then a row was added by hand on bay 5, dated at that bay's Oct 3 fill so it
  // joins the fill. Ordered by date the hand row comes first, and before this
  // fix it became the lot's primary: every Lifter tag from any bay would have
  // carried harvest date Oct 3 (Koa, 2026-10-23, live).
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const sour = seedLot(sqlite, { zone: 'Z3', cultivar: 'Sour Lifter', daysAgo: 20 });
  seedLoad(sqlite, sour, 5, { minutesAgo: 20 * 1440, bins: 480 });
  const crewed = seedLot(sqlite, { zone: 'Z21', cultivar: 'Lifter', daysAgo: 10 });
  sqlite.prepare(`UPDATE harvest_scan_log SET crew = 'A' WHERE id = ?`).run(crewed);
  seedLoad(sqlite, crewed, 4, { minutesAgo: 10 * 1440, bins: 168 });
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew, bay, occurred_at, closed_at, is_test)
    VALUES ('enter', 'Z21', 'Lifter', ?, 1, NULL, 5, datetime('now', '-20 days'), datetime('now', '-20 days'), 1)
  `).run(2026);
  const hand = Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
  const html = await (await handleHarvestD1(new Request(`${API}?action=bay_tags&lang=en`), env, ctx)).text();
  const rows = [...html.matchAll(/data-session="(\d+)" data-cultivar="Lifter" data-cut="1" data-bay="(\d+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(rows.map(r => r[1]).sort(), [4, 5], 'Lifter shows on bays 4 and 5');
  for (const [session, bay] of rows) assert.equal(session, crewed, `bay ${bay} hangs on the crewed session, not ${hand}`);
});
