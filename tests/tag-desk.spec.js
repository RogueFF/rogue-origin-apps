/**
 * Tag & Desk — browser smoke test against an in-memory mock of /api/kanban.
 * Fixtures: the Sep 2 2026 snapshot of the live cards, cart and orders.
 * Serves the repo over http (ES modules need it) on 8099 like .claude/launch.json.
 *
 * Run: npx playwright test tests/tag-desk.spec.js --project=chromium
 */
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'tag-desk');
const PORT = 8099;
const PAGE = `http://localhost:${PORT}/src/pages/tag-desk.html`;
let server;

test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
});
test.afterAll(() => { if (server) server.kill(); });

function mockApi(page, { today = '2026-09-03T21:00:00Z' } = {}) {
  const cards = JSON.parse(fs.readFileSync(path.join(FIX, 'cards.json'), 'utf8')).cards;
  const cart = JSON.parse(fs.readFileSync(path.join(FIX, 'cart.json'), 'utf8')).cart;
  const orders = JSON.parse(fs.readFileSync(path.join(FIX, 'orders.json'), 'utf8')).orders;
  const requests = JSON.parse(fs.readFileSync(path.join(FIX, 'requests.json'), 'utf8')).requests;
  const calls = [];
  let nextCart = 900, nextOrder = 500;
  const rows = () => Object.values(cart).flat();
  const findCard = id => cards.find(c => c.id === Number(id));
  page.addInitScript(t => { const real = Date; const fixed = new real(t).getTime(); const D = class extends real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; window.Date = D; }, today);
  return page.route(u => u.pathname.endsWith('/api/kanban'), async (route, req) => {
    const u = new URL(req.url()); const action = u.searchParams.get('action');
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; }
    calls.push({ action, body });
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    switch (action) {
      case 'cards': return json({ success: true, cards });
      case 'getCart': return json({ success: true, cart, count: rows().length });
      case 'getOrderHistory': return json({ success: true, orders, count: orders.length });
      case 'getReorderRequests': return json({ success: true, requests, count: requests.length });
      case 'addToCart': {
        const c = findCard(body.cardId); if (!c) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Card not found' }) });
        if (c.supplier === 'Grove') { const open = requests.find(r => r.cardId === c.id && r.status === 'open'); if (!open) requests.push({ id: 99, cardId: c.id, requestedAt: '2026-09-03 21:00:00', status: 'open', notifyState: 'sent', item: c.item, supplier: 'Grove' }); return json({ success: true, mode: 'reorder_request', request: { id: 99, cardId: c.id, item: c.item, status: 'open', outcome: open ? 'already_open' : 'created', retried: !!open } }); }
        const v = c.supplier; cart[v] ||= []; let row = cart[v].find(r => r.cardId === c.id);
        if (row) { row.qty += body.qty || 1; row.addedAt = '2026-09-03 21:05:00'; if (body.note) row.note = body.note; if (body.addedBy) row.addedBy = body.addedBy; }
        else { row = { cartId: nextCart++, cardId: c.id, qty: body.qty || 1, addedAt: '2026-09-03 21:05:00', addedBy: body.addedBy || null, note: body.note || null, item: c.item, supplier: v }; cart[v].push(row); }
        return json({ success: true, mode: 'cart', cartItem: row });
      }
      case 'updateCartQty': { const row = rows().find(r => r.cardId === Number(body.cardId)); if (!row) return json({ success: false, error: 'Cart entry not found' }); row.qty = Math.max(1, Math.floor(body.qty)); return json({ success: true }); }
      case 'removeFromCart': { for (const v of Object.keys(cart)) cart[v] = cart[v].filter(r => r.cardId !== Number(body.cardId)); return json({ success: true }); }
      case 'markOrdered': { const items = (cart[body.vendor] || []).map(r => ({ cardId: r.cardId, qty: r.qty, item: r.item })); if (!items.length) return json({ success: false, error: 'No cart items' }); orders.unshift({ id: nextOrder, vendor: body.vendor, orderedAt: '2026-09-03 21:10:00', placedBy: body.placedBy, items }); cart[body.vendor] = []; return json({ success: true, orderId: nextOrder++, vendor: body.vendor, itemCount: items.length, items }); }
      case 'update': { const c = findCard(body.id); Object.assign(c, body); return json({ success: true, message: 'Card updated' }); }
      case 'add': { const c = { id: 200, ...body }; cards.push(c); return json({ success: true, id: 200 }); }
      case 'delete': { const i = cards.findIndex(c => c.id === Number(body.id)); if (i >= 0) cards.splice(i, 1); return json({ success: true }); }
      default: return json({ success: false, error: 'Unknown action: ' + action });
    }
  }).then(() => ({ calls, cart, cards, orders }));
}

