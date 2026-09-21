/**
 * Browser-side printing decisions for the takedown screen.
 *
 * WHY THIS EXISTS
 * The takedown screen prints a tag by loading `sack_label` into a hidden iframe
 * and calling `window.print()` on it. **On WebKit that call is scoped to the
 * TOP-LEVEL document, not the frame** — so an iPhone prints the takedown screen
 * instead of the tag. Reported by Koa 2026-09-21, in Chrome on iOS; Chrome there
 * is WebKit underneath (Apple requires it), so it is not a Safari-only bug.
 *
 * Desktop Chrome scopes it to the frame, which is why the barn PC has always
 * worked and why this went unnoticed until the crew tried a phone.
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
 * Mac reports 0, an iPad reports 5. Anything unrecognised falls through to
 * `false`, i.e. keeps the iframe, because that is the path already proven on the
 * barn PC and a wrong guess there would break the one thing that works.
 */
export const IFRAME_PRINT_UNRELIABLE_SRC = `function (ua, platform, maxTouchPoints) {
  ua = String(ua || '');
  platform = String(platform || '');
  var touch = Number(maxTouchPoints) || 0;
  if (/iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(platform)) return true;
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
