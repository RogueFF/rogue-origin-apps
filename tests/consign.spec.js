// Consignment lot ledger, staff page (consign.html). Made-up farms, cultivars and prices only.
// The context-level guard aborts every *.workers.dev request the fake below does not
// answer, so nothing reaches the live API, in this tab or any other.
// ES modules need http, so the repo is served on its own port.
// Run: npx playwright test tests/consign.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8131;
const PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = path.resolve(__dirname, '..', 'test-results', 'consign-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
});
test.afterAll(() => { if (server) server.kill(); });

const CULTIVARS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
const money0 = (o = {}) => ({ status: 'weighed', estimate: true, needs_price: false, intake_lbs: 100, pulled_lbs: 0, final_lbs: 0, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, remainder_lbs: 100, payable_main_lbs: 100, payable_smalls_lbs: 0, sold_main_lbs: 0, sold_smalls_lbs: 0, on_hand_lbs: null, value: 1000, owed: 1000, ...o });
const LOT_A = { id: 10, dropoff_id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: 4, closed_at: null, voided_at: null, runs: [], sold: [], money: money0() };
const LOT_B = { id: 11, dropoff_id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', cultivar: 'Beta', type: 'smalls', term: 'sold', intake_lbs: null, price_per_lb: 4, smalls_price_per_lb: null, closed_at: null, voided_at: null, runs: [], sold: [], money: money0({ status: 'dropped', intake_lbs: null, remainder_lbs: 0, owed: 0, value: 0, on_hand_lbs: 0 }) };
const FARMS = [
  { id: 1, name: 'Farm A', default_term: 'dropoff', lang: 'en', active: 1, balance: 1000, credit: 0, owed: 1000, paid: 0, estimate: true, needs_price: false },
  { id: 2, name: 'Farm B', default_term: 'sold', lang: 'es', active: 1, balance: -160, credit: 160, owed: 840, paid: 1000, estimate: false, needs_price: true },
];
const PRICES = CULTIVARS.flatMap((c, i) => [
  { id: i * 2 + 1, farm_id: 1, cultivar: c, type: 'tops', price_per_lb: 10, effective_from: '2026-01-01' },
  ...(i % 2 === 0 ? [{ id: i * 2 + 2, farm_id: 1, cultivar: c, type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01' }] : []),
]);

function makeFake({ open, farms } = {}) {
  const state = {
    posts: [], offline: false, delay: 0,
    open: open || { to_weigh: [LOT_B], to_screen: [LOT_A], needs_price: [] },
    farms: farms || FARMS,
  };
  state.answer = (action, body) => {
    switch (action) {
      case 'farms': return state.farms;
      case 'open': return state.open;
      case 'farm': return {
        farm: state.farms.find((f) => f.id === body.farm_id) || state.farms[0],
        price_points: PRICES,
        dropoffs: [{ id: 5, farm_id: 1, dropped_at: '2026-11-14 17:30:00', dropped_by: 'T', note: '', lots: [LOT_A, LOT_B] }],
        payments: [{ id: 1, farm_id: 1, paid_on: '2026-11-15', amount: 500, method: 'check', reference: '1001', note: null, voided_at: null }],
        totals: { owed: 1000, paid: 500, balance: 500, credit: 0, estimate: true, needs_price: false },
      };
      case 'dropoff': return { dropoff: { id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00' }, lots: [LOT_A, LOT_B] };
      case 'saveDropoff': return { dropoff: { id: 6, farm_id: body.farm_id }, lots: [] };
      case 'saveScreenRun': return { lot: { ...LOT_A, closed_at: 'x', money: money0({ status: 'closed', estimate: false }) } };
      case 'setWeight': return { lot: { ...LOT_B, intake_lbs: body.intake_lbs, money: money0() } };
      case 'savePayment': return { payment: { id: 2 }, totals: {} };
      default: return null;
    }
  };
  return state;
}

async function isolate(context, fake) {
  const blocked = [];
  // Order matters: the guard first, so the fakes registered after it take priority.
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route('**/api/orders?action=validatePassword**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true } }) }));
  await context.route('**/api/consign?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    if (action.startsWith('save') || action === 'setWeight') {
      fake.posts.push({ action, body });
      if (fake.offline) return route.abort('internetdisconnected');
      if (fake.delay) await new Promise((r) => setTimeout(r, fake.delay));
    }
    const data = fake.answer(action, body);
    if (data == null) { blocked.push(req.url()); return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  return blocked;
}

// Leaving a filled form asks "leave without saving?"; these specs mean to leave.
const acceptLeave = (page) => { if (!page.__acceptLeave) { page.__acceptLeave = true; page.on('dialog', (d) => d.accept()); } };

async function open(page, { lang = 'en', hash = '#/', fake = makeFake() } = {}) {
  acceptLeave(page);
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript((l) => {
    if (sessionStorage.getItem('seeded')) return; // keep held entries across reloads
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    localStorage.setItem('ro-lang', l);
  }, lang);
  await page.goto(PAGE + hash);
  return { fake, blocked };
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('Consignment lot ledger', () => {
  test('one-line dropoff (EN): Saved shows only after the server answers', async ({ page }) => {
    const fake = makeFake();
    fake.delay = 300;
    const { blocked } = await open(page, { hash: '#/dropoff', fake });
    await page.locator('[data-farm="1"]').click();
    await page.getByRole('button', { name: '＋ Alpha' }).click();
    await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]').fill('42.5');
    await expect(page.locator('[data-row="Alpha"] [data-on$="|tops"]')).toBeChecked();
    await expect(page.locator('#summary')).toContainText('42.5');
    const save = page.locator('#saveBtn');
    await save.click();
    await expect(save).toHaveText('Saving…');
    await expect(save).toBeDisabled();
    await expect(page.locator('#toast')).toHaveText('Saved');
    await expect(page).toHaveURL(/#\/$/);
    const post = fake.posts.find((p) => p.action === 'saveDropoff');
    expect(post.body.lines).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 42.5 }]);
    expect(post.body.client_key).toBeTruthy();
    expect(blocked).toEqual([]);
  });

  test('ten cultivars with both types and a split (ES, 375 wide)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const fake = makeFake();
    const { blocked } = await open(page, { lang: 'es', hash: '#/dropoff', fake });
    await page.locator('[data-farm="1"]').click();
    for (const c of CULTIVARS) await page.getByRole('button', { name: `＋ ${c}` }).click();
    for (const [i, c] of CULTIVARS.entries()) {
      await page.locator(`[data-row="${c}"] [data-type="tops"] input[data-lbs]`).fill(String(10 + i));
      await page.locator(`[data-row="${c}"] [data-type="smalls"] input[data-lbs]`).fill(String(2 + i));
    }
    await page.locator('[data-row="Alpha"] [data-type="tops"] [data-split]').click();
    await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]').nth(1).fill('5');
    await expect(page.locator('#saveBtn')).toHaveText('Guardar entrega');
    expect(await noHorizontalScroll(page)).toBe(true);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'dropoff-es-375-full.png'), fullPage: true });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Guardado');
    const post = fake.posts.find((p) => p.action === 'saveDropoff');
    expect(post.body.lines).toHaveLength(21);
    expect(post.body.lines.filter((l) => l.cultivar === 'Alpha' && l.type === 'tops').map((l) => l.term)).toEqual(['dropoff', 'sold']);
    expect(blocked).toEqual([]);
  });

  test('screening: off by 10 lb blocks Save, fixing it saves with finishes_lot', async ({ page }) => {
    const fake = makeFake();
    const { blocked } = await open(page, { hash: '#/screen/5/10', fake });
    await expect(page.locator('#pulled')).toHaveValue('100');
    await page.locator('[data-out="final"]').fill('70');
    await page.locator('[data-out="toSmalls"]').fill('10');
    await page.locator('[data-out="biomass"]').fill('8');
    await page.locator('[data-out="mold"]').fill('2');
    await expect(page.locator('#checkBar')).toHaveClass(/bad/);
    await expect(page.locator('#checkBar')).toContainText('Off by 10 lb (allowed 1 lb)');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await page.locator('[data-out="final"]').fill('80');
    await expect(page.locator('#checkBar')).toHaveClass(/good/);
    await expect(page.locator('#checkBar')).toContainText('Adds up');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const post = fake.posts.find((p) => p.action === 'saveScreenRun');
    expect(post.body).toMatchObject({ lot_id: 10, pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true });
    expect(blocked).toEqual([]);
  });

  test('no signal: the save is held, then sent with the same client_key', async ({ page }) => {
    const fake = makeFake();
    fake.offline = true;
    const { blocked } = await open(page, { hash: '#/dropoff', fake });
    await page.locator('[data-farm="1"]').click();
    await page.getByRole('button', { name: '＋ Beta' }).click();
    await page.locator('[data-row="Beta"] [data-type="tops"] input[data-lbs]').fill('12');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toContainText('No signal');
    await expect(page.locator('#heldChip')).toBeVisible();
    await expect(page.locator('#heldChip')).toHaveText('1 held');
    await expect(page.locator('#sendHeldBtn')).toBeVisible();
    fake.offline = false;
    await page.locator('#heldChip').click();
    await expect(page.locator('#heldChip')).toBeHidden();
    const sends = fake.posts.filter((p) => p.action === 'saveDropoff');
    expect(sends).toHaveLength(2);
    expect(sends[1].body.client_key).toBe(sends[0].body.client_key);
    expect(blocked).toEqual([]);
  });

  test('staff cannot edit prices; owner mode shows the price controls', async ({ page }) => {
    const { blocked } = await open(page, { hash: '#/dropoff' });
    await page.locator('[data-farm="1"]').click();
    await page.getByRole('button', { name: '＋ Alpha' }).click();
    await expect(page.locator('.cs-price').first()).toContainText('$10.00');
    await expect(page.locator('input[name*="price"], [data-price-input]')).toHaveCount(0);
    await page.goto(`${PAGE}#/farm/1`);
    await expect(page.locator('#balance')).toHaveText('$500.00');
    await expect(page.locator('#addPrice')).toBeHidden();
    await expect(page.locator('[data-terms]').first()).toBeHidden();
    await expect(page.locator('#view input')).toHaveCount(0);
    await page.locator('#ownerBtn').click();
    await page.locator('dialog input[name="pw"]').fill('owner-test');
    await page.locator('dialog [data-act="ok"]').click();
    await expect(page.locator('#addPrice')).toBeVisible();
    expect(blocked).toEqual([]);
  });

  test('home at the extremes: empty, and 40 waiting lots with 12 farms', async ({ page }) => {
    for (const [w, h] of [[375, 812], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      const empty = makeFake({ open: { to_weigh: [], to_screen: [], needs_price: [] }, farms: [] });
      await page.context().unrouteAll({ behavior: 'ignoreErrors' });
      await page.goto('about:blank'); // a real load, not a same-page hash change
      await open(page, { fake: empty });
      await expect(page.locator('[data-card="toWeigh"]')).toContainText('Nothing waiting.');
      await expect(page.locator('#view')).toContainText('No farms yet');
      expect(await noHorizontalScroll(page)).toBe(true);

      const many = Array.from({ length: 40 }, (_, i) => ({ ...LOT_A, id: 100 + i, cultivar: `Cultivar with a long name ${i}`, farm_name: `Farm ${String.fromCharCode(65 + (i % 12))} with a long name` }));
      const farms = Array.from({ length: 12 }, (_, i) => ({ ...FARMS[i % 2], id: 50 + i, name: `Farm ${String.fromCharCode(65 + i)}` }));
      await page.context().unrouteAll({ behavior: 'ignoreErrors' });
      const blocked = await isolate(page.context(), makeFake({ open: { to_weigh: many.slice(0, 15), to_screen: many.slice(15, 35), needs_price: many.slice(35) }, farms }));
      await page.reload();
      await expect(page.locator('[data-card="toScreen"] .cs-count')).toHaveText('20');
      await expect(page.locator('a.cs-farm')).toHaveCount(12);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(blocked).toEqual([]);
    }
  });

  test('screenshots: home, dropoff and screening at 375 and 1024, EN and ES', async ({ page }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const fake = makeFake();
    acceptLeave(page);
    const blocked = await isolate(page.context(), fake);
    await page.addInitScript(() => localStorage.setItem('ro_api_password', 'test-only'));
    for (const lang of ['en', 'es']) {
      for (const [w, h] of [[375, 812], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${PAGE}#/`);
        await page.evaluate((l) => localStorage.setItem('ro-lang', l), lang);
        await page.reload();
        await expect(page.locator('[data-card="toScreen"] .cs-count')).toHaveText('1');
        await page.screenshot({ path: path.join(SHOTS, `home-${lang}-${w}.png`), fullPage: true });
        expect(await noHorizontalScroll(page)).toBe(true);

        await page.goto(`${PAGE}#/dropoff`);
        await page.locator('[data-farm="1"]').click();
        await page.getByRole('button', { name: '＋ Alpha' }).click();
        await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]').fill('100');
        await page.locator('[data-row="Alpha"] [data-on$="|smalls"]').check();
        await page.getByRole('button', { name: '＋ Beta' }).click();
        await page.locator('[data-row="Beta"] [data-type="tops"] [data-split]').click();
        await page.locator('[data-row="Beta"] [data-type="tops"] input[data-lbs]').first().fill('30');
        await page.locator('[data-row="Beta"] [data-type="tops"] input[data-lbs]').nth(1).fill('70');
        await page.screenshot({ path: path.join(SHOTS, `dropoff-${lang}-${w}.png`), fullPage: true });
        expect(await noHorizontalScroll(page)).toBe(true);

        await page.goto(`${PAGE}#/screen/5/10`);
        await page.locator('[data-out="final"]').fill('80');
        await page.locator('[data-out="toSmalls"]').fill('10');
        await page.locator('[data-out="biomass"]').fill('6');
        await page.locator('[data-out="mold"]').fill('2');
        await expect(page.locator('#checkBar')).toHaveClass(/bad/);
        await page.screenshot({ path: path.join(SHOTS, `screen-${lang}-${w}.png`), fullPage: true });
        expect(await noHorizontalScroll(page)).toBe(true);
      }
    }
    expect(blocked).toEqual([]);
  });
});
