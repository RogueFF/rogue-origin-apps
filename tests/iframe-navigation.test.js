/**
 * Iframe Navigation Test Suite
 * Tests the view switching system in the main dashboard
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'file://' + path.resolve(__dirname, '../src/pages');
const TIMEOUT = 10000;

describe('Iframe Navigation Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle2' });
  });

  afterEach(async () => {
    await page.close();
  });

  describe('View Switching', () => {
    test('Dashboard view is active by default', async () => {
      const dashboardActive = await page.$eval('#dashboardView', el =>
        el.classList.contains('active')
      );
      expect(dashboardActive).toBe(true);
    });

    test('Clicking Kanban nav item switches to kanban view', async () => {
      await page.click('[data-view="kanban"]');
      await page.waitForSelector('#kanbanView.active', { timeout: 5000 });

      const kanbanActive = await page.$eval('#kanbanView', el =>
        el.classList.contains('active')
      );
      expect(kanbanActive).toBe(true);

      const dashboardActive = await page.$eval('#dashboardView', el =>
        el.classList.contains('active')
      );
      expect(dashboardActive).toBe(false);
    });

    test('Clicking Scoreboard nav item switches to scoreboard view', async () => {
      await page.click('[data-view="scoreboard"]');
      await page.waitForSelector('#scoreboardView.active', { timeout: 5000 });

      const scoreboardActive = await page.$eval('#scoreboardView', el =>
        el.classList.contains('active')
      );
      expect(scoreboardActive).toBe(true);
    });

    test('Clicking Barcode nav item switches to barcode view', async () => {
      await page.click('[data-view="barcode"]');
      await page.waitForSelector('#barcodeView.active', { timeout: 5000 });

      const barcodeActive = await page.$eval('#barcodeView', el =>
        el.classList.contains('active')
      );
      expect(barcodeActive).toBe(true);
    });

    test('Clicking SOP nav item switches to sop view', async () => {
      await page.click('[data-view="sop"]');
      await page.waitForSelector('#sopView.active', { timeout: 5000 });

      const sopActive = await page.$eval('#sopView', el =>
        el.classList.contains('active')
      );
      expect(sopActive).toBe(true);
    });

    test('Clicking Orders nav item switches to orders view', async () => {
      await page.click('[data-view="orders"]');
      await page.waitForSelector('#ordersView.active', { timeout: 5000 });

      const ordersActive = await page.$eval('#ordersView', el =>
        el.classList.contains('active')
      );
      expect(ordersActive).toBe(true);
    });

    test('Clicking Dashboard nav item returns to dashboard view', async () => {
      // Switch away first
      await page.click('[data-view="kanban"]');
      await page.waitForSelector('#kanbanView.active');

      // Switch back
      await page.click('[data-view="dashboard"]');
      await page.waitForSelector('#dashboardView.active');

      const dashboardActive = await page.$eval('#dashboardView', el =>
        el.classList.contains('active')
      );
      expect(dashboardActive).toBe(true);
    });
  });

  describe('Lazy Loading', () => {
    test('Iframe src not set until view activated', async () => {
      const kanbanSrcBefore = await page.$eval('#kanbanFrame', el => el.src);
      expect(kanbanSrcBefore).toBe('');

      await page.click('[data-view="kanban"]');
      await page.waitForSelector('#kanbanView.active');

      const kanbanSrcAfter = await page.$eval('#kanbanFrame', el => el.src);
      expect(kanbanSrcAfter).toContain('kanban.html');
    });

    test('Iframe src persists on second activation', async () => {
      // Activate kanban first time
      await page.click('[data-view="kanban"]');
      await page.waitForSelector('#kanbanView.active');

      const firstSrc = await page.$eval('#kanbanFrame', el => el.src);

      // Switch away and back
      await page.click('[data-view="dashboard"]');
      await page.click('[data-view="kanban"]');

      const secondSrc = await page.$eval('#kanbanFrame', el => el.src);
      expect(secondSrc).toBe(firstSrc);
    });
  });

  describe('UI State Updates', () => {
    test('Active nav item has .active class', async () => {
      await page.click('[data-view="scoreboard"]');
      await page.waitForSelector('#scoreboardView.active');

      const scoreboardNavActive = await page.$eval('[data-view="scoreboard"]', el =>
        el.classList.contains('active')
      );
      expect(scoreboardNavActive).toBe(true);

      const dashboardNavActive = await page.$eval('[data-view="dashboard"]', el =>
        el.classList.contains('active')
      );
      expect(dashboardNavActive).toBe(false);
    });

    test('Document title updates correctly', async () => {
      await page.click('[data-view="scoreboard"]');
      await page.waitForSelector('#scoreboardView.active');

      const title = await page.title();
      expect(title).toBe('Rogue Origin - Scoreboard');
    });

    test('AI chat widget hidden on iframe views', async () => {
      // Check visible on dashboard
      const visibleOnDashboard = await page.$eval('#aiChatWidget', el =>
        window.getComputedStyle(el).display !== 'none'
      );
      expect(visibleOnDashboard).toBe(true);

      // Check hidden on iframe view
      await page.click('[data-view="kanban"]');
      await page.waitForSelector('#kanbanView.active');

      const hiddenOnIframe = await page.$eval('#aiChatWidget', el =>
        window.getComputedStyle(el).display === 'none'
      );
      expect(hiddenOnIframe).toBe(true);
    });
  });

  describe('Navigation Flow', () => {
    test('Can navigate through all views in sequence', async () => {
      const views = ['kanban', 'scoreboard', 'barcode', 'sop', 'orders', 'dashboard'];

      for (const view of views) {
        await page.click(`[data-view="${view}"]`);
        await page.waitForSelector(`#${view}View.active`, { timeout: 5000 });

        const isActive = await page.$eval(`#${view}View`, el =>
          el.classList.contains('active')
        );
        expect(isActive).toBe(true);
      }
    });

    test('Rapid view switching works correctly', async () => {
      // Click views with small delays to simulate realistic switching
      await page.click('[data-view="kanban"]');
      await page.waitForTimeout(100);
      await page.click('[data-view="scoreboard"]');
      await page.waitForTimeout(100);
      await page.click('[data-view="barcode"]');

      // Wait for final view
      await page.waitForSelector('#barcodeView.active', { timeout: 8000 });

      const barcodeActive = await page.$eval('#barcodeView', el =>
        el.classList.contains('active')
      );
      expect(barcodeActive).toBe(true);

      // Only barcode should be active
      const kanbanActive = await page.$eval('#kanbanView', el =>
        el.classList.contains('active')
      );
      const scoreboardActive = await page.$eval('#scoreboardView', el =>
        el.classList.contains('active')
      );
      expect(kanbanActive).toBe(false);
      expect(scoreboardActive).toBe(false);
    });
  });
});
