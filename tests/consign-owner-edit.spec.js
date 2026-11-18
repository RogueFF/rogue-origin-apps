// Owner edits on the consignment farm page (consign.html). Made-up farms, cultivars and numbers.
// Owner mode puts an Edit button on every saved thing; staff mode shows none.
// Every API call is answered by the fake below at the context level, and any other *.workers.dev
// request is aborted, so nothing reaches the live API.
// Run: npx playwright test tests/consign-owner-edit.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8137;
const PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = process.env.EDIT_SHOTS || path.resolve(__dirname, '..', 'test-results', 'consign-owner-edit-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const OWNER_PW = 'owner-test';
const money0 = (o = {}) => ({ status: 'weighed', estimate: true, needs_price: false, intake_lbs: 100, pulled_lbs: 0, final_lbs: 0, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, remainder_lbs: 100, payable_main_lbs: 100, payable_smalls_lbs: 0, sold_main_lbs: 0, sold_smalls_lbs: 0, on_hand_lbs: null, value: 1000, owed: 1000, ...o });
const RUN = { id: 70, lot_id: 10, run_at: '2026-11-15 18:00:00', pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 8, biomass_lbs: 2, mold_lbs: 0, diff_lbs: 0, note: null, voided_at: null };
const SOLD = { id: 80, lot_id: 11, sold_on: '2026-11-16', lbs: 5, kind: 'main', note: null, voided_at: null };
const lot = (id, cultivar, type, o = {}) => ({ id, dropoff_id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', cultivar, type, term: 'dropoff', intake_lbs: 100, weighed_at: 'x', price_per_lb: 10, smalls_price_per_lb: 4, closed_at: null, note: null, note_visible: 0, voided_at: null, runs: [], sold: [], money: money0(), ...o });

function makeFake() {
  const s = {
    posts: [],
    prices: [
      { id: 1, farm_id: 1, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: '2026-11-01', created_at: 'x' },
      { id: 2, farm_id: 1, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: '2026-11-01', created_at: 'x' },
      { id: 3, farm_id: 1, cultivar: 'Beta with a long cultivar name', type: 'tops', price_per_lb: 12, effective_from: '2026-11-01', created_at: 'x' },
    ],
    payments: [{ id: 9, farm_id: 1, paid_on: '2026-11-15', amount: 300, method: 'check', reference: 'R1', note: 'first', voided_at: null }],
    lotPrice: 10,
    run: { ...RUN },
  };
  const lots = () => [
    lot(10, 'Alpha', 'tops', { price_per_lb: s.lotPrice, runs: [s.run], money: money0({ status: 'screening', pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 8, biomass_lbs: 2, remainder_lbs: 40 }) }),
    lot(11, 'Beta with a long cultivar name', 'tops', { term: 'sold', note: 'wet', sold: [SOLD], money: money0({ on_hand_lbs: 95, sold_main_lbs: 5 }) }),
  ];
  s.answer = (action, body) => {
    switch (action) {
      case 'farms': return [{ id: 1, name: 'Farm A', contact: null, default_term: 'dropoff', lang: 'en', active: 1, created_at: 'x', balance: 700, credit: 0, owed: 1000, paid: 300, estimate: true, needs_price: false }];
      case 'open': return { to_weigh: [], to_screen: [], needs_price: [] };
      case 'farm': return {
        farm: { id: 1, name: 'Farm A', contact: null, default_term: 'dropoff', lang: 'en', active: 1, created_at: 'x' },
        price_points: s.prices,
        dropoffs: [{ id: 5, farm_id: 1, dropped_at: '2026-11-14 17:30:00', dropped_by: 'T', note: 'n', source: 'app', voided_at: null, lots: lots() }],
        payments: s.payments,
        totals: { owed: 1000, paid: s.payments.reduce((a, p) => a + p.amount, 0), balance: 1000 - s.payments.reduce((a, p) => a + p.amount, 0), credit: 0, estimate: true, needs_price: false },
        access: null,
      };
      case 'editPricePoint': {
        const p = s.prices.find((x) => x.id === body.id);
        Object.assign(p, Object.fromEntries(['cultivar', 'type', 'price_per_lb', 'effective_from'].filter((k) => k in body).map((k) => [k, body[k]])));
        if (body.update_lots) s.lotPrice = p.price_per_lb;
        return { price_point: p, lots_updated: body.update_lots ? 1 : 0 };
      }
      case 'dropoff': return { dropoff: { id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00' }, lots: lots() };
      case 'editScreenRun': {
        Object.assign(s.run, Object.fromEntries(['pulled_lbs', 'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs', 'note'].filter((k) => k in body).map((k) => [k, body[k]])));
        return { lot: lots()[0] };
      }
      case 'deletePricePoint': s.prices = s.prices.filter((x) => x.id !== body.id); return { ok: true };
      case 'editPayment': {
        const p = s.payments.find((x) => x.id === body.payment_id);
        Object.assign(p, Object.fromEntries(['amount', 'paid_on', 'method', 'reference', 'note'].filter((k) => k in body).map((k) => [k, body[k]])));
        return { payment: p, totals: {} };
      }
      default: return null;
    }
  };
  return s;
}

const MONEY_KEYS = new Set(['price_per_lb', 'smalls_price_per_lb', 'owed', 'value', 'balance', 'paid', 'credit', 'amount', 'estimate', 'payments', 'totals', 'payment', 'access']);
const staffShape = (v) => {
  if (Array.isArray(v)) return v.map(staffShape);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !MONEY_KEYS.has(k)).map(([k, x]) => [k, staffShape(x)]));
};
const OWNER_ONLY = /^(edit|delete)/;

async function isolate(context, fake) {
  const blocked = [];
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route('**/api/orders?action=validatePassword**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true } }) }));
  await context.route('**/api/consign?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    const owner = body.owner_password === OWNER_PW;
    fake.posts.push({ action, body });
    if (OWNER_ONLY.test(action) && !owner) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Owner password required', code: 'UNAUTHORIZED' }) });
    }
    if (fake.refuse && fake.refuse[action]) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: fake.refuse[action], code: 'VALIDATION_ERROR' }) });
    }
    const data = fake.answer(action, body);
    if (data == null) { blocked.push(req.url()); return route.abort(); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: owner ? data : staffShape(data), owner }) });
  });
  return blocked;
}

