/**
 * Supply card on the old kanban template (kanban.html cardHtml / getPrintCSS):
 * red body, gold ink, double gold border, uppercase name header
 * with a rule, location line, white photo box, uppercase fields, gold price
 * pill, round logo bottom-left. Koa 2026-10-28: every Tag & Desk card print
 * should look like the old kanban card. Koa 2026-10-29: one card per item, red
 * only — green cards are retired.
 *
 * One face only, so the QR sits on the front (the old 6×4 put it on a back
 * page) next to the scan trigger the old card never had.
 *   size 'c6'   — 6×4 stack card (old default card + sticker-4x8 layout)
 *   size 'full' — 8.5×11 sheet (old "full" card)
 * Styles live in tag-desk.css under `.kc`. Pure strings, no DOM, so
 * `node --test` covers it.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Location line: the card's crumbtrail with › separators, or zone · slot when it has none. */
export const locLine = (crumbtrail, zone, slot) => {
  const ct = String(crumbtrail || '').trim();
  if (ct) return ct.replace(/\s*>\s*/g, ' › ');
  return [zone && zone !== 'Unassigned' ? zone : '', slot].filter(Boolean).join(' · ');
};

/**
 * One card. `trigger` and `foot` are trusted HTML the caller builds; every
 * other value is escaped here. `fields` is [[label, value], …] (three on both sizes).
 */
export function classicCard({ size = 'c6', colour = 'red', item, loc, picture, fields = [], price, trigger, qr, logo, foot = '' }) {
  const long = String(item || '').length > (size === 'full' ? 34 : 26) ? ' long' : '';
  const photo = picture ? `<div class="kc-img"><img src="${esc(picture)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='📷'"></div>` : '<div class="kc-img">📷</div>';
  const flds = fields.map(([l, v]) => `<div class="kc-field"><small>${esc(l)}</small><span>${esc(v || '—')}</span></div>`).join('');
  const pill = price ? `<div class="kc-price">${esc(price)}</div>` : '';
  const head = `<div class="kc-border"></div><div class="kc-inner"></div>`;
  const tail = `<img class="kc-logo" src="${esc(logo)}" alt=""><div class="kc-foot">${foot}</div>`;
  if (size === 'full') {
    return `<div class="kc-sheet"><div class="kc full ${colour}">${head}<div class="kc-content"><div class="kc-header${long}"><h3>${esc(item)}</h3></div>
<div class="kc-loc">${esc(loc)}</div>${photo}<div class="kc-fields">${flds}</div>
<div class="kc-bottom"><div class="kc-qr">${qr}</div><div class="kc-act"><div class="kc-scan">${trigger}</div>${pill}</div></div></div>${tail}</div></div>`;
  }
  return `<div class="kc c6 ${colour}">${head}<div class="kc-content"><div class="kc-header${long}"><h3>${esc(item)}</h3></div>
<div class="kc-loc">${esc(loc)}</div><div class="kc-body"><div class="kc-left"><div class="kc-top">${photo}<div class="kc-fields">${flds}</div></div>
<div class="kc-scan">${trigger}</div></div><div class="kc-right"><div class="kc-qr">${qr}</div>${pill}</div></div></div>${tail}</div>`;
}
