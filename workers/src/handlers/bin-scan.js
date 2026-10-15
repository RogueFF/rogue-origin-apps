/**
 * /k/<token> — the Grove red ORDER card's QR target (design §6, §7).
 *
 * GET only renders. The scan is recorded by the page's own script POSTing
 * ?action=scanCard, because camera apps and link scanners prefetch URLs and a
 * mutating GET would order bags nobody asked for. The API URL is absolute: a
 * relative ?action= would resolve back onto /k/ and record nothing.
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
/** Spanish first by status; the server's (English) message only for the unexpected. */
function fail(status, msg) {
  const [es, en] = status === 404 ? ['Tarjeta no reconocida', 'Card not recognised']
    : status === 400 && /replaced/i.test(msg || '') ? ['Tarjeta reemplazada — usa la nueva', 'Card replaced — use the new one']
    : status === 400 ? ['No se pudo registrar', 'Could not record · ' + (msg || '')]
    : status === 0 ? ['Sin conexión', 'No connection']
    : ['Error', msg || ''];
  show('#7f1d1d', [el('h1', null, '✗'), el('p', 'big', es), el('p', 'en', en), ...pair('Avisa a Koa', 'Tell Koa')]);
}
function ok(d) {
  const lane = d.lane || {}, rq = d.request || {};
  const bins = el('div', 'bins'), n = Math.max(0, Math.min(Number(lane.bins) || 0, 80));
  for (let i = 0; i < n; i++) bins.append(el('i', i < (Number(lane.redTapeAtBins) || 0) ? 'r' : ''));
  show(COLOURS[lane.colour] || '#8b1a1a', [
    el('h1', null, 'PEDIR'), el('p', 'big', lane.item || ''),
    ...(rq.outcome === 'created' ? pair('Solicitud enviada a Damon ✓', 'Request sent to Damon')
      : rq.retried ? pair('Ya está pedido · correo reenviado', 'Already requested · email re-sent')
      : pair('Ya está pedido · Damon ya tiene el correo', 'Already requested · Damon already has the email')),
    bins,
    el('p', 'msg', '~' + (lane.bins ?? '?') + ' contenedores' + (lane.orderBy ? ' · pedir antes del ' + lane.orderBy : '')),
    el('p', 'en', '~' + (lane.bins ?? '?') + ' bins' + (lane.orderBy ? ' · order by ' + lane.orderBy : '')),
    ...pair('Deja la tarjeta aquí hasta la próxima entrega.', 'Leave the card here until the next delivery.'),
  ]);
}
fetch(BASE + '/api/kanban?action=scanCard', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN }),
}).then(r => r.json().catch(() => ({})).then(d => (r.ok && d.success ? ok(d) : fail(r.status, d.error || 'HTTP ' + r.status))))
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
