/**
 * QR codes for sack tags — generated here, never fetched.
 *
 * WHY: the tag's QR used to come from `api.qrserver.com` as a 203x203 `<img>`.
 * Measured 2026-09-21: that fetch took **0.62–0.84 s** against **0.16–0.24 s**
 * for the entire label page. Since the label waits for every image before
 * calling `window.print()` (printing early yields blank squares), that third
 * party WAS the delay the crew felt on every bag — and it put tag printing at
 * the mercy of an unrelated company in the middle of a harvest.
 *
 * Generating it here removes both the wait and the dependency.
 *
 * SHAPE ON PURPOSE: this returns a `data:` URI for an `<img>`, not an inline
 * `<svg>` element. Keeping it an `<img class="qr">` means the label CSS is
 * unchanged and — importantly — the print agent's "did the QR actually load?"
 * guard (`img.qr` → `naturalWidth > 0`) keeps working. An inline `<svg>` would
 * have silently broken that guard, and the guard is what stops a tag with a
 * blank QR being wire-tied to a sack.
 */

import qrcode from '../vendor/qrcode-generator.js';

/**
 * Error correction level. M (~15% recoverable) is the standard choice and what
 * the tags have always used. These live months in a dusty barn and get handled
 * wet, so the redundancy earns its space; H would cost modules and shrink each
 * one at a fixed 1-inch print size.
 */
export const QR_EC_LEVEL = 'M';

/** Type 0 = auto — the smallest version that fits the payload. */
const QR_TYPE_AUTO = 0;

/**
 * The raw module grid, as `boolean[][]` (`true` = dark).
 * Exposed so tests can assert the spec's structure rather than trust the
 * encoder blindly: a subtly wrong QR prints perfectly and fails weeks later,
 * on a sack, in a barn.
 */
export function qrModules(data) {
  const text = String(data || '');
  if (!text) throw new Error('Refusing to build a QR for an empty payload.');
  const qr = qrcode(QR_TYPE_AUTO, QR_EC_LEVEL);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const grid = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    grid.push(row);
  }
  return grid;
}

/**
 * The QR as a `data:image/svg+xml;base64,…` URI, ready for `<img class="qr">`.
 *
 * One `<rect>` per run of dark modules in a row rather than per module — it is
 * the same picture in a fraction of the bytes, which matters because this URI
 * is inlined into the HTML of every tag.
 */
export function qrDataUri(data) {
  const m = qrModules(data);
  const n = m.length;

  const rects = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!m[r][c]) { c++; continue; }
      const start = c;
      while (c < n && m[r][c]) c++;
      rects.push(`<rect x="${start}" y="${r}" width="${c - start}" height="1"/>`);
    }
  }

  // crispEdges: a thermal head prints black or nothing, so antialiased module
  // edges become a threshold decision by the printer rather than by us.
  // The white background is painted, not left transparent — a browser drops
  // background colours when printing unless "Background graphics" is ticked,
  // and a transparent QR would print as whatever sits under it.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/>` +
    `<g fill="#000">${rects.join('')}</g></svg>`;

  return 'data:image/svg+xml;base64,' + base64(svg);
}

/** Workers have btoa; Node's Buffer is the fallback for tests. */
function base64(s) {
  const bytes = new TextEncoder().encode(s);
  if (typeof btoa === 'function') {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}
