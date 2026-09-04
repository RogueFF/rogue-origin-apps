// Read-only look at the new page against the LIVE API (no writes): desktop, phone, Tag preview.
// node tests/helpers/tag-desk-live-shots.mjs
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import { spawn } from 'child_process'; import path from 'path'; import fs from 'fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../..');
const OUT = path.join(ROOT, 'test-results', 'tag-desk-live'); fs.mkdirSync(OUT, { recursive: true });
const server = spawn('python', ['-m', 'http.server', '8099'], { cwd: ROOT, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1200));
const PAGE = 'http://localhost:8099/src/pages/tag-desk.html';
const browser = await chromium.launch(); const errs = []; const writes = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
page.on('request', r => { if (r.method() === 'POST' && /api\/kanban/.test(r.url())) writes.push(r.url()); });
await page.goto(PAGE); await page.waitForSelector('.vt', { timeout: 30000 }); await page.waitForTimeout(1500);
const info = await page.evaluate(() => ({ tiles: [...document.querySelectorAll('.vt')].map(t => t.innerText.replace(/\n/g, ' ')), lanes: [...document.querySelectorAll('#view-order .lane .cnt')].map(e => +e.innerText), when: document.querySelector('.board-h .when').innerText, badge: document.querySelector('.tab[data-view=order] .n').innerText, cards: document.querySelector('.tab[data-view=cards] .n').innerText, outbar: !!document.querySelector('.outbar') }));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: path.join(OUT, 'live-order.png') });
await page.click('.tabs [data-view="cards"]'); await page.waitForTimeout(800); await page.screenshot({ path: path.join(OUT, 'live-cards.png') });
await page.click('.tabs [data-view="print"]'); await page.waitForTimeout(800); await page.screenshot({ path: path.join(OUT, 'live-print.png') });
await page.click('.tabs [data-view="grove"]'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, 'live-grove.png') });
await page.click('.tabs [data-view="tag"]'); await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, 'live-tag-preview.png') });
await ctx.close();
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const mp = await m.newPage(); mp.on('pageerror', e => errs.push('M PAGEERROR ' + e.message));
await mp.goto(PAGE); await mp.waitForSelector('.vt', { timeout: 30000 }); await mp.waitForTimeout(1200); await mp.screenshot({ path: path.join(OUT, 'live-phone.png') });
await browser.close(); server.kill();
console.log('errors', errs); console.log('writes', writes);
