/**
 * Tag & Desk card prints on the old kanban template (kanban.html cardHtml):
 * green/red body, double gold border, name header, location, photo, three
 * fields, gold price pill, round logo — with the QR and scan trigger on the face.
 * Koa 2026-10-28: every card print should look like the old kanban card.
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classicCard, locLine } from '../src/js/tag-desk/classic-card.js';

const card = (o = {}) => ({
  item: 'Tall Trash Bags', loc: 'Cleaning Rack › F-1', picture: 'https://m.media-amazon.com/x.jpg',
  fields: [['Supplier · Proveedor', 'Amazon'], ['Order qty · Cantidad', 'x2'], ['Delivery · Entrega', '1 Day']],
  price: '$0.85/Pc', trigger: 'ONLY <span class="big">2</span> PACKS LEFT?', qr: '<svg data-qr="1"></svg>', logo: '../assets/ro-logo-horizontal.png', foot: '#1 · v2 · Oct 28', ...o,
});

test('6×4 card is the old template in red: double gold border, header, location, photo, fields, QR, price, logo', () => {
  const h = classicCard(card());
  assert.match(h, /^<div class="kc c6 red">/); // one red card per item since 2026-10-29: red is the default
  assert.ok(h.includes('<div class="kc-border"></div><div class="kc-inner"></div>'), 'double gold border');
  assert.ok(h.includes('<h3>Tall Trash Bags</h3>'), 'item name is the header');
  assert.ok(h.includes('<div class="kc-loc">Cleaning Rack › F-1</div>'));
  assert.match(h, /class="kc-img"><img src="https:\/\/m\.media-amazon\.com\/x\.jpg" alt="" referrerpolicy="no-referrer"/);
  for (const v of ['Amazon', 'x2', '1 Day']) assert.ok(h.includes(`<span>${v}</span>`), `field ${v}`);
  assert.ok(h.includes('<div class="kc-qr"><svg data-qr="1"></svg></div>'), 'QR on the face');
  assert.ok(h.includes('<span class="big">2</span>'), 'trigger HTML passes through');
  assert.ok(h.includes('<div class="kc-price">$0.85/Pc</div>'));
  assert.ok(h.includes('<img class="kc-logo" src="../assets/ro-logo-horizontal.png"'));
  assert.ok(h.includes('#1 · v2 · Oct 28'));
});

test('the 8.5×11 sheet is red too and wraps the same parts', () => {
  const s = classicCard(card({ size: 'full' }));
  assert.match(s, /^<div class="kc-sheet"><div class="kc full red">/);
  assert.ok(s.includes('<div class="kc-bottom"><div class="kc-qr">'), 'QR row at the bottom like the old full card');
});

test('values are escaped, gaps show a dash, no photo shows the old camera placeholder, no price drops the pill', () => {
  const h = classicCard(card({ item: 'Bags <b>&</b>', picture: '', price: '', fields: [['Supplier · Proveedor', '']] }));
  assert.ok(h.includes('<h3>Bags &lt;b&gt;&amp;&lt;/b&gt;</h3>'));
  assert.ok(h.includes('<span>—</span>'));
  assert.ok(h.includes('<div class="kc-img">📷</div>'));
  assert.ok(!h.includes('kc-price'));
});

test('long names get the smaller header', () => {
  assert.ok(classicCard(card({ item: '4.75x1 die-cut Small Blank Stickers' })).includes('kc-header long'));
  assert.ok(!classicCard(card()).includes('kc-header long'));
});

test('location line: crumbtrail with › separators, else zone · slot', () => {
  assert.equal(locLine('Cleaning Rack > F-1', 'Cleaning Rack', 'F-1'), 'Cleaning Rack › F-1');
  assert.equal(locLine('', 'Supply Rack', 'B-2'), 'Supply Rack · B-2');
  assert.equal(locLine('', 'Unassigned', ''), '');
});
