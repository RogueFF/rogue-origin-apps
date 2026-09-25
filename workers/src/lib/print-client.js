/**
 * Browser-side printing decisions for the takedown screen.
 *
 * WHY THIS EXISTS
 * The takedown screen prints a tag by loading `sack_label` into a hidden iframe
 * (0x0, positioned offscreen) and calling `window.print()` on it. **Mobile
 * browsers do not honour that**, in two different ways:
 *
 * - **iOS** (Koa, 2026-09-21): WebKit scopes `window.print()` to the TOP-LEVEL
 *   document rather than the calling frame, so the phone printed the takedown
 *   screen instead of the tag. Chrome on iOS is WebKit underneath — Apple
 *   requires it — so this was never Safari-specific.
 * - **Android** (Koa, 2026-09-22): nothing happened at all. No dialog, no job.
 *   A 0x0 offscreen iframe simply never prints. **The serial was still spent**,
 *   which is the worst shape a failure can take here: a number consumed, a
 *   Shopify count moved, and no tag anywhere.
 *
 * Desktop scopes it to the frame correctly, which is why the barn PC has always
 * worked and why none of this surfaced until the crew used phones.
 *
 * So the rule is **mobile, not iOS**. Enumerating operating systems is how the
 * Android case got missed; any handset gets the top-level path, and only a
 * desktop keeps the iframe.
 *
 * The snippet below is authored ONCE here and injected into the page verbatim,
 * so there is no second copy to drift. The tag CSS in this repo already carries
 * "KEEP IN SYNC with the other renderer" warnings; that is a standing bug risk
 * and not one worth repeating for a UA test.
 */

/**
 * Source of the browser-side predicate, injected into the takedown page.
 *
 * ES5 on purpose: this runs on whatever handset the crew is carrying, and there
 * is no build step between here and the page.
 *
 * iPadOS is the awkward case — it sends a desktop Mac user-agent, so it is
 * indistinguishable from a real Mac by UA alone. Touch points separate them: a
 * Mac reports 0, an iPad reports 5.
 *
 * Touch points are used ONLY to catch that one case, never on their own: a
 * touchscreen Windows laptop reports plenty of them and must stay on the iframe.
 * Anything unrecognised falls through to `false`, because the iframe is the path
 * already proven on the barn PC and a wrong guess there breaks the one thing
 * that works.
 */
export const IFRAME_PRINT_UNRELIABLE_SRC = `function (ua, platform, maxTouchPoints) {
  ua = String(ua || '');
  platform = String(platform || '');
  var touch = Number(maxTouchPoints) || 0;
  // Any phone or tablet: 'Mobi' covers Chrome, Firefox and Samsung Internet on
  // Android, and anything else that follows the convention.
  if (/Android|Mobi|iPhone|iPad|iPod/i.test(ua)) return true;
  if (/iPhone|iPad|iPod/i.test(platform)) return true;
  // iPadOS masquerading as macOS: desktop UA, but a Mac has no touch screen.
  if (/Mac/i.test(platform) && touch > 1) return true;
  return false;
}`;

/**
 * Build the predicate from that exact source, so tests exercise what ships
 * rather than a re-implementation of it.
 *
 * @returns {(ua?: string, platform?: string, maxTouchPoints?: number) => boolean}
 */
export function makeIframePrintUnreliable() {
  // eslint-disable-next-line no-new-func
  return new Function('return (' + IFRAME_PRINT_UNRELIABLE_SRC + ');')();
}

/* ---------------------------------------------------------------------------
 * Printing from Safari on iOS
 *
 * Koa, 2026-09-25: a tag printed from an iPhone came out shrunk to ~80% and
 * split across two labels — the date line and the bottom of the QR on the
 * second. Another iPhone printed the same page perfectly. The first cut of
 * this fix read the split as home-screen app versus Safari; Koa's second
 * report set it straight: "it works in Chrome but not Safari". The home-screen
 * app is Safari's print path with no address bar, which is why it failed too.
 *
 * Chrome on iOS — the browser every phone test on 2026-09-21 ran in — drives
 * the printer itself and lands the 4x2 page 1:1 on the 4x2 label. Safari hands
 * the page to UIKit's print formatter, which ignores `@page`, insets the
 * content from every edge of the label, shrinks anything wider than what is
 * left to fit, and SPLITS anything taller onto the next label. A 4in tag
 * became ~3.2in wide and ~1.6in tall inside a box shorter than that. Nothing
 * on the page can widen that box; the only move is to lay the tag out to fit
 * inside it.
 *
 * So when the label page finds itself on Safari's print path it re-lays the
 * SAME markup into a smaller box: QR to the height of the box, the text column
 * scaled to match. The box is a guess at the printable area, measured off
 * Koa's photo, so it is tunable without a deploy: `?fit=3.2x1` on the URL for
 * a test print, or the `app_print_box` row in harvest_settings for every phone.
 * ------------------------------------------------------------------------- */

/**
 * Source of the "does this browser print through Safari" predicate, injected
 * into the label page. ES5, like the one above.
 *
 * True for Safari on iPhone and iPad and for the home-screen app (same engine,
 * same print path, same failure). False for Chrome on iOS — `CriOS` in the UA
 * — because that is the one phone path proven to print the full tag, and for
 * everything that is not iOS at all. Firefox and Edge on iOS are unproven and
 * get the compact tag: a small tag that prints whole beats a full one that
 * splits, and nobody on the crew carries them.
 *
 * iPadOS sends a Mac user-agent; touch points separate it from a real Mac,
 * exactly as in IFRAME_PRINT_UNRELIABLE_SRC. Anything unrecognised falls
 * through to `false`: the full tag is the path proven everywhere else.
 */
