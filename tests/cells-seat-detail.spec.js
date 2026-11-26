// Cells board: tap a seat's card for its hour-by-hour and key metrics (Koa 2026-11-25).
// Made-up names and weights. Every API call is answered by the fake below at the CONTEXT
// level, and any other *.workers.dev request is aborted, so nothing reaches the live API.
// Run: npx playwright test tests/cells-seat-detail.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8139;
const PAGE = `http://localhost:${PORT}/src/pages/cells.html`;
const SHOTS = process.env.LINE_SCALE_SHOTS || path.resolve(__dirname, '..', 'test-results', 'line-scale-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const G = 453.59237;
const LF = '2026 - Lifter / Sungrown';
const NOW = Date.parse('2026-11-25T22:20:00Z');   // 2:20 PM Pacific
const board = {
  serverNow: NOW, waiting: [],
  cells: [
    { stationId: 'table1', label: 'Cell 1', lane: 'wholesale', scale: { weightG: 179.8, live: true, battery: { pct: 64 } },
      job: { phase: 'running', tabletOnline: true, cultivar: LF, bag: null, targetG: null, clockStart: NOW - 12 * 60000 } },
    { stationId: 'table2', label: 'Cell 2', lane: 'wholesale', scale: null,
      job: { phase: 'idle', tabletOnline: true, cultivar: null } },
    { stationId: 'table3', label: 'Cell 3', lane: 'wholesale', scale: { weightG: 460, live: true },
      job: { phase: 'finished', tabletOnline: true, cultivar: LF, finishedNetG: 460, finishedAt: NOW - 60000 } },
    { stationId: 'table6', label: 'Cell 6', lane: 'wholesale', scale: { weightG: null, live: false },
      job: { phase: 'running', tabletOnline: true, cultivar: LF, clockStart: NOW - 60000 } },
  ],
};
const seat1 = {
  success: true, date: '2026-11-25',
  rows: [
    { slot: '11-12', personId: 5, cultivar: LF, g: 170.8, min: 1.8 },
    { slot: '12-1', personId: 5, cultivar: LF, g: 227.8, min: 25.7 },
    { slot: '1-2', personId: 5, cultivar: LF, g: 946.7, min: 60 },
    { slot: '2-3', personId: 5, cultivar: LF, g: 300.4, min: 20 },
  ],
  pickups: [{ ts: '2026-11-25 21:27:01', g: 463.3, cycleS: 1507, personId: 5, cultivar: LF }, { ts: '2026-11-25 22:01:39', g: 483.5, cycleS: 1957, personId: 5, cultivar: LF }],
  names: { 5: 'Diego' },
};

test('tap a seat card: today, pace, batches, best hour, hours at goal, and the hour-by-hour', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const asked = [];
  await context.route(/workers\.dev/, async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    asked.push(`${action}${url.searchParams.get('stationId') ? `:${url.searchParams.get('stationId')}` : ''}`);
    const ok = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (action === 'cellBoard') return ok(board);
    if (action === 'cellQueue') return ok({ cells: [] });
    if (action === 'getProduction') return ok({ success: true, targetRate: 1.1, production: [] });
    if (action === 'lineScaleHours') return ok({ success: true, date: '2026-11-25', fillOn: false, slots: [{ slot: '2-3', rows: [
      { stationId: 'table1', personId: 5, name: 'Diego', g: 300.4, min: 20 },
      { stationId: 'table2', personId: 6, name: 'Ana', g: 520, min: 20 },
      { stationId: 'table3', personId: 7, name: 'Beto', g: 120, min: 20 },
      { stationId: 'table6', personId: 8, name: 'Carla', g: 260, min: 20 },
    ] }] });
    if (action === 'lineScaleSeat') return url.searchParams.get('stationId') === 'table1' ? ok(seat1) : ok({ error: 'Not a scale seat' }, 400);
    return route.abort();
  });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(PAGE);
  // The floor is the default view (Koa 2026-11-25).
  await expect(page.locator('#floor svg')).toBeVisible();
  await expect(page.locator('#floor [data-station]')).toHaveCount(16);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'cells-floor.png') });
  await page.locator('#floor [data-station="table1"]').click();
  await expect(page.locator('.sd-overlay h2')).toHaveText('Seat 2 · today');
  await page.keyboard.press('Escape');
  await page.locator('#viewCards').click();
  const card = page.locator('.tile', { hasText: 'Cell 1' });
  await expect(card).toBeVisible();
  await card.click();
  const panel = page.locator('.sd-overlay');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toHaveText('Seat 2 · today');
  await expect(panel.locator('.sd-table tbody tr')).toHaveCount(4);
  await expect(panel.locator('.sd-tile').nth(0)).toContainText(`${((170.8 + 227.8 + 946.7 + 300.4) / G).toFixed(2)} lb`);
  await expect(panel.locator('.sd-tile').nth(2)).toContainText('2');
  await expect(panel.locator('.sd-tile').nth(3)).toContainText('1–2');
  await expect(panel.locator('tr.now')).toContainText('2–3');
  await expect(panel).toContainText('Diego');
  await page.screenshot({ path: path.join(SHOTS, 'cells-seat-detail.png') });
  expect(asked).toContain('lineScaleSeat:table1');
  // Esc closes it; a seat with no scale says so.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.locator('.tile', { hasText: 'Cell 2' }).click();
  await expect(panel).toContainText('Nothing weighed');
  await page.locator('.sd-close').click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
