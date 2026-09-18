/**
 * Screenshots of the crew screens, for the harvest SOP.
 *
 * --local (2026-09-18) RENDERS THE SCREENS FROM AN IN-MEMORY DATABASE instead
 * of production, which is how the writing shots get taken at all now the season
 * is live: the worker module is imported directly, a seeded SQLite stands in for
 * D1, and every request the page makes is answered in-process. No row reaches
 * production, no serial is spent, and both languages can be shot in one run
 * because each starts from its own fresh database.
 *
 *   node scripts/shoot-sop-screens.mjs --local
 *
 * Shot in SPANISH at phone size, because that is what the crew actually holds —
 * an SOP illustrated with the English desktop view teaches a screen nobody
 * sees. The red PRUEBA band is in every shot on purpose: the system is in test
 * mode until the first cut, and the band is a thing the crew should recognise.
 *
 *   node scripts/shoot-sop-screens.mjs
 *
 * Writes into the wiki repo. The one shot that needs state (the end-of-day
 * close) creates a single is_test session, takes the picture, and deletes it —
 * scan_log rows only, so no bag serial is ever consumed.
 *
 * SHOTS THAT WRITE ARE OPT-IN (2026-09-10). Pointed at production, /z/Z4 OPENS
 * a zone session and /fin CLOSES the crew's open ones. That was harmless in
 * test mode; with the season live they are real records. Both are skipped
 * unless --allow-writes is passed, and --only= narrows a run to named shots:
 *
 *   node scripts/shoot-sop-screens.mjs en --only=sack-scan
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
const OUT = 'C:/Users/Koasm/Documents/RogueFamilyFarms/wiki/operations/images';

const SHOTS = [
  { file: 'crew-card',   url: '/c/A',  note: 'crew card, scanned once per phone' },
  { file: 'zone-scan',   url: '/z/Z4', note: 'zone sign', writes: true },
  { file: 'barn-intake', url: '/b/1',  note: 'barn door 1' },
  // Cropped to the Location panel: the page grew past 844px when the redesign
  // landed, and the plain cap cut "Stored in" off mid-tile (2026-09-10).
  { file: 'sack-scan',   url: '/s/26-SLIFT-142?opened=1', note: 'a tag scanned', until: '.sd-location' },
];

// Both languages. The crew screens carry a real English toggle, so an English
// screenshot is a real screen and not a mock-up — and an English reader should
// not have to match Spanish text to an English sheet (Koa, 2026-09-07).
// The TAG is not in this list: it prints the same either way.
// ONE LANGUAGE PER RUN, driven by the caller, because the /fin shot needs a
// freshly seeded session and nothing else open. Looping both languages inside
// one run put the zone-scan shot of the first pass — which opens a real
// session — in front of the second pass's /fin, so the English shot closed
// that instead and read 0.0 hours. Same trap as the ordering above, one level
// up: every screenshot of this system is also a use of it.
const ARGS = process.argv.slice(2);
const LOCAL = ARGS.includes('--local');
const LANG = ARGS.includes('en') ? 'en' : 'es';
const ALLOW_WRITES = ARGS.includes('--allow-writes');
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const wanted = (file) => !ONLY.length || ONLY.includes(file);
const skipWrite = (file) => {
  console.log(`  skipped ${file} — it writes to production; pass --allow-writes`);
};

/**
 * Clipped to the content, not the handset.
 *
 * These screens are short and the phone is tall, so a full-page shot is mostly
 * empty dark green — which on a printed sheet is a third of a page of nothing,
 * and in an embedded page is bytes for no picture.
 */
const shoot = async (page, path, until = null) => {
  const h = await page.evaluate((sel) => {
    // With `until`, the crop ends under that element — a panel that must be
    // whole in the picture — instead of at the handset's height.
    if (sel) {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`shot crop target ${sel} not on the page`);
      return Math.ceil(el.getBoundingClientRect().bottom + 14);
    }
    let bottom = 0;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    return Math.ceil(bottom + 14);
  }, until);
  // A named target sets its own height; the 844 cap is for whole-page shots.
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 390, height: until ? h : Math.min(h, 844) }, fullPage: !!until });
};

/**
 * A worker with a seeded database, served to the browser through page routing.
 *
 * The seed is the smallest thing that makes every screen say something real: a
 * zone open under Crew A (so the barn door has a zone to follow and /fin has a
 * session to close) and a lot old enough to be coming down.
 */
const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql', '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql',
];