test('desk loads the live shape: tiles, three lanes, counts, no console errors', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  const tiles = await page.$$eval('.vt', els => els.map(e => e.innerText.replace(/\n/g, ' ')));
  expect(tiles.some(t => /^Uline/.test(t))).toBe(true);
  const lanes = await page.$$eval('#view-order .lane .cnt', els => els.map(e => +e.innerText));
  expect(lanes.length).toBe(3); expect(lanes[0]).toBeGreaterThan(0);
  expect(await page.$eval('.board-h .when', e => e.innerText)).toMatch(/Next check/);
  await page.click('.tabs [data-view="cards"]');
  expect(await page.$$eval('.pc', e => e.length)).toBe(93);
  await page.click('.tabs [data-view="print"]');
  expect(await page.$('#pstage .pcard .qr svg')).not.toBeNull();
  await page.click('.pv-head [data-fmt="red"]');
  expect(await page.$('#pstage .pcard.red')).not.toBeNull();
  expect(errs.filter(e => !/favicon|manifest|ro-logo|icon-apple/.test(e))).toEqual([]);
});

test('desk writes: quantity, add, remove, mark ordered → receipt, receive per item', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.lane.q .ic');
  const first = await page.$eval('.lane.q .ic', e => +e.dataset.id);
  await page.click(`.lane.q .ic[data-id="${first}"] [data-inc]`); await page.waitForTimeout(400);
  expect(api.calls.some(c => c.action === 'updateCartQty' && c.body.cardId === first)).toBe(true);
  await page.click('.lane.d .lane-h [data-addids]'); await page.waitForTimeout(600);
  expect(api.calls.filter(c => c.action === 'addToCart' && c.body.addedBy === 'desk').length).toBeGreaterThan(0);
  expect(await page.$$eval('#view-order .lane.d .ic', e => e.length)).toBe(0);
  await page.click('#actbar .btn-primary'); await page.waitForTimeout(600);
  const mo = api.calls.find(c => c.action === 'markOrdered'); expect(mo.body).toEqual({ vendor: 'Uline', placedBy: 'desk' });
  expect(await page.$('.receipt')).not.toBeNull();
  const rows = await page.$$eval('.orow', e => e.length); expect(rows).toBeGreaterThan(0);
  await page.click('.orow [data-recvone]'); await page.waitForTimeout(300);
  expect(await page.$$eval('.orow', e => e.length)).toBe(rows - 1);
  await page.click('.onorder [data-received]'); await page.waitForTimeout(300);
  expect(await page.$('.receipt')).toBeNull();
  expect(await page.$eval('table.grid tr.new', e => e.innerText)).toMatch(/Received/);
  const mem = await page.evaluate(() => JSON.parse(localStorage.getItem('ro-tagdesk-v1')));
  expect(Object.keys(mem.received).length).toBe(rows);
});

test('tag: a queued card re-scan is idempotent; a fresh card queues once; the red card raises the desk alarm', async ({ page }) => {
  const api = await mockApi(page);
  const queued = api.cart.Uline[0].cardId;
  await page.goto(`${PAGE}?flag=${queued}`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/Already on the list/);
  expect(api.calls.filter(c => c.action === 'addToCart').length).toBe(0);
  expect(await page.evaluate(() => document.body.classList.contains('tagonly'))).toBe(true);
  expect(await page.$('.tag-side')).toBeNull();
  const fresh = api.cards.find(c => c.supplier === 'Uline' && !api.cart.Uline.some(r => r.cardId === c.id));
  await page.goto(`${PAGE}?flag=${fresh.id}`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/Queued/);
  const add = api.calls.filter(c => c.action === 'addToCart'); expect(add.length).toBe(1); expect(add[0].body.addedBy).toBe('tag');
  expect(new URL(page.url()).searchParams.get('flag')).toBeNull();
  await page.click('#tundo'); await page.waitForTimeout(400);
  expect(api.calls.some(c => c.action === 'removeFromCart' && c.body.cardId === fresh.id)).toBe(true);
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/Removed/);
  await page.goto(`${PAGE}?flag=${fresh.id}&red=1`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/OUT/);
  expect(api.calls.filter(c => c.action === 'addToCart').pop().body.note).toBe('RED CARD');
  await page.goto(PAGE); await page.waitForSelector('.vt');
  expect(await page.$eval('.outbar', e => e.innerText)).toMatch(/OUT —/);
  await page.click('[data-outclear]'); await page.waitForTimeout(200);
  expect(await page.$('.outbar')).toBeNull();
});

test('tag: a Grove card goes to Damon; an unknown id says so', async ({ page }) => {
  const api = await mockApi(page);
  const grove = api.cards.find(c => c.supplier === 'Grove');
  await page.goto(`${PAGE}?flag=${grove.id}`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/Requested from Damon/);
  await page.goto(`${PAGE}?flag=99999`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/not recognised/);
});

test('phone: no order control, rows dense, editor fits', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
  await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('actbar')).display)).toBe('none');
  expect(await page.evaluate(() => [...document.querySelectorAll('[data-mark],[data-markg]')].every(b => b.getBoundingClientRect().height === 0))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.click('.bottombar [data-view="cards"]'); await page.waitForSelector('.pc');
  expect(await page.$eval('.pc', e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
  await page.click('.pc'); await page.waitForSelector('#editor[open]');
  expect(await page.evaluate(() => { const b = document.getElementById('edBody'); return b.scrollWidth <= b.clientWidth + 1; })).toBe(true);
  await ctx.close();
});
