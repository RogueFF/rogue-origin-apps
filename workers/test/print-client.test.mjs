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

test('Android Chrome keeps the iframe — it scopes print correctly', () => {
  assert.equal(unreliable(ANDROID_CHROME, 'Linux armv8l', 5), false);
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
