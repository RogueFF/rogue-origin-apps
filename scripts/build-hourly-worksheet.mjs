/**
 * Build the paper hourly worksheet from outputs/sop/hourly-worksheet.src.html.
 *
 *   node scripts/build-hourly-worksheet.mjs
 *
 * The hour rows are generated rather than typed, so the sheet's hours and the
 * app's hour list cannot drift apart: both run FIRST_HOUR..LAST_HOUR and both
 * label an hour the way the crew says it ("9-10").
 *
 * NO NODE DEPENDENCIES ON PURPOSE. The other doc builders import playwright,
 * and on 2026-09-24 the repo's node_modules was emptied by another session —
 * every one of them broke at once, for a document that has nothing to do with
 * the app's dependency tree. This one drives an installed Chrome (or Edge)
 * through --headless --print-to-pdf, which is on the machine whether or not npm
 * has run. If a browser is ever missing, it says which paths it tried.
 *
 * One page, always. A second page means a row was added without shrinking
 * something, and half the day would be on a sheet nobody carries.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WIKI = 'C:/Users/Koasm/Documents/RogueFamilyFarms';
const SRC = join(WIKI, 'outputs/sop/hourly-worksheet.src.html');
const OUT = join(WIKI, 'outputs/sop/hourly-crew-worksheet.pdf');

// The barn day as the app offers it (harvest-crew-hourly.js), trimmed to the
// hours anyone actually hangs in: the app's list starts at 5 for a late night,
// but a paper row for 5 AM is a row wasted on every sheet ever printed.
const FIRST_HOUR = 6;
const LAST_HOUR = 19;   // the 7-8 PM row

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const twelve = (h) => ((h + 11) % 12) + 1;

function rows() {
  const out = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const label = `${twelve(h)}-${twelve(h + 1)}`;
    // The first row is the morning head count — what the app calls the day's
    // first report, in the same word the crew sees on screen.
    const tag = h === FIRST_HOUR
      ? ' <small style="font:400 8px \'Source Sans 3\',sans-serif;color:#6b8071">arranque</small>' : '';
    out.push(`<tr><td class="hr">${label}${tag}</td><td></td><td></td><td></td><td></td><td></td>` +
      `<td class="sticks"></td><td class="notes"></td></tr>`);
  }
  return out.join('\n    ');
}

const browser = BROWSERS.find(existsSync);
if (!browser) {
  throw new Error('No Chrome or Edge found. Tried:\n  ' + BROWSERS.join('\n  '));
}

const html = readFileSync(SRC, 'utf8').replace('@@ROWS@@', rows());
if (html.includes('@@ROWS@@')) throw new Error('the row slot was left unfilled');

const dir = mkdtempSync(join(tmpdir(), 'worksheet-'));
const page = join(dir, 'sheet.html');
writeFileSync(page, html);

execFileSync(browser, [
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',      // the URL and date stamp are not part of the form
  '--print-to-pdf=' + OUT,
  'file:///' + page.replace(/\\/g, '/'),
], { stdio: 'pipe' });

const pdf = readFileSync(OUT);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`hourly-crew-worksheet.pdf  ${Math.round(pdf.length / 1024)} KB · ${pages} page(s) · ` +
  `${LAST_HOUR - FIRST_HOUR + 1} hour rows · rendered by ${browser.split('/').pop()}`);
if (pages !== 1) throw new Error(`expected 1 page, got ${pages} — a row was added without room for it`);
