// Consignment stage 4: the partner farm's own page, and the owner's "Farm's page" card.
// Made-up farms, cultivars and prices only. The link is made at run time.
// Every *.workers.dev request is aborted at the context level unless the fake answers it,
// so nothing can reach the live API.
// Run: npx playwright test tests/consign-farm.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8134;
const FARM_PAGE = `http://localhost:${PORT}/src/pages/consign-farm.html`;
const STAFF_PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = path.resolve(__dirname, '..', 'test-results', 'consign-farm-shots');
const LINK = 'Q'.repeat(20) + '_' + 'z'.repeat(22); // 43 characters, shape only
const PIN = '2468';

let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

/* ---------- fixtures ---------- */

const lot = (o) => ({
  id: 1, cultivar: 'Alpha', type: 'tops', term: 'dropoff', status: 'weighed', intake_lbs: 40, price_per_lb: 10, smalls_price_per_lb: 4,
  needs_price: false, estimate: true, owed: 400, final_lbs: null, to_smalls_lbs: null, biomass_lbs: null, mold_lbs: null,
  sold_lbs: null, on_hand_lbs: null, note: null, ...o,
});

const SMALL = {
  farm: { name: 'Farm A', lang: 'en' },
  totals: { balance: 400, owed: 400, paid: 0, estimate: true, last_payment_on: null },
  price_points: [{ cultivar: 'Alpha', type: 'tops', price_per_lb: 10 }],
  dropoffs: [{ id: 1, dropped_at: '2026-11-10 17:00:00', lots: [lot({})] }],
  payments: [],
};

const CULTIVARS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa Long Cultivar Name'];
function large() {
  let id = 0;
  const price_points = CULTIVARS.flatMap((c, i) => [
    { cultivar: c, type: 'tops', price_per_lb: 10 + i },
    { cultivar: c, type: 'smalls', price_per_lb: 4 + i / 2 },
  ]);
  const dropoffs = CULTIVARS.map((c, i) => ({
    id: 100 + i,
    dropped_at: `2026-11-${String(15 - i).padStart(2, '0')} 17:00:00`,
    lots: [
      lot({ id: ++id, cultivar: c, type: 'tops', status: i % 3 === 0 ? 'closed' : i % 3 === 1 ? 'screening' : 'dropped',
        intake_lbs: i % 3 === 2 ? null : 1234.5 + i, needs_price: i === 4, price_per_lb: i === 4 ? null : 10 + i,
        estimate: i % 3 !== 0, owed: 12345.67 + i,
        ...(i % 3 !== 2 ? { final_lbs: 1000 + i, to_smalls_lbs: 120.25, biomass_lbs: 80, mold_lbs: 4.25 } : {}),
        ...(i === 3 ? { term: 'sold', sold_lbs: 600, on_hand_lbs: 520.25 } : {}),
        note: i === 0 ? 'Two bags were damp on arrival; dried before weighing.' : null }),
      lot({ id: ++id, cultivar: c, type: 'smalls', status: i % 2 ? 'closed' : 'weighed', intake_lbs: 300 + i, price_per_lb: 4 + i / 2, smalls_price_per_lb: null,
        owed: 1500 + i, estimate: !(i % 2),
        ...(i % 2 ? { final_lbs: 290 + i, to_smalls_lbs: 0, biomass_lbs: 8, mold_lbs: 2 } : {}),
        ...(i === 5 ? { term: 'sold', sold_lbs: 100, on_hand_lbs: 195 } : {}) }),
    ],
  }));
  const payments = Array.from({ length: 8 }, (_, i) => ({
    paid_on: `2026-11-${String(16 - i).padStart(2, '0')}`, amount: 25000 + i * 1000, method: ['check', 'cash', 'transfer'][i % 3], reference: i % 3 === 0 ? `10${i}` : null,
  }));
  return {
    farm: { name: 'Farm B', lang: 'es' },
    totals: { balance: -4321.5, owed: 200000, paid: 204321.5, estimate: true, last_payment_on: '2026-11-16' },
    price_points, dropoffs, payments,
  };
}

/* ---------- the fake API ---------- */

