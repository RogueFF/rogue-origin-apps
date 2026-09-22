import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrDataUri, qrModules, QR_EC_LEVEL } from '../src/lib/qr.js';

const SACK_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/s/26-SLIFT-142';

/** Decode the data URI back to the SVG source it carries. */
function svgOf(uri) {
  assert.match(uri, /^data:image\/svg\+xml;base64,/, 'must be an inline image, never a network fetch');
  return Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
}

// ---------------------------------------------------------------------------
// Structure — it has to stay an <img>-able inline resource
// ---------------------------------------------------------------------------

test('qrDataUri returns a base64 svg data URI, so the tag fetches nothing', () => {
  const uri = qrDataUri(SACK_URL);
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
  assert.ok(!uri.includes('qrserver'), 'the whole point is no third party');
});

test('the svg viewBox matches the module count exactly', () => {
  const svg = svgOf(qrDataUri(SACK_URL));
  const n = qrModules(SACK_URL).length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${n} ${n}"`));
});

test('the svg renders with crisp edges — a thermal head has no greys', () => {
  assert.match(svgOf(qrDataUri(SACK_URL)), /shape-rendering="crispEdges"/);
});

test('a white background is painted, never left transparent', () => {
  const svg = svgOf(qrDataUri(SACK_URL));
  assert.match(svg, /fill="#fff"/, 'transparent would print as whatever is under it');
});

// ---------------------------------------------------------------------------
// Correctness — a subtly wrong QR prints fine and fails weeks later on a sack,
// so check the structure the spec guarantees rather than trusting it blindly
// ---------------------------------------------------------------------------

test('finder patterns are present in all three corners', () => {
  const m = qrModules(SACK_URL);
  const n = m.length;
  // The spec's 7x7 finder: solid ring, one-module gap, 3x3 centre.
  const finderAt = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const expected = edge || centre;
        if (m[r0 + r][c0 + c] !== expected) return false;
      }
    }
    return true;
  };
  assert.ok(finderAt(0, 0), 'top-left finder');
  assert.ok(finderAt(0, n - 7), 'top-right finder');
  assert.ok(finderAt(n - 7, 0), 'bottom-left finder');
});

test('the quiet-zone corner opposite the finders is NOT a finder', () => {
  const m = qrModules(SACK_URL);
  const n = m.length;
  // Bottom-right has no finder — catches an encoder that mirrors the grid.
  const solidRing = [0, 6].every(r => m[n - 7 + r].slice(n - 7, n).every(Boolean));
  assert.equal(solidRing, false);
});

test('the module grid is square and non-trivial', () => {
  const m = qrModules(SACK_URL);
  assert.ok(m.length >= 21, 'smallest QR is 21x21');
  m.forEach(row => assert.equal(row.length, m.length));
  const dark = m.flat().filter(Boolean).length;
  const total = m.length * m.length;
  assert.ok(dark > total * 0.2 && dark < total * 0.8, `implausible dark ratio: ${dark}/${total}`);
});

test('different sack ids produce different codes', () => {
  assert.notEqual(
    qrDataUri('https://x.example/s/26-SLIFT-1'),
    qrDataUri('https://x.example/s/26-SLIFT-2'),
  );
});

test('the same input is deterministic — two prints of one tag must match', () => {
  assert.equal(qrDataUri(SACK_URL), qrDataUri(SACK_URL));
});

test('error correction is M — the tags live in a dusty barn for months', () => {
  assert.equal(QR_EC_LEVEL, 'M');
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('payload characters cannot break out into the svg markup', () => {
  const svg = svgOf(qrDataUri('https://x.example/s/"><script>alert(1)</script>'));
  assert.ok(!svg.includes('<script'), 'payload is encoded into modules, never echoed');
});

test('an empty payload is refused rather than printing a meaningless tag', () => {
  assert.throws(() => qrDataUri(''), /empty/i);
});
