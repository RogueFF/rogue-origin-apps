import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelUrl, tagRender, nextBackoff } from '../../tools/print-agent/lib.mjs';

// ---------------------------------------------------------------------------
// labelUrl — the agent renders the SAME page the browser would have printed,
// so there is never a second tag design to keep in sync
// ---------------------------------------------------------------------------

test('labelUrl points at the real sack_label page for one sack', () => {
  const u = new URL(labelUrl('https://api.example.com', '26-SLIFT-142'));
  assert.equal(u.pathname, '/api/harvest');
  assert.equal(u.searchParams.get('action'), 'sack_label');
  assert.equal(u.searchParams.get('ids'), '26-SLIFT-142');
});

test('labelUrl escapes a sack id rather than splicing it into the query', () => {
  const u = new URL(labelUrl('https://api.example.com', '26-X&evil=1'));
  assert.equal(u.searchParams.get('ids'), '26-X&evil=1');
  assert.equal(u.searchParams.get('evil'), null);
});

test('labelUrl tolerates a base with a trailing slash', () => {
  assert.equal(
    new URL(labelUrl('https://api.example.com/', '26-A')).pathname,
    '/api/harvest',
  );
});

// ---------------------------------------------------------------------------
// tagRender — dots, not CSS pixels. A 4x2 tag at 203 dpi is 812 x 406 dots,
// and the printer must receive exactly that or the QR softens.
// ---------------------------------------------------------------------------

test('tagRender gives exactly 812 x 406 dots at 203 dpi', () => {
  const r = tagRender(203);
  assert.equal(r.widthPx, 812);
  assert.equal(r.heightPx, 406);
});

test('tagRender scales the browser viewport by dpi over CSS 96', () => {
  assert.equal(tagRender(203).deviceScaleFactor, 203 / 96);
});

test('tagRender handles a 300 dpi printer without changing the tag design', () => {
  const r = tagRender(300);
  assert.equal(r.widthPx, 1200);
  assert.equal(r.heightPx, 600);
});

test('tagRender returns whole dots, never fractional pixels', () => {
  const r = tagRender(203);
  assert.equal(Number.isInteger(r.widthPx), true);
  assert.equal(Number.isInteger(r.heightPx), true);
});

// ---------------------------------------------------------------------------
// nextBackoff — a barn network blip must not become a hot loop against the API
// ---------------------------------------------------------------------------

test('nextBackoff grows on repeated failures', () => {
  assert.ok(nextBackoff(2) > nextBackoff(1));
});

test('nextBackoff is capped so the agent always recovers promptly', () => {
  assert.ok(nextBackoff(99) <= 30000);
});

test('nextBackoff on the first failure is short enough to be invisible', () => {
  assert.ok(nextBackoff(1) <= 2000);
});
