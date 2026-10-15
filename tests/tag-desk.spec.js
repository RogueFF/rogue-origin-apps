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

const laneFixture = () => [
  { cardId: 21, item: 'Custom 1 Oz Bags', crumbtrail: 'Grove Rack > A-1', colour: 'orange', config: { bagsPerBox: 500, bagsPerBin: 50, leadDays: 75, safetyDays: 30, moq: 2500, seedPerMonth: 600 },
    baseline: { bags: 2400, at: '2026-08-02T17:00:00.000Z', reason: 'receive' }, redCard: { id: 301, token: 'tok21' }, openRequest: { id: 77, requestedAt: '2026-08-25 18:00:00', notifyState: 'sent' },
    onHand: 1500, bins: 30, rate: 20, rateSource: 'ledger', reorderPoint: 2100, redTapeAtBins: 42, suggestedQty: 2500, runOut: '2026-11-17', orderBy: '2026-08-20', status: 'order', recount: false },
  { cardId: 99, item: '10 LB GROVE BAGS', crumbtrail: 'Grove Bags Rack > E-1', colour: 'slate', config: { bagsPerBox: 100, bagsPerBin: 50, leadDays: 75, safetyDays: 30, moq: 2500, seedPerMonth: 90 },
    baseline: { bags: 650, at: '2026-08-20T17:00:00.000Z', reason: 'recount' }, redCard: null, openRequest: null,
    onHand: 600, bins: 12, rate: 3, rateSource: 'seed', reorderPoint: 315, redTapeAtBins: 7, suggestedQty: 2500, runOut: '2027-01-15', orderBy: '2026-11-01', status: 'ok', recount: false },
];

