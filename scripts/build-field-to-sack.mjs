/**
 * Build the Field to Sack one-pager PDFs from outputs/sop/field-to-sack.src.html.
 *
 *   node scripts/build-field-to-sack.mjs
 *
 * The source carries `@@IMG:name.png@@` slots and a language toggle. Each PDF
 * is one language with its own screenshots inlined as data URIs, so the file
 * prints and travels with nothing to fetch — it is handed to a crew on a phone
 * in a barn, or printed and laminated.
 *
 * Two traps, both paid for once:
 *
 *  · `page.pdf()` honours `emulateMedia`. Left on screen it prints the screen
 *    layout — nine pages with the cards cut in half. Print media is set BEFORE
 *    the pdf call, never after.
 *  · The toggle is a real button on the page, so the language is chosen by
 *    clicking it rather than by editing the markup: the PDF then shows exactly
 *    what the browser shows.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:/Users/Koasm/Documents/RogueFamilyFarms';
const SRC = join(ROOT, 'outputs/sop/field-to-sack.src.html');
const IMAGES = join(ROOT, 'wiki/operations/images');

const inlineImages = (html) => html.replace(/@@IMG:([a-z0-9.-]+)@@/gi, (_, file) => {
  const bytes = readFileSync(join(IMAGES, file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
});

const run = async () => {
  const html = inlineImages(readFileSync(SRC, 'utf8'));
  if (html.includes('@@IMG:')) throw new Error('an image slot was left unfilled');

  const browser = await chromium.launch();
  try {
    for (const [lang, button] of [['ES', '#btn-es'], ['EN', '#btn-en']]) {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.click(button);
      await page.waitForFunction((sel) => document.querySelector(sel).getAttribute('aria-pressed') === 'true', button);
      await page.emulateMedia({ media: 'print' });
      const out = join(ROOT, `outputs/sop/field-to-sack-${lang}.pdf`);
      const pdf = await page.pdf({ format: 'Letter', printBackground: true,
        margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' } });
      writeFileSync(out, pdf);
      const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      console.log(`  field-to-sack-${lang}.pdf  ${Math.round(pdf.length / 1024)} KB · ${pages} pages`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
