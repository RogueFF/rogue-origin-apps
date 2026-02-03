// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080/src/pages/hourly-entry.html';
const MOCK_TARGET_RATE = 1.35;

function setupMockAPI(page, existingProduction = []) {
  return page.route('**/api/production**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');

    if (action === 'getProduction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            success: true,
            date: new Date().toISOString().split('T')[0],
            targetRate: MOCK_TARGET_RATE,
            timeSlots: [],
            production: existingProduction,
          },
        }),
      });
    } else if (action === 'getCultivars') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, cultivars: ['2025 Lifter', '2025 Cherry'] },
        }),
      });
    } else if (action === 'getShiftStart') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { success: false } }),
      });
    } else if (action === 'addProduction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'ok', id: 1 }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    }
  });
}

test.describe('Hourly Entry - Goal Fixes & Crew Changes', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('hourlyEntry_tutorialComplete', 'true');
      localStorage.setItem('hourlyEntry_tooltipsDismissed', 'true');
    });
  });

  test('targetRate is loaded from API response, not hardcoded 0.9', async ({ page }) => {
    await setupMockAPI(page);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Open first time slot
    await page.locator('.timeline-slot').first().click();
    await page.waitForTimeout(300);

    // Set 5 trimmers
    const trimmers1 = page.locator('#trimmers1');
    await trimmers1.fill('5');
    await trimmers1.dispatchEvent('change');
    await page.waitForTimeout(600);

    // Read hourly target
    const targetDisplay = page.locator('#hourly-target-value');
    const targetText = await targetDisplay.textContent();
    const targetValue = parseFloat(targetText);

    // With API rate 1.35: 5 * 1.35 * 1.0 = 6.75
    // With old hardcoded 0.9: 5 * 0.9 * 1.0 = 4.5
    // Target must be above 6 (proving API rate is used)
    expect(targetValue).toBeGreaterThanOrEqual(6.5);
    expect(targetValue).toBeLessThanOrEqual(7.0);
  });

  test('QC notes load from API data using qcNotes field', async ({ page }) => {
    const existingData = [{
      timeSlot: '7:00 AM \u2013 8:00 AM',
      trimmers1: 5, buckers1: 2, tzero1: 1,
      cultivar1: '2025 Lifter',
      tops1: 6.5, smalls1: 1.2,
      trimmers2: 0, buckers2: 0, tzero2: 0,
      cultivar2: '', tops2: 0, smalls2: 0,
      qcNotes: '[Crew change 7:30 AM: Trimmers L1: 5 \u2192 4]',
      effectiveTrimmers1: null, effectiveTrimmers2: null,
    }];

    await setupMockAPI(page, existingData);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Open slot with existing data
    await page.locator('.timeline-slot').first().click();
    await page.waitForTimeout(300);

    // QC notes should contain the crew change note
    const qcNotes = page.locator('#qcNotes');
    const notesValue = await qcNotes.inputValue();
    expect(notesValue).toContain('Crew change');
  });

  test('copy crew from previous does not throw (handleFieldChange fix)', async ({ page }) => {
    const existingData = [{
      timeSlot: '7:00 AM \u2013 8:00 AM',
      trimmers1: 5, buckers1: 2, tzero1: 1,
      cultivar1: '2025 Lifter',
      tops1: 6.5, smalls1: 1.2,
      trimmers2: 0, buckers2: 0, tzero2: 0,
      cultivar2: '', tops2: 0, smalls2: 0,
      qcNotes: '', effectiveTrimmers1: null, effectiveTrimmers2: null,
    }];

    await setupMockAPI(page, existingData);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Collect console errors
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Open second morning slot (8-9 AM) — grid is 2-column (morning/afternoon interleaved)
    // nth(0)=7-8AM, nth(1)=12:30-1PM, nth(2)=8-9AM
    const slots = page.locator('.timeline-slot');
    const slotCount = await slots.count();
    if (slotCount > 2) {
      await slots.nth(2).click();
      await page.waitForTimeout(300);

      // Click copy crew
      const copyBtn = page.locator('#copy-crew-btn');
      if (await copyBtn.isVisible()) {
        await copyBtn.click();
        await page.waitForTimeout(600);

        // No errors about handleFieldChange
        const handleErrors = errors.filter(e => e.includes('handleFieldChange'));
        expect(handleErrors).toHaveLength(0);

        // Trimmers should be copied
        const t1Val = await page.locator('#trimmers1').inputValue();
        expect(t1Val).toBe('5');
      }
    }
  });

  test('save payload includes effectiveTrimmers and qcNotes', async ({ page }) => {
    let savedPayload = null;

    await page.route('**/api/production**', async (route) => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');

      if (action === 'addProduction') {
        savedPayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'ok', id: 1 }),
        });
      } else if (action === 'getProduction') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { success: true, targetRate: MOCK_TARGET_RATE, production: [] },
          }),
        });
      } else if (action === 'getCultivars') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { cultivars: [] } }),
        });
      } else if (action === 'getShiftStart') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { success: false } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: {} }),
        });
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Open first slot
    await page.locator('.timeline-slot').first().click();
    await page.waitForTimeout(300);

    // Enter crew + production
    await page.locator('#trimmers1').fill('5');
    await page.locator('#trimmers1').dispatchEvent('change');
    await page.locator('#tops1').fill('7.2');
    await page.locator('#tops1').dispatchEvent('change');

    // Wait for auto-save (1s debounce + buffer)
    await page.waitForTimeout(2000);

    // Verify payload
    expect(savedPayload).not.toBeNull();
    expect(savedPayload).toHaveProperty('effectiveTrimmers1');
    expect(savedPayload).toHaveProperty('effectiveTrimmers2');
    expect(savedPayload).toHaveProperty('qcNotes');
    expect(savedPayload.trimmers1).toBe(5);
    expect(savedPayload.effectiveTrimmers1).toBe(5); // No mid-hour change, effective = raw
  });

  test('timeline target uses effective trimmers from API data', async ({ page }) => {
    const existingData = [{
      timeSlot: '7:00 AM \u2013 8:00 AM',
      trimmers1: 4, buckers1: 2, tzero1: 1,
      cultivar1: '2025 Lifter',
      tops1: 6.5, smalls1: 1.2,
      trimmers2: 0, buckers2: 0, tzero2: 0,
      cultivar2: '', tops2: 0, smalls2: 0,
      qcNotes: '',
      effectiveTrimmers1: 4.5, // Weighted from mid-hour crew change
      effectiveTrimmers2: null,
    }];

    await setupMockAPI(page, existingData);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Timeline target should use effective trimmers (4.5), not raw (4)
    const targetEl = page.locator('#timeline-target');
    const targetText = await targetEl.textContent();
    const targetValue = parseFloat(targetText);

    // With effective 4.5 trimmers: 4.5 * 1.35 * 1.0 = 6.075
    // With raw 4 trimmers: 4 * 1.35 * 1.0 = 5.4
    expect(targetValue).toBeGreaterThan(5.8);
    expect(targetValue).toBeLessThan(6.5);
  });

  test('page loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await setupMockAPI(page);
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    expect(errors).toHaveLength(0);
  });
});
