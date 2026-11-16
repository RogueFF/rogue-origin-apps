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
    if (sessionStorage.getItem('seeded')) return; // a later language switch survives reloads
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    localStorage.setItem('ro-lang', l);
  }, lang);
  await page.goto(PAGE + hash);
  return { fake, blocked };
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

/** A plain test photo made in the page: a big white canvas with lines on it, as a JPEG. Never committed. */
async function makePhoto(page, w = 3000, h = 2250) {
  const b64 = await page.evaluate(([cw, ch]) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch);
    x.strokeStyle = '#000'; x.lineWidth = 6;
    for (let i = 1; i < 12; i++) { x.beginPath(); x.moveTo(100, (i * ch) / 12); x.lineTo(cw - 100, (i * ch) / 12); x.stroke(); }
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, [w, h]);
  return { name: 'sheet.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** Width and height from a JPEG's SOF marker. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const DROP_READ = {
  kind: 'dropoff', farm_id: 1, dropped_by: 'Sam', note: 'two totes', date: null, warnings: [],
  rows: [
    { cultivar: 'Alpha', cultivar_known: true, tops: { value: 52, unsure: true, on: true }, smalls: { value: null, unsure: false, on: false }, note: '' },
    { cultivar: 'Alpah', cultivar_known: false, tops: { value: 10, unsure: false, on: true }, smalls: { value: null, unsure: false, on: true }, note: 'wet' },
  ],
};
const SCREEN_LOTS = () => [
  lot(10, 'Alpha', 'tops'),
  lot(11, 'Alpha', 'smalls', { money: money0({ intake_lbs: 40, remainder_lbs: 40 }) }),
  lot(12, 'Beta', 'tops', { intake_lbs: null, money: money0({ status: 'dropped', intake_lbs: null, remainder_lbs: 0 }) }),
  lot(13, 'Gamma', 'tops', { money: money0({ intake_lbs: 60, remainder_lbs: 60 }) }),
];
const v = (value, unsure = false) => ({ value, unsure });
const SCREEN_READ = {
  kind: 'screen', farm_id: null, dropped_by: '', note: '', date: null, warnings: [],
  rows: [
    { lot_id: 10, pulled: v(100), final: v(80), to_smalls: v(10), biomass: v(9), mold: v(1), finishes: { value: true, unsure: false } },
    { lot_id: 13, pulled: v(60), final: v(50), to_smalls: v(0), biomass: v(5), mold: v(2), finishes: { value: false, unsure: false } },
  ],
};

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

test.describe('Consignment photo of a sheet', () => {
  test('photo -> dropoff: prefilled, marked Check, Save only after both are checked, saved as paper', async ({ page }) => {
    const fake = makeFake({ read: DROP_READ });
    const { blocked } = await open(page, { hash: '#/photo/dropoff/1', fake });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page));
    await expect(page.locator('#photoBanner')).toHaveText('Filled from a photo. Check every number before saving.');
    const save = page.locator('#saveBtn');
    await expect(save).toBeDisabled();
    await expect(page.locator('.cs-markword')).toHaveCount(2);
    await expect(page.locator('.cs-markword').first()).toHaveText('Check');
    await expect(page.locator('#saveError')).toContainText('Boxes still to check: 2');
    const alphaTops = page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]');
    await expect(alphaTops).toHaveValue('52');
    await expect(alphaTops).toHaveClass(/cs-mark/);
    await expect(page.locator('#droppedBy')).toHaveValue('Sam');
    await expect(page.locator('#dropNote')).toHaveValue('two totes');
    // edit the unsure weight: the mark clears and focus stays
    await alphaTops.fill('52.5');
    await expect(alphaTops).not.toHaveClass(/cs-mark/);
    await expect(alphaTops).toBeFocused();
    await expect(save).toBeDisabled();
    // the unknown cultivar: fix the name
    await page.locator('input[data-name]').fill('Beta');
    await page.locator('input[data-name]').blur();
    await expect(page.locator('.cs-markword')).toHaveCount(0);
    await expect(save).toBeEnabled();
    expect(fake.posts).toEqual([]);
    await save.click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const post = fake.posts.find((p) => p.action === 'saveDropoff');
    expect(post.body.source).toBe('paper');
    expect(post.body.farm_id).toBe(1);
    expect(post.body.lines).toEqual([
      { cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 52.5 },
      { cultivar: 'Beta', type: 'tops', term: 'dropoff', intake_lbs: 10, note: 'wet' },
      { cultivar: 'Beta', type: 'smalls', term: 'dropoff', intake_lbs: null, note: 'wet' },
    ]);
    // the read request: one photo, shrunk to at most 2000 px, under 4 MB, farm passed along
    expect(fake.reads).toHaveLength(1);
    const r = fake.reads[0];
    expect(r).toMatchObject({ kind: 'dropoff', farm_id: 1, media_type: 'image/jpeg' });
    const img = Buffer.from(r.image_b64, 'base64');
    const size = jpegSize(img);
    expect(Math.max(size.width, size.height)).toBe(2000);
    expect(img.length).toBeLessThan(4 * 1024 * 1024);
    expect(blocked).toEqual([]);
  });

  test('photo -> dropoff: OK keeps the number as read; a small photo is not enlarged', async ({ page }) => {
    const fake = makeFake({ read: { ...DROP_READ, rows: [DROP_READ.rows[0]] } });
    await open(page, { hash: '#/photo/dropoff/1', fake });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await page.locator('[data-okmark$="|tops"]').click();
    await expect(page.locator('.cs-markword')).toHaveCount(0);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(fake.posts[0].body.lines).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 52 }]);
    expect(Math.max(...Object.values(jpegSize(Buffer.from(fake.reads[0].image_b64, 'base64'))))).toBe(800);
  });

  test('photo -> screening review: blank lot skipped, Save all waits for the off lot, two saves with their own keys', async ({ page }) => {
    const fake = makeFake({ lots: SCREEN_LOTS(), read: SCREEN_READ });
    const { blocked } = await open(page, { hash: '#/photo/screen/5', fake });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page));
    await expect(page.locator('[data-review]')).toHaveCount(3);
    await expect(page.locator('[data-review="11"]')).toContainText('Not screened');
    await expect(page.locator('[data-review="11"] input')).toHaveCount(0);
    await expect(page.locator('[data-review="12"]')).toHaveCount(0);
    await expect(page.locator('[data-checkbar="13"]')).toContainText('Off by 3');
    await expect(page.locator('[data-checkbar="10"]')).toContainText('Adds up');
    const saveAll = page.locator('#saveAllBtn');
    await expect(saveAll).toBeDisabled();
    await page.locator('[data-f="13|biomass"]').fill('8');
    await expect(page.locator('[data-checkbar="13"]')).toContainText('Adds up');
    await expect(saveAll).toBeEnabled();
    expect(fake.posts).toEqual([]);
    await saveAll.click();
    await expect(page.locator('#toast')).toHaveText('All saved');
    await expect(page).toHaveURL(/#\/farm\/1$/);
    const runs = fake.posts.filter((p) => p.action === 'saveScreenRun').map((p) => p.body);
    expect(runs.map((b) => b.lot_id)).toEqual([10, 13]);
    expect(new Set(runs.map((b) => b.client_key)).size).toBe(2);
    expect(runs.map((b) => b.finishes_lot)).toEqual([true, false]);
    expect(runs[1]).toMatchObject({ pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 0, biomass_lbs: 8, mold_lbs: 2 });
    expect(fake.reads[0]).toMatchObject({ kind: 'screen', dropoff_id: 5 });
    expect(blocked).toEqual([]);
  });

  test('screening review: an unsure box blocks Save all; a refusal keeps that card editable and the others save', async ({ page }) => {
    const read = { ...SCREEN_READ, rows: [{ ...SCREEN_READ.rows[0], mold: v(1, true) }, { ...SCREEN_READ.rows[1], biomass: v(8) }] };
    const fake = makeFake({ lots: SCREEN_LOTS(), read });
    fake.refuseLot = { id: 10, error: 'Only 90 lb is left to screen, cannot pull more than that' };
    await open(page, { hash: '#/photo/screen/5', fake });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await expect(page.locator('#saveAllBtn')).toBeDisabled();
    await expect(page.locator('[data-review="10"] .cs-markword')).toHaveText('Check');
    await page.locator('[data-okmark="10|mold"]').click();
    await page.locator('#saveAllBtn').click();
    await expect(page.locator('[data-review="10"] [data-status="refused"]')).toContainText('Only 90 lb');
    await expect(page.locator('[data-review="13"] [data-status="saved"]')).toBeVisible();
    await expect(page.locator('[data-f="10|pulled"]')).toBeEnabled();
    await expect(page.locator('[data-f="13|pulled"]')).toBeDisabled();
    expect(fake.posts.map((p) => p.body.lot_id)).toEqual([10, 13]);
    fake.refuseLot = null;
    await page.locator('[data-f="10|pulled"]').fill('90');
    await page.locator('[data-f="10|final"]').fill('70');
    await page.locator('[data-saveone="10"]').click();
    await expect(page.locator('#toast')).toHaveText('All saved');
    const again = fake.posts.filter((p) => p.body.lot_id === 10);
    expect(again).toHaveLength(2);
    expect(again[0].body.client_key).toBe(again[1].body.client_key);
  });

  test('screening review with no signal: the first save is held, the rest go straight to the held list', async ({ page }) => {
    const fake = makeFake({ lots: SCREEN_LOTS(), read: { ...SCREEN_READ, rows: [SCREEN_READ.rows[0], { ...SCREEN_READ.rows[1], biomass: v(8) }] } });
    fake.offlineAfter = 0;
    await open(page, { hash: '#/photo/screen/5', fake });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await page.locator('#saveAllBtn').click();
    await expect(page.locator('#toast')).toHaveText('No signal. The rest are held on this device.');
    const held = await page.evaluate(() => Object.keys(localStorage).filter((k) => /consign/.test(k)).map((k) => localStorage.getItem(k)).join(''));
    expect(held).toContain('"lot_id":10');
    expect(held).toContain('"lot_id":13');
    expect(fake.posts.filter((p) => p.action === 'saveScreenRun')).toHaveLength(1);
  });

  test('read fails: the message, Enter by hand, and nothing saved', async ({ page }) => {
    const fake = makeFake({ readError: 'Could not read the sheet. Enter the numbers by hand.' });
    await open(page, { hash: '#/photo/dropoff', fake });
    await page.locator('#takePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await expect(page.locator('#readFailed')).toContainText('Could not read the sheet. Enter the numbers by hand.');
    await expect(page.locator('#enterByHand')).toHaveAttribute('href', '#/dropoff');
    await page.locator('#enterByHand').click();
    await expect(page.locator('[data-farm="1"]')).toBeVisible();
    expect(fake.posts).toEqual([]);
    expect(fake.reads).toHaveLength(1);
  });

  test('read fails in Spanish; a wrong sheet is refused', async ({ page }) => {
    const fake = makeFake({ readError: 'Could not read the sheet. Enter the numbers by hand.' });
    await open(page, { hash: '#/photo/screen/5', fake, lang: 'es' });
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await expect(page.locator('#readFailed')).toContainText('No se pudo leer la hoja');
    await expect(page.locator('#enterByHand')).toHaveText('Escribir a mano');
    await expect(page.locator('#enterByHand')).toHaveAttribute('href', '#/farm/1');
    fake.readError = null;
    fake.read = { kind: 'screen', farm_id: null, dropped_by: '', note: '', date: null, rows: [], warnings: ['wrong_sheet'] };
    await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
    await expect(page.locator('#readFailed')).toContainText('otra hoja');
    expect(fake.posts).toEqual([]);
  });

  test('screenshots: sheets, prefilled dropoff and screening review at 375 and 1024, EN and ES', async ({ page }) => {
    test.setTimeout(120000);
    const fake = makeFake({ lots: SCREEN_LOTS(), read: DROP_READ });
    await open(page, { fake });
    for (const lang of ['en', 'es']) {
      await page.evaluate((l) => localStorage.setItem('ro-lang', l), lang);
      for (const width of [375, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        const shot = async (name) => {
          expect(await noHorizontalScroll(page), `${name} ${lang} ${width}`).toBe(true);
          await page.screenshot({ path: path.join(SHOTS, `paper-${name}-${lang}-${width}.png`), fullPage: true });
        };
        await page.goto(`${PAGE}#/print/dropoff/1`);
        await page.reload();
        await expect(page.locator('.sh-preview .sh-page')).toHaveCount(1);
        await shot('sheet-a');
        await page.goto(`${PAGE}#/print/screen/5`);
        await expect(page.locator('.sh-preview .sh-page')).toHaveCount(1);
        await shot('sheet-b');
        fake.read = DROP_READ;
        await page.goto(`${PAGE}#/photo/dropoff/1`);
        await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
        await expect(page.locator('#photoBanner')).toBeVisible();
        await shot('dropoff-prefilled');
        fake.read = SCREEN_READ;
        await page.goto(`${PAGE}#/photo/screen/5`);
        await page.locator('#choosePhoto').setInputFiles(await makePhoto(page, 800, 600));
        await expect(page.locator('#saveAllBtn')).toBeVisible();
        await shot('screen-review');
        await page.goto(`${PAGE}#/`);
      }
    }
    expect(fake.posts).toEqual([]);
  });
});
