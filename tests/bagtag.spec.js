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
      lines: [{ id: 5, cultivar: 'Orange Fritter', form: 'tops', bag: 'qOz', qty: 2, qtyOpen: 2, route: 'cell', why: '2026 Sungrown Tops: trimmed at a cell' }] },
    { id: 1, name: '#9001', placedAt: '2026-11-09T22:00:00Z', rush: false, state: 'queued', fifo: 2,
      carriedOver: true, changedInShopify: false, cellLines: 0, cultivars: [],
      lines: [{ id: 1, cultivar: 'Rainbow GMO', form: 'smalls', bag: 'oz1', qty: 2, qtyOpen: 2, route: 'bagging', why: 'Smalls: bagged from the pool' }] },
  ],
};

async function isolate(context) {
  const blocked = [];
  const calls = [];
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => {
    blocked.push(route.request().url());
    return route.abort();
  });
  await context.route('**/api/production**', (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    calls.push(action);
    if (action === 'orderQueue') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUEUE) });
    if (action === 'orderSync') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...QUEUE, refresh: { ok: true, orders: 2, closed: 0 } }) });
    }
    blocked.push(route.request().url());
    return route.abort();
  });
  return { blocked, calls };
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

    await page.click('#refreshBtn');
    await expect.poll(() => live.calls.includes('orderSync')).toBe(true);

    await page.click('#langToggle');
    await expect(page.locator('h1')).toHaveText('Cola de empaque');
    await expect(cards.nth(0).locator('.route.r-cell')).toHaveText('Celda');
    await expect(cards.nth(1).locator('.why')).toHaveText('Smalls: se embolsa del inventario');
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
