// @ts-check
//
// Every page opens, and nothing it needs is missing.
//
// This is the check the build cannot make. tools/check-urls.mjs proves each URL
// a built page names exists on disk; only a browser proves the page then runs:
// that a module graph resolves, that the TV boards' classic scripts still find
// each other through window, and that nothing throws on the way up.
//
// Two failure kinds, both attributable to this repository:
//   · a request to the site's own origin that comes back 4xx or 5xx
//   · an uncaught error on the page
// Requests to the API and to the CDNs are ignored: a barn wifi drop or an
// expired session is not a broken page, and each screen shows its own
// connection state.
//
// Point it at a served copy of the site and run it:
//   SMOKE_BASE=http://localhost:5503/rogue-origin-apps npx playwright test tests/pages-smoke.spec.js --project=chromium
//
// Without SMOKE_BASE the suite skips, so it never fails a run that has no
// server behind it.
const { test, expect } = require('@playwright/test');

const BASE = process.env.SMOKE_BASE;

/** Every page the site publishes, at the path it publishes it. */
const PAGES = [
  'index.html',
  'offline.html',
  'sms-policy.html',
  'src/pages/index.html',
  'src/pages/floor.html',
  'src/pages/hourly-entry.html',
  'src/pages/scoreboard-v2.html',
  'src/pages/scoreboard-v3.html',
  'src/pages/scale-display.html',
  'src/pages/supersack-entry.html',
  'src/pages/supersack-analytics.html',
  'src/pages/wholesale.html',
  'src/pages/consignment.html',
  'src/pages/kanban.html',
  'src/pages/tag-desk.html',
  'src/pages/sop-manager.html',
  'src/pages/complaints.html',
  'src/pages/ui-examples.html',
];

test.describe('every page opens', () => {
  test.skip(!BASE, 'set SMOKE_BASE to a served copy of the site');

  for (const page of PAGES) {
    test(page, async ({ page: browserPage }) => {
      const origin = new URL(BASE).origin;
      const missing = [];
      const thrown = [];

      browserPage.on('response', (response) => {
        if (response.status() < 400) return;
        if (!response.url().startsWith(origin)) return;
        missing.push(`${response.status()} ${response.url()}`);
      });
      browserPage.on('pageerror', (error) => thrown.push(error.message));

      await browserPage.goto(`${BASE}/${page}`, { waitUntil: 'load' });
      // Long enough for a module graph to resolve and the page's own boot to
      // run; these pages fetch on load, so an early assertion would miss it.
      await browserPage.waitForTimeout(2500);

      expect(missing, `${page} requested files the site does not serve`).toEqual([]);
      expect(thrown, `${page} threw on load`).toEqual([]);
    });
  }
});
