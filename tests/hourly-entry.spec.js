// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3456';

test.describe('Hourly Entry Page', () => {
  test.beforeEach(async ({ page }) => {
    // Set localStorage to skip tutorial before navigating
    await page.addInitScript(() => {
      localStorage.setItem('hourlyEntry_tutorialComplete', 'true');
      localStorage.setItem('hourlyEntry_tooltipsDismissed', 'true');
    });

    await page.goto(`${BASE_URL}/src/pages/hourly-entry.html`);
    await page.waitForLoadState('networkidle');
  });

  test('page loads without errors', async ({ page }) => {
    // Check page title (Floor Manager dashboard)
    await expect(page).toHaveTitle(/Floor Manager|Hourly.*Entry/i);

    // Check no console errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Verify timeline view is visible
    await expect(page.locator('#timeline-view')).toBeVisible();

    // Verify timeline list exists
    await expect(page.locator('#timeline-list')).toBeVisible();

    // Check for critical elements
    await expect(page.locator('.app-header h1')).toBeVisible();
    await expect(page.locator('#date-picker')).toBeVisible();
    await expect(page.locator('#lang-toggle')).toBeVisible();

    // No JS errors should have occurred
    expect(errors).toHaveLength(0);
  });

  test('timeline slots are rendered with accessibility attributes', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check timeline has proper role
    const timeline = page.locator('#timeline-list');
    await expect(timeline).toHaveAttribute('role', 'list');

    // Check slots have keyboard accessibility
    const firstSlot = page.locator('.timeline-slot').first();
    await expect(firstSlot).toHaveAttribute('role', 'listitem');
    await expect(firstSlot).toHaveAttribute('tabindex', '0');
  });

  test('clicking a time slot opens editor', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click first time slot
    await page.locator('.timeline-slot').first().click();

    // Editor content should be visible (in-card layout)
    await expect(page.locator('#editor-content')).toBeVisible();
    await expect(page.locator('#editor-content')).toHaveClass(/active/);

    // Timeline content should be hidden (in-card layout)
    await expect(page.locator('#timeline-content')).not.toHaveClass(/active/);
  });

  test('editor has accessible form controls', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open editor
    await page.locator('.timeline-slot').first().click();
    await expect(page.locator('#editor-content')).toBeVisible();

    // Check +/- buttons have aria-labels
    const decrementBtn = page.locator('button[data-field="buckers1"].decrement');
    await expect(decrementBtn).toHaveAttribute('aria-label', /decrease/i);

    const incrementBtn = page.locator('button[data-field="buckers1"].increment');
    await expect(incrementBtn).toHaveAttribute('aria-label', /increase/i);

    // Check inputs have aria-labelledby
    const buckersInput = page.locator('#buckers1');
    await expect(buckersInput).toHaveAttribute('aria-labelledby', 'label-buckers1');
  });

  test('keyboard navigation works on timeline', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Focus first slot
    const firstSlot = page.locator('.timeline-slot').first();
    await firstSlot.focus();

    // Press Enter to open
    await page.keyboard.press('Enter');
    await expect(page.locator('#editor-content')).toBeVisible();

    // Go back
    await page.locator('#back-to-timeline').click();
    await expect(page.locator('#timeline-content')).toHaveClass(/active/);

    // Focus and use arrow keys (grid layout: ArrowRight moves to adjacent column)
    await firstSlot.focus();
    await page.keyboard.press('ArrowRight');

    // Second slot (afternoon column, same row) should now be focused
    const secondSlot = page.locator('.timeline-slot').nth(1);
    await expect(secondSlot).toBeFocused();
  });

  test('save indicator elements exist', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open editor
    await page.locator('.timeline-slot').first().click();

    // Check save indicator structure
    const indicator = page.locator('#save-indicator');
    await expect(indicator).toBeAttached();

    await expect(page.locator('#save-indicator .save-success')).toBeAttached();
    await expect(page.locator('#save-indicator .save-error')).toBeAttached();
    await expect(page.locator('#retry-save')).toBeAttached();
  });

  test('step guide updates based on form state', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open editor
    await page.locator('.timeline-slot').first().click();

    // Step guide should exist and show some guidance
    const stepGuide = page.locator('#step-guide');
    await expect(stepGuide).toBeVisible();

    // Should show one of the valid step states (Crew, Production, Complete, Celebrate, Missed)
    await expect(page.locator('#step-title')).toContainText(/crew|equipo|production|producción|done|completado|target|meta/i);
  });

  test('language toggle works', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Get initial language button text
    const langBtn = page.locator('#lang-toggle');
    const initialText = await langBtn.textContent();

    // Click to toggle
    await langBtn.click();

    // Button text should change
    const newText = await langBtn.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('skip link exists for accessibility', async ({ page }) => {
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeAttached();
    await expect(skipLink).toHaveAttribute('href', '#timeline-list');
  });

  test('Enter key moves to next field and saves', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open editor
    await page.locator('.timeline-slot').first().click();
    await expect(page.locator('#editor-content')).toBeVisible();

    // Focus first field
    const buckers1 = page.locator('#buckers1');
    await buckers1.focus();
    await buckers1.fill('3');

    // Press Enter
    await page.keyboard.press('Enter');

    // Should move to next field (trimmers1)
    await expect(page.locator('#trimmers1')).toBeFocused();

    // Fill and press Enter again
    await page.locator('#trimmers1').fill('5');
    await page.keyboard.press('Enter');

    // Should move to tzero1
    await expect(page.locator('#tzero1')).toBeFocused();
  });

  test('start day button and time badge exist', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check start day button exists
    const startBtn = page.locator('#start-day-btn');
    await expect(startBtn).toBeAttached();

    // Check time badge exists (hidden initially)
    const timeBadge = page.locator('#start-time-badge');
    await expect(timeBadge).toBeAttached();

    // Check time display exists
    const timeDisplay = page.locator('#start-time-display');
    await expect(timeDisplay).toBeAttached();
  });
});
