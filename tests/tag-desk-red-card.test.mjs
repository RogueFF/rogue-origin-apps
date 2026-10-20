/**
 * Grove red ORDER card — printed once per lane from the Desk's Lane kit, on the
 * old kanban card template (kanban.html, 8.5×11 "full" size) in red.
 * Koa 2026-10-19: "make the Grove reorder cards closer to our old template".
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redCardPage, RED_CARD_CSS, imagesSettled } from '../src/js/tag-desk/red-card.js';

const lane = () => ({
  item: 'Custom 1 Oz Bags', crumbtrail: 'Grove Rack > A-1', colourHex: '#c2410c', colourName: 'NARANJA',
  picture: 'https://grovebags.com/cdn/1oz.png', supplier: 'Grove', orderQty: 'CUSTOM', delivery: '2 Months', price: '$0.95/Pc',
  qr: '<svg data-qr="1"></svg>', logo: 'https://rogueff.github.io/rogue-origin-apps/src/assets/ro-logo-square.png',
});

test('red card is the old kanban template in red: double gold border, name header, location, photo, three fields, QR, price, logo', () => {
  const h = redCardPage(lane());
  assert.match(h, /<section class="pg rc">/);
  assert.match(h, /class="kanban full-card red"/);
  assert.ok(h.includes('<div class="kanban-border"></div>'), 'outer gold border');
  assert.ok(h.includes('<div class="kanban-inner"></div>'), 'inner gold border');
  assert.ok(h.includes('<h3>Custom 1 Oz Bags</h3>'), 'item name is the header');
  assert.ok(h.includes('Grove Rack › A-1'), 'crumbtrail with › separators');
  assert.ok(h.includes('NARANJA') && h.includes('#c2410c'), 'lane colour swatch + name');
  assert.match(h, /class="full-img has"><img src="https:\/\/grovebags\.com\/cdn\/1oz\.png"/);
  for (const v of ['Grove', 'CUSTOM', '2 Months']) assert.ok(h.includes(`<span>${v}</span>`), `field ${v}`);
  assert.ok(h.includes('<svg data-qr="1"></svg>'), 'QR svg inlined');
  assert.ok(h.includes('SCAN TO ORDER') && h.includes('ESCANEA PARA PEDIR'), 'bilingual scan line');
  assert.ok(h.includes('class="kanban-price">$0.95/Pc<'), 'gold price pill');
  assert.ok(h.includes('class="kanban-logo" src="https://rogueff.github.io/rogue-origin-apps/src/assets/ro-logo-square.png"'), 'round logo');
  assert.ok(h.includes('Leave it here until the next delivery'), 'the red card stays in the lane');
});

test('no photo → placeholder text, no broken <img>', () => {
  const h = redCardPage({ ...lane(), picture: '' });
  assert.ok(h.includes('class="full-img">foto de la bolsa'), 'placeholder');
  assert.ok(!h.includes('src="https://grovebags'), 'no photo tag');
});

test('no price → no price pill', () => {
  assert.ok(!redCardPage({ ...lane(), price: '' }).includes('kanban-price'));
});

test('escapes HTML in card text', () => {
  const h = redCardPage({ ...lane(), item: '<b>1 oz</b>', crumbtrail: 'Rack > "A"' });
  assert.ok(h.includes('&lt;b&gt;1 oz&lt;/b&gt;') && !h.includes('<b>1 oz</b>'));
  assert.ok(h.includes('&quot;A&quot;'));
});

test('CSS carries the old palette and sizes the page for one 7.7×10.2 card on letter', () => {
  for (const s of ['#bd4a28', '#f0cb60', '#e4aa4f', '.pg.rc', '.kanban.full-card', '7.7in', '10.2in']) assert.ok(RED_CARD_CSS.includes(s), s);
});

const fakeImg = complete => { const h = {}; return { complete, addEventListener: (ev, fn) => { h[ev] = fn; }, fire: ev => h[ev] && h[ev]() }; };

test('imagesSettled resolves true once every pending image loads or errors', async () => {
  const a = fakeImg(true), b = fakeImg(false), c = fakeImg(false);
  let done = null; const p = imagesSettled([a, b, c], 1000).then(v => { done = v; return v; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(done, null, 'still waiting on b and c');
  b.fire('load'); c.fire('error');
  assert.equal(await p, true);
});

test('imagesSettled resolves false when an image never loads before the timeout', async () => {
  assert.equal(await imagesSettled([fakeImg(false)], 20), false);
});

test('imagesSettled resolves true at once when nothing is pending', async () => {
  assert.equal(await imagesSettled([fakeImg(true)], 1000), true);
  assert.equal(await imagesSettled([], 1000), true);
});

// ---- English version (Koa 2026-10-19: "make sure we have english versions also") ----
import { bi } from '../src/js/tag-desk/red-card.js';

test('bi() puts the Desk language first and the other language small underneath', () => {
  assert.equal(bi('Hola', 'Hello', 'es'), 'Hola<span class="en">Hello</span>');
  assert.equal(bi('Hola', 'Hello', 'en'), 'Hello<span class="en">Hola</span>');
  assert.equal(bi('Hola', 'Hello'), 'Hola<span class="en">Hello</span>', 'Spanish first by default');
});

test('lang "en" prints the red card English-first: scan line, field labels, keep line, photo placeholder', () => {
  const h = redCardPage({ ...lane(), picture: '', lang: 'en' });
  assert.ok(h.includes('class="full-scan">SCAN TO ORDER<span class="en">ESCANEA PARA PEDIR</span>'), 'scan line');
  assert.ok(h.includes('<small>Supplier · Proveedor</small>') && h.includes('<small>Order qty · Cantidad</small>') && h.includes('<small>Delivery · Entrega</small>'), 'labels');
  assert.ok(h.includes('class="full-keep">Leave it here until the next delivery<span class="en">Déjala aquí hasta la próxima entrega</span>'), 'keep line');
  assert.ok(h.includes('class="full-img">bag photo · foto de la bolsa'), 'placeholder');
});

test('without lang the red card stays Spanish-first', () => {
  const h = redCardPage({ ...lane(), picture: '' });
  assert.ok(h.includes('class="full-scan">ESCANEA PARA PEDIR<span class="en">SCAN TO ORDER</span>'));
  assert.ok(h.includes('<small>Proveedor · Supplier</small>'));
  assert.ok(h.includes('class="full-keep">Déjala aquí hasta la próxima entrega<span class="en">Leave it here until the next delivery</span>'));
});