export const SAFARI_PRINT_SRC = `function (ua, platform, maxTouchPoints) {
  ua = String(ua || '');
  platform = String(platform || '');
  var touch = Number(maxTouchPoints) || 0;
  var ios = /iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(platform)
    || (/Mac/i.test(platform) && touch > 1);
  if (!ios) return false;
  // Chrome on iOS. Its print path is its own and lands the tag 1:1.
  if (/CriOS/i.test(ua)) return false;
  return true;
}`;

/**
 * Build the predicate from that exact source, so tests exercise what ships.
 *
 * @returns {(ua?: string, platform?: string, maxTouchPoints?: number) => boolean}
 */
export function makeSafariPrint() {
  // eslint-disable-next-line no-new-func
  return new Function('return (' + SAFARI_PRINT_SRC + ');')();
}

/**
 * Printable box Safari's print path is assumed to leave on a 4x2 label, in
 * inches. Measured off the 2026-09-25 photo: the tag was scaled to ~0.8 (so
 * ~3.2in of usable width) and cut ~1in below where it started. Height is the
 * one that matters — width overflow only shrinks, height overflow SPLITS — so
 * it is set a little under the measurement.
 */
export const APP_PRINT_DEFAULT_BOX = { w: 3, h: 0.9 };

/**
 * Source of the browser-side decision, injected into the label page.
 *
 * Returns null for the normal 4x2 tag, or `{ w, h, f }`: the box in inches and
 * the factor to apply to the text column's font sizes. `f` keeps the text stack
 * (name, code, number+cut, date) inside the box's height: the full-size stack
 * is ~1.3in tall in a 2in label, hence 1.25 × the height ratio, never above 1.
 *
 *   fit      — the URL's ?fit=: 'full' forces the normal tag, 'app' forces the
 *              compact one, 'WxH' forces it with that box. Anything else defers
 *              to `compact`.
 *   setting  — the app_print_box setting ('WxH' or empty). Only ever sets the
 *              box; it cannot switch the compact layout on, so a phone in
 *              Chrome is never affected by it.
 *   compact  — the SAFARI_PRINT_SRC verdict: true on Safari's print path.
 *
 * ES5 on purpose, like the predicate above: no build step, any handset.
 */
export const APP_PRINT_FIT_SRC = `function (fit, setting, compact) {
  function parseBox(s) {
    var m = /^\\s*(\\d+(?:\\.\\d+)?)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*$/i.exec(String(s || ''));
    if (!m) return null;
    var w = parseFloat(m[1]), h = parseFloat(m[2]);
    // A box wider or taller than the label is a typo, and one under an inch
    // wide or a third of an inch tall could not hold a readable tag.
    if (!(w >= 1 && w <= 4 && h >= 0.3 && h <= 2)) return null;
    return { w: w, h: h };
  }
  fit = String(fit || '').toLowerCase();
  if (fit === 'full') return null;
  var urlBox = parseBox(fit);
  if (fit !== 'app' && !urlBox && compact !== true) return null;
  var box = urlBox || parseBox(setting) || { w: ${APP_PRINT_DEFAULT_BOX.w}, h: ${APP_PRINT_DEFAULT_BOX.h} };
  var f = Math.min(1, 1.25 * Math.min(box.h / 2, box.w / 4));
  return { w: box.w, h: box.h, f: Math.round(f * 1000) / 1000 };
}`;

/**
 * Build the fit function from that exact source, so tests exercise what ships.
 *
 * @returns {(fit?: string, setting?: string, compact?: boolean) => ({w:number,h:number,f:number}|null)}
 */
export function makeAppPrintFit() {
  // eslint-disable-next-line no-new-func
  return new Function('return (' + APP_PRINT_FIT_SRC + ');')();
}

/**
 * How each line of the text column is scaled inside the compact box.
 *
 * Koa, 2026-09-25, after the compact tag printed whole: "it looks better, but
 * the printout is too small." One factor for every line (the 1.25 x height
 * ratio above) put the bag number at 17pt. That number is the thing read
 * across the barn; the cultivar name, the cut box and the date line are read
 * at arm's length. So the number keeps its size and the lines around it give.
 *
 * Budget, at the default 0.9in box (0.82in inside the padding): name 0.65,
 * number 0.95, cut box 0.65, date line 0.7. The cultivar code loses its own
 * line and rides at the front of the date line (the page script moves it),
 * which is the 0.2in that pays for the number. These are ceilings: the page
 * then shrinks the number, and after it the name, until the stack actually
 * fits the box's height, because the number's inline size is already fit to
 * the column width and a short "#142" starts near 44pt.
 *
 * Everything scales with the box height so a taller box, set by ?fit= or the
 * app_print_box setting, grows each line back toward the full tag. Capped at
 * 1: a compact tag is never larger than the real one. Floored at 0.3: below
 * that nothing is readable and the box is a typo.
 *
 * ES5, injected verbatim, like the rules above.
 */
export const COMPACT_TEXT_SRC = `function (h) {
  var k = (Number(h) - 0.08) / 0.82;
  function f(base) { return Math.min(1, Math.max(0.3, Math.round(base * k * 1000) / 1000)); }
  return { name: f(0.65), num: f(0.95), cut: f(0.65), meta: f(0.7) };
}`;

/**
 * Build the rule from that exact source, so tests exercise what ships.
 *
 * @returns {(h: number) => ({name:number,num:number,cut:number,meta:number})}
 */
export function makeCompactText() {
  // eslint-disable-next-line no-new-func
  return new Function('return (' + COMPACT_TEXT_SRC + ');')();
}
