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
  { file: 'crew-card',   url: '/c/A',  note: 'crew card, scanned once per phone' },
  { file: 'zone-scan',   url: '/z/Z4', note: 'zone sign' },
  { file: 'barn-intake', url: '/b/1',  note: 'barn door 1' },
  { file: 'sack-scan',   url: '/s/26-SLIFT-142?opened=1', note: 'a tag scanned' },
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
const LANG = (process.argv[2] || 'es') === 'en' ? 'en' : 'es';

/**
 * Clipped to the content, not the handset.
 *
 * These screens are short and the phone is tall, so a full-page shot is mostly
 * empty dark green — which on a printed sheet is a third of a page of nothing,
 * and in an embedded page is bytes for no picture.
 */
const shoot = async (page, path) => {
  const h = await page.evaluate(() => {
    let bottom = 0;
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    return Math.ceil(bottom + 14);
  });
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 390, height: Math.min(h, 844) } });
};

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
  const page = await ctx.newPage();
  const q = (u) => u + (u.includes('?') ? '&' : '?') + 'lang=' + LANG;

  // /fin first — see the note on LANG above.
  await page.goto(q(BASE + '/fin'), { waitUntil: 'networkidle' });
  await shoot(page, join(OUT, `sop-day-end-${LANG}.png`));
  console.log(`  sop-day-end-${LANG}.png  <- /fin`);

  for (const s2 of SHOTS) {
    await page.goto(q(BASE + s2.url), { waitUntil: 'networkidle' });
    await shoot(page, join(OUT, `sop-${s2.file}-${LANG}.png`));
    console.log(`  sop-${s2.file}-${LANG}.png  <- ${s2.url}`);
  }
  await ctx.close();

  // The tag prints the same in either language, so it is shot once.
  const wide = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  const wp = await wide.newPage();
  await wp.goto(BASE + '/api/harvest?action=sack_label&examples=1&lang=es', { waitUntil: 'networkidle' });
  await wp.locator('.label').first().screenshot({ path: join(OUT, 'sop-tag.png') });
  console.log('  sop-tag.png  <- one 4x2 tag');

  await browser.close();
};

run().catch((e) => { console.error(e); process.exit(1); });
