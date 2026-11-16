// Consignment stage 2: paper sheets, photo read, review. Made-up farms and cultivars only.
// Same guards as consign.spec.js: every *.workers.dev request the fake does not answer is
// aborted at the context level, and readSheet is answered by the fake, never the real API.
// Run: npx playwright test tests/consign-paper.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8132;
const PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = path.resolve(__dirname, '..', 'test-results', 'consign-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu'];
const money0 = (o = {}) => ({ status: 'weighed', estimate: true, needs_price: false, intake_lbs: 100, pulled_lbs: 0, final_lbs: 0, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, remainder_lbs: 100, payable_main_lbs: 100, payable_smalls_lbs: 0, sold_main_lbs: 0, sold_smalls_lbs: 0, on_hand_lbs: null, value: 1000, owed: 1000, ...o });
const lot = (id, cultivar, type, o = {}) => ({
  id, dropoff_id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', cultivar, type, term: 'dropoff',
  intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: 4, closed_at: null, voided_at: null, runs: [], sold: [], money: money0(), ...o,
});
const FARMS = [
  { id: 1, name: 'Farm A', default_term: 'dropoff', lang: 'en', active: 1, balance: 1000, credit: 0, owed: 1000, paid: 0, estimate: true, needs_price: false },
  { id: 2, name: 'Farm B', default_term: 'sold', lang: 'es', active: 1, balance: 0, credit: 0, owed: 0, paid: 0, estimate: false, needs_price: false },
];
const prices = (names) => names.flatMap((c, i) => [
  { id: i * 2 + 1, farm_id: 1, cultivar: c, type: 'tops', price_per_lb: 10, effective_from: '2026-01-01' },
  { id: i * 2 + 2, farm_id: 1, cultivar: c, type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01' },
]);

function makeFake(o = {}) {
  const state = {
    posts: [], reads: [], cultivars: o.cultivars || GREEK.slice(0, 3),
    lots: o.lots || [lot(10, 'Alpha', 'tops'), lot(11, 'Alpha', 'smalls', { money: money0({ intake_lbs: 40, remainder_lbs: 40 }) }), lot(12, 'Beta', 'tops', { intake_lbs: null, money: money0({ status: 'dropped', intake_lbs: null, remainder_lbs: 0 }) })],
    read: o.read || null, readError: o.readError || null, refuseLot: null, offlineAfter: null,
  };
  state.answer = (action, body) => {
    switch (action) {
      case 'farms': return FARMS;
      case 'open': return { to_weigh: [], to_screen: state.lots.filter((l) => l.money.status === 'weighed'), needs_price: [] };
      case 'farm': return {
        farm: FARMS.find((f) => f.id === body.farm_id) || FARMS[0],
        price_points: prices(state.cultivars),
        dropoffs: [{ id: 5, farm_id: 1, dropped_at: '2026-11-14 17:30:00', dropped_by: 'T', note: '', lots: state.lots }],
        payments: [], totals: { owed: 1000, paid: 0, balance: 1000, credit: 0, estimate: true, needs_price: false },
      };
      case 'dropoff': return { dropoff: { id: 5, farm_id: 1, farm_name: 'Farm A', dropped_at: '2026-11-14 17:30:00', dropped_by: 'Sam' }, lots: state.lots };
      case 'saveDropoff': return { dropoff: { id: 6, farm_id: body.farm_id }, lots: [] };
      case 'saveScreenRun': return { lot: { ...state.lots.find((l) => l.id === body.lot_id), closed_at: body.finishes_lot ? 'x' : null } };
      default: return null;
    }
  };
  return state;
}

async function isolate(context, fake) {
  const blocked = [];
  await context.route(/^https?:\/\/[^/]*\.workers\.dev\//, (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route('**/api/orders?action=validatePassword**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { success: true } }) }));
  await context.route('**/api/consign?**', async (route) => {
    const req = route.request();
    const action = new URL(req.url()).searchParams.get('action');
    const body = JSON.parse(req.postData() || '{}');
    const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (action === 'readSheet') {
      fake.reads.push(body);
      if (fake.readError) return reply(500, { success: false, error: fake.readError, code: 'INTERNAL_ERROR' });
      return reply(200, { success: true, data: { read: fake.read } });
    }
    if (action.startsWith('save')) {
      fake.posts.push({ action, body });
      if (fake.offlineAfter != null && fake.posts.filter((p) => p.action === action).length > fake.offlineAfter) return route.abort('internetdisconnected');
      if (fake.refuseLot && body.lot_id === fake.refuseLot.id) return reply(400, { success: false, error: fake.refuseLot.error, code: 'VALIDATION_ERROR' });
    }
    const data = fake.answer(action, body);
    if (data == null) { blocked.push(req.url()); return route.abort(); }
    return reply(200, { success: true, data });
  });
  return blocked;
}

const acceptLeave = (page) => { if (!page.__acceptLeave) { page.__acceptLeave = true; page.on('dialog', (d) => d.accept()); } };

async function open(page, { lang = 'en', hash = '#/', fake = makeFake() } = {}) {
  acceptLeave(page);
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript((l) => {
    localStorage.setItem('ro_api_password', 'test-only');
    localStorage.setItem('ro-lang', l);
  }, lang);
  await page.goto(PAGE + hash);
  return { fake, blocked };
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

test.describe('Consignment paper sheets', () => {
  test('sheet A for a farm with 3 cultivars: only the sheet prints, QR present, no prices, 1 letter page', async ({ page }) => {
    const { blocked } = await open(page, { hash: '#/print/dropoff/1' });
    await expect(page.locator('.sh-preview .sh-page')).toHaveCount(1);
    await expect(page.locator('#printArea .sh-page')).toHaveCount(1);
    await expect(page.locator('#printArea .sh-qrimg svg')).toHaveCount(1);
    await expect(page.locator('#printArea .sh-code')).toHaveText('DROP-F1');
    for (const c of ['Alpha', 'Beta', 'Gamma']) await expect(page.locator('#printArea')).toContainText(c);
    expect(await page.locator('#printArea').innerText()).not.toContain('$');
    const qrPx = await page.locator('#printArea .sh-qrimg svg').evaluate((el) => {
      const box = el.closest('#printArea'); box.style.display = 'block';
      const w = el.getBoundingClientRect().width; box.style.display = ''; return w;
    });
    expect(qrPx).toBeGreaterThanOrEqual(96); // at least 1 in on paper
    await page.emulateMedia({ media: 'print' });
    const visible = await page.evaluate(() => [...document.body.children].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.id));
    expect(visible).toEqual(['printArea']);
    const pdf = await page.pdf({ format: 'Letter', path: path.join(SHOTS, 'sheet-a-dropoff.pdf') });
    expect(pdfPages(pdf)).toBe(1);
    expect(blocked).toEqual([]);
  });

  test('sheet A with 13 cultivars: 2 pages', async ({ page }) => {
    await open(page, { hash: '#/print/dropoff/1', fake: makeFake({ cultivars: GREEK }) });
    await expect(page.locator('#printArea .sh-page')).toHaveCount(2);
    await page.emulateMedia({ media: 'print' });
    expect(pdfPages(await page.pdf({ format: 'Letter' }))).toBe(2);
  });

  test('sheet B for a dropoff with 11 open lots: 2 pages; a smalls row has no to-smalls box', async ({ page }) => {
    const lots = Array.from({ length: 11 }, (_, i) => lot(20 + i, GREEK[i], i % 3 === 1 ? 'smalls' : 'tops'));
    lots.push(lot(40, 'Mu', 'tops', { intake_lbs: null, money: money0({ status: 'dropped', intake_lbs: null, remainder_lbs: 0 }) }));
    await open(page, { hash: '#/print/screen/5', fake: makeFake({ lots }) });
    await expect(page.locator('#printArea .sh-page')).toHaveCount(2);
    await expect(page.locator('#printArea .sh-code').first()).toHaveText('SCREEN-D5');
    const smallsRow = page.locator('#printArea tr.sh-row[data-lot="21"]');
    await expect(smallsRow.locator('[data-box="to_smalls"]')).toHaveCount(0);
    await expect(smallsRow.locator('.sh-na')).toHaveCount(1);
    await expect(page.locator('#printArea tr.sh-row[data-lot="20"] [data-box="to_smalls"]')).toHaveCount(1);
    await expect(page.locator('#printArea .sh-weighfirst')).toContainText('Mu');
    await page.emulateMedia({ media: 'print' });
    expect(pdfPages(await page.pdf({ format: 'Letter', path: path.join(SHOTS, 'sheet-b-screening.pdf') }))).toBe(2);
  });

  test('print links: home, dropoff farm step, farm page dropoff card', async ({ page }) => {
    await open(page);
    await expect(page.locator('#printSheetBtn')).toHaveAttribute('href', '#/print/dropoff');
    await page.goto(`${PAGE}#/dropoff`);
    await page.locator('[data-farm="1"]').click();
    await expect(page.locator('#printFarmSheet')).toHaveAttribute('href', '#/print/dropoff/1');
    await page.goto(`${PAGE}#/farm/1`);
    await expect(page.locator('[data-printscreen="5"]')).toHaveAttribute('href', '#/print/screen/5');
  });
});
