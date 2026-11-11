/**
 * Practice mode's stand-in for Shopify admin (Koa 2026-11-11: printing goes
 * through Shopify). Bag/tag's "Confirm + open in Shopify" opens this page in demo:
 * it shows the two Shopify steps and lets you "buy the label", which marks the
 * mock order fulfilled, as Shopify would. Only works in demo mode.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { isDemo, demoApi, showDemoBanner } from '../shared/demo.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
registerLabels({
  en: {
    title: 'Shopify (stand-in)', what: 'Live, this is the order\'s page in Shopify admin. Two steps happen there:',
    slip: '1. Print → Print packing slips (into the sleeve).', label: '2. When packed and weighed: Create shipping label → Buy shipping label → Print label.',
    buy: 'Pretend: buy the label (fulfils the order)', done: 'Fulfilled. It drops off the bag/tag queue. You can close this tab.',
    notDemo: 'This page only works in practice mode.', fail: 'That didn\'t work: {e}',
  },
  es: {
    title: 'Shopify (de prueba)', what: 'En vivo, aquí está la página de la orden en Shopify. Ahí pasan dos pasos:',
    slip: '1. Print → Print packing slips (va en la funda).', label: '2. Ya empacada y pesada: Create shipping label → Buy shipping label → Print label.',
    buy: 'De prueba: comprar la etiqueta (completa la orden)', done: 'Completada. Sale de la cola de empaque. Puede cerrar esta pestaña.',
    notDemo: 'Esta página solo funciona en modo de práctica.', fail: 'No funcionó: {e}',
  },
});
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = demoApi(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API);
const $ = id => document.getElementById(id);

function render() {
  $('title').textContent = `${t('title')} · ${params.get('order') ? `#${params.get('order')}` : ''}`;
  $('what').textContent = t('what');
  $('slip').textContent = t('slip');
  $('label').textContent = t('label');
  $('buy').textContent = t('buy');
}

$('buy').addEventListener('click', async () => {
  if (!isDemo()) { $('msg').textContent = t('notDemo'); return; }
  try {
    const r = await fetch(`${API}?action=demoFulfill`, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ orderId: Number(params.get('order')) }) });
    const d = await r.json().catch(() => ({}));
    $('msg').textContent = r.ok ? t('done') : t('fail').replace('{e}', d.error || r.status);
    if (r.ok) $('buy').disabled = true;
  } catch (e) { $('msg').textContent = t('fail').replace('{e}', e.message); }
});
$('langToggle').addEventListener('click', () => { setLang(getLang() === 'en' ? 'es' : 'en'); $('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN'; render(); });
$('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN';
showDemoBanner();
render();
if (!isDemo()) { $('buy').disabled = true; $('msg').textContent = t('notDemo'); }
