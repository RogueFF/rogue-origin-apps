/**
 * Practice / demo mode on the floor pages (Koa 2026-11-11). Any page opened with
 * ?demo=1 talks to /api/demo/production instead of /api/production: the same
 * Worker code on a separate practice database (workers/src/lib/demo-env.js), so
 * nothing a demo does can reach live data. A loud banner sits on every demo screen.
 */
const params = () => new URLSearchParams(location.search);
export const isDemo = () => params().get('demo') === '1';

/** The page's API base, switched to the practice database in demo mode. */
export function demoApi(api) {
  return isDemo() ? String(api).replace(/\/api\/production$/, '/api/demo/production') : api;
}

/** A link to another floor page, kept in demo mode (and on the same local API). */
export function withDemo(href) {
  if (!isDemo()) return href;
  const [path, query = ''] = String(href).split('?');
  const q = new URLSearchParams(query);
  q.set('demo', '1');
  const api = params().get('api');
  if (api && !q.has('api')) q.set('api', api);
  return `${path}?${q}`;
}

/** The DEMO banner: fixed at the top of the screen, with a link back to the practice controls. */
export function showDemoBanner() {
  if (!isDemo() || document.getElementById('ro-demo-banner')) return;
  let es = false;
  try { es = localStorage.getItem('ro-lang') === 'es'; } catch { /* default English */ }
  const bar = document.createElement('div');
  bar.id = 'ro-demo-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:sticky;top:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;'
    + 'padding:8px 12px;font:800 16px Outfit,system-ui,sans-serif;letter-spacing:.04em;color:#1d1d1b;'
    + 'background:repeating-linear-gradient(135deg,#f2c14e 0 18px,#e9a93a 18px 36px);border-bottom:3px solid #b8760b;';
  const label = document.createElement('span');
  label.textContent = es ? 'PRÁCTICA · datos de prueba, no es en vivo' : 'DEMO · practice data, not live';
  const link = document.createElement('a');
  link.href = withDemo('demo.html');
  link.textContent = es ? 'Controles' : 'Controls';
  link.style.cssText = 'color:#1d1d1b;text-decoration:underline;font-weight:700;';
  bar.append(label, link);
  document.body.prepend(bar);
}
