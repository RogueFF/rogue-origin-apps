/**
 * Page Loading Test Suite
 * Tests each iframe page individually for functionality
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'file://' + path.resolve(__dirname, '../src/pages');
const TIMEOUT = 10000;

describe('Individual Page Loading Tests', () => {
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

    // Collect console messages
    page.consoleErrors = [];
    page.consoleWarnings = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        page.consoleErrors.push(msg.text());
      } else if (msg.type() === 'warning') {
        page.consoleWarnings.push(msg.text());
      }
    });
  });

  afterEach(async () => {
    await page.close();
  });

  describe('Kanban Page', () => {
    beforeEach(async () => {
      await page.goto(`${BASE_URL}/kanban.html`, { waitUntil: 'networkidle2' });
    });

    test('Page loads successfully', async () => {
      const title = await page.title();
      expect(title).toBeTruthy();
    });

    test('Required DOM elements exist', async () => {
      const body = await page.$('body');
      expect(body).toBeTruthy();
    });

    test('No JavaScript console errors', async () => {
      const criticalErrors = page.consoleErrors.filter(err =>
        !err.includes('Failed to fetch') &&
        !err.includes('NetworkError') &&
        !err.includes('404')
      );
      expect(criticalErrors.length).toBe(0);
    });

    test('Page responds within 3 seconds', async () => {
      const startTime = Date.now();
      await page.goto(`${BASE_URL}/kanban.html`, { waitUntil: 'domcontentloaded' });
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(3000);
    });
  });

  describe('Scoreboard Page', () => {
    beforeEach(async () => {
      await page.goto(`${BASE_URL}/scoreboard.html`, { waitUntil: 'networkidle2' });
    });

    test('Page loads successfully', async () => {
      const title = await page.title();
      expect(title).toBe('Production Scoreboard');
    });

    test('Required DOM elements exist', async () => {
      const clock = await page.$('#clock');
      expect(clock).toBeTruthy();

      const date = await page.$('#date');
      expect(date).toBeTruthy();

      const strainName = await page.$('#strainName');
      expect(strainName).toBeTruthy();
    });

    test('Language toggle buttons exist', async () => {
      const enBtn = await page.$('#btnEn');
      expect(enBtn).toBeTruthy();

      const esBtn = await page.$('#btnEs');
      expect(esBtn).toBeTruthy();
    });

    test('No critical JavaScript errors', async () => {
      const criticalErrors = page.consoleErrors.filter(err =>
        !err.includes('Failed to fetch') &&
        !err.includes('NetworkError') &&
        !err.includes('404')
      );
      expect(criticalErrors.length).toBe(0);
    });

    test('Page file size is optimized (< 150KB)', async () => {
      const fs = require('fs');
      const filePath = path.resolve(__dirname, '../src/pages/scoreboard.html');
      const stats = fs.statSync(filePath);
      const fileSizeInKB = stats.size / 1024;

      expect(fileSizeInKB).toBeLessThan(150);
    });
  });

  describe('Barcode Page', () => {
    beforeEach(async () => {
      await page.goto(`${BASE_URL}/barcode.html`, { waitUntil: 'networkidle2' });
    });

    test('Page loads successfully', async () => {
      const title = await page.title();
      expect(title).toBeTruthy();
    });

    test('Required DOM elements exist', async () => {
      const body = await page.$('body');
      expect(body).toBeTruthy();
    });

    test('No critical JavaScript errors', async () => {
      const criticalErrors = page.consoleErrors.filter(err =>
        !err.includes('Failed to fetch') &&
        !err.includes('NetworkError') &&
        !err.includes('404')
      );
      expect(criticalErrors.length).toBe(0);
    });
  });

  describe('Orders Page', () => {
    beforeEach(async () => {
      await page.goto(`${BASE_URL}/orders.html`, { waitUntil: 'networkidle2' });
    });

    test('Page loads successfully', async () => {
      const title = await page.title();
      expect(title).toBeTruthy();
    });

    test('Required DOM elements exist', async () => {
      const body = await page.$('body');
      expect(body).toBeTruthy();
    });

    test('No critical JavaScript errors', async () => {
      const criticalErrors = page.consoleErrors.filter(err =>
        !err.includes('Failed to fetch') &&
        !err.includes('NetworkError') &&
        !err.includes('404')
      );
      expect(criticalErrors.length).toBe(0);
    });
  });

  describe('SOP Manager Page', () => {
    beforeEach(async () => {
      await page.goto(`${BASE_URL}/sop-manager.html`, { waitUntil: 'networkidle2' });
    });

    test('Page loads successfully', async () => {
      const title = await page.title();
      expect(title).toBeTruthy();
    });

    test('Required DOM elements exist', async () => {
      const body = await page.$('body');
      expect(body).toBeTruthy();
    });

    test('No critical JavaScript errors', async () => {
      const criticalErrors = page.consoleErrors.filter(err =>
        !err.includes('Failed to fetch') &&
        !err.includes('NetworkError') &&
        !err.includes('404')
      );
      expect(criticalErrors.length).toBe(0);
    });
  });

  describe('Cross-Page Consistency', () => {
    test('All pages use Phosphor Icons consistently', async () => {
      const pages = ['kanban.html', 'barcode.html', 'orders.html', 'sop-manager.html'];

      for (const pageName of pages) {
        await page.goto(`${BASE_URL}/${pageName}`, { waitUntil: 'networkidle2' });

        // Check for Phosphor icon usage
        const hasPhosphorIcons = await page.evaluate(() => {
          const icons = document.querySelectorAll('[class*="ph-"]');
          return icons.length > 0;
        });

        // Most pages should have icons (order.html may not)
        if (pageName !== 'order.html') {
          expect(hasPhosphorIcons).toBe(true);
        }
      }
    });

    test('All pages load external CSS correctly', async () => {
      const pages = [
        { file: 'kanban.html', css: 'kanban.css' },
        { file: 'scoreboard.html', css: 'scoreboard.css' },
        { file: 'barcode.html', css: 'barcode.css' },
        { file: 'orders.html', css: 'orders.css' },
        { file: 'sop-manager.html', css: 'sop-manager.css' }
      ];

      for (const { file, css } of pages) {
        await page.goto(`${BASE_URL}/${file}`, { waitUntil: 'networkidle2' });

        const hasCSSLink = await page.evaluate((cssFile) => {
          const links = document.querySelectorAll('link[rel="stylesheet"]');
          return Array.from(links).some(link => link.href.includes(cssFile));
        }, css);

        expect(hasCSSLink).toBe(true);
      }
    });
  });
});
