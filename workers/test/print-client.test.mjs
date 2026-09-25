import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IFRAME_PRINT_UNRELIABLE_SRC, makeIframePrintUnreliable } from '../src/lib/print-client.js';

/**
 * The browser snippet is authored once, in the lib, and injected into the
 * takedown page verbatim. These tests evaluate that SAME source rather than a
 * copy, so there is no second definition to drift — the tag CSS in this repo
 * already carries "KEEP IN SYNC with the other renderer" warnings and that is a
 * standing bug risk worth not repeating.
 */
const unreliable = makeIframePrintUnreliable();

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI  = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

test('iPhone Safari needs a top-level print', () => {
  assert.equal(unreliable(IPHONE_SAFARI, 'iPhone', 5), true);
});

test('iPhone Chrome needs it too — Chrome on iOS is WebKit underneath', () => {
  assert.equal(
    unreliable(IPHONE_CHROME, 'iPhone', 5), true,
    'Apple requires WebKit on iOS, so CriOS has the identical iframe-print behaviour',
  );
});

test('iPadOS is detected even though it reports itself as a Mac', () => {
  assert.equal(
    unreliable(IPAD_SAFARI, 'MacIntel', 5), true,
    'iPadOS sends a desktop Mac UA; the touch points are what give it away',
  );
});

test('a real Mac is NOT treated as iOS', () => {
  assert.equal(
    unreliable(MAC_SAFARI, 'MacIntel', 0), false,
    'same UA as iPadOS — only maxTouchPoints separates them',
  );
});

test('Android Chrome needs a top-level print too', () => {
  assert.equal(
    unreliable(ANDROID_CHROME, 'Linux armv8l', 5), true,
    'Koa, 2026-09-22: pressing PRINT TAG on Android did nothing at all — the '
    + 'hidden 0x0 offscreen iframe never printed, while the serial was still spent',
  );
});

test('any mobile browser gets the top-level path, not just ones we have met', () => {
  const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
  const SAMSUNG_INTERNET = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
  assert.equal(unreliable(FIREFOX_ANDROID, 'Linux armv8l', 5), true);
  assert.equal(unreliable(SAMSUNG_INTERNET, 'Linux armv8l', 5), true);
});

test('a touchscreen Windows laptop is NOT mistaken for a phone', () => {
  const WIN_TOUCH = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  assert.equal(
    unreliable(WIN_TOUCH, 'Win32', 10), false,
    'touch points alone must not demote a desktop off the proven iframe path',
  );
});

test('desktop Chrome keeps the iframe — this is the proven barn PC path', () => {
  assert.equal(unreliable(WIN_CHROME, 'Win32', 0), false);
});

test('missing/odd navigator values fall back to the iframe, never to breaking the barn PC', () => {
  assert.equal(unreliable(undefined, undefined, undefined), false);
  assert.equal(unreliable('', '', 0), false);
});

