// Consignment: a lot finished at dropoff (optional Final lb on the dropoff form).
// Made-up farms, cultivars and prices only. Every *.workers.dev request the fake does not
// answer is aborted at the context level; readSheet is answered by the fake.
// Run: npx playwright test tests/consign-final.spec.js --project=chromium
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8133;
const PAGE = `http://localhost:${PORT}/src/pages/consign.html`;
const SHOTS = path.resolve(__dirname, '..', 'test-results', 'consign-shots');
let server;
test.beforeAll(async () => {
  server = spawn('python', ['-m', 'http.server', String(PORT)], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.afterAll(() => { if (server) server.kill(); });

const FARMS = [{ id: 1, name: 'Farm A', default_term: 'dropoff', lang: 'en', active: 1, balance: 0, credit: 0, owed: 0, paid: 0, estimate: false, needs_price: false }];
const PRICES = ['Alpha', 'Beta', 'Gamma'].flatMap((c, i) => [
  { id: i * 2 + 1, farm_id: 1, cultivar: c, type: 'tops', price_per_lb: 10, effective_from: '2026-01-01' },
  { id: i * 2 + 2, farm_id: 1, cultivar: c, type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01' },
]);

function makeFake(o = {}) {
  const state = { posts: [], reads: [], offline: false, read: o.read || null };
  state.answer = (action, body) => {
    switch (action) {
      case 'farms': return FARMS;
      case 'open': return { to_weigh: [], to_screen: [], needs_price: [] };
      case 'farm': return { farm: FARMS[0], price_points: PRICES, dropoffs: [], payments: [], totals: { owed: 0, paid: 0, balance: 0, credit: 0, estimate: false, needs_price: false } };
      case 'saveDropoff': return { dropoff: { id: 6, farm_id: body.farm_id }, lots: [] };
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
    if (action === 'readSheet') { fake.reads.push(body); return reply(200, { success: true, data: { read: fake.read } }); }
    if (action.startsWith('save')) {
      fake.posts.push({ action, body });
      if (fake.offline) return route.abort('internetdisconnected');
    }
    const data = fake.answer(action, body);
    if (data == null) { blocked.push(req.url()); return route.abort(); }
    return reply(200, { success: true, data });
  });
  return blocked;
}

async function open(page, { lang = 'en', hash = '#/dropoff', fake = makeFake() } = {}) {
  page.on('dialog', (d) => d.accept());
  const blocked = await isolate(page.context(), fake);
  await page.addInitScript((l) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('ro_api_password', 'test-only');
    localStorage.setItem('ro-lang', l);
  }, lang);
  await page.goto(PAGE + hash);
  return { fake, blocked };
}

const box = (page, cultivar, type, what = 'lbs') => page.locator(`[data-row="${cultivar}"] [data-type="${type}"] input[data-${what}]`).first();
const loss = (page, cultivar, type, key) => page.locator(`[data-row="${cultivar}"] [data-type="${type}"] input[data-loss$="|${key}"]`).first();
const finalx = (page, cultivar, type) => page.locator(`[data-row="${cultivar}"] [data-type="${type}"] .cs-finalx`).first();
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function startAlpha(page) {
  await page.locator('[data-farm="1"]').click();
  await page.getByRole('button', { name: '＋ Alpha' }).click();
}
const savedLines = (fake) => fake.posts.filter((p) => p.action === 'saveDropoff').at(-1).body.lines;

test.describe('Consignment: finished at dropoff', () => {
  test('final empty: nothing changes, no final is sent', async ({ page }) => {
    const { fake, blocked } = await open(page);
    await startAlpha(page);
    await expect(box(page, 'Alpha', 'tops', 'final')).toBeVisible();
    await expect(page.locator('[data-row="Alpha"] [data-type="tops"] label[for$="-final"]')).toHaveText('Final lb');
    await box(page, 'Alpha', 'tops').fill('40');
    await expect(finalx(page, 'Alpha', 'tops')).toBeEmpty();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 40 }]);
    expect(blocked).toEqual([]);
  });

  test('final equal to the weight: no more questions, the summary shows before → after', async ({ page }) => {
    const { fake, blocked } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('50');
    await box(page, 'Alpha', 'tops', 'final').fill('50');
    await expect(loss(page, 'Alpha', 'tops', 'biomass')).toHaveCount(0);
    await expect(finalx(page, 'Alpha', 'tops')).toContainText('Finished at dropoff');
    await expect(page.locator('#summary')).toContainText('50 → 50 lb');
    await expect(page.locator('#summary')).toContainText('Finished at dropoff');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 50, final: { final_lbs: 50 } }]);
    expect(blocked).toEqual([]);
  });

  test('final inside the tolerance counts as equal', async ({ page }) => {
    await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('100');
    await box(page, 'Alpha', 'tops', 'final').fill('99.2');
    await expect(loss(page, 'Alpha', 'tops', 'biomass')).toHaveCount(0);
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('final lower (tops): loss boxes appear with the add-up bar; Save waits until it adds up', async ({ page }) => {
    const { fake, blocked } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('100');
    const fin = box(page, 'Alpha', 'tops', 'final');
    await fin.fill('80');
    await expect(fin).toBeFocused();
    for (const k of ['toSmalls', 'biomass', 'mold']) await expect(loss(page, 'Alpha', 'tops', k)).toBeVisible();
    const bar = page.locator('[data-row="Alpha"] [data-type="tops"] .cs-checkbar');
    await expect(bar).toContainText('Off by 20 lb');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('#saveError')).toContainText('must add up');
    await loss(page, 'Alpha', 'tops', 'toSmalls').fill('10');
    await expect(loss(page, 'Alpha', 'tops', 'toSmalls')).toBeFocused();
    await expect(bar).toContainText('Off by 10 lb');
    await loss(page, 'Alpha', 'tops', 'biomass').fill('8');
    await loss(page, 'Alpha', 'tops', 'mold').fill('2');
    await expect(loss(page, 'Alpha', 'tops', 'mold')).toBeFocused();
    await expect(bar).toContainText('Adds up');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(page.locator('#summary')).toContainText('100 → 80 lb');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 100, final: { final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2 } }]);
    expect(blocked).toEqual([]);
  });

  test('final lower (smalls): only Biomass and Mold', async ({ page }) => {
    const { fake } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'smalls').fill('40');
    await box(page, 'Alpha', 'smalls', 'final').fill('36');
    await expect(loss(page, 'Alpha', 'smalls', 'toSmalls')).toHaveCount(0);
    await loss(page, 'Alpha', 'smalls', 'biomass').fill('4');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'smalls', term: 'dropoff', intake_lbs: 40, final: { final_lbs: 36, biomass_lbs: 4, mold_lbs: 0 } }]);
  });

  test('raising the final back to the weight hides the loss boxes and sends no stale losses', async ({ page }) => {
    const { fake } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('100');
    await box(page, 'Alpha', 'tops', 'final').fill('80');
    await loss(page, 'Alpha', 'tops', 'biomass').fill('20');
    await box(page, 'Alpha', 'tops', 'final').fill('100');
    await expect(loss(page, 'Alpha', 'tops', 'biomass')).toHaveCount(0);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)[0].final).toEqual({ final_lbs: 100 });
  });

  test('final higher than the weight: inline error, Save off', async ({ page }) => {
    await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('50');
    await box(page, 'Alpha', 'tops', 'final').fill('55');
    await expect(finalx(page, 'Alpha', 'tops')).toContainText('more than the weight');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await box(page, 'Alpha', 'tops', 'final').fill('5x');
    await expect(page.locator('#saveBtn')).toBeDisabled();
  });

  test('review: "1,000" is refused, never read as 1 lb; "12,5" is 12.5', async ({ page }) => {
    const { fake } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('1,000');
    await box(page, 'Alpha', 'tops', 'final').fill('1,000');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await box(page, 'Alpha', 'tops').fill('12,5');
    await box(page, 'Alpha', 'tops', 'final').fill('12,5');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 12.5, final: { final_lbs: 12.5 } }]);
  });

  test('review: unsplitting clears the finals so the merged line is asked again', async ({ page }) => {
    await open(page);
    await startAlpha(page);
    const split = page.locator('[data-row="Alpha"] [data-type="tops"] [data-split]');
    await split.click();
    const finals = page.locator('[data-row="Alpha"] [data-type="tops"] input[data-final]');
    await finals.nth(0).fill('5');
    await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]').nth(1).fill('10');
    await finals.nth(1).fill('10');
    await split.click();
    await expect(box(page, 'Alpha', 'tops')).toHaveValue('10');
    await expect(box(page, 'Alpha', 'tops', 'final')).toHaveValue('');
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('final with no weight: accepted as weighed, no more questions', async ({ page }) => {
    const { fake } = await open(page);
    await startAlpha(page);
    await box(page, 'Alpha', 'tops', 'final').fill('70');
    await expect(page.locator('[data-row="Alpha"] [data-on$="|tops"]')).toBeChecked();
    await expect(loss(page, 'Alpha', 'tops', 'biomass')).toHaveCount(0);
    await expect(page.locator('#summary')).toContainText('70 → 70 lb');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: null, final: { final_lbs: 70 } }]);
  });

  test('a term split: each part has its own final', async ({ page }) => {
    const { fake } = await open(page);
    await startAlpha(page);
    await page.locator('[data-row="Alpha"] [data-type="tops"] [data-split]').click();
    const lbsBoxes = page.locator('[data-row="Alpha"] [data-type="tops"] input[data-lbs]');
    const finals = page.locator('[data-row="Alpha"] [data-type="tops"] input[data-final]');
    await expect(finals).toHaveCount(2);
    await lbsBoxes.nth(0).fill('30');
    await finals.nth(0).fill('30');
    await lbsBoxes.nth(1).fill('70');
    await finals.nth(1).fill('60');
    await page.locator('[data-row="Alpha"] [data-type="tops"] input[data-loss$="|1|biomass"]').fill('10');
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    expect(savedLines(fake)).toEqual([
      { cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 30, final: { final_lbs: 30 } },
      { cultivar: 'Alpha', type: 'tops', term: 'sold', intake_lbs: 70, final: { final_lbs: 60, to_smalls_lbs: 0, biomass_lbs: 10, mold_lbs: 0 } },
    ]);
  });

  test('no signal: a dropoff with a final is held and resent unchanged', async ({ page }) => {
    const { fake, blocked } = await open(page);
    fake.offline = true;
    await startAlpha(page);
    await box(page, 'Alpha', 'tops').fill('50');
    await box(page, 'Alpha', 'tops', 'final').fill('50');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#heldChip')).toHaveText('1 held');
    fake.offline = false;
    await page.locator('#heldChip').click();
    await expect(page.locator('#heldChip')).toBeHidden();
    const sends = fake.posts.filter((p) => p.action === 'saveDropoff');
    expect(sends).toHaveLength(2);
    expect(sends[1].body).toEqual(sends[0].body);
    expect(sends[1].body.lines[0].final).toEqual({ final_lbs: 50 });
    expect(blocked).toEqual([]);
  });

  test('photo: a final below its weight opens empty loss boxes marked Check', async ({ page }) => {
    const v = (value, unsure = false) => ({ value, unsure });
    const read = {
      kind: 'dropoff', farm_id: 1, dropped_by: 'Sam', note: '', date: null, warnings: [],
      rows: [
        { cultivar: 'Alpha', cultivar_known: true, tops: { ...v(100), on: true }, tops_final: v(90), smalls: { ...v(null), on: false }, smalls_final: v(null), note: '' },
        { cultivar: 'Beta', cultivar_known: true, tops: { ...v(20), on: true }, tops_final: v(20), smalls: { ...v(null), on: true }, smalls_final: v(15, true), note: '' },
      ],
    };
    const fake = makeFake({ read });
    const { blocked } = await open(page, { hash: '#/photo/dropoff/1', fake });
    await page.locator('#choosePhoto').setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await expect(page.locator('#photoBanner')).toBeVisible();
    await expect(box(page, 'Alpha', 'tops', 'final')).toHaveValue('90');
    await expect(box(page, 'Beta', 'tops', 'final')).toHaveValue('20');
    await expect(box(page, 'Beta', 'smalls', 'final')).toHaveValue('15');
    await expect(box(page, 'Beta', 'smalls', 'final')).toHaveClass(/cs-mark/);
    for (const k of ['toSmalls', 'biomass', 'mold']) await expect(loss(page, 'Alpha', 'tops', k)).toHaveValue('');
    await expect(page.locator('[data-row="Alpha"] [data-type="tops"] .cs-losses.cs-marked .cs-markword')).toHaveText('Check');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await loss(page, 'Alpha', 'tops', 'biomass').fill('10');
    await expect(page.locator('[data-row="Alpha"] [data-type="tops"] .cs-losses.cs-marked')).toHaveCount(0);
    // Beta smalls: a final with no weight, unsure; OK it.
    await page.locator('[data-okmark$="|smalls_final"]').click();
    await expect(page.locator('#saveBtn')).toBeEnabled();
    expect(fake.posts).toEqual([]);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const post = fake.posts.find((p) => p.action === 'saveDropoff');
    expect(post.body.source).toBe('paper');
    expect(post.body.lines).toEqual([
      { cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 100, final: { final_lbs: 90, to_smalls_lbs: 0, biomass_lbs: 10, mold_lbs: 0 } },
      { cultivar: 'Beta', type: 'tops', term: 'dropoff', intake_lbs: 20, final: { final_lbs: 20 } },
      { cultivar: 'Beta', type: 'smalls', term: 'dropoff', intake_lbs: null, final: { final_lbs: 15 } },
    ]);
    expect(blocked).toEqual([]);
  });

  test('Spanish labels; every state at 375 and 1024 in EN and ES, no sideways scroll; screenshots', async ({ page }) => {
    const want = {
      en: { final: 'Final lb', done: 'Finished at dropoff', where: 'Where did the 20 lb go?', addsUp: 'Adds up', over: 'more than the weight' },
      es: { final: 'Libras finales', done: 'Terminado en la entrega', where: '¿A dónde fueron las 20 lb?', addsUp: 'Cuadra', over: 'más que el peso' },
    };
    test.setTimeout(120000);
    const { blocked } = await open(page);
    for (const lang of ['en', 'es']) {
      await page.evaluate((l) => localStorage.setItem('ro-lang', l), lang);
      for (const width of [375, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${PAGE}#/dropoff`);
        await page.reload();
        await startAlpha(page);
        await expect(page.locator('[data-row="Alpha"] [data-type="tops"] label[for$="-final"]')).toHaveText(want[lang].final);
        await box(page, 'Alpha', 'tops').fill('50');
        await box(page, 'Alpha', 'tops', 'final').fill('50');
        await expect(finalx(page, 'Alpha', 'tops')).toContainText(want[lang].done);
        expect(await noHorizontalScroll(page)).toBe(true);
        await page.locator('.cs-step').nth(1).screenshot({ path: path.join(SHOTS, `final-equal-${lang}-${width}.png`) });
        await box(page, 'Alpha', 'smalls').fill('100');
        await box(page, 'Alpha', 'smalls', 'final').fill('80');
        await expect(finalx(page, 'Alpha', 'smalls')).toContainText(want[lang].where);
        await loss(page, 'Alpha', 'smalls', 'biomass').fill('15');
        await loss(page, 'Alpha', 'smalls', 'mold').fill('5');
        await expect(finalx(page, 'Alpha', 'smalls')).toContainText(want[lang].addsUp);
        expect(await noHorizontalScroll(page)).toBe(true);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOTS, `final-lower-${lang}-${width}.png`), fullPage: true });
        // Higher than the weight: inline error, Save off.
        await box(page, 'Alpha', 'tops', 'final').fill('55');
        await expect(finalx(page, 'Alpha', 'tops')).toContainText(want[lang].over);
        await expect(page.locator('#saveBtn')).toBeDisabled();
        expect(await noHorizontalScroll(page)).toBe(true);
        // No weight: taken as weighed.
        await box(page, 'Alpha', 'tops').fill('');
        await box(page, 'Alpha', 'tops', 'final').fill('70');
        await expect(finalx(page, 'Alpha', 'tops')).toContainText('70 → 70');
        await expect(page.locator('#summary')).toContainText('70 → 70');
        await expect(page.locator('#saveBtn')).toBeEnabled();
        expect(await noHorizontalScroll(page)).toBe(true);
      }
    }
    expect(blocked).toEqual([]);
  });

  test('the dropoff sheet PDF with the Final columns is one letter page', async ({ page }) => {
    const { blocked } = await open(page, { hash: '#/print/dropoff/1' });
    await expect(page.locator('#printArea .sh-page')).toHaveCount(1);
    await expect(page.locator('#printArea thead')).toContainText('Tops final');
    await expect(page.locator('#printArea thead')).toContainText('Smalls final');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('.sh-preview').screenshot({ path: path.join(SHOTS, 'final-sheet-a-preview.png') });
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', path: path.join(SHOTS, 'final-sheet-a-dropoff.pdf') });
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(1);
    expect(blocked).toEqual([]);
  });
});
