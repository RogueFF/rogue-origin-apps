/**
 * The shell's apps rail, pinned: one entry per page that exists, the current
 * page found from the URL, and the Kanban decision from 2026-09-15 (the crew
 * still uses the original page; Tag Desk stays beta).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NAV, currentApp, railHtml } from '../src/shell/nav.js';

const items = NAV.flatMap((group) => group.items);

test('every app has a unique id, a label, and a page that exists', () => {
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of items) {
    assert.ok(item.label, item.id);
    const page = fileURLToPath(new URL(`../src/pages/${item.href}`, import.meta.url));
    assert.ok(existsSync(page), `${item.href} is missing`);
  }
});

test('currentApp finds the page from the URL path', () => {
  assert.equal(currentApp('/rogue-origin-apps/src/pages/index.html').id, 'hub');
  assert.equal(currentApp('/rogue-origin-apps/src/pages/').id, 'hub');
  assert.equal(currentApp('/src/pages/hourly-entry.html').id, 'floor-manager');
  assert.equal(currentApp('/src/pages/kanban.html').id, 'supply-kanban');
  assert.equal(currentApp('/src/pages/floor.html'), null);
});

test('Supply Kanban opens the original page and Tag Desk is marked beta', () => {
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.equal(byId['supply-kanban'].href, 'kanban.html');
  assert.equal(byId['tag-desk'].href, 'tag-desk.html');
  assert.match(byId['tag-desk'].label, /beta/i);
});

test('railHtml marks exactly the current app', () => {
  const html = railHtml('hub', { brand: 'Ops Hub', logo: 'logo.png' });
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /<a href="index\.html" aria-current="page">/);
  assert.match(html, /<span>Ops Hub<\/span>/);
  assert.match(html, /id="railDot"/);
});

test('railHtml marks nothing for a page outside the rail', () => {
  assert.doesNotMatch(railHtml(undefined), /aria-current/);
});
