// The seat screen fits one tablet screen with no scrolling (Koa 2026-11-25), in either
// orientation, in its two tallest states (the TARE banner up; the "New cultivar next
// batch" pill up). Made-up names. Every API call is answered by the fake below at the
// CONTEXT level; any other *.workers.dev request is aborted.
// Run: npx playwright test tests/seat-one-screen.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8141;
const PAGE = `http://localhost:${PORT}/src/pages/cell.html?station=table1`;
const SHOTS = process.env.LINE_SCALE_SHOTS || path.resolve(__dirname, '..', 'test-results', 'line-scale-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const SL = '2026 - Sour Lifter / Sungrown';
const LF = '2026 - Lifter / Sungrown';
// Tablets (CSS px): 10" in landscape as the home-screen app and with Chrome's bar, a 7-8"
// in landscape, and the same 10" in portrait (app, and with Chrome's bar).
// Smaller Samsungs too: a Tab A 10.1 (960x600 CSS px), a Tab A7 Lite (893x533), each in Chrome (bar
// showing) and in portrait.
const SIZES = [[1280, 800], [1280, 720], [1024, 600], [800, 1280], [800, 1180], [962, 601], [962, 545], [893, 533], [893, 475], [601, 962], [533, 893], [533, 835]];

async function open(browser, [w, h], state) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const fake = { kg: state === 'tare' ? 0.168 : 0, hours: [{ slot: '8-9', cultivar: SL, changeAt: null, changeCultivar: null }] };
  await context.route(/workers\.dev/, (route) => {
    const url = new URL(route.request().url());
    const a = url.searchParams.get('action');
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (a === 'scaleWeight') return ok({ weight: fake.kg, updatedAt: 'x', isStale: false, staleAfterS: 45, battery: { pct: 82, mv: 3990 } });
    if (a === 'lineCrew') return ok({ success: true, people: [{ id: 1, name: 'Ana María Gutiérrez' }] });
    if (a === 'lineState') return ok({ success: true, date: '2026-11-25', hours: fake.hours, seat: { personId: 1, since: '2026-11-25 16:00:00' } });
    if (a === 'getProduction') return ok({ success: true, targetRate: 1.1, production: [] });
    if (['lineSeat', 'lineScaleSave', 'scaleMark', 'setCellState', 'lineScaleSeat'].includes(a)) return ok({ success: true, rows: [] });
    return route.abort();
  });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  await page.addInitScript((phase) => {
    localStorage.setItem('ro-line:table1', JSON.stringify({ phase, person: { id: 1, name: 'Ana María Gutiérrez', day: '2026-11-25' }, seatSynced: true, basketDay: '2026-11-25' }));
  }, state === 'tare' ? 'idle' : 'armed');
  await page.clock.install({ time: new Date('2026-11-25T16:40:00Z') });   // 8:40 AM Pacific
  await page.clock.resume();
  await page.goto(PAGE);
  return { context, page, fake };
}

async function fits(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const doc = document.documentElement;
    const bottom = (sel) => { const e = document.querySelector(sel); return e && !e.hidden ? e.getBoundingClientRect().bottom : 0; };
    const ring = document.querySelector('.ring').getBoundingClientRect();
    // Nothing cut off sideways inside a card (the circle card hides its overflow).
    const clipped = [...document.querySelectorAll('.card, .tiles, #banner')].some((card) => {
      const c = card.getBoundingClientRect();
      return [...card.querySelectorAll('*')].some((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > c.right + 1 || r.bottom > c.bottom + 1); });
    });
    return {
      scrollY: doc.scrollHeight - vh, scrollX: doc.scrollWidth - vw,
      lowest: Math.max(bottom('.tiles'), bottom('.core'), bottom('#banner'), bottom('.cv'), bottom('#whoBtn')) - vh,
      ring: Math.round(Math.min(ring.width, ring.height)),
      clipped,
    };
  });
}

for (const size of SIZES) {
  test(`one screen at ${size[0]}x${size[1]}: no scrolling, the circle stays big`, async ({ browser }) => {
    // 1. Before the TARE: the yellow banner is up.
    let { context, page } = await open(browser, size, 'tare');
    await expect(page.locator('#banner')).toBeVisible();
    await page.waitForTimeout(500);
    let f = await fits(page);
    expect(f.scrollY, 'page scrolls (tare banner)').toBeLessThanOrEqual(0);
    expect(f.scrollX).toBeLessThanOrEqual(0);
    expect(f.lowest).toBeLessThanOrEqual(0);
    expect(f.ring).toBeGreaterThanOrEqual(150);
    expect(f.clipped, 'something is cut off inside a card').toBe(false);
    await page.screenshot({ path: path.join(SHOTS, `fit-${size[0]}x${size[1]}-tare.png`) });
    await context.close();

    // 2. Mid-batch with a cultivar change waiting: the "New cultivar next batch" pill is up.
    let fake;
    ({ context, page, fake } = await open(browser, size, 'run'));
    await page.waitForTimeout(1500);
    for (const kg of [0.05, 0.12, 0.21]) { fake.kg = kg; await page.waitForTimeout(1300); }
    fake.hours = [{ slot: '8-9', cultivar: SL, changeAt: '08:30', changeCultivar: LF }];
    await page.clock.fastForward(16000);
    await expect(page.locator('#cvNext')).toBeVisible();
    f = await fits(page);
    expect(f.scrollY, 'page scrolls (new cultivar pill)').toBeLessThanOrEqual(0);
    expect(f.lowest).toBeLessThanOrEqual(0);
    expect(f.ring).toBeGreaterThanOrEqual(150);
    expect(f.clipped, 'something is cut off inside a card').toBe(false);
    await page.screenshot({ path: path.join(SHOTS, `fit-${size[0]}x${size[1]}-running.png`) });
    await context.close();
  });
}
