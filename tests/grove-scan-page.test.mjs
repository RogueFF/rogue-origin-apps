/** /k/<token> red-card scan page: renders only, mutates via a POST from the page's own script. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPageHtml, handleBinScan } from '../workers/src/handlers/bin-scan.js';

const BASE = 'https://api.example.test';

test('page POSTs scanCard to the absolute API URL with the token', () => {
  const html = scanPageHtml('abcdefgh23', BASE);
  assert.match(html, /action=scanCard/);
  assert.match(html, /method:\s*'POST'/);
  assert.ok(html.includes('"abcdefgh23"'));
  assert.ok(html.includes('"https://api.example.test"'));
  assert.match(html, /\/api\/kanban\?action=scanCard/);
  assert.match(html, /Enviando/);
  assert.doesNotMatch(html, /<(link|img)\b|src=["']http/i);   // no external resources
});

test('a hostile token cannot break out of the script or the markup', () => {
  const evil = '</script><script>alert(1)</script>';
  const html = scanPageHtml(evil, BASE);
  assert.ok(!html.includes(evil));
  assert.equal(html.match(/<\/script>/gi).length, 1);
  assert.ok(!html.includes('<script>alert'));
});

test('GET /k/<token> never touches the database', async () => {
  const boom = () => { throw new Error('DB touched on GET'); };
  const env = { PUBLIC_API_BASE: BASE, DB: new Proxy({}, { get: boom }) };
  const res = await handleBinScan(new Request(`${BASE}/k/abcdefgh23`), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.ok(html.includes('"abcdefgh23"'));
});

test('errors are Spanish first by status; the three rescan messages exist', () => {
  const html = scanPageHtml('abcdefgh23', BASE);
  for (const s of ['Tarjeta no reconocida', 'Card not recognised', 'Tarjeta reemplazada o anulada', 'Card replaced or void',
    'Solicitud enviada a Damon ✓', 'Ya está pedido · correo reenviado', 'Ya está pedido · Damon ya tiene el correo',
    'Already requested · Damon already has the email', 'retried']) assert.ok(html.includes(s), s);
});

test('a trailing slash on PUBLIC_API_BASE is stripped', async () => {
  const res = await handleBinScan(new Request(`${BASE}/k/abcdefgh23`), { PUBLIC_API_BASE: BASE + '/' });
  const html = await res.text();
  assert.ok(html.includes(`"${BASE}"`));
  assert.ok(!html.includes(`"${BASE}/"`));
});