function makeFake(o = {}) {
  return {
    revoked: false, needsPin: false, lockedMinutes: 0, triesLeft: 5, lang: 'en', data: SMALL, calls: [], ...o,
  };
}

async function isolate(context, fake) {
  const blocked = [];
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route(/\/api\/consign-farm\?/, (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    fake.calls.push({ action, url: req.url(), body, headers: req.headers() });
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    const dead = () => reply(401, { success: false, error: 'This link is not active', code: 'UNAUTHORIZED' });
    if (fake.revoked || body.token !== LINK) return dead();
    if (action === 'status') return reply(200, { success: true, data: { needs_pin: fake.needsPin, locked: fake.lockedMinutes > 0, minutes_left: fake.lockedMinutes, lang: fake.lang } });
    if (action === 'setPin') {
      if (!fake.needsPin) return reply(400, { success: false, error: 'A PIN is already set for this link', code: 'VALIDATION_ERROR' });
      fake.needsPin = false; fake.pin = body.pin;
      return reply(200, { success: true, data: fake.data });
    }
    if (action === 'view') {
      if (fake.lockedMinutes > 0) return reply(429, { success: false, error: 'Too many wrong PINs', code: 'RATE_LIMITED', details: { locked: true, minutes_left: fake.lockedMinutes } });
      if (body.pin !== (fake.pin || PIN)) {
        fake.triesLeft -= 1;
        if (fake.triesLeft <= 0) { fake.lockedMinutes = 15; return reply(429, { success: false, error: 'Too many wrong PINs', code: 'RATE_LIMITED', details: { locked: true, minutes_left: 15 } }); }
        return reply(400, { success: false, error: 'Wrong PIN', code: 'VALIDATION_ERROR', details: { tries_left: fake.triesLeft } });
      }
      fake.triesLeft = 5;
      return reply(200, { success: true, data: fake.data });
    }
    blocked.push(req.url());
    return route.abort();
  });
  return blocked;
}

async function openFarm(page, { fake = makeFake(), lang = 'en', hash = `#k=${LINK}`, width = 1024 } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript((l) => { try { localStorage.setItem('ro-lang', l); } catch { /* */ } }, lang);
  await page.goto(FARM_PAGE + hash);
  return { fake, blocked };
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });

async function enterPin(page, pin) {
  await page.locator('#pin1').fill(pin);
  await page.locator('#pinBtn').click();
}

/* ---------- behaviour ---------- */

