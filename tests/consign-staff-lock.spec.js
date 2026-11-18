// Staff money lock on the consignment staff page (consign.html). Made-up farms, cultivars and numbers.
// Staff mode shows no money anywhere; owner mode shows it; switching modes updates the screen.
// Every API call is answered by the fake below at the context level, and any other *.workers.dev
// request is aborted, so nothing reaches the live API.
// Run: npx playwright test tests/consign-staff-lock.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8134;
const PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = process.env.STAFF_LOCK_SHOTS || path.resolve(__dirname, '..', 'test-results', 'consign-staff-lock-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const OWNER_PW = 'owner-test';
const CULTIVARS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
const money0 = (o = {}) => ({ status: 'weighed', estimate: true, needs_price: false, intake_lbs: 100, pulled_lbs: 0, final_lbs: 0, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, remainder_lbs: 100, payable_main_lbs: 100, payable_smalls_lbs: 0, sold_main_lbs: 0, sold_smalls_lbs: 0, on_hand_lbs: null, value: 1337, owed: 1337, ...o });
const lot = (id, cultivar, type, o = {}) => ({ id, dropoff_id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', cultivar, type, term: 'dropoff', intake_lbs: 100, price_per_lb: 13.37, smalls_price_per_lb: 7.77, closed_at: null, voided_at: null, runs: [], sold: [], money: money0(), ...o });
const LOT_A = lot(10, 'Alpha', 'tops');
const LOT_B = lot(11, 'Beta', 'smalls', { term: 'sold', intake_lbs: null, price_per_lb: null, money: money0({ status: 'dropped', intake_lbs: null, remainder_lbs: 0, owed: 0, value: 0, on_hand_lbs: 0, needs_price: true }) });
const farmRow = (id, name, o = {}) => ({ id, name, contact: null, default_term: 'dropoff', lang: 'en', active: 1, created_at: '2026-11-01 00:00:00', balance: 4242.42, credit: 0, owed: 8484.84, paid: 4242.42, estimate: true, needs_price: false, ...o });

/**
 * small: one farm, one lot of each kind. large: 12 farms, 40 waiting lots, 10 cultivars, many payments.
 * Money is everywhere in the owner data, with odd figures, so a leak shows as a "$".
 */
function makeFake(size = 'small') {
  const large = size === 'large';
  const farms = large
    ? Array.from({ length: 12 }, (_, i) => farmRow(i + 1, `Farm ${String.fromCharCode(65 + i)} with a long name`, { balance: i % 2 ? -160.16 : 4242.42, needs_price: i % 3 === 0 }))
    : [farmRow(1, 'Farm A'), farmRow(2, 'Farm B', { balance: -160.16, credit: 160.16, needs_price: true, lang: 'es' })];
  const many = Array.from({ length: 40 }, (_, i) => lot(100 + i, `${CULTIVARS[i % 10]} long cultivar name`, i % 2 ? 'smalls' : 'tops'));
  const lots = large ? [LOT_A, LOT_B, ...many.slice(0, 12)] : [LOT_A, LOT_B];
  const prices = (large ? CULTIVARS : CULTIVARS.slice(0, 3)).flatMap((c, i) => [
    { id: i * 2 + 1, farm_id: 1, cultivar: c, type: 'tops', price_per_lb: 13.37, effective_from: '2026-01-01', created_at: 'x' },
    ...(i % 2 === 0 ? [{ id: i * 2 + 2, farm_id: 1, cultivar: c, type: 'smalls', price_per_lb: 7.77, effective_from: '2026-01-01', created_at: 'x' }] : []),
  ]);
  const payments = Array.from({ length: large ? 8 : 1 }, (_, i) => ({ id: i + 1, farm_id: 1, paid_on: '2026-11-15', amount: 4242.42, method: 'check', reference: `REF-SENTINEL-${i}`, note: null, voided_at: null }));
  const state = { posts: [], oldWorker: false };
  state.answer = (action, body) => {
    switch (action) {
      case 'farms': return farms;
      case 'open': return large ? { to_weigh: many.slice(0, 15), to_screen: many.slice(15, 35), needs_price: many.slice(35) } : { to_weigh: [LOT_B], to_screen: [LOT_A], needs_price: [LOT_B] };
      case 'farm': return {
        farm: farms.find((f) => f.id === body.farm_id) || farms[0],
        price_points: prices,
        dropoffs: (large ? [5, 6, 7] : [5]).map((id) => ({ id, farm_id: 1, dropped_at: '2026-11-14 17:30:00', dropped_by: 'T', note: '', lots })),
        payments,
        totals: { owed: 8484.84, paid: 4242.42, balance: 4242.42, credit: 0, estimate: true, needs_price: true },
        access: null,
      };
      case 'dropoff': return { dropoff: { id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00' }, lots };
      case 'saveDropoff': return { dropoff: { id: 6, farm_id: body.farm_id }, lots: [] };
      case 'setWeight': return { lot: { ...LOT_B, intake_lbs: body.intake_lbs, money: money0() } };
      case 'saveScreenRun': return { lot: { ...LOT_A, closed_at: 'x', money: money0({ status: 'closed', estimate: false }) } };
      case 'savePayment': return { payment: { id: 9, amount: body.amount }, totals: { balance: 1 } };
      default: return null;
    }
  };
  return state;
}

// The worker's staff view, roughly (workers/src/lib/consign-staff-view.js builds it from allowlists).
const MONEY_KEYS = new Set(['price_per_lb', 'smalls_price_per_lb', 'owed', 'value', 'balance', 'paid', 'credit', 'amount', 'estimate', 'payments', 'totals', 'payment', 'access']);
const staffShape = (v) => {
  if (Array.isArray(v)) return v.map(staffShape);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !MONEY_KEYS.has(k)).map(([k, x]) => [k, staffShape(x)]));
};

async function isolate(context, fake) {
  const blocked = [];
  // The guard first, so the fakes registered after it take priority.
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route('**/api/orders?action=validatePassword**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true } }) }));
  await context.route('**/api/consign?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    const owner = body.owner_password === OWNER_PW;
    fake.posts.push({ action, body });
    if ((action === 'savePayment' || (action === 'voidRow' && body.table === 'payment')) && !owner && !fake.oldWorker) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Owner password required', code: 'UNAUTHORIZED' }) });
    }
    const data = fake.answer(action, body);
    if (data == null) { blocked.push(req.url()); return route.abort(); }
    // oldWorker: a worker from before the lock, which sends money to anyone and no owner flag.
    const reply = fake.oldWorker ? { success: true, data } : { success: true, data: owner ? data : staffShape(data), owner };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return blocked;
}

async function open(page, { lang = 'en', hash = '#/', fake = makeFake(), owner = false, held = null } = {}) {
  if (!page.__acceptLeave) { page.__acceptLeave = true; page.on('dialog', (d) => d.accept()); }
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript(({ l, o, h }) => {
    localStorage.setItem('ro-lang', l);
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    if (o) sessionStorage.setItem('consign_owner_pw', o);
    if (h) localStorage.setItem('consign_held_v1', JSON.stringify(h));
  }, { l: lang, o: owner || '', h: held });
  await page.goto(PAGE + hash);
  return { fake, blocked };
}

/** All of the page's text, hidden or not, plus attribute values a person could see. */
const pageText = (page) => page.evaluate(() => {
  const attrs = [...document.querySelectorAll('[title],[aria-label],[placeholder],input[value]')].map((e) => [e.title, e.getAttribute('aria-label'), e.placeholder, e.value].join(' '));
  return `${document.body.textContent}\n${attrs.join('\n')}`;
});
async function expectNoMoney(page, label) {
  const text = await pageText(page);
  for (const bad of ['$', 'NaN', 'undefined', '13.37', '13,37', '7.77', '7,77', '4,242', '4242', 'REF-SENTINEL', 'null']) {
    expect(text.includes(bad), `${label}: shows "${bad}"`).toBe(false);
  }
  for (const id of ['#balance', '#payBtn', '.cs-price:not(:has(.noprice))', '.cs-chip.est', '[data-void^="payment|"]', 'a[href^="#/pay"]']) {
    await expect(page.locator(id), `${label}: ${id}`).toHaveCount(0);
  }
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// The dropoff form shows a type's boxes once it is ticked; tick it the way a person does.
const tickOn = async (page, cultivar, type) => {
  const box = page.locator(`[data-row="${cultivar}"] [data-on$="|${type}"]`);
  if (!(await box.isChecked())) await box.check();
};
// Controls that live in a "More" disclosure: open it the way a person does (tap its summary).
const openMore = async (page, sel = 'details.cs-more') => {
  await page.locator(sel).first().waitFor({ state: 'attached' });
  const closed = page.locator(`${sel}:not([open]) > summary`);
  while (await closed.count()) await closed.first().click();
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

/** Fill the dropoff form: smallest is one line, largest is every cultivar with both types and a split. */
async function fillDropoff(page, large) {
  await page.locator('[data-farm="1"]').click();
  const names = large ? CULTIVARS : ['Alpha'];
  for (const c of names) await page.locator('#cultPick').selectOption(c);
  for (const [i, c] of names.entries()) {
    await tickOn(page, c, 'tops');
    await page.locator(`[data-row="${c}"] [data-type="tops"] input[data-lbs]`).fill(String(10 + i));
    if (large) {
      await tickOn(page, c, 'smalls');
      await page.locator(`[data-row="${c}"] [data-type="smalls"] input[data-lbs]`).fill(String(2 + i));
    }
  }
  // A cultivar the farm has no price for: "No price" is a flag staff may see.
  await page.locator('#cultPick').selectOption('__new');
  await page.locator('#otherName').fill('Omega');
  await page.locator('#addOther').click();
  await tickOn(page, 'Omega', 'tops');
  await page.locator('[data-row="Omega"] [data-type="tops"] input[data-lbs]').fill('5');
  if (large) {
    await openMore(page, '[data-row="Alpha"] [data-type="tops"] details.cs-more');
    await page.locator('[data-row="Alpha"] [data-type="tops"] [data-split]').click();
    await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]').nth(1).fill('5');
  }
  await expect(page.locator('#summary')).toContainText('Omega');
}

test.describe('Consignment staff money lock', () => {
  for (const size of ['small', 'large']) {
    test(`staff mode shows no money on any screen (${size} content, EN and ES)`, async ({ page }) => {
      for (const lang of ['en', 'es']) {
        await page.context().unrouteAll({ behavior: 'ignoreErrors' });
        await page.goto('about:blank');
        const { blocked, fake } = await open(page, { lang, fake: makeFake(size) });
        await expect(page.locator('a.cs-farm').first()).toBeVisible();
        await expectNoMoney(page, `home ${lang}`);
        if (size === 'small') await expect(page.locator('a.cs-farm[data-farm="2"] .cs-chip.noprice')).toBeVisible();

        await page.goto(`${PAGE}#/farm/1`);
        await expect(page.locator('[data-lot="10"]').first()).toBeVisible();
        await expect(page.locator('[data-lot="11"] .cs-chip.noprice').first()).toBeVisible();
        await expectNoMoney(page, `farm ${lang}`);

        await page.goto(`${PAGE}#/dropoff`);
        await fillDropoff(page, size === 'large');
        await expect(page.locator('[data-row="Omega"] .cs-chip.noprice').first()).toBeVisible();
        await expectNoMoney(page, `dropoff + review ${lang}`);

        await page.goto(`${PAGE}#/weigh/5/11`);
        await expect(page.locator('#weight')).toBeVisible();
        await expectNoMoney(page, `weigh ${lang}`);

        await page.goto(`${PAGE}#/screen/5/10`);
        await expect(page.locator('#pulled')).toBeVisible();
        await page.locator('[data-out="final"]').fill('100');
        await expect(page.locator('#checkBar')).toHaveClass(/good/);
        await expectNoMoney(page, `screen ${lang}`);
        await page.locator('#saveBtn').click();
        await expect(page.locator('#toast')).toHaveText(lang === 'es' ? 'Guardado' : 'Saved');
        await expectNoMoney(page, `screen saved ${lang}`);

        // No owner password ever left the page in staff mode.
        expect(fake.posts.some((p) => 'owner_password' in p.body)).toBe(false);
        expect(blocked).toEqual([]);
      }
    });
  }

  test('a worker that still sends money (old worker) shows none to staff either', async ({ page }) => {
    const fake = makeFake('large');
    fake.oldWorker = true;
    const { blocked } = await open(page, { fake });
    await expect(page.locator('a.cs-farm').first()).toBeVisible();
    await expectNoMoney(page, 'home');
    await page.goto(`${PAGE}#/farm/1`);
    await expect(page.locator('[data-lot="10"]').first()).toBeVisible();
    await expectNoMoney(page, 'farm');
    await page.goto(`${PAGE}#/dropoff`);
    await fillDropoff(page, true);
    await expectNoMoney(page, 'dropoff');
    expect(blocked).toEqual([]);
  });

  test('the pay screen is owner only: staff land on Home', async ({ page }) => {
    const { blocked } = await open(page, { hash: '#/pay/1' });
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('a.cs-farm').first()).toBeVisible();
    await expect(page.locator('#amount')).toHaveCount(0);
    await expectNoMoney(page, 'pay as staff');
    expect(blocked).toEqual([]);
  });

  test('a payment held in owner mode shows no amount to staff, and the server refuses it without the owner', async ({ page }) => {
    const held = [{ id: 'pk1', action: 'savePayment', body: { farm_id: 1, farm_name: 'Farm A', amount: 4242.42, method: 'check', reference: 'REF-SENTINEL-H', client_key: 'pk1' }, held_at: Date.now() }];
    const { fake, blocked } = await open(page, { held });
    await expect(page.locator('#heldBox')).toContainText('Farm A');
    await expect(page.locator('#heldBox')).toContainText('Owner password required');
    await expectNoMoney(page, 'home with a refused payment');
    // The held body never carried a password, and staff did not add one.
    expect(fake.posts.find((p) => p.action === 'savePayment').body.owner_password).toBeUndefined();
    expect(blocked).toEqual([]);
  });

  test('owner mode shows the money; switching modes updates the screen; a refused password drops to staff', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const { fake, blocked } = await open(page, { hash: '#/farm/1' });
    await expect(page.locator('[data-lot="10"]').first()).toBeVisible();
    await expectNoMoney(page, 'farm, staff');

    // Owner on: the page fetches again with the password and draws the money.
    await page.locator('#ownerBtn').click();
    await page.locator('dialog input[name="pw"]').fill(OWNER_PW);
    await page.locator('dialog [data-act="ok"]').click();
    await expect(page.locator('#balance')).toHaveText('$4,242.42');
    await expect(page.locator('#view')).toContainText('REF-SENTINEL-0');
    await expect(page.locator('#view')).toContainText('$13.37');
    await expect(page.locator('#view a[href="#/pay/1"]')).toBeVisible();
    expect(fake.posts.filter((p) => p.action === 'farm').at(-1).body.owner_password).toBe(OWNER_PW);
    await shot(page, 'owner-farm-en-1024');

    await page.goto(`${PAGE}#/`);
    await expect(page.locator('#payBtn')).toBeVisible();
    await expect(page.locator('a.cs-farm[data-farm="1"] .cs-big')).toHaveText('$4,242.42');

    // Owner off: the money goes from the screen at once.
    await page.locator('#ownerBtn').click();
    await expect(page.locator('#toast')).toHaveText('Owner mode is off.');
    await expectNoMoney(page, 'home after owner off');
    await page.goto(`${PAGE}#/farm/1`);
    await expect(page.locator('[data-lot="10"]').first()).toBeVisible();
    await expectNoMoney(page, 'farm after owner off');

    // A wrong password: the server answers as staff, the page drops owner mode and says so.
    await page.locator('#ownerBtn').click();
    await page.locator('dialog input[name="pw"]').fill('not-the-password');
    await page.locator('dialog [data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Owner password was not accepted. Owner mode is off.');
    await expect(page.locator('#ownerBtn')).toHaveAttribute('aria-pressed', 'false');
    await expectNoMoney(page, 'farm after a refused password');
    const pw = await page.evaluate(() => sessionStorage.getItem('consign_owner_pw'));
    expect(pw).toBeNull();
    expect(blocked).toEqual([]);
  });

  test('a stale owner password saved in the tab drops to staff on the first read', async ({ page }) => {
    const { blocked } = await open(page, { owner: 'stale-password' });
    await expect(page.locator('a.cs-farm').first()).toBeVisible();
    await expect(page.locator('#ownerBtn')).toHaveAttribute('aria-pressed', 'false');
    await expectNoMoney(page, 'home with a stale password');
    expect(blocked).toEqual([]);
  });

  test('screenshots: staff Home, farm and dropoff at 375 and 1024, EN and ES; no sideways scroll', async ({ page }) => {
    for (const lang of ['en', 'es']) {
      for (const [w, h] of [[375, 812], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.context().unrouteAll({ behavior: 'ignoreErrors' });
        await page.goto('about:blank');
        const { blocked } = await open(page, { lang, fake: makeFake('small') });
        await expect(page.locator('a.cs-farm').first()).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `staff-home-${lang}-${w}`);
        await page.goto(`${PAGE}#/farm/1`);
        await expect(page.locator('[data-lot="10"]').first()).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `staff-farm-${lang}-${w}`);
        await page.goto(`${PAGE}#/dropoff`);
        await fillDropoff(page, false);
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `staff-dropoff-${lang}-${w}`);
        expect(blocked).toEqual([]);
      }
    }
  });
});
