// @ts-check
//
// Floor Manager — end-to-end wiring.
//
// Five tests, all against mocked routes with the real response shapes from the
// phase 1 spec's "Backend contract". The one that earns its keep is the Enter
// save: the legacy page dropped an edit made while a request was in the air and
// posted a second row on the blur that followed its own focus move, so this
// asserts EXACTLY one POST and pins all eighteen keys of the addProduction body
// rather than spot-checking three of them. A key silently missing from that
// body is a column the worker zeroes.
//
// The clock is fixed at 10:15 AM local so the ribbon, the selected hour and the
// slot the payload lands on are the same at any time of day the suite runs;
// setFixedTime freezes Date without stopping the page's timers, so the polls
// and the bag countdown still behave as they do in production.
const { test, expect } = require('@playwright/test');

// FLOOR_URL points the suite at another checkout's server, such as a worktree
// served on its own port; the default is the main checkout's.
const BASE_URL = process.env.FLOOR_URL || 'http://localhost:5500/src/pages/floor.html';
const MOCK_TARGET_RATE = 1.35;

/** Every key the worker's addProduction handler is sent, in contract order. */
const PAYLOAD_KEYS = [
  'date', 'timeSlot',
  'buckers1', 'trimmers1', 'tzero1', 'cultivar1', 'tops1', 'smalls1',
  'buckers2', 'trimmers2', 'tzero2', 'cultivar2', 'tops2', 'smalls2',
  'qcperson', 'qcNotes', 'effectiveTrimmers1', 'effectiveTrimmers2',
];

/** shared/api.js unwraps the outer envelope, so every fixture is wrapped once. */
function json(data) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  };
}

/** Local calendar date, never toISOString — the page keys the day on this. */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fixedMorning() {
  const d = new Date();
  d.setHours(10, 15, 0, 0);
  return d;
}

const QUEUE_BRIEF = {
  headline: {
    mode: 'now',
    cultivarId: 'cv-1',
    cultivarName: 'Godfather OG',
    form: 'tops',
    orderId: 'o-1',
    orderRef: '#35453',
    nickname: 'Godfather run',
    doneLbs: 15.5,
    totalLbs: 30,
    pct: 0.52,
  },
  next: {
    mode: 'next',
    cultivarId: 'cv-2',
    cultivarName: 'Passion Fruit OG',
    form: 'smalls',
    orderId: 'o-1',
    orderRef: '#35453',
    nickname: 'Godfather run',
    doneLbs: 0,
    totalLbs: 20,
    pct: 0,
  },
  blocks: [{
    orderId: 'o-1',
    orderRef: '#35453',
    nickname: 'Godfather run',
    cultivarName: 'Godfather OG',
    form: 'tops',
    doneLbs: 15.5,
    totalLbs: 50,
    pct: 0.31,
    finish: { date: todayLocal(), minutes: 640 },
    passes: [{
      cultivarId: 'cv-1',
      cultivarName: 'Godfather OG',
      form: 'tops',
      doneLbs: 15.5,
      totalLbs: 30,
      pct: 0.52,
      finish: { date: todayLocal(), minutes: 640 },
      lines: [{ lineId: 'l-1', form: 'tops', qtyLbs: 30, doneLbs: 15.5, creditedLbs: 0 }],
    }],
  }],
  blocksTotal: 1,
  queueAliases: ['2025 Lifter'],
};

/**
 * Mock every endpoint the page touches. `posts` collects the addProduction
 * bodies so a test can count them; `production` seeds getProduction.
 */
