/**
 * /k/<token> — the Grove red ORDER card's QR target (design §6, §7; SOP-024).
 *
 * GET only renders. The page's own script first asks ?action=cardState
 * (read-only) and then does one of two things:
 *   - no open request → POST ?action=scanCard: the rack ran down to the card,
 *     order more (the original flow);
 *   - request open (the card is in the ORDERED box) → show the delivery form
 *     and POST ?action=receiveFromCard with the cases that arrived (Koa
 *     2026-10-22). A delivery scan can never raise a stray order.
 * Mutations are POSTs because camera apps and link scanners prefetch URLs. The
 * API URL is absolute: a relative ?action= would resolve back onto /k/.
 */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** JSON for inside <script>: `<` escaped so a value can never close the tag. */
const js = v => JSON.stringify(v).replace(/</g, '\\u003c');

export function scanPageHtml(token, base) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PEDIR</title>
<style>
body{margin:0;min-height:100vh;font-family:system-ui,sans-serif;color:#fff;background:#222;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:22vw;margin:0;line-height:1;letter-spacing:.02em}
.big{font-size:9vw;font-weight:700;margin:.3em 0}.msg{font-size:6vw;margin:.4em 0}.en{opacity:.8;font-size:4.5vw}
.bins{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:1em 0}
.bins i{width:28px;height:28px;border:2px solid #fff;border-radius:4px;background:rgba(255,255,255,.25)}
.bins i.r{background:#d00000}
form.arrive{background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.5);border-radius:16px;padding:14px;margin:.6em 0;display:grid;gap:10px;text-align:left}
form.arrive label{display:grid;gap:4px;font-size:5vw;font-weight:700}
form.arrive label .en{font-weight:400;font-size:4vw}
form.arrive input{font:inherit;font-size:9vw;font-weight:800;text-align:center;padding:6px;border-radius:10px;border:0;width:100%;box-sizing:border-box;color:#111}
form.arrive button{font:inherit;font-size:7vw;font-weight:800;padding:12px;border:0;border-radius:12px;background:#fff;color:#14532d}
a.link{color:#fff;opacity:.75;font-size:4.5vw}
small{opacity:.5;margin-top:2em}
</style></head><body>
<div id="v"><p class="big">Enviando…</p><p class="en">Sending…</p></div>
<small>${esc(token)}</small>
<script>
const TOKEN = ${js(token)}, BASE = ${js(base)};
const COLOURS = { orange: '#c2410c', teal: '#0f766e', violet: '#6d28d9', olive: '#4d5d16', slate: '#334155' };
const v = document.getElementById('v');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pair = (es, en, cls = 'msg') => [el('p', cls, es), el('p', 'en', en)];
function show(bg, nodes) { document.body.style.background = bg; v.replaceChildren(...nodes); }
const post = (url, payload) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  .then(r => r.json().catch(() => ({})).then(d => ({ r, d })));
const handle = ({ r, d }, onOk) => (r.ok && d.success ? onOk(d) : fail(r.status, d.error || 'HTTP ' + r.status));
/** Spanish first by status; the server's (English) message only for the unexpected. */
function fail(status, msg) {
  const [es, en] = status === 404 ? ['Tarjeta no reconocida', 'Card not recognised']
    : status === 400 && /replaced/i.test(msg || '') ? ['Tarjeta reemplazada — usa la nueva', 'Card replaced — use the new one']
    : status === 400 ? ['No se pudo registrar', 'Could not record · ' + (msg || '')]
    : status === 0 ? ['Sin conexión', 'No connection']
    : ['Error', msg || ''];
  show('#7f1d1d', [el('h1', null, '✗'), el('p', 'big', es), el('p', 'en', en), ...pair('Avisa a Koa', 'Tell Koa')]);
}
function binsRow(lane) {
  const bins = el('div', 'bins'), n = Math.max(0, Math.min(Number(lane.bins) || 0, 80));
  for (let i = 0; i < n; i++) bins.append(el('i', i < (Number(lane.redTapeAtBins) || 0) ? 'r' : ''));
  return bins;
}
/** The rack ran down to the card: the request went to Damon. */
function ok(d) {
  const lane = d.lane || {}, rq = d.request || {};
  show(COLOURS[lane.colour] || '#8b1a1a', [
    el('h1', null, 'PEDIR'), el('p', 'big', lane.item || ''),
    ...(rq.outcome === 'created' ? pair('Solicitud enviada a Damon ✓', 'Request sent to Damon')
      : rq.retried ? pair('Ya está pedido · correo reenviado', 'Already requested · email re-sent')
      : pair('Ya está pedido · Damon ya tiene el correo', 'Already requested · Damon already has the email')),
    binsRow(lane),
    el('p', 'msg', '~' + (lane.bins ?? '?') + ' contenedores' + (lane.orderBy ? ' · pedir antes del ' + lane.orderBy : '')),
    el('p', 'en', '~' + (lane.bins ?? '?') + ' bins' + (lane.orderBy ? ' · order by ' + lane.orderBy : '')),
    ...pair('Pon la tarjeta en la caja PEDIDO hasta que lleguen las cajas.', 'Put the card in the ORDERED box until the cases arrive.'),
  ]);
}
function order() { post(BASE + '/api/kanban?action=scanCard', { token: TOKEN }).then(x => handle(x, ok)).catch(() => fail(0)); }
/** The card is in the ORDERED box: the cases are here (or the email needs re-sending). */
function ordered(d) {
  const lane = d.lane || {}, perBox = Number(lane.config && lane.config.bagsPerBox) || 100;
  const guess = Math.max(1, Math.round((Number(lane.suggestedQty) || perBox) / perBox));
  const boxes = el('input'); boxes.type = 'number'; boxes.min = '1'; boxes.step = '1'; boxes.inputMode = 'numeric'; boxes.value = String(guess);
  const left = el('input'); left.type = 'number'; left.min = '0'; left.step = '1'; left.inputMode = 'numeric'; left.value = String(Math.max(0, Number(lane.bins) || 0));
  const lb = el('label', null, 'Cajas que llegaron'); lb.append(el('span', 'en', 'Cases that arrived'), boxes);
  const ll = el('label', null, 'Bins llenos en el rack (sin contar los nuevos)'); ll.append(el('span', 'en', 'Full bins on the rack (not counting the new ones)'), left);
  const btn = el('button', null, 'Recibir · Receive'); btn.type = 'submit';
  const form = el('form', 'arrive'); form.append(lb, ll, btn);
  form.addEventListener('submit', ev => {
    ev.preventDefault(); btn.disabled = true; btn.textContent = 'Guardando…';
    post(BASE + '/api/kanban?action=receiveFromCard', { token: TOKEN, boxes: Number(boxes.value), leftoverBins: Number(left.value) })
      .then(x => handle(x, received)).catch(() => fail(0));
  });
  const resend = el('a', 'link', 'Reenviar el correo a Damon · Re-send the email'); resend.href = '#';
  resend.addEventListener('click', ev => { ev.preventDefault(); order(); });
  show(COLOURS[lane.colour] || '#8b1a1a', [
    el('h1', null, 'PEDIDO'), el('p', 'big', lane.item || ''),
    ...pair('Ya está pedido · Damon ya tiene el correo', 'Already requested · Damon already has the email', 'en'),
    ...pair('¿Llegaron las cajas?', 'Did the cases arrive?'),
    form, resend,
  ]);
}
/** The delivery is in the Desk. */
function received(d) {
  const lane = d.lane || {}, sh = lane.shopify || null;
  show('#14532d', [
    el('h1', null, '✓'), el('p', 'big', 'Recibido · Received'), binsRow(lane),
    el('p', 'msg', '~' + (lane.bins ?? '?') + ' contenedores en el rack'), el('p', 'en', '~' + (lane.bins ?? '?') + ' bins on the rack'),
    ...pair('Llena los bins vacíos y pon la tarjeta debajo de los bins verdes.', 'Fill the empty bins and put the card under the green bins.'),
    ...(d.needsRecount ? pair('El conteo no cuadraba — avisa a la oficina.', 'The count was off — tell the office.', 'en') : []),
    ...(sh && sh.agrees === false ? pair('Oficina: Shopify dice ~' + (sh.bins ?? '?') + ' bins · ponlo en ' + (lane.onHand ?? '?') + '.', 'Office: Shopify says ~' + (sh.bins ?? '?') + ' bins · set it to ' + (lane.onHand ?? '?') + '.', 'en') : []),
  ]);
}
fetch(BASE + '/api/kanban?action=cardState&token=' + encodeURIComponent(TOKEN))
  .then(r => r.json().catch(() => ({})).then(d => (!r.ok || !d.success ? fail(r.status, d.error || 'HTTP ' + r.status) : d.openRequest ? ordered(d) : order())))
  .catch(() => fail(0));
</script></body></html>`;
}

export async function handleBinScan(request, env) {
  const token = new URL(request.url).pathname.replace(/^\/k\//, '').trim();
  const base = (env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev').replace(/\/+$/, '');
  return new Response(scanPageHtml(token, base), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