async function localSystem() {
  const handlers = await import(pathToFileURL('workers/src/handlers/harvest-d1.js').href);
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const sql = readFileSync(join('workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of sql.split(';')) if (stmt.trim()) sqlite.exec(stmt);
  }
  sqlite.exec(`CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT);
    INSERT INTO cultivars VALUES (1, 'Sour Lifter', 'SLIFT');
    CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER);`);
  // Cut nine days ago, hauled the same day: a lot that reads READY at takedown.
  sqlite.exec(`INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
      occurred_at, closed_at, headcount, is_test)
    VALUES ('enter', 'Z8', 'Sour Lifter', 2026, 1, 'A', datetime('now','-9 days'), datetime('now','-9 days','+7 hours'), 13, 0)`);
  sqlite.exec(`INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, crew, occurred_at, is_test)
    VALUES ('barn_load', 'Z8', 2026, 22, 1, 7, 'A', datetime('now','-9 days','+3 hours'), 0)`);

  const DB = {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      return { bind(...a) {
        return {
          all: async () => ({ results: sqlite.prepare(sql).all(...a) }),
          first: async () => sqlite.prepare(sql).get(...a) ?? null,
          run: async () => {
            const r = sqlite.prepare(sql).run(...a);
            return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
          },
        };
      } };
    },
  };
  // Not test mode: the crew screens carry a red PRUEBA band in test mode, and
  // the SOP should show the screens as they are during a live harvest.
  const env = { DB, HARVEST_TEST_MODE: 'false' };
  const ctx = { waitUntil() {} };
  const serve = async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/s/')) return handlers.handleSackScan(request, env, ctx);
    if (url.pathname.startsWith('/z/')) return handlers.handleZoneScan(request, env, ctx);
    if (url.pathname.startsWith('/c/')) return handlers.handleCrewScan(request, env, ctx);
    if (url.pathname === '/fin') return handlers.handleDayEndScan(request, env, ctx);
    if (url.pathname === '/b' || url.pathname.startsWith('/b/')) return handlers.handleBarnScan(request, env, ctx);
    return handlers.handleHarvestD1(request, env, ctx);
  };
  return { serve, sqlite };
}

/** Answer this page's requests from the local worker; let the QR service through. */
async function serveLocally(ctx) {
  const { serve, sqlite } = await localSystem();
  await ctx.route(BASE + '/**', async (route) => {
    const req = route.request();
    const res = await serve(new Request(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: req.method() === 'POST' ? req.postData() : undefined,
    }));
    await route.fulfill({
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'text/html; charset=utf-8' },
      body: await res.text(),
    });
  });
  return sqlite;
}

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  // The crew tag rides on the handset, so the shots have to carry it too or
  // every screen renders as an untagged phone.
  await ctx.addCookies([
    { name: 'rf_crew', value: 'A', url: BASE },
    { name: 'rf_lang', value: LANG, url: BASE },
  ]);
  const localDb = LOCAL ? await serveLocally(ctx) : null;
  const page = await ctx.newPage();
  const q = (u) => u + (u.includes('?') ? '&' : '?') + 'lang=' + LANG;

  // Local runs shoot in the order the crew works, so each screen has the state
  // the one before it left: the zone opens, the door follows it, /fin closes it.
  if (LOCAL) {
    for (const s2 of SHOTS) {
      if (!wanted(s2.file)) continue;
      await page.goto(q(BASE + s2.url), { waitUntil: 'networkidle' });
      await shoot(page, join(OUT, `sop-${s2.file}-${LANG}.png`), s2.until || null);
      console.log(`  sop-${s2.file}-${LANG}.png  <- ${s2.url} (local)`);
    }
    if (wanted('day-end')) {
      // A day's work, so the close reads like one: the session the zone-scan
      // shot opened is aged before /fin sees it.
      localDb.exec("UPDATE harvest_scan_log SET occurred_at = datetime('now','-7 hours') WHERE event_type='enter' AND closed_at IS NULL");
      await page.goto(q(BASE + '/fin'), { waitUntil: 'networkidle' });
      await shoot(page, join(OUT, `sop-day-end-${LANG}.png`));
      console.log(`  sop-day-end-${LANG}.png  <- /fin (local)`);
    }
  }

  // /fin first — see the note on LANG above.
  if (!LOCAL && wanted('day-end')) {
    if (!ALLOW_WRITES) skipWrite('day-end');
    else {
      await page.goto(q(BASE + '/fin'), { waitUntil: 'networkidle' });
      await shoot(page, join(OUT, `sop-day-end-${LANG}.png`));
      console.log(`  sop-day-end-${LANG}.png  <- /fin`);
    }
  }

  for (const s2 of LOCAL ? [] : SHOTS) {
    if (!wanted(s2.file)) continue;
    if (s2.writes && !ALLOW_WRITES) { skipWrite(s2.file); continue; }
    await page.goto(q(BASE + s2.url), { waitUntil: 'networkidle' });
    await shoot(page, join(OUT, `sop-${s2.file}-${LANG}.png`), s2.until || null);
    console.log(`  sop-${s2.file}-${LANG}.png  <- ${s2.url}`);
  }
  await ctx.close();

  // The tag prints the same in either language, so it is shot once.
  if (!wanted('tag')) { await browser.close(); return; }
  const wide = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  const wp = await wide.newPage();
  await wp.goto(BASE + '/api/harvest?action=sack_label&examples=1&lang=es', { waitUntil: 'networkidle' });
  await wp.locator('.label').first().screenshot({ path: join(OUT, 'sop-tag.png') });
  console.log('  sop-tag.png  <- one 4x2 tag');

  await browser.close();
};

run().catch((e) => { console.error(e); process.exit(1); });