async function mockApi(page, { posts = [], production = [] } = {}) {
  await page.route('**/api/production**', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');

    if (action === 'getProduction') {
      return route.fulfill(json({
        success: true,
        date: todayLocal(),
        targetRate: MOCK_TARGET_RATE,
        timeSlots: [],
        production,
      }));
    }
    if (action === 'getCultivars') {
      return route.fulfill(json({ cultivars: ['2025 Lifter', '2025 Cherry'] }));
    }
    if (action === 'getShiftStart' || action === 'setShiftStart') {
      return route.fulfill(json({ shiftAdjustment: null }));
    }
    if (action === 'scoreboard') {
      return route.fulfill(json({
        scoreboard: { todayTarget: 88, projectedTotal: 84 },
        timer: {
          bagsToday: 3,
          bags5kgToday: 3,
          bags10lbToday: 0,
          targetSeconds: 2400,
          lastBagTime: null,
          avgSecondsToday: 0,
          currentTrimmers: 12,
        },
        date: todayLocal(),
      }));
    }
    if (action === 'version') {
      return route.fulfill(json({ version: 1, updatedAt: `${todayLocal()}T10:00:00.000Z` }));
    }
    if (action === 'scaleWeight') {
      return route.fulfill(json({
        weight: 4.812,
        targetWeight: 5,
        unit: 'g',
        bagMode: '5kg',
        percentComplete: 96,
        isStale: false,
      }));
    }
    if (action === 'addProduction') {
      posts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill(json({ success: true, message: 'ok', id: 1 }));
    }
    return route.fulfill(json({}));
  });

  await page.route('**/api/wholesale**', (route) => route.fulfill(json(QUEUE_BRIEF)));
  await page.route('**/api/pool**', (route) => route.fulfill(json({ products: [], entries: [] })));
}

/** Boot the page with the clock pinned, and wait for the first render. */
async function open(page, opts = {}) {
  await page.clock.setFixedTime(fixedMorning());
  await mockApi(page, opts);
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.tick[aria-current="true"]')).toHaveCount(1);
}

test.describe('Floor Manager', () => {

  test('loads with no console errors and no page errors', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await open(page);
    // Long enough for the 5s version poll and its refresh to land, which is
    // where a wiring mistake between main and the render modules would surface.
    await page.waitForTimeout(6000);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#hourTitle')).toHaveText('10–11 AM');
  });

  test('Enter sends exactly one addProduction with the full payload', async ({ page }) => {
    const posts = [];
    await open(page, { posts });

    const slot = await page.locator('.tick[aria-current="true"]').getAttribute('data-index');
    expect(slot).toBe('3'); // 10:00-11:00 AM, from the pinned clock

    await page.locator('#trimmers1').fill('5');
    await page.locator('#tops1').fill('7.2');
    await page.locator('#tops1').press('Enter');

    // The debounce is 1s; anything queued behind the flush would fire inside
    // this window, so a second POST has time to show up if the saver drops one.
    await page.waitForTimeout(1500);

    expect(posts).toHaveLength(1);
    const payload = posts[0];
    expect(Object.keys(payload).sort()).toEqual([...PAYLOAD_KEYS].sort());
    expect(payload).toEqual({
      date: todayLocal(),
      timeSlot: '10:00 AM – 11:00 AM',
      buckers1: 0,
      trimmers1: 5,
      tzero1: 1,
      cultivar1: '',
      tops1: 7.2,
      smalls1: 0,
      buckers2: 0,
      trimmers2: 0,
      tzero2: 1,
      cultivar2: '',
      tops2: 0,
      smalls2: 0,
      qcperson: 1,
      qcNotes: '',
      effectiveTrimmers1: 5,
      effectiveTrimmers2: 0,
    });

    // Enter walks to the next field rather than submitting anything.
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).toBe('smalls1');
  });

  test('ArrowRight moves the selected hour', async ({ page }) => {
    await open(page);

    const before = await page.locator('.tick[aria-current="true"]').getAttribute('data-index');
    // Nothing is focused after load, so the arrow belongs to the ribbon.
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('BODY');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.tick[aria-current="true"]'))
      .toHaveAttribute('data-index', String(Number(before) + 1));
    await expect(page.locator('#hourTitle')).toHaveText('11 AM–12 PM');
  });

  test('the ES button translates the page', async ({ page }) => {
    await open(page);

    await expect(page.locator('#reasonsLead')).toHaveText('Why? (optional)');
    await page.locator('#langBtn').click();

    await expect(page.locator('#reasonsLead')).toHaveText('¿Por qué? (opcional)');
    await expect(page.locator('#chips .rchip').first()).toContainText('máquina parada');
    // The hour title is a clock reading, not a phrase — it stays put.
    await expect(page.locator('#hourTitle')).toHaveText('10–11 AM');

    await page.locator('#langBtn').click();
    await expect(page.locator('#reasonsLead')).toHaveText('Why? (optional)');
  });

  test('with no shift start the ribbon shows all ten hours', async ({ page }) => {
    await open(page);
    await expect(page.locator('#ribbon .tick')).toHaveCount(10);
    // No manual start time means the button offers to start the day.
    await expect(page.locator('#shiftLabel')).toHaveText('Start Day');
  });

});
