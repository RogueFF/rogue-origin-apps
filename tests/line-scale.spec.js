// Line trimmer scale screen (cell.html) and the per-trimmer scales on Hourly entry,
// Koa 2026-11-24. Made-up names and weights. Every API call is answered by the
// fake below at the CONTEXT level, and any other *.workers.dev request is aborted,
// so nothing reaches the live API. The clock is fixed to a Tuesday morning, Pacific.
// Run: npx playwright test tests/line-scale.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8137;
const ROOT = `http://localhost:${PORT}/src/pages`;
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
const CREW = ['Ana', 'Beto', 'Carla', 'Dani', 'Elena', 'Fer', 'Gabi', 'Hugo', 'Iris', 'Juan'].map((name, i) => ({ id: i + 1, name }));

function makeFake() {
  const f = {
    kg: 0, stale: false,
    hours: [{ slot: '8-9', cultivar: SL, changeAt: null, changeCultivar: null }],
    seat: null, posts: [],
    production: [], lineHours: { fillOn: false, slots: [] },
  };
  f.handle = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    let body = {};
    if (req.method() === 'POST') { try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; } }
    if (req.method() === 'POST') f.posts.push({ action, body });
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    switch (action) {
      case 'scaleWeight': return ok({ weight: f.kg, unit: 'kg', updatedAt: '2026-11-24 17:00:00', isStale: f.stale, staleAfterS: 45, battery: { pct: 82, mv: 3990, rssi: -58 } });
      case 'lineCrew': return ok({ success: true, people: CREW });
      case 'lineState': return ok({ success: true, date: '2026-11-24', hours: f.hours, seat: f.seat });
      case 'lineSeat': f.seat = body.personId ? { personId: body.personId, since: '2026-11-24 16:52:00' } : null; return ok({ success: true, seat: f.seat });
      case 'lineScaleSeat': return ok({ success: true, date: '2026-11-24', rows: [] });
      case 'lineScaleSave': case 'scaleMark': case 'setCellState': return ok({ success: true });
      // Hourly entry
      case 'getProduction': return ok({ success: true, date: '2026-11-24', targetRate: 1.1, production: f.production });
      case 'lineScaleHours': return ok({ success: true, date: '2026-11-24', ...f.lineHours });
      case 'scoreboard': return ok({ scoreboard: {} });
      case 'version': return ok({ version: 1 });
      case 'getCultivars': return ok({ success: true, cultivars: [SL, LF] });
      case 'getShiftStart': return ok({ success: true, shiftStart: null });
      default: return ok({ success: true });
    }
  };
  return f;
}

