/**
 * Build the crew cheat-sheet PDF from outputs/sop/cheat-sheet.src.html.
 *
 *   node scripts/build-cheat-sheet.mjs
 *
 * Front: five QR codes for the pages the crew actually needs. Back: how to use
 * each one, numbered to match. Print double-sided and laminate.
 *
 * The QR codes come from the worker's own generator (workers/src/lib/qr.js),
 * the same one that draws the code on every sack tag — so what is printed here
 * cannot drift from what is printed there.
 *
 * No ?lang= on any target, on purpose: the card is bilingual and each phone
 * keeps whatever language its owner already chose.
 *
 * Two traps this script exists to avoid, both learned building field-to-sack:
 *  · page.pdf() honours emulateMedia, so print media is set BEFORE the call.
 *  · Web fonts must finish loading or Barlow silently falls back mid-layout.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = 'C:/Users/Koasm/Documents/RogueFamilyFarms';
const SRC = join(WIKI, 'outputs/sop/cheat-sheet.src.html');
const OUT = join(WIKI, 'outputs/sop/harvest-cheat-sheet.pdf');

const { qrDataUri } = await import(
  join(REPO, 'workers/src/lib/qr.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

const API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

const TARGETS = {
  zones:    `${API}/api/harvest?action=print_codes&packet=zones`,
  crew:     `${API}/api/harvest?action=crew`,
  barn:     `${API}/b`,
  print:    `${API}/api/harvest?action=sack_print`,
  fin:      `${API}/fin`,
  practice: `${API}/api/harvest?action=practice`,
};

const run = async () => {
  let html = readFileSync(SRC, 'utf8');
  for (const [name, url] of Object.entries(TARGETS)) {
    const slot = `@@QR:${name}@@`;
    if (!html.includes(slot)) throw new Error(`no slot for ${name} — the card and this script disagree`);
    html = html.replaceAll(slot, qrDataUri(url));
  }
  if (html.includes('@@QR:')) throw new Error('a QR slot was left unfilled');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });
    writeFileSync(OUT, pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`harvest-cheat-sheet.pdf  ${Math.round(pdf.length / 1024)} KB · ${pages} pages`);
    if (pages !== 2) console.warn(`  ⚠ expected 2 pages (front + back), got ${pages}`);
    for (const [name, url] of Object.entries(TARGETS)) console.log(`  ${name.padEnd(9)} ${url}`);
  } finally {
    await browser.close();
  }
};

await run();