function mockApi(page, { today = '2026-09-03T21:00:00Z', bins = true } = {}) {
  const cards = JSON.parse(fs.readFileSync(path.join(FIX, 'cards.json'), 'utf8')).cards;
  const cart = JSON.parse(fs.readFileSync(path.join(FIX, 'cart.json'), 'utf8')).cart;
  const orders = JSON.parse(fs.readFileSync(path.join(FIX, 'orders.json'), 'utf8')).orders;
  const requests = JSON.parse(fs.readFileSync(path.join(FIX, 'requests.json'), 'utf8')).requests;
  const calls = [];
  const lanes = laneFixture(); const unmapped = [{ variant_id: '4455667788', qty: 12, lastSeen: '2026-09-01' }];
  const laneOf = id => lanes.find(l => l.cardId === Number(id));
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
      case 'getBinStatus': return bins ? json({ success: true, lanes, unmapped }) : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'no such table: kanban_bin_config' }) });
      case 'receiveBins': { const l = laneOf(body.cardId); const before = l.onHand; const per = body.bagsPerBin || l.config.bagsPerBin, perBox = body.bagsPerBox || l.config.bagsPerBox; l.bins = body.leftoverBins + Math.ceil(body.boxes * perBox / per); l.onHand = body.leftoverBins * l.config.bagsPerBin + body.boxes * perBox; l.status = 'ok'; l.openRequest = null; return json({ success: true, lane: l, needsRecount: true, estimateBefore: before }); }
      case 'recount': { const l = laneOf(body.cardId); l.bins = body.sealedBins; l.onHand = body.sealedBins * l.config.bagsPerBin; return json({ success: true, lane: l }); }
      case 'setBinConfig': { const l = laneOf(body.cardId); const { cardId, colour, ...cfg } = body; Object.assign(l.config, cfg); if (colour) l.colour = colour; return json({ success: true, lane: l }); }
      case 'makeLaneKit': { const l = laneOf(body.cardId); l.redCard = { id: 302, token: 'tok' + l.cardId }; return json({ success: true, redCard: { token: l.redCard.token, url: `https://rogue-origin-api.roguefamilyfarms.workers.dev/k/${l.redCard.token}` }, card: findCard(body.cardId), lane: l }); }
      case 'setRecipe': { const i = unmapped.findIndex(u => u.variant_id === String(body.variant_id)); if (i >= 0) unmapped.splice(i, 1); return json({ success: true }); }
      default: return json({ success: false, error: 'Unknown action: ' + action });
    }
  }).then(() => ({ calls, cart, cards, orders, lanes, unmapped }));
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
  expect(await page.$eval('#actbar [data-copy]', e => e.dataset.copy)).toMatch(/^S-[\w-]+ \d+(\n|$)/);
  expect(await page.$('#actbar [data-ulinego]')).not.toBeNull();
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return {}; }; });
  await page.click('#actbar [data-ulinego]'); await page.waitForTimeout(200);
  const opened = await page.evaluate(() => window.__opened);
  expect(opened.length).toBe(1); expect(opened[0]).toMatch(/^https:\/\/www\.uline\.com\/QuickOrder#ro=S-/);
  expect(decodeURIComponent(opened[0].split('#ro=')[1]).split('\n').every(l => /^S-[\w-]+ \d+$/.test(l))).toBe(true);
  expect(await page.$eval('.copyline pre.paste', e => e.innerText.split('\n').length)).toBeGreaterThan(1);
  await page.click('.vt[data-v="Amazon"]'); await page.waitForTimeout(300);
  const amz = await page.$eval('#actbar [data-cartgo="Amazon"]', a => a.href);
  expect(amz).toMatch(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}#ro=[A-Z0-9]{10}%20\d+/);
  await page.click('.vt[data-v="Walmart"]'); await page.waitForTimeout(300);
  const wm = await page.$eval('#actbar [data-cartgo="Walmart"]', a => a.href);
  expect(wm).toMatch(/^https:\/\/affil\.walmart\.com\/cart\/addToCart\?items=\d+(%7C|\|)\d+/);
  await page.click('.vt[data-v="Uline"]'); await page.waitForTimeout(300);
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

test('tag: +1 then Undo +1 lands back on what the scan queued, not on 1', async ({ page }) => {
  const api = await mockApi(page);
  const inCart = id => Object.values(api.cart).flat().find(r => r.cardId === id);
  // want a card whose suggested qty is >= 3, so an undo computed off the wrong base cannot pass by accident
  let picked = null;
  for (const c of api.cards.filter(x => ['Uline', 'Amazon', 'Walmart'].includes(x.supplier) && !inCart(x.id))) {
    await page.goto(`${PAGE}?flag=${c.id}`); await page.waitForSelector('.band');
    const add = api.calls.filter(x => x.action === 'addToCart' && x.body.cardId === c.id).pop();
    if (!add) continue; // already on order: the scan queues nothing
    if (add.body.qty >= 3) { picked = { id: c.id, q: add.body.qty }; break; }
    await page.click('#tundo'); await page.waitForTimeout(300);
  }
  expect(picked).not.toBeNull();
  await page.click('[data-tag="plus"]'); await page.waitForTimeout(400);
  expect(inCart(picked.id).qty).toBe(picked.q + 1);
  await page.click('#tundo'); await page.waitForTimeout(400);
  expect(inCart(picked.id).qty).toBe(picked.q);
  await page.click('[data-tag="plus"]'); await page.waitForTimeout(400);
  await page.click('[data-tag="plus"]'); await page.waitForTimeout(400);
  await page.click('#tundo'); await page.waitForTimeout(400);
  expect(inCart(picked.id).qty).toBe(picked.q + 1);
});

test('tag: a card already on order says so and is not queued twice; urgent and the red card still reach the desk', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('#actbar [data-mark]');
  const ordered = api.cart.Uline.map(r => r.cardId);
  await page.click('#actbar [data-mark]'); await page.waitForTimeout(700);
  const adds = () => api.calls.filter(c => c.action === 'addToCart');
  const before = adds().length;
  await page.goto(`${PAGE}?flag=${ordered[0]}`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/Already on order/);
  expect(adds().length).toBe(before);
  await page.click('[data-tag="urgent"]'); await page.waitForTimeout(500);
  expect(adds().pop().body).toMatchObject({ cardId: ordered[0], note: 'URGENT', addedBy: 'tag' });
  await page.goto(`${PAGE}?flag=${ordered[1]}&red=1`); await page.waitForSelector('.band');
  expect(await page.$eval('.band .verb', e => e.innerText)).toMatch(/OUT/);
  expect(adds().pop().body).toMatchObject({ cardId: ordered[1], note: 'RED CARD' });
});

