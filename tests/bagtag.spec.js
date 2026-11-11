// Bag/tag queue page (bagtag.html, order flow slice 1). Made-up orders only.
// The context-level guard aborts every *.workers.dev request that the mock
// below doesn't answer, so the live API is never hit.
// ES modules need http, so the repo is served on its own port.
// Run: npx playwright test tests/bagtag.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8123;
const PAGE = `http://localhost:${PORT}/src/pages/bagtag.html`;
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
});
test.afterAll(() => { if (server) server.kill(); });
const NOW = Date.parse('2026-11-10T18:00:00Z');

const QUEUE = {
  serverNow: NOW,
  configured: true,
  sync: { lastTryAt: '2026-11-10 17:58:00', lastOkAt: '2026-11-10 17:58:00', lastError: null, count: 3 },
  fulfilledToday: 2,
  orders: [
    { id: 3, name: '#9003', placedAt: '2026-11-10T15:00:00Z', rush: true, rushWhy: 'UPS Next Day Air', state: 'queued', fifo: 1,
      carriedOver: false, changedInShopify: false, cellLines: 1, cultivars: ['Orange Fritter'],
      cell: { stationId: 'table1', label: 'Cell 1', slot: 'NOW', why: 'cell is free', scale: true, baskets: 1, done: 0, started: false, nowJobId: 1 },
      lines: [{ id: 5, cultivar: 'Orange Fritter', form: 'tops', bag: 'qOz', qty: 2, qtyOpen: 2, route: 'cell', why: '2026 Sungrown Tops: trimmed at a cell' }] },
    { id: 1, name: '#9001', placedAt: '2026-11-09T22:00:00Z', rush: false, state: 'queued', fifo: 2,
      carriedOver: true, changedInShopify: false, cellLines: 0, cultivars: [],
      lines: [{ id: 1, cultivar: 'Rainbow GMO', form: 'smalls', bag: 'oz1', qty: 2, qtyOpen: 2, route: 'bagging', why: 'Smalls: bagged from the pool' }] },
  ],
};

const PRINT = {
  order: { id: 3, name: '#9003', rush: true, confirmedAt: null },
  slipUrl: 'https://admin.shopify.com/store/example-store/orders/3',
  lines: [{ cultivar: 'Orange Fritter', form: 'tops', bag: 'qOz', qty: 2, route: 'cell' }],
  coas: [{ cultivar: 'Orange Fritter', file: 'Orange-Fritter-PostHarvest-G1396-2026.pdf' }, { cultivar: 'Purple Snowman', missing: true }],
};

async function isolate(context) {
  const blocked = [];
  const calls = [];
  const posts = [];
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  await context.route('**/api/production**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    calls.push(action);
    if (action === 'orderQueue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUEUE) });
    if (action === 'orderAction') { posts.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); }
    if (action === 'orderPrint') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRINT) });
    if (action === 'coaPdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' });
    if (action === 'cellQueue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ serverNow: NOW, cells: [] }) });
    if (action === 'orderSync') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...QUEUE, refresh: { ok: true, orders: 2, closed: 0 } }) });
    }
    blocked.push(route.request().url());
    return route.abort();
  });
  return { blocked, calls, posts };
}

test.describe('Bag/tag queue', () => {
  test('rush first, route chips, carried over, Refresh, Spanish', async ({ page }) => {
    const live = await isolate(page.context());
    await page.addInitScript(() => localStorage.setItem('ro-lang', 'en'));
    await page.goto(PAGE);
    const cards = page.locator('#toStart .order');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('#9003');
    await expect(cards.nth(0)).toContainText('RUSH');
    await expect(cards.nth(0).locator('.route.r-cell')).toHaveText('Cell');
    await expect(cards.nth(0)).toContainText('Orange Fritter · Tops · ¼ oz × 2');
    await expect(cards.nth(1)).toContainText('Carried over');
    await expect(cards.nth(1).locator('.route.r-bagging')).toHaveText('Bagging');
    await expect(page.locator('#counts')).toContainText('2 fulfilled today');

    // Slice 2: the order is on a cell already; the one click confirms it.
    await expect(cards.nth(0).locator('.cell-line')).toContainText('Cell 1 · NOW');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), cards.nth(0).locator('.btn.primary').click()]);
    await expect(popup).toHaveURL(/print\.html\?order=3&auto=1/);
    await expect.poll(() => live.posts.length).toBe(1);
    await popup.close();
    expect(live.posts[0]).toEqual({ orderId: 3, op: 'confirm' });

    await page.click('#refreshBtn');
    await expect.poll(() => live.calls.includes('orderSync')).toBe(true);

    await page.click('#langToggle');
    await expect(page.locator('h1')).toHaveText('Cola de empaque');
    await expect(cards.nth(0).locator('.route.r-cell')).toHaveText('Celda');
    await expect(cards.nth(1).locator('.why')).toHaveText('Smalls: se embolsa del inventario');
    expect(live.blocked).toEqual([]);
  });

  test('the papers tab: COA prints, a missing COA is named, the slip opens in Shopify', async ({ page }) => {
    const live = await isolate(page.context());
    await page.addInitScript(() => { localStorage.setItem('ro-lang', 'en'); window.__prints = 0; });
    await page.goto(`http://localhost:${PORT}/src/pages/print.html?order=3`);
    await expect(page.locator('h1')).toHaveText('#9003 · Papers');
    await expect(page.locator('.coa.missing')).toContainText('No COA for Purple Snowman');
    await expect(page.locator('#slip a')).toHaveAttribute('href', PRINT.slipUrl);
    await page.locator('.coa').first().locator('.btn').click();
    // Headless Chromium has no PDF viewer, so it lands on the fallback link; a real Chrome prints.
    await expect(page.locator('.coa').first().locator('.status')).toHaveText(/Sent to print|Open the COA to print it/, { timeout: 8000 });
    expect(live.calls).toContain('coaPdf');
    expect(live.blocked).toEqual([]);
  });

  test('says when Shopify is not connected', async ({ page }) => {
    await isolate(page.context());
    await page.route('**/api/production**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ...QUEUE, configured: false, sync: null, orders: [] }),
    }));
    await page.addInitScript(() => localStorage.setItem('ro-lang', 'en'));
    await page.goto(PAGE);
    await expect(page.locator('#info')).toContainText('Shopify is not connected yet');
    await expect(page.locator('#syncLine')).toHaveText('Not synced yet');
  });
});