test.describe('farm page: access', () => {
  test('no link and a malformed link: not active, and nothing is called', async ({ page }) => {
    const { fake, blocked } = await openFarm(page, { hash: '' });
    await expect(page.locator('#badLink')).toContainText('This link is not active.');
    await expect(page.locator('#badLink')).toContainText('Ask Rogue Origin for a new one.');
    await page.goto(`${FARM_PAGE}#k=short`);
    await expect(page.locator('#badLink')).toBeVisible();
    expect(fake.calls).toEqual([]);
    expect(blocked).toEqual([]);
  });

  test('first open: set the PIN (must match), then the page opens; the link stays in the URL', async ({ page }) => {
    const { fake, blocked } = await openFarm(page, { fake: makeFake({ needsPin: true }) });
    await expect(page.locator('#setPinForm')).toContainText('Set your PIN');
    await expect(page.locator('#pin1')).toHaveAttribute('inputmode', 'numeric');
    await page.locator('#pin1').fill('1357');
    await page.locator('#pin2').fill('1358');
    await page.locator('#setPinBtn').click();
    await expect(page.locator('#msg')).toHaveText('The two PINs are not the same. Type them again.');
    await page.locator('#pin1').fill('12');
    await page.locator('#pin2').fill('12');
    await page.locator('#setPinBtn').click();
    await expect(page.locator('#msg')).toHaveText('The PIN is 4 numbers.');
    await page.locator('#pin1').fill('1a3');
    await expect(page.locator('#pin1')).toHaveValue('13');
    await page.locator('#pin1').fill('1357');
    await page.locator('#pin2').fill('1357');
    await page.locator('#setPinBtn').click();
    await expect(page.locator('#farmName')).toHaveText('Farm A');
    expect(page.url()).toContain(`#k=${LINK}`);
    expect(fake.calls.map((c) => c.action)).toEqual(['status', 'setPin']);
    expect(fake.calls[1].body).toEqual({ token: LINK, pin: '1357' });
    for (const c of fake.calls) {
      expect(c.url).not.toContain(LINK);
      expect(c.url).not.toContain('1357');
      expect(c.headers.authorization).toBeUndefined();
    }
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    expect(stored).not.toContain(LINK);
    expect(stored).not.toContain('1357');
    expect(blocked).toEqual([]);
  });

  test('enter PIN; a wrong PIN says how many tries are left; the fifth locks', async ({ page }) => {
    const { fake, blocked } = await openFarm(page);
    await expect(page.locator('#pinForm')).toContainText('Enter your PIN');
    await enterPin(page, '0000');
    await expect(page.locator('#msg')).toHaveText('Wrong PIN. 4 tries left before the page locks for 15 minutes.');
    await expect(page.locator('#pin1')).toHaveValue('');
    for (const n of [3, 2]) {
      await enterPin(page, '0000');
      await expect(page.locator('#msg')).toHaveText(`Wrong PIN. ${n} tries left before the page locks for 15 minutes.`);
    }
    await enterPin(page, '0000');
    await expect(page.locator('#msg')).toHaveText('Wrong PIN. 1 try left before the page locks for 15 minutes.');
    await enterPin(page, '0000');
    await expect(page.locator('#lockedMsg')).toHaveText('Too many wrong PINs. Try again in 15 minutes.');
    fake.lockedMinutes = 0;
    fake.triesLeft = 5;
    await page.locator('#retryBtn').click();
    await enterPin(page, PIN);
    await expect(page.locator('#farmName')).toHaveText('Farm A');
    expect(blocked).toEqual([]);
  });

  test('locked on open shows minutes left; revoked link shows not active', async ({ page }) => {
    const fake = makeFake({ lockedMinutes: 7 });
    await openFarm(page, { fake });
    await expect(page.locator('#lockedMsg')).toHaveText('Too many wrong PINs. Try again in 7 minutes.');
    fake.revoked = true;
    await page.locator('#retryBtn').click();
    await expect(page.locator('#badLink')).toBeVisible();
  });

  test('language starts from the farm, and the switch flips it', async ({ page }) => {
    await openFarm(page, { fake: makeFake({ lang: 'es' }), lang: 'en' });
    await expect(page.locator('#pinForm')).toContainText('Escriba su PIN');
    await page.locator('#langToggle').click();
    await expect(page.locator('#pinForm')).toContainText('Enter your PIN');
  });

  test('storage blocked (throws): the page still works', async ({ page }) => {
    await page.addInitScript(() => {
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    });
    const fake = makeFake();
    await isolate(page.context(), fake);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${FARM_PAGE}#k=${LINK}`);
    await enterPin(page, PIN);
    await expect(page.locator('#farmName')).toHaveText('Farm A');
    await page.locator('#langToggle').click();
    await expect(page.locator('#standLabel')).toHaveText('Le debemos');
  });

  test('a wrong-PIN message follows a language switch; html lang follows too', async ({ page }) => {
    await openFarm(page, { fake: makeFake({ lang: 'es' }), lang: 'es' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await enterPin(page, '0000');
    await expect(page.locator('#msg')).toContainText('Le quedan 4 intentos');
    await page.locator('#langToggle').click();
    await expect(page.locator('#msg')).toHaveText('Wrong PIN. 4 tries left before the page locks for 15 minutes.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('refresh with no signal keeps the page and says so', async ({ page }) => {
    await openFarm(page);
    await enterPin(page, PIN);
    await expect(page.locator('#farmName')).toBeVisible();
    await page.context().unroute(/\/api\/consign-farm\?/);
    await page.context().route(/\/api\/consign-farm\?/, (route) => route.abort('internetdisconnected'));
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#pageMsg')).toHaveText('No connection. Check your signal and try again.');
    await expect(page.locator('#farmName')).toHaveText('Farm A');
  });

  test('no signal on Open keeps the typed PIN', async ({ page }) => {
    await openFarm(page);
    await expect(page.locator('#pinForm')).toBeVisible();
    await page.context().unroute(/\/api\/consign-farm\?/);
    await page.context().route(/\/api\/consign-farm\?/, (route) => route.abort('internetdisconnected'));
    await enterPin(page, PIN);
    await expect(page.locator('#msg')).toHaveText('No connection. Check your signal and try again.');
    await expect(page.locator('#pin1')).toHaveValue(PIN);
  });

  test('close page forgets the PIN and asks again', async ({ page }) => {
    const { fake } = await openFarm(page);
    await enterPin(page, PIN);
    await expect(page.locator('#farmName')).toBeVisible();
    await page.locator('#closeBtn').click();
    await expect(page.locator('#pinForm')).toBeVisible();
    expect(fake.calls.at(-1).action).toBe('status');
  });
});

test.describe('farm page: content', () => {
  test('smallest: one lot, no payments; cards in order; estimate tag', async ({ page }) => {
    await openFarm(page);
    await enterPin(page, PIN);
    const ids = await page.locator('.cf-stack > section').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual(['stand', 'prices', 'dropoffs', 'payments']);
    await expect(page.locator('#standLabel')).toHaveText('We owe you');
    await expect(page.locator('#balance')).toHaveText('$400.00');
    await expect(page.locator('#stand')).toContainText('Estimate');
    await expect(page.locator('#lastPayment')).toHaveText('No payment yet');
    await expect(page.locator('#payments')).toContainText('No payments yet.');
    await expect(page.locator('#sold')).toHaveCount(0);
  });

  test('largest: credit balance, sold card last, needs-price, after numbers, eight payments', async ({ page }) => {
    await openFarm(page, { fake: makeFake({ data: large(), lang: 'es' }) });
    await enterPin(page, PIN);
    const ids = await page.locator('.cf-stack > section').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual(['stand', 'prices', 'dropoffs', 'payments', 'sold']);
    await expect(page.locator('#standLabel')).toHaveText('Crédito a favor de Rogue Origin');
    await expect(page.locator('#payments li')).toHaveCount(8);
    await expect(page.locator('#prices li')).toHaveCount(10);
    await expect(page.locator('.cf-noprice')).toHaveCount(1);
    await expect(page.locator('[data-lot="1"]')).toContainText('Tops finales');
    await expect(page.locator('[data-lot="1"]')).toContainText('Two bags were damp');
  });
});

test.describe('farm page: screenshots, 375 and 1024, EN and ES', () => {
  for (const width of [375, 1024]) {
    for (const lang of ['en', 'es']) {
      const tagName = `${lang}-${width}`;
      test(`states ${tagName}`, async ({ page }) => {
        // bad link
        const fake = makeFake({ needsPin: true, lang });
        await openFarm(page, { fake, lang, width, hash: '#k=nope' });
        await expect(page.locator('#badLink')).toBeVisible();
        await shot(page, `bad-link-${tagName}`);
        // set PIN
        await page.goto(`${FARM_PAGE}#k=${LINK}`);
        await expect(page.locator('#setPinForm')).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `set-pin-${tagName}`);
        // enter PIN, wrong PIN
        fake.needsPin = false;
        await page.reload();
        await expect(page.locator('#pinForm')).toBeVisible();
        await shot(page, `enter-pin-${tagName}`);
        await enterPin(page, '0000');
        await expect(page.locator('#msg')).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `wrong-pin-${tagName}`);
        // locked
        fake.lockedMinutes = 12;
        await page.reload();
        await expect(page.locator('#lockedCard')).toBeVisible();
        await shot(page, `locked-${tagName}`);
        // revoked
        fake.revoked = true;
        await page.reload();
        await expect(page.locator('#badLink')).toBeVisible();
        await shot(page, `revoked-${tagName}`);
      });

      for (const [size, data] of [['smallest', SMALL], ['largest', large()]]) {
        test(`page ${size} ${tagName}`, async ({ page }) => {
          const fake = makeFake({ data: { ...data, farm: { ...data.farm, lang } }, lang });
          await openFarm(page, { fake, lang, width });
          await enterPin(page, PIN);
          await expect(page.locator('#farmName')).toBeVisible();
          expect(await noHorizontalScroll(page)).toBe(true);
          await shot(page, `page-${size}-${tagName}`, true);
        });
      }
    }
  }
});

/* ---------- the owner's card on the staff page ---------- */

const STAFF_FARM = { id: 1, name: 'Farm A', default_term: 'dropoff', lang: 'en', active: 1 };
function staffFake(access) {
  return { access, calls: [] };
}
async function openStaff(page, sf, { lang = 'en', width = 1024, owner = true } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const blocked = [];
  const ctx = page.context();
  await ctx.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route('**/api/orders?action=validatePassword**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true } }) }));
  await ctx.route(/\/api\/consign\?/, (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    sf.calls.push({ action, body });
    const ok = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (action === 'farm') {
      return ok({ farm: STAFF_FARM, price_points: [], dropoffs: [], payments: [], totals: { owed: 0, paid: 0, balance: 0, credit: 0, estimate: false, needs_price: false }, access: sf.access });
    }
    if (action === 'farms') return ok([{ ...STAFF_FARM, balance: 0, credit: 0, owed: 0, paid: 0, estimate: false, needs_price: false }]);
    if (action === 'open') return ok({ to_weigh: [], to_screen: [], needs_price: [] });
    if (action === 'issueFarmAccess') {
      sf.access = { active: true, pin_set: false, issued_at: '2026-11-17 16:00:00', last_seen_at: null, locked: false };
      return ok({ token: LINK });
    }
    if (action === 'revokeFarmAccess') {
      sf.access = { ...sf.access, active: false, locked: false };
      return ok({ revoked: 1, access: sf.access });
    }
    blocked.push(req.url());
    return route.abort();
  });
  await page.addInitScript(({ l, owner: o }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    localStorage.setItem('ro-lang', l);
    if (o) sessionStorage.setItem('consign_owner_pw', 'test-owner');
  }, { l: lang, owner });
  await page.goto(`${STAFF_PAGE}#/farm/1`);
  return blocked;
}

test.describe("staff page: Farm's page card", () => {
  test('hidden outside owner mode', async ({ page }) => {
    await openStaff(page, staffFake(null), { owner: false });
    await expect(page.locator('#balance')).toBeVisible();
    await expect(page.locator('#farmAccess')).toBeHidden();
  });

  test('create: link shown once with copy and QR, sent with the owner password, never stored', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const sf = staffFake(null);
    const blocked = await openStaff(page, sf);
    await expect(page.locator('#farmAccess')).toHaveAttribute('data-state', 'none');
    await expect(page.locator('#farmAccessLine')).toHaveText('No link yet.');
    await page.locator('#createLink').click();
    await expect(page.locator('#farmLinkBox')).toContainText('This link is shown once. Send it to the farm yourself.');
    await expect(page.locator('#farmLink')).toHaveValue(`http://localhost:${PORT}/src/pages/consign-farm.html#k=${LINK}`);
    await expect(page.locator('#farmLinkBox .cs-qrbox svg')).toHaveCount(1);
    await expect(page.locator('#farmAccess')).toHaveAttribute('data-state', 'waiting');
    expect(sf.calls.find((c) => c.action === 'issueFarmAccess').body).toMatchObject({ farm_id: 1, owner_password: 'test-owner' });
    await page.locator('#copyLink').click();
    await expect(page.locator('#toast')).toHaveText('Copied');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain(LINK);
    await shot(page, 'staff-card-link-shown-en-1024', true);
    await page.locator('#hideLink').click();
    await expect(page.locator('#farmLinkBox')).toHaveCount(0);
    // Leaving and coming back: the link is gone for good.
    await page.goto(`${STAFF_PAGE}#/`);
    await page.goto(`${STAFF_PAGE}#/farm/1`);
    await expect(page.locator('#farmAccess')).toHaveAttribute('data-state', 'waiting');
    await expect(page.locator('#farmLinkBox')).toHaveCount(0);
    expect(blocked).toEqual([]);
  });

  test('lot editor: "Show this note to the farm" sends note_visible; the lot shows it', async ({ page }) => {
    const sf = staffFake(null);
    sf.dropoffs = [{ id: 5, farm_id: 1, dropped_at: '2026-11-10 17:00:00', dropped_by: null, note: null, lots: [{
      id: 9, dropoff_id: 5, farm_id: 1, cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 40, price_per_lb: 10, smalls_price_per_lb: 4,
      note: 'Damp bag', note_visible: 0, runs: [], sold: [],
      money: { status: 'weighed', estimate: true, needs_price: false, intake_lbs: 40, pulled_lbs: 0, final_lbs: 0, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, remainder_lbs: 40, owed: 400 },
    }] }];
    await page.route(/\/api\/consign\?action=(farm|setLotTerms)/, async (route) => {
      const action = new URL(route.request().url()).searchParams.get('action');
      const body = JSON.parse(route.request().postData() || '{}');
      sf.calls.push({ action, body });
      if (action === 'setLotTerms') sf.dropoffs[0].lots[0].note_visible = body.note_visible ? 1 : 0;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: action === 'farm'
        ? { farm: STAFF_FARM, price_points: [], dropoffs: sf.dropoffs, payments: [], totals: { owed: 400, paid: 0, balance: 400, credit: 0, estimate: true, needs_price: false }, access: null }
        : { lot: sf.dropoffs[0].lots[0] } }) });
    });
    await openStaff(page, sf);
    await expect(page.locator('[data-lot="9"]')).toContainText('Damp bag');
    await expect(page.locator('[data-lot="9"]')).not.toContainText('Farm sees this note');
    await page.locator('[data-terms="9"]').click();
    const tick = page.locator('dialog input[name="note_visible"]');
    await expect(tick).not.toBeChecked();
    await expect(page.locator('dialog')).toContainText('Show this note to the farm: “Damp bag”');
    await tick.check();
    await page.locator('dialog [data-act="ok"]').click();
    await expect(page.locator('[data-lot="9"]')).toContainText('Farm sees this note');
    expect(sf.calls.find((c) => c.action === 'setLotTerms').body).toMatchObject({ lot_id: 9, note_visible: true, owner_password: 'test-owner' });
  });

  test('new link asks first; turn off asks first', async ({ page }) => {
    const sf = staffFake({ active: true, pin_set: true, issued_at: '2026-11-01 16:00:00', last_seen_at: '2026-11-16 18:30:00', locked: false });
    await openStaff(page, sf);
    await expect(page.locator('#farmAccess')).toHaveAttribute('data-state', 'inuse');
    await expect(page.locator('#farmAccessLine')).toContainText('In use. Last opened');
    await page.locator('#newLink').click();
    await expect(page.locator('dialog .cs-dlgmsg')).toHaveText('The old link stops working right away. The farm opens the new link and sets a new PIN.');
    await page.locator('dialog [data-act="cancel"]').click();
    expect(sf.calls.some((c) => c.action === 'issueFarmAccess')).toBe(false);
    await page.locator('#turnOffLink').click();
    await page.locator('dialog [data-act="ok"]').click();
    await expect(page.locator('#farmAccess')).toHaveAttribute('data-state', 'off');
    await expect(page.locator('#farmAccessLine')).toHaveText('Turned off. The farm cannot open its page.');
    await expect(page.locator('#createLink')).toBeVisible();
  });

  for (const width of [375, 1024]) {
    for (const lang of ['en', 'es']) {
      for (const [state, access] of [
        ['none', null],
        ['waiting', { active: true, pin_set: false, issued_at: '2026-11-17 16:00:00', last_seen_at: null, locked: false }],
        ['inuse', { active: true, pin_set: true, issued_at: '2026-11-01 16:00:00', last_seen_at: '2026-11-16 18:30:00', locked: false }],
        ['locked', { active: true, pin_set: true, issued_at: '2026-11-01 16:00:00', last_seen_at: '2026-11-16 18:30:00', locked: true }],
        ['off', { active: false, pin_set: true, issued_at: '2026-11-01 16:00:00', last_seen_at: '2026-11-16 18:30:00', locked: false }],
      ]) {
        test(`card ${state} ${lang}-${width}`, async ({ page }) => {
          await openStaff(page, staffFake(access), { lang, width });
          const card = page.locator('#farmAccess');
          await expect(card).toHaveAttribute('data-state', state);
          expect(await noHorizontalScroll(page)).toBe(true);
          await card.screenshot({ path: path.join(SHOTS, `staff-card-${state}-${lang}-${width}.png`) });
        });
      }
    }
  }
});