test('the injected snippet is a self-contained expression with no build step', () => {
  assert.match(IFRAME_PRINT_UNRELIABLE_SRC, /^function\s*\(/);
  assert.ok(!IFRAME_PRINT_UNRELIABLE_SRC.includes('=>'), 'ES5 only — this ships to whatever the crew carries');
});

/* -------------------------------------------------------------------------
 * The home-screen app fit rule (Koa, 2026-09-25). Same discipline: the tests
 * evaluate the shipped source, not a copy of it.
 * ---------------------------------------------------------------------- */
import { APP_PRINT_FIT_SRC, APP_PRINT_DEFAULT_BOX, makeAppPrintFit, SAFARI_PRINT_SRC, makeSafariPrint } from '../src/lib/print-client.js';

const fit = makeAppPrintFit();

test('the app fit source is a plain ES5 function expression', () => {
  assert.match(APP_PRINT_FIT_SRC.trim(), /^function \(fit, setting, compact\) \{[\s\S]*\}$/);
  assert.doesNotMatch(APP_PRINT_FIT_SRC, /=>|\bconst\b|\blet\b/, 'must run on any handset without a build step');
});

test('Safari, Android and the barn PC keep the full 4x2 tag', () => {
  assert.equal(fit('', '', false), null);
  assert.equal(fit('', '', undefined), null, 'no verdict means the full tag');
  assert.equal(fit('', '3.2x1', false), null, 'the setting sets the box, it never switches the layout on');
});

test('the iOS home-screen app gets the compact tag with the default box', () => {
  const r = fit('', '', true);
  assert.deepEqual(r, { w: APP_PRINT_DEFAULT_BOX.w, h: APP_PRINT_DEFAULT_BOX.h, f: 0.563 });
});

test('the text factor keeps the stack inside the box height and never enlarges', () => {
  assert.equal(fit('3.2x1', '', true).f, 0.625);
  assert.equal(fit('4x2', '', true).f, 1, 'a full-size box means full-size text, not 125%');
  assert.equal(fit('1x2', '', true).f, 0.313, 'a narrow box is limited by its width');
});

test('?fit=full forces the full tag even inside the app', () => {
  assert.equal(fit('full', '', true), null);
  assert.equal(fit('FULL', '3x1', true), null);
});

test('?fit=app and ?fit=WxH force the compact tag, so it can be checked from Safari', () => {
  assert.deepEqual(fit('app', '', false), fit('', '', true));
  assert.deepEqual(fit('3.2x1.1', '', false), { w: 3.2, h: 1.1, f: 0.688 });
  assert.deepEqual(fit(' 3.2 X 1.1 ', '', false), { w: 3.2, h: 1.1, f: 0.688 }, 'spacing and case are forgiven');
});

test('the URL box wins over the setting, and the setting over the default', () => {
  assert.equal(fit('3.5x1.2', '3.2x1', true).w, 3.5);
  assert.equal(fit('', '3.2x1', true).w, 3.2);
  assert.equal(fit('app', '3.2x1', true).h, 1);
});

test('a box that could not hold a tag, or exceeds the label, falls back', () => {
  const dflt = fit('', '', true);
  assert.deepEqual(fit('', '9x9', true), dflt, 'bigger than the label');
  assert.deepEqual(fit('', '0.5x0.5', true), dflt, 'too small to read');
  assert.deepEqual(fit('', 'wide', true), dflt, 'not a size at all');
  assert.equal(fit('9x9', '', false), null, 'a bad URL box does not force the compact layout on');
});

/* -------------------------------------------------------------------------
 * Which phones get the compact tag (Koa, 2026-09-25, second report: "it works
 * in Chrome but not Safari"). The first cut keyed on the home-screen app; the
 * real split is Safari's print path versus Chrome's, and the home-screen app
 * is just Safari's path with no address bar.
 * ---------------------------------------------------------------------- */
const safariPrint = makeSafariPrint();
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneHomeScreen: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.86 Mobile/15E148 Safari/604.1',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  ipadChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.86 Version/18.6 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
};

test('the Safari-print predicate is a plain ES5 function expression', () => {
  assert.match(SAFARI_PRINT_SRC.trim(), /^function \(ua, platform, maxTouchPoints\) \{[\s\S]*\}$/);
  assert.doesNotMatch(SAFARI_PRINT_SRC, /=>|const|let/, 'must run on any handset without a build step');
});

test('Safari on an iPhone, and the home-screen app, print through Safari', () => {
  assert.equal(safariPrint(UA.iphoneSafari, 'iPhone', 5), true);
  assert.equal(safariPrint(UA.iphoneHomeScreen, 'iPhone', 5), true, 'the home-screen app is Safari with no address bar');
});

test('Chrome on iOS prints the full tag — the one phone path proven to work', () => {
  assert.equal(safariPrint(UA.iphoneChrome, 'iPhone', 5), false);
  assert.equal(safariPrint(UA.ipadChrome, 'MacIntel', 5), false);
});

test('iPadOS hides behind a Mac user-agent; touch points give it away', () => {
  assert.equal(safariPrint(UA.ipadSafari, 'MacIntel', 5), true);
  assert.equal(safariPrint(UA.macSafari, 'MacIntel', 0), false, 'a real Mac keeps the full tag');
});

test('Android and the barn PC keep the full tag', () => {
  assert.equal(safariPrint(UA.androidChrome, 'Linux armv81', 5), false);
  assert.equal(safariPrint(UA.winChrome, 'Win32', 10), false, 'a touchscreen laptop is not an iPad');
  assert.equal(safariPrint('', '', 0), false, 'nothing known means the proven path');
});
