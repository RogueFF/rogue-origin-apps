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
