#!/usr/bin/env node
/**
 * Trailer decals as ZPL for a 4x6 in thermal label at 203 dpi (Zebra ZP 450).
 *
 *   node tools/trailer-decals/make-zpl.mjs            -> all six, T1..T6, to stdout
 *   node tools/trailer-decals/make-zpl.mjs 3 5        -> just T3 and T5
 *   node tools/trailer-decals/make-zpl.mjs --test 1   -> a PRUEBA/TEST decal for T1 that opens the
 *                                                       sealed preview, for showing the crew
 *   node tools/trailer-decals/make-zpl.mjs --grid 3 [--test]
 *                                                     -> T3's QR placement as JSON (for a decode check)
 *
 * Send the output raw to the printer with send-raw.ps1 (see README.md).
 *
 * The QR is drawn from the SAME encoder the app uses (workers/src/lib/qr.js) as
 * solid ZPL boxes, a whole number of dots per module, rather than with the
 * printer's own ^BQ barcode — ^BQ tops out at 10 dots a module, about 1.6 in for
 * this payload, and this code is read off the side of a trailer. The target is
 * the live decal route, /t/<n>, which is what the app's own print sheet encodes.
 */
import { qrModules } from '../../workers/src/lib/qr.js';

const PUBLIC_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
// The sealed preview alias (wrangler versions upload --preview-alias trailer-test
// --var HARVEST_FORCE_TEST:true): always test mode, never the floor's records.
const PREVIEW_BASE = 'https://trailer-test-rogue-origin-api.roguefamilyfarms.workers.dev';
const TRAILERS = [1, 2, 3, 4, 5, 6];

const W = 812;          // 4 in at 203 dpi
const H = 1218;         // 6 in
const QR_TOP = 440;
const QR_MAX = 640;     // dots available for the symbol itself
const QUIET = 4;        // modules of white the spec requires around it

function qrPlacement(n, base = PUBLIC_BASE) {
  const target = `${base}/t/${n}`;
  const grid = qrModules(target);
  const count = grid.length;
  const dot = Math.floor(QR_MAX / count);
  const size = dot * count;
  const x0 = Math.floor((W - size) / 2);
  if (x0 < QUIET * dot) throw new Error(`T${n}: no room for the quiet zone (${x0} < ${QUIET * dot} dots)`);
  return { target, grid, count, dot, size, x0, y0: QR_TOP };
}

/** Dark modules as boxes, one per horizontal run, so the label stays small. */
function qrBoxes({ grid, dot, x0, y0 }) {
  const out = [];
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      let end = c;
      while (end + 1 < row.length && row[end + 1]) end++;
      const w = (end - c + 1) * dot;
      out.push(`^FO${x0 + c * dot},${y0 + r * dot}^GB${w},${dot},${dot},B,0^FS`);
      c = end;
    }
  });
  return out.join('\n');
}

/** Centred text line: ^FB across the full width, justification C. */
const line = (y, h, text) =>
  `^FO0,${y}^FB${W},1,0,C,0^A0N,${h},${Math.round(h * 0.9)}^FD${text}^FS`;

function decalZpl(n, test = false) {
  const base = test ? PREVIEW_BASE : PUBLIC_BASE;
  const p = qrPlacement(n, base);
  const below = p.y0 + p.size;
  // A test decal must never pass for a real one on a trailer: the big number is
  // replaced by PRUEBA reversed out of a black band, and the line under it says
  // what it is for.
  const head = test
    ? [`^FO0,40^GB${W},250,250,B,0^FS`,
       `^FO0,70^FB${W},1,0,C,0^A0N,200,180^FR^FDPRUEBA^FS`,
       line(318, 46, `TEST · T${n} · no cuenta / does not count`)]
    : [line(24, 330, `T${n}`), line(360, 62, `TRAILA / TRAILER ${n}`)];
  return [
    '^XA',
    '^CI28',                        // UTF-8, for the accents
    `^PW${W}`, `^LL${H}`, '^LH0,0', '^PON',
    ...head,
    qrBoxes(p),
    line(below + 26, 40, test ? 'Demo: escanea para ver cómo funciona' : 'Escanea al dejar cada carga'),
    line(below + 74, 32, test ? 'Demo: scan to see how it works' : 'Scan at every drop-off'),
    line(below + 118, 22, `${base.replace('https://', '')}/t/${n}`),
    '^XZ',
  ].join('\n');
}

const args = process.argv.slice(2);
const test = args.includes('--test');
const nums = args.filter(a => !a.startsWith('--')).map(Number);
if (args[0] === '--grid') {
  const { target, grid, dot, x0, y0 } = qrPlacement(nums[0], test ? PREVIEW_BASE : PUBLIC_BASE);
  process.stdout.write(JSON.stringify({ target, grid, dot, x0, y0, W, H }));
} else {
  const picks = nums.length ? nums : (test ? [1] : TRAILERS);
  for (const n of picks) if (!TRAILERS.includes(n)) throw new Error(`No trailer T${n}; there are T1-T6.`);
  process.stdout.write(picks.map(n => decalZpl(n, test)).join('\n') + '\n');
}
