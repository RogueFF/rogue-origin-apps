// @ts-check
//
// Supersack Tracker — the two day-total boxes.
//
// The floor weighs two piles for the whole day, Biomass #2 and Premium #1,
// and never splits either by strain (Koa, 2026-09-03). So the page asks for
// the two totals once and the API divides them across the day's strains by
// sack share. Everything here runs against mocked routes with the real
// response shapes. The test that earns its keep is the submit: it pins that
// the D1 body carries the two totals and NO per-strain biomass/trim, because a
// per-strain key that slips back in silently overrides the split on the worker.
//
// Serve the repo root on :5500 first (the "static" launch config does this).
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5500/src/pages/supersack-entry.html';
const LIFTER = '2025 - Lifter / Sungrown';
const BLISS = '2025 - Berry Bliss / Sungrown';
const LBS_TO_GRAMS = 453.592;

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

/** Route predicate on path + action, so a `?` in the URL is never read as a glob. */
function api(path, action) {
  return url => url.pathname.endsWith(path) && url.searchParams.get('action') === action;
}

async function mockApi(page, { history = [] } = {}) {
  /** Every write the page attempts: sack subtractions, pool credits, the D1 save. */
  const writes = [];
  const record = r => {
    writes.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill(json({ success: true }));
  };

  await page.route(api('/api/production', 'scoreboard'), r => r.fulfill(json({ scoreboard: { hourlyRates: [
    { strain: 'Lifter', lbs: 10, smalls: 4 },
    { strain: 'Berry Bliss', lbs: 20, smalls: 6 },
  ] } })));
  await page.route(api('/api/production', 'dashboard'), r => r.fulfill(json({ strainSnapshot: [] })));
  await page.route(api('/api/supersack', 'history'), r => r.fulfill(json({ entries: history })));
  await page.route(api('/api/supersack', 'submit'), record);
  await page.route(api('/api/pool', 'get_supersack_variants'), r => r.fulfill(json({ variants: [
    { id: 'gid://shopify/ProductVariant/1', title: LIFTER, quantity: 50, inventoryItemId: 'inv-1', locationId: 'loc-1' },
    { id: 'gid://shopify/ProductVariant/2', title: BLISS, quantity: 40, inventoryItemId: 'inv-2', locationId: 'loc-1' },
  ] })));
  await page.route(api('/api/pool', 'list_products'), r => r.fulfill(json({ products: [
    { id: 'gid://shopify/Product/bio', title: 'CBD Biomass (Trim)', poolValue: 0 },
    { id: 'gid://shopify/Product/trim', title: 'Premium CBD Flower Trim', poolValue: 0 },
  ] })));
  await page.route(api('/api/pool', 'update_pool'), record);
  await page.route(api('/api/pool', 'update_supersack_inventory'), record);
  await page.route(api('/api/pool', 'get_recent_changes'), r => r.fulfill(json({ entries: [] })));
  await page.route(api('/api/pool', 'get_supersack_recent_changes'), r => r.fulfill(json({ entries: [] })));
  return writes;
}

async function open(page, opts) {
  const writes = await mockApi(page, opts);
  await page.goto(BASE_URL);
  await page.locator('.strain-row').first().waitFor();
  return writes;
}

async function setSacks(page, strain, n) {
  const input = page.locator(`.strain-row[data-strain="${strain}"] .strain-counter input`);
  await input.fill(String(n));
  await input.dispatchEvent('change');
}

async function setTotals(page, biomass, trim) {
  await page.fill('#biomass-input', String(biomass));
  await page.fill('#trim-input', String(trim));
}

test.describe('Supersack Tracker — day-total boxes', () => {
  test('asks for Biomass #2 and Premium #1 once for the day, never per strain', async ({ page }) => {
    await open(page);
    await setSacks(page, LIFTER, 3);
    await setSacks(page, BLISS, 1);
    await expect(page.locator('#biomass-input')).toBeVisible();
    await expect(page.locator('#trim-input')).toBeVisible();
    // Only the two sack counters live inside the strain rows now.
    await expect(page.locator('.strain-row input[type=number]')).toHaveCount(2);
  });

  test('submits the two totals and leaves the split to the API', async ({ page }) => {
    const writes = await open(page);
    await setSacks(page, LIFTER, 3);
    await setSacks(page, BLISS, 1);
    await setTotals(page, 100, 20);
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toHaveClass(/success/);

    const submits = writes.filter(w => w.url.includes('action=submit'));
    expect(submits).toHaveLength(1);
    const body = submits[0].body;
    expect(body.biomass_lbs).toBe(100);
    expect(body.trim_lbs).toBe(20);
    expect(Object.keys(body.strains).sort()).toEqual([BLISS, LIFTER].sort());
    expect(body.strains[LIFTER].sacks).toBe(3);
    for (const s of Object.values(body.strains)) {
      expect(s).not.toHaveProperty('biomass');
      expect(s).not.toHaveProperty('trim');
    }

    const pool = writes.filter(w => w.url.includes('action=update_pool')).map(w => w.body);
    expect(pool).toHaveLength(2);
    expect(pool.find(p => p.productId.endsWith('/bio'))).toMatchObject({ operation: 'add', amount: Math.round(100 * LBS_TO_GRAMS * 10) / 10 });
    expect(pool.find(p => p.productId.endsWith('/trim'))).toMatchObject({ operation: 'add', amount: Math.round(20 * LBS_TO_GRAMS * 10) / 10 });
  });

  test('refuses Premium #1 above Biomass #2 before any pool call, and Swap puts it right', async ({ page }) => {
    const writes = await open(page);
    await setSacks(page, LIFTER, 3);
    await setTotals(page, 20, 100);
    await expect(page.locator('#weight-warning')).toBeVisible();
    await page.click('#submit-btn');
    await expect(page.locator('#status-msg')).toHaveClass(/error/);
    expect(writes).toHaveLength(0);

    await page.click('#swap-btn');
    await expect(page.locator('#biomass-input')).toHaveValue('100');
    await expect(page.locator('#trim-input')).toHaveValue('20');
    await expect(page.locator('#weight-warning')).toBeHidden();
  });

  test('a saved day pre-fills the boxes with the sum of its rows and locks them', async ({ page }) => {
    await open(page, { history: [
      { date: '2026-09-03', strain: LIFTER, sacks_opened: 3, biomass_lbs: 75, trim_lbs: 15 },
      { date: '2026-09-03', strain: BLISS, sacks_opened: 1, biomass_lbs: 25, trim_lbs: 5 },
    ] });
    await expect(page.locator('#biomass-input')).toHaveValue('100');
    await expect(page.locator('#trim-input')).toHaveValue('20');
    await expect(page.locator('#biomass-input')).toBeDisabled();
    await page.click('#edit-btn');
    await expect(page.locator('#biomass-input')).toBeEnabled();
  });
});
