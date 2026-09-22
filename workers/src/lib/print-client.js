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
