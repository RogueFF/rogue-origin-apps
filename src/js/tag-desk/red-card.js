/**
 * Grove red ORDER card — one per lane, laminated, printed once from the Desk's
 * Lane kit. It is the old supply-closet kanban card (kanban.html, the 8.5×11
 * "full" size) in red: double gold border, name header, location line, bag
 * photo, three fields, QR + SCAN TO ORDER, gold price pill, round logo.
 * Koa 2026-10-19: the Grove reorder cards should match the old template.
 * Pure strings, no DOM, so `node --test` covers it.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The old card palette and layout: red body, gold ink, gold borders. Lifted from kanban.html getPrintCSS('full'). */
export const RED_CARD_CSS = `
.pg.rc{padding:.4in;align-items:center;justify-content:center;gap:0}
.kanban.full-card{width:7.7in;height:10.2in;position:relative;border-radius:16px;background:#bd4a28;color:#f0cb60;flex:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.kanban-border{position:absolute;inset:0;border:7px solid #e4aa4f;border-radius:16px}
.kanban-inner{position:absolute;inset:22px;border:5px solid #e4aa4f;border-radius:12px}
.full-content{position:absolute;inset:52px 52px 100px 52px;display:flex;flex-direction:column;align-items:center}
.full-header{width:100%;text-align:center;border-bottom:5px solid currentColor;padding-bottom:14px;margin-bottom:14px}
.full-header h3{text-transform:uppercase;font-weight:800;letter-spacing:1px;font-size:50px;line-height:1.05;word-break:break-word;margin:0}
.full-loc{display:flex;align-items:center;justify-content:center;gap:14px;font-weight:700;font-size:26px;margin-bottom:22px}
.full-loc .sw{display:inline-block;width:26px;height:26px;border-radius:6px;border:3px solid #e4aa4f;vertical-align:-5px;margin-right:8px}
.full-img{background:#fff;border:6px solid #e4aa4f;border-radius:14px;width:5in;height:3.1in;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:24px;font-size:28px;color:#8a857a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.full-img img{width:100%;height:100%;object-fit:contain}
.full-fields{display:flex;width:100%;justify-content:space-around;text-align:center;gap:12px;margin-bottom:auto}
.full-field small{text-transform:uppercase;opacity:.8;display:block;font-weight:600;font-size:17px;margin-bottom:8px;letter-spacing:.5px}
.full-field span{font-weight:800;font-size:38px;display:block;line-height:1.1}
.full-bottom{display:flex;width:100%;align-items:center;gap:24px}
.full-qr{background:#fff;border-radius:10px;border:4px solid #e4aa4f;width:2.3in;height:2.3in;padding:.12in;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.full-qr svg{width:100%;height:100%;display:block}
.full-scan{flex:1;text-transform:uppercase;font-weight:800;font-size:27px;letter-spacing:.5px;line-height:1.15}
.full-scan .en{display:block;font-size:20px;font-weight:600;opacity:.9}
.kanban-price{background:#e4aa4f;border-radius:44px;font-weight:800;color:#1f2a20;padding:12px 28px;font-size:30px;margin-left:auto;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.kanban-logo{position:absolute;border-radius:50%;bottom:30px;left:30px;width:60px;height:60px}
.full-keep{position:absolute;right:52px;bottom:40px;font-size:16px;font-weight:600;text-align:right;opacity:.9;line-height:1.3}
.full-keep .en{display:block;font-weight:500;opacity:.85}
`;

/** Two-language text: the Desk language first, the other small underneath. Spanish first unless lang is 'en'. */
export const bi = (es, en, lang = 'es') => lang === 'en' ? `${en}<span class="en">${es}</span>` : `${es}<span class="en">${en}</span>`;

/**
 * One letter page holding the red card. Everything is text the caller already
 * has: the kanban card's fields, the lane colour, the QR as an inline SVG and
 * an absolute logo URL (the print window is about:blank, so no relative paths).
 * `lang` ('es' default, or 'en') picks which language is big; the other stays small underneath.
 */
export function redCardPage({ item, crumbtrail, colourHex, colourName, picture, supplier, orderQty, delivery, price, qr, logo, lang = 'es' }) {
  const en = lang === 'en';
  const loc = esc(String(crumbtrail || '').replace(/\s*>\s*/g, ' › '));
  const swatch = colourName ? `<span>·</span><span><i class="sw" style="background:${esc(colourHex)}"></i>${esc(colourName)}</span>` : '';
  const photo = picture ? `<div class="full-img has"><img src="${esc(picture)}" alt="" referrerpolicy="no-referrer"></div>` : `<div class="full-img">${en ? 'bag photo · foto de la bolsa' : 'foto de la bolsa · bag photo'}</div>`;
  const field = (lEs, lEn, v) => `<div class="full-field"><small>${en ? `${lEn} · ${lEs}` : `${lEs} · ${lEn}`}</small><span>${esc(v || '—')}</span></div>`;
  return `<section class="pg rc"><div class="kanban full-card red"><div class="kanban-border"></div><div class="kanban-inner"></div>
<div class="full-content"><div class="full-header"><h3>${esc(item)}</h3></div>
<div class="full-loc"><span>${loc}</span>${swatch}</div>
${photo}
<div class="full-fields">${field('Proveedor', 'Supplier', supplier)}${field('Cantidad', 'Order qty', orderQty)}${field('Entrega', 'Delivery', delivery)}</div>
<div class="full-bottom"><div class="full-qr">${qr}</div><div class="full-scan">${bi('ESCANEA PARA PEDIR', 'SCAN TO ORDER', lang)}</div>${price ? `<div class="kanban-price">${esc(price)}</div>` : ''}</div></div>
<img class="kanban-logo" src="${esc(logo)}" alt=""><div class="full-keep">${bi('Déjala aquí hasta la próxima entrega', 'Leave it here until the next delivery', lang)}</div></div></section>`;
}

/**
 * Resolves true once every image in `imgs` has loaded or errored, false if `ms`
 * passes first. Print only after it: a laminated card with a blank photo box is
 * a wasted sheet.
 */
export function imagesSettled(imgs, ms = 3000) {
  return new Promise(resolve => {
    const pending = [...imgs].filter(i => !i.complete);
    if (!pending.length) return resolve(true);
    let left = pending.length, done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    const one = () => { if (!done && --left <= 0) { done = true; clearTimeout(timer); resolve(true); } };
    pending.forEach(i => { i.addEventListener('load', one, { once: true }); i.addEventListener('error', one, { once: true }); });
  });
}