async function open(page, { owner = false, fake = makeFake(), hash = '#/farm/1' } = {}) {
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript(({ o }) => {
    localStorage.setItem('ro-lang', 'en');
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    if (o) sessionStorage.setItem('consign_owner_pw', o);
  }, { o: owner ? OWNER_PW : '' });
  await page.goto(PAGE + hash);
  await expect(page.locator('[data-lot="10"]')).toBeVisible();
  return { fake, blocked };
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const edits = (fake, action) => fake.posts.filter((p) => p.action === action);

test.describe('Consignment owner edits', () => {
  test('owner mode: an Edit on every price point, dropoff, lot, run, sold entry and payment', async ({ page }) => {
    for (const width of [375, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const { blocked } = await open(page, { owner: true });
      await expect(page.locator('[data-edit^="price|"]')).toHaveCount(3);
      await expect(page.locator('[data-edit="dropoff|5"]')).toBeVisible();
      await expect(page.locator('[data-edit="lot|10"]')).toBeVisible();
      await expect(page.locator('[data-edit="lot|11"]')).toBeVisible();
      await expect(page.locator('[data-edit="run|10|70"]')).toBeVisible();
      await expect(page.locator('[data-edit="sold|11|80"]')).toBeVisible();
      await expect(page.locator('[data-edit="payment|9"]')).toBeVisible();
      // Edit sits next to Void on the same row.
      await expect(page.locator('[data-dropoff="5"] .cs-cardhead [data-edit="dropoff|5"] + [data-void="dropoff|5"]')).toHaveCount(1);
      expect(await noHorizontalScroll(page), `no horizontal scroll at ${width}`).toBe(true);
      await shot(page, `farm-owner-${width}`);
      await page.locator('[data-edit="price|1"]').click();
      const dlg = page.locator('dialog.cs-dialog');
      await expect(dlg).toBeVisible();
      await expect(dlg.locator('input[name="update_lots"]')).toBeChecked();
      await expect(dlg.locator('[data-act="extra"]')).toHaveText('Delete');
      expect(await noHorizontalScroll(page), `dialog: no horizontal scroll at ${width}`).toBe(true);
      await shot(page, `price-dialog-${width}`, false);
      await dlg.locator('[data-act="cancel"]').click();
      expect(blocked).toEqual([]);
      await page.context().unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('owner edits a price point: only the changed fields go, with update_lots; the farm is read again', async ({ page }) => {
    const { fake, blocked } = await open(page, { owner: true });
    const reads = () => fake.posts.filter((p) => p.action === 'farm').length;
    const before = reads();
    await page.locator('[data-edit="price|1"]').click();
    const dlg = page.locator('dialog.cs-dialog');
    await dlg.locator('input[name="price_per_lb"]').fill('11.5');
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Saved. 1 lots now have the new price.');
    const [e] = edits(fake, 'editPricePoint');
    const { owner_password: pw, actor, ...sent } = e.body;
    expect(pw).toBe(OWNER_PW);
    expect(actor).toBeTruthy();
    expect(sent).toEqual({ id: 1, price_per_lb: 11.5, update_lots: true });
    await expect.poll(reads).toBeGreaterThan(before);
    await expect(page.locator('[data-pp="1"]')).toContainText('$11.50');

    // Untick: the lots are left alone.
    await page.locator('[data-edit="price|3"]').click();
    await dlg.locator('input[name="price_per_lb"]').fill('13');
    await dlg.locator('input[name="update_lots"]').uncheck();
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(edits(fake, 'editPricePoint')[1].body).toMatchObject({ id: 3, price_per_lb: 13, update_lots: false });

    // A server refusal shows the server's words.
    fake.refuse = { editPricePoint: 'Start date must be a real date, YYYY-MM-DD' };
    await page.locator('[data-edit="price|2"]').click();
    await dlg.locator('input[name="price_per_lb"]').fill('5');
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Start date must be a real date, YYYY-MM-DD');
    await expect(page.locator('#toast')).toHaveClass(/err/);
    fake.refuse = null;

    // Delete asks first, then removes the point.
    await page.locator('[data-edit="price|2"]').click();
    await dlg.locator('[data-act="extra"]').click();
    await expect(page.locator('dialog.cs-dialog')).toContainText('Lots keep the price they have now.');
    await page.locator('dialog.cs-dialog [data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Deleted');
    expect(edits(fake, 'deletePricePoint').map((p) => p.body.id)).toEqual([2]);
    await expect(page.locator('[data-edit="price|2"]')).toHaveCount(0);
    expect(blocked).toEqual([]);
  });

  test('owner edits a payment from the farm page', async ({ page }) => {
    const { fake, blocked } = await open(page, { owner: true });
    await page.locator('[data-edit="payment|9"]').click();
    const dlg = page.locator('dialog.cs-dialog');
    await expect(dlg.locator('input[name="amount"]')).toHaveValue('300');
    await dlg.locator('input[name="amount"]').fill('350');
    await dlg.locator('select[name="method"]').selectOption('cash');
    await dlg.locator('input[name="reference"]').fill('');
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const [e] = edits(fake, 'editPayment');
    const { owner_password: _pw, actor: _a, ...sent } = e.body;
    expect(sent).toEqual({ payment_id: 9, amount: 350, method: 'cash', reference: '' });
    await expect(page.locator('#balance')).toHaveText('$650.00');
    // Nothing changed: no call.
    await page.locator('[data-edit="payment|9"]').click();
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Nothing changed.');
    expect(edits(fake, 'editPayment')).toHaveLength(1);
    expect(blocked).toEqual([]);
  });

  test('screening screen: owner Edit beside the run Void; a save reads the lot again', async ({ page }) => {
    const { fake, blocked } = await open(page, { owner: true });
    await page.goto(`${PAGE}#/screen/5/10`);
    await expect(page.locator('[data-edit="run|10|70"] + [data-voidrun="70"]')).toHaveCount(1);
    const reads = () => fake.posts.filter((p) => p.action === 'dropoff').length;
    const before = reads();
    await page.locator('[data-edit="run|10|70"]').click();
    const dlg = page.locator('dialog.cs-dialog');
    await dlg.locator('input[name="final_lbs"]').fill('48');
    await dlg.locator('input[name="biomass_lbs"]').fill('4');
    await dlg.locator('[data-act="ok"]').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const { owner_password: _pw, actor: _a, ...sent } = edits(fake, 'editScreenRun')[0].body;
    expect(sent).toEqual({ run_id: 70, final_lbs: 48, biomass_lbs: 4 });
    await expect.poll(reads).toBeGreaterThan(before);
    expect(blocked).toEqual([]);
  });

  test('staff mode has no Edit controls anywhere', async ({ page }) => {
    for (const width of [375, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const { fake, blocked } = await open(page);
      await expect(page.locator('[data-edit]')).toHaveCount(0);
      await expect(page.locator('.cs-edit, .cs-entries')).toHaveCount(0);
      await expect(page.locator('[data-terms]').first()).toBeHidden();
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.goto(`${PAGE}#/screen/5/10`);
      await expect(page.locator('[data-voidrun="70"]')).toBeVisible();
      await expect(page.locator('[data-edit]')).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(fake.posts.some((p) => OWNER_ONLY.test(p.action))).toBe(false);
      expect(blocked).toEqual([]);
      await page.goto('about:blank');
      await page.context().unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