test('desk: a card queued again while its order is on the way carries a red "Already ordered" flag; an undone order does not', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('#actbar [data-mark]');
  const ids = api.cart.Uline.map(r => r.cardId);
  await page.click('#actbar [data-mark]'); await page.waitForTimeout(700);
  await page.click('[data-undo]'); await page.waitForTimeout(900);
  expect(await page.$$eval('#view-order .lane.q .flag.onorder', e => e.length)).toBe(0);
  await page.click('#actbar [data-mark]'); await page.waitForTimeout(700);
  // an old-page scan lands in the cart behind the desk's back
  await page.evaluate(id => fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/kanban?action=addToCart', { method: 'POST', body: JSON.stringify({ cardId: id, qty: 2 }) }), ids[0]);
  await page.reload(); await page.waitForSelector('.vt');
  expect(await page.$eval(`#view-order .lane.q .ic[data-id="${ids[0]}"] .flag.onorder`, e => e.textContent)).toMatch(/^Already ordered .+ check it came before ordering again$/);
});

test('print: cancelling the dialog keeps the card on the to-print list; Yes marks it printed', async ({ page }) => {
  await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('afterprint')); }); // Chrome fires afterprint on Cancel too
  await page.click('.tabs [data-view="print"]'); await page.waitForSelector('#printOne');
  const printed = () => page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('ro-tagdesk-v1') || '{}')).printed || {}).length);
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('#printOne'); await page.waitForTimeout(400);
  expect(asked).toMatch(/Did the card print\?/);
  expect(await printed()).toBe(0);
  page.once('dialog', d => d.accept());
  await page.click('#printOne'); await page.waitForTimeout(400);
  expect(await printed()).toBe(1);
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

// --- Grove lanes (getBinStatus) ---------------------------------------------
test('grove: one tile per lane, headline from the lane, red tape line, request and no-recipe strip', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  expect(await page.$$eval('.lane-tile', e => e.length)).toBe(2);
  const heads = await page.$$eval('.lane-tile h3', e => e.map(x => x.innerText));
  expect(heads).toEqual(['ORDER NOW · 14 days late', 'OK until Jan 15']);
  const first = await page.$eval('.lane-tile[data-lane="21"]', e => e.innerText);
  expect(first).toMatch(/Red tape at bin 42/); expect(first).toMatch(/~140\/wk \(ledger\)/); expect(first).toMatch(/Requested from Damon · Aug 25/); expect(first).toMatch(/last count Aug 2/);
  expect(await page.$$eval('.lane-tile[data-lane="21"] .sq', e => e.length)).toBe(42);           // tape deeper than the stock: empty red outlines keep it visible
  expect(await page.$$eval('.lane-tile[data-lane="21"] .sq.on', e => e.length)).toBe(30);
  expect(await page.$$eval('.lane-tile[data-lane="99"] .sq.red', e => e.length)).toBe(7);
  expect(await page.$eval('.lane-tile[data-lane="99"]', e => e.innerText)).not.toMatch(/Requested from Damon/);
  expect(await page.$eval('.lane-tile[data-lane="21"]', e => e.classList.contains('st-order'))).toBe(true);
  expect(await page.$eval('#view-grove', e => e.innerText)).toMatch(/Shopify items with no bag recipe \(1\)/);
  expect(errs).toEqual([]);
});

test('grove: Receive posts leftover + boxes and the toast names the new red-tape depth', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  await page.click('.lane-tile[data-lane="21"] [data-rv]'); await page.waitForSelector('#recv[open]');
  expect(await page.$eval('#rvPerBox', e => e.value)).toBe('500'); expect(await page.$eval('#rvPerBin', e => e.value)).toBe('50');
  await page.fill('#rvLeft', '39'); await page.fill('#rvBoxes', '25');
  expect(await page.$eval('#rvLive', e => e.innerText)).toMatch(/= 289 bins · red tape at bin 42/);
  await page.click('#rvSave'); await page.waitForSelector('.toast');
  const call = api.calls.find(c => c.action === 'receiveBins');
  expect(call.body).toMatchObject({ cardId: 21, leftoverBins: 39, boxes: 25 });
  const toast = await page.$eval('.toast', e => e.innerText);
  expect(toast).toMatch(/Red tape at bin 42 · move the red card · print the tape label/); expect(toast).toMatch(/Recount\?/);
  expect(await page.$eval('.lane-tile[data-lane="21"] h3', e => e.innerText)).toMatch(/^OK until/);
});

