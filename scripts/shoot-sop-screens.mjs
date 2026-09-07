/**
 * Screenshots of the crew screens, for the harvest SOP.
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
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
const OUT = 'C:/Users/Koasm/Documents/RogueFamilyFarms/wiki/operations/images';

const SHOTS = [
  { file: 'sop-crew-card.png',   url: '/c/A',  note: 'crew card, scanned once per phone' },
  { file: 'sop-zone-scan.png',   url: '/z/Z4', note: 'zone sign' },
  { file: 'sop-barn-intake.png', url: '/b/1',  note: 'barn door 1' },
  { file: 'sop-sack-scan.png',   url: '/s/26-SLIFT-142?opened=1', note: 'a tag scanned' },
];

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // The crew tag rides on the handset, so the shots have to carry it too or
  // every screen renders as an untagged phone.
  await ctx.addCookies([
    { name: 'rf_crew', value: 'A', url: BASE },
    { name: 'rf_lang', value: 'es', url: BASE },
  ]);
  const page = await ctx.newPage();

  // /fin FIRST, and this ordering is not cosmetic. Photographing /z/Z4 does not
  // show a zone scan, it PERFORMS one — the shot opens a real session. Taken
  // before /fin, that session was the newest open one, so the close reported
  // 0.0 hours and then warned that the zone it had just closed was still open.
  // The product was right both times; the script was lying to it.
  //
  // The seed and the cleanup are the caller's, with wrangler: Node on Windows
  // cannot spawn npx.cmd without a shell, and a shell re-splits SQL on spaces.
  await page.goto(BASE + '/fin', { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(OUT, 'sop-day-end.png'), fullPage: true });
  console.log('  sop-day-end.png  <- /fin');

  for (const s of SHOTS) {
    await page.goto(BASE + s.url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(OUT, s.file), fullPage: true });
    console.log('  ' + s.file + '  <- ' + s.url);
  }

  // ── the tag sheet, at paper width rather than phone width ────────────────
  const wide = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  const wp = await wide.newPage();
  await wp.goto(BASE + '/api/harvest?action=sack_label&examples=1&lang=es', { waitUntil: 'networkidle' });
  const label = await wp.locator('.label').first();
  await label.screenshot({ path: join(OUT, 'sop-tag.png') });
  console.log('  sop-tag.png  <- one 4x2 tag');

  await browser.close();
};

run().catch((e) => { console.error(e); process.exit(1); });
