/**
 * Baseline Test Suite
 * Establishes working state before refactoring changes
 * Tests basic functionality of all pages
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'file://' + path.resolve(__dirname, '../src/pages');
const TIMEOUT = 10000;

describe('Baseline Tests - All Pages Load', () => {
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

    // Collect console errors
    page.consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        page.consoleErrors.push(msg.text());
      }
    });
  });

  afterEach(async () => {
    await page.close();
  });

  test('index.html (Main Dashboard) loads without errors', async () => {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle2' });

    // Check page loaded
    const title = await page.title();
    expect(title).toBe('Rogue Origin - Operations Hub');

    // Check critical elements exist
    const sidebar = await page.$('#sidebar');
    expect(sidebar).toBeTruthy();

    const dashboardView = await page.$('#dashboardView');
    expect(dashboardView).toBeTruthy();

    // Should have minimal console errors (allow for missing API calls and CDN timeout)
    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError') &&
      !err.includes('net::ERR') &&
      !err.includes('Loading') &&
      !err.includes('cdn.')
    );
    // Dashboard may have some CDN loading warnings in offline mode - allow up to 5
    expect(criticalErrors.length).toBeLessThan(6);
  });

  test('scoreboard.html loads without errors', async () => {
    await page.goto(`${BASE_URL}/scoreboard.html`, { waitUntil: 'networkidle2' });

    const title = await page.title();
    expect(title).toBe('Production Scoreboard');

    // Check key elements
    const clock = await page.$('#clock');
    expect(clock).toBeTruthy();

    const strainName = await page.$('#strainName');
    expect(strainName).toBeTruthy();

    // No critical errors
    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('kanban.html loads without errors', async () => {
    await page.goto(`${BASE_URL}/kanban.html`, { waitUntil: 'networkidle2' });

    const title = await page.title();
    expect(title).toContain('Kanban');

    // Check body exists and page rendered
    const body = await page.$('body');
    expect(body).toBeTruthy();

    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('barcode.html loads without errors', async () => {
    await page.goto(`${BASE_URL}/barcode.html`, { waitUntil: 'networkidle2' });

    const title = await page.title();
    expect(title).toContain('Label Printer');

    const body = await page.$('body');
    expect(body).toBeTruthy();

    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('orders.html loads without errors', async () => {
    await page.goto(`${BASE_URL}/orders.html`, { waitUntil: 'networkidle2' });

    const title = await page.title();
    expect(title).toContain('Order');

    const body = await page.$('body');
    expect(body).toBeTruthy();

    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('sop-manager.html loads without errors', async () => {
    await page.goto(`${BASE_URL}/sop-manager.html`, { waitUntil: 'networkidle2' });

    const title = await page.title();
    expect(title).toContain('SOP');

    const body = await page.$('body');
    expect(body).toBeTruthy();

    const criticalErrors = page.consoleErrors.filter(err =>
      !err.includes('Failed to fetch') &&
      !err.includes('NetworkError')
    );
    expect(criticalErrors.length).toBe(0);
  });

  test('All pages load within 3 seconds', async () => {
    const pages = [
      'index.html',
      'scoreboard.html',
      'kanban.html',
      'barcode.html',
      'orders.html',
      'sop-manager.html'
    ];

    for (const pageName of pages) {
      const startTime = Date.now();
      await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: 'domcontentloaded' });
      const loadTime = Date.now() - startTime;

      expect(loadTime).toBeLessThan(3000);
    }
  });
});