async function rig(browser, { width = 1024, height = 1300 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const fake = makeFake();
  // Context level: every tab, every workers.dev host. Anything the fake doesn't serve is aborted.
  await context.route(/workers\.dev/, (route) => fake.handle(route).catch(() => route.abort()));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  // 8:52 AM Pacific (PST, UTC-8), a working Tuesday, no break.
  await page.clock.install({ time: new Date('2026-11-24T16:52:00Z') });
  await page.clock.resume();
  return { context, page, fake };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const posted = (fake, action) => fake.posts.filter((p) => p.action === action);
async function setKg(page, fake, kg, ms = 1500) { fake.kg = kg; await page.waitForTimeout(ms); }

test('seat screen: name tap, hour batch, changeover, the hour mark, pickup, totals sent', async ({ browser }) => {
  const { context, page, fake } = await rig(browser);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ROOT}/cell.html?station=table3`);

  // No name yet: the screen asks right away.
  await expect(page.locator('#nameDialog')).toBeVisible();
  await expect(page.locator('#nameList .name-btn')).toHaveCount(CREW.length);
  await shot(page, '0-name-tap');
  await page.locator('#nameList .name-btn', { hasText: 'Ana' }).click();
  await expect(page.locator('#nameDialog')).toBeHidden();
  await expect(page.locator('#whoName')).toHaveText('Ana');
  await expect.poll(() => posted(fake, 'lineSeat').map((p) => p.body.personId)).toContain(1);

  // The cultivar comes from Hourly entry; nothing to pick.
  await expect(page.locator('#cvName')).toHaveText('Sour Lifter');
  await expect(page.locator('select')).toHaveCount(0);

  // 0 g: the tared empty basket is armed.
  await setKg(page, fake, 0);
  await expect(page.locator('#netValue')).toHaveText('0.00 lb');
  await expect(page.locator('#toGo')).toHaveText('0.0 g');
  await expect(page.locator('#targetText')).toHaveText('of 1.10 lb goal this hour');
  await shot(page, '1-zero');

  // Mid-batch.
  for (const kg of [0.03, 0.07, 0.11, 0.15, 0.19, 0.212]) await setKg(page, fake, kg, 700);
  await page.waitForTimeout(800);
  await expect(page.locator('#netValue')).toHaveText('0.47 lb');
  await expect(page.locator('#toGo')).toHaveText('212.0 g');
  await expect(page.locator('#ringFill')).not.toHaveClass(/full/);
  await expect(page.locator('#pct')).toContainText('9:00');
  await shot(page, '2-mid-batch');

  // Hourly entry changes the cultivar mid-batch: this basket stays Sour Lifter, the next is Lifter.
  fake.hours = [{ slot: '8-9', cultivar: SL, changeAt: '08:50', changeCultivar: LF }];
  await page.clock.fastForward(16000);
  await expect(page.locator('#cvNext')).toBeVisible();
  await expect(page.locator('#cvNext')).toContainText('Lifter');
  await expect(page.locator('#cvName')).toHaveText('Sour Lifter');
  await shot(page, '3-changeover');

  // The hour mark: the swap guide covers the screen, step 1 waiting ("finished" on the Cells board).
  await page.clock.setSystemTime(new Date('2026-11-24T17:00:03Z'));
  const guide = page.locator('#swapGuide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Hour done');
  await expect(guide).toContainText('0.47 lb');
  await expect(page.locator('#swapSteps li').nth(0)).toHaveClass('now');
  await expect(page.locator('#banner')).toBeHidden();
  await expect.poll(() => posted(fake, 'setCellState').some((p) => p.body.phase === 'finished')).toBe(true);
  await shot(page, '4-swap-step1');

  // Basket A off: step 1 ticked, step 2 waiting.
  await setKg(page, fake, -0.168, 1300);
  await expect(page.locator('#swapSteps li').nth(0)).toHaveClass('done');
  await expect(page.locator('#swapSteps li').nth(1)).toHaveClass('now');
  await shot(page, '4b-swap-step2');
  // Basket B on, 6 g heavier than A: step 3, press TARE.
  await setKg(page, fake, 0.006, 1800);
  await expect(page.locator('#swapSteps li').nth(2)).toHaveClass('now');
  await shot(page, '4c-swap-step3');
  // TARE: the swap is a pickup of basket A, "Keep trimming", then the guide goes away.
  await setKg(page, fake, 0, 2500);
  await expect(page.locator('#swapDone')).toBeVisible();
  await shot(page, '4d-swap-done');
  await expect(guide).toBeHidden({ timeout: 8000 });
  await expect.poll(() => posted(fake, 'scaleMark').length).toBe(1);
  const mark = posted(fake, 'scaleMark')[0].body;
  expect(mark.kind).toBe('pickup');
  expect(mark.personId).toBe(1);
  expect(mark.cultivar).toBe(SL);
  expect(Math.abs(mark.kg - 0.212)).toBeLessThan(0.002);
  await expect(page.locator('#cvName')).toHaveText('Lifter');
  await expect(page.locator('#cvNext')).toBeHidden();
  await expect(page.locator('#dayBaskets')).toHaveText('1 batch');

  // The hour totals went to the Worker as absolute rows, the tops in 8-9 on Sour Lifter.
  await expect.poll(() => posted(fake, 'lineScaleSave').length).toBeGreaterThan(0);
  const rows = posted(fake, 'lineScaleSave').flatMap((p) => p.body.rows);
  const last = new Map();
  for (const r of rows) last.set(`${r.slot}|${r.personId}|${r.cultivar}`, r);
  const sl89 = last.get(`8-9|1|${SL}`);
  expect(sl89).toBeTruthy();
  expect(Math.abs(sl89.g - 212)).toBeLessThan(1.5);
  expect(posted(fake, 'lineScaleSave')[0].body.stationId).toBe('table3');
  await shot(page, '5-next-batch');

  // Spanish.
  await page.locator('#langToggle').click();
  await expect(page.locator('#targetText')).toContainText('meta esta hora');
  expect(errors).toEqual([]);
  await context.close();
});

test('day start: yesterday\'s batch is gone; name, TARE, "Ready: start trimming", trim', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 1300 } });
  const fake = makeFake();
  await context.route(/workers\.dev/, (route) => fake.handle(route).catch(() => route.abort()));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  // Yesterday the 4:30 batch finished and nobody swapped; the tablet kept it.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro-line:table3', JSON.stringify({
      phase: 'finished', basketDay: '2026-11-23', batchSlot: '4-4:30', cultivar: '2026 - Sour Lifter / Sungrown', nextCultivar: '',
      person: { id: 2, name: 'Beto', day: '2026-11-23' }, swap: { liftSeen: false, doneAt: null, heldG: 300 }, finishedNetG: 300,
    }));
  });
  // 6:55 AM Pacific, before the shift.
  await page.clock.install({ time: new Date('2026-11-24T14:55:00Z') });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  fake.kg = 0.168;   // the empty basket is on, not tared yet
  await page.goto(`${ROOT}/cell.html?station=table3`);

  await expect(page.locator('#swapGuide')).toBeHidden();
  await expect(page.locator('#nameDialog')).toBeVisible();
  await page.locator('#nameList .name-btn', { hasText: 'Beto' }).click();
  await expect(page.locator('#banner')).toContainText('press TARE');
  await shot(page, 'day-1-tare');
  await setKg(page, fake, 0, 3000);   // TARE on the scale
  await expect(page.locator('#banner')).toHaveText('Ready: start trimming');
  await expect(page.locator('#banner')).toHaveClass(/ready/);
  await shot(page, 'day-2-ready');
  await setKg(page, fake, 0.012, 2000);
  await expect(page.locator('#banner')).toBeHidden();
  await expect(page.locator('#netValue')).toHaveText('0.03 lb');
  await shot(page, 'day-3-trimming');
  // The hour's goal (1.10 lb/trimmer-hr x 60 min = 499 g): the circle turns green.
  for (const kg of [0.15, 0.3, 0.45, 0.52]) await setKg(page, fake, kg, 1200);
  await expect(page.locator('#ringFill')).toHaveClass(/full/);
  await expect(page.locator('#netValue')).toHaveText('1.15 lb');
  await shot(page, 'day-4-goal-met');
  expect(errors).toEqual([]);
  await context.close();
});

test('seat screen at phone width: nothing runs off the side', async ({ browser }) => {
  const { context, page, fake } = await rig(browser, { width: 375, height: 900 });
  fake.seat = null;
  await page.goto(`${ROOT}/cell.html?station=table3`);
  await page.locator('#nameList .name-btn', { hasText: 'Carla' }).click();
  await setKg(page, fake, 0.15, 2000);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
  await shot(page, '6-phone');
  await context.close();
});

test('Hourly entry: the trimmer scales are switched off (no chip, no panel, no fetch); saves still say topsTouched', async ({ browser }) => {
  const { context, page, fake } = await rig(browser, { width: 1280, height: 1400 });
  await page.addInitScript(() => {
    localStorage.setItem('hourlyEntry_tutorialComplete', 'true');
    localStorage.setItem('hourlyEntry_tooltipsDismissed', 'true');
  });
  fake.production = [{ timeSlot: '8:00 AM – 9:00 AM', trimmers1: 8, buckers1: 3, tzero1: 1, cultivar1: SL, tops1: 6.2, smalls1: 1.4, topsSource: null }];
  fake.lineHours = { fillOn: false, slots: [{ slot: '8-9', long: '8:00 AM – 9:00 AM', g: 2617.3, lb: 5.77, fill: 'hand', rows: [
    { stationId: 'table1', personId: 1, name: 'Ana', cultivar: SL, g: 680.4, lb: 1.5, min: 58 },
  ] }] };
  const asked = [];
  page.on('request', (r) => { if (/action=lineScaleHours/.test(r.url())) asked.push(r.url()); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ROOT}/hourly-entry.html`);
  const hour = page.locator('.timeline-slot', { hasText: '6.2 lbs' }).first();
  await expect(hour).toBeVisible();
  await expect(page.locator('.slot-scale')).toHaveCount(0);
  await hour.click();
  await expect(page.locator('#tops1')).toHaveValue('6.2');
  await expect(page.locator('#scale-section')).toBeHidden();
  await expect(page.locator('#line-scale-fill')).toHaveCount(0);
  await shot(page, '8-hourly-editor-scales-off');
  // A save with the tops box left alone still tells the Worker so (the fill API stays as it is).
  await page.locator('#qcNotes').fill('ok');
  await page.locator('#qcNotes').blur();
  await expect.poll(() => posted(fake, 'addProduction').length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(posted(fake, 'addProduction').at(-1).body.topsTouched).toBe(false);
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});
