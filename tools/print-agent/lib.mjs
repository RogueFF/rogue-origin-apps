/**
 * Print agent — the decisions, separated from the I/O so they can be tested
 * without a printer attached.
 *
 * See agent.mjs for the loop and README.md for setup.
 */

/** CSS reference resolution. A CSS inch is 96 px by definition. */
const CSS_DPI = 96;

/** The tag, in inches. Matches `@page { size: 4in 2in }` in sack_label. */
export const TAG_WIDTH_IN = 4;
export const TAG_HEIGHT_IN = 2;

/**
 * URL of the real label page for one sack.
 *
 * The agent renders the SAME page the browser would have printed — not a
 * re-implementation. The tag design has been tuned over several rounds and its
 * CSS already carries "KEEP IN SYNC with the other renderer" warnings; adding a
 * third renderer here would be a standing bug.
 */
export function labelUrl(apiBase, sackId) {
  const url = new URL('/api/harvest', apiBase);
  url.searchParams.set('action', 'sack_label');
  url.searchParams.set('ids', sackId);
  return url.toString();
}

/**
 * Viewport and scale factor to render the tag at exactly the printer's dots.
 *
 * At 203 dpi a 4x2 tag is 812 x 406 dots. Rendering at CSS pixels and letting
 * the driver scale up is what softens a QR into something a phone camera has to
 * work at — so the browser is told to render at print resolution directly, and
 * the print step then does a 1:1 blit.
 */
export function tagRender(dpi) {
  return {
    dpi,
    widthPx: Math.round(TAG_WIDTH_IN * dpi),
    heightPx: Math.round(TAG_HEIGHT_IN * dpi),
    // Playwright takes a CSS-pixel viewport plus a scale factor.
    viewportWidth: Math.round(TAG_WIDTH_IN * CSS_DPI),
    viewportHeight: Math.round(TAG_HEIGHT_IN * CSS_DPI),
    deviceScaleFactor: dpi / CSS_DPI,
  };
}

/**
 * How long to wait after `failures` consecutive errors.
 *
 * The barn's internet drops. Without backoff the agent would hammer the API
 * through every outage; with an uncapped one it would still be asleep when the
 * network returned and the crew was waiting at the printer. So: grows fast,
 * caps at 30 s.
 */
export function nextBackoff(failures) {
  const ms = 500 * Math.pow(2, Math.max(0, failures - 1));
  return Math.min(ms, 30000);
}

/**
 * Is this rendered image plausibly a tag?
 *
 * The screenshot is blitted onto the exact 4x2 page by print-image.ps1, so a
 * dot or two of overshoot is absorbed with no visible effect. Measured on the
 * real page 2026-09-18: the target is 812 x 406 at 203 dpi and the label
 * actually renders 812 x 408 — the element lays out about one CSS pixel taller
 * than 2in. Harmless, and normalized by the blit.
 *
 * A LARGE deviation is different: it means the page did not lay out as a tag at
 * all (a stylesheet that did not load, a changed layout, an error page). That
 * must not be printed, because the output gets wire-tied to a sack and is only
 * discovered weeks later at scan time.
 */
export function renderSaneEnough(actual, expected, tolerance = 0.05) {
  if (!actual || !expected) return false;
  if (!(actual.widthPx > 0) || !(actual.heightPx > 0)) return false;
  const off = (a, b) => Math.abs(a - b) / b;
  return off(actual.widthPx, expected.widthPx) <= tolerance
      && off(actual.heightPx, expected.heightPx) <= tolerance;
}