test('grove: Recount posts one number; Map assigns a recipe', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  await page.click('.lane-tile[data-lane="99"] [data-rc]'); await page.waitForSelector('#recv[open]');
  await page.fill('#rcSealed', '9'); await page.click('#rvSave'); await page.waitForSelector('.toast:has-text("Count saved")');
  expect(api.calls.find(c => c.action === 'recount').body).toMatchObject({ cardId: 99, sealedBins: 9 });
  await page.click('[data-map="4455667788"]'); await page.waitForSelector('#recv[open]');
  await page.selectOption('#mpCard', '54'); await page.click('#rvSave'); await page.waitForSelector('.toast:has-text("Mapped")');
  expect(api.calls.find(c => c.action === 'setRecipe').body).toMatchObject({ variant_id: '4455667788', card_id: 54, qty: 1 });
  expect(await page.$('[data-map="4455667788"]')).toBeNull();
});

const stubPrintWindow = page => page.evaluate(() => { window.__kits = []; window.open = () => { const w = { document: { html: '', open() { this.html = ''; }, write(s) { this.html += s; }, close() {} }, focus() {}, print() {}, close() {} }; window.__kits.push(w); return w; }; });

test('grove: Lane kit asks first, then opens a print window with PEDIR, the /k/ URL and the bag photo slot', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt'); await stubPrintWindow(page);
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  let asked = ''; page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('.lane-tile[data-lane="21"] [data-kit]'); await page.waitForTimeout(200);
  expect(asked).toMatch(/replaces the red card on the rack — the old one stops working/);
  expect(api.calls.some(c => c.action === 'makeLaneKit')).toBe(false); expect(await page.evaluate(() => window.__kits.length)).toBe(0);
  page.once('dialog', d => d.accept());
  await page.click('.lane-tile[data-lane="21"] [data-kit]'); await page.waitForFunction(() => window.__kits[0] && /PEDIR/.test(window.__kits[0].document.html));
  const html = await page.evaluate(() => window.__kits[0].document.html);
  expect(html).toMatch(/PEDIR · 1 oz/); expect(html).toMatch(/\/k\/tok21/); expect(html).toMatch(/Cinta roja en el bin 42/); expect(html).toMatch(/Solo un bin abierto por carril/);
  expect(html).not.toMatch(/Outfit/);
  expect(api.calls.filter(c => c.action === 'makeLaneKit').length).toBe(1);
});

test('grove: Tape label prints page 3 only, with no API call', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt'); await stubPrintWindow(page);
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  const before = api.calls.length;
  await page.click('.lane-tile[data-lane="21"] [data-tape]'); await page.waitForFunction(() => window.__kits[0] && window.__kits[0].document.html.length > 0);
  const html = await page.evaluate(() => window.__kits[0].document.html);
  expect(html).toMatch(/Red tape at bin 42/); expect(html).toMatch(/Cinta roja en el bin 42/); expect(html).not.toMatch(/PEDIR/);
  expect(api.calls.length).toBe(before);
});

test('grove: Settings sends only the keys that changed', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('.lane-tile');
  await page.click('.lane-tile[data-lane="21"] [data-cfg]'); await page.waitForSelector('#recv[open]');
  expect(await page.$eval('#cfg-leadDays', e => e.value)).toBe('75');
  await page.fill('#cfg-leadDays', '80'); await page.selectOption('#cfg-colour', 'teal');
  await page.click('#rvSave'); await page.waitForSelector('.toast:has-text("Settings saved")');
  expect(api.calls.find(c => c.action === 'setBinConfig').body).toEqual({ cardId: 21, leadDays: 80, colour: 'teal' });
});

test('grove: a worker without bin tracking shows a plain note, not an empty board', async ({ page }) => {
  await mockApi(page, { bins: false });
  await page.goto(PAGE); await page.waitForSelector('.vt');
  await page.click('.tabs [data-view="grove"]'); await page.waitForSelector('#view-grove .unavail');
  expect(await page.$eval('#view-grove .unavail', e => e.innerText)).toMatch(/Bin tracking unavailable: .*no such table: kanban_bin_config/);
  expect(await page.$('.lane-tile')).toBeNull();
});
