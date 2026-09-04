/**
 * Tag & Desk — the pure model.
 *
 * Everything here is a function of the four API reads (cards, cart, orders,
 * reorder requests), a calendar date, and the desk's own memory. No DOM, no
 * fetch, no localStorage — so `node --test` can pin every rule.
 *
 * Rules the page lives by (Koa, 2026-09-03):
 *  - Cart vendors are CHECKED Mon / Wed / Fri and pushed off when stocked.
 *    D1..D3 are the next three check days from "today".
 *  - "About to run out" = the order history says it runs out before the
 *    FOLLOWING check plus the card's own lead days could restock it.
 *  - Two-bin system: Fill to = both bins, Reorder at = the back bin. A red
 *    card at the bottom of the back bin means completely out (an alarm).
 *  - A re-scan never inflates a quantity; scans are anonymous.
 */

// ---------- dates ----------
export const CHECK_DOWS = [1, 3, 5]; // Mon Wed Fri
export const pd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return isoOf(d); };
export const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
export function nextCheckAfter(s) { const d = pd(s); do { d.setDate(d.getDate() + 1); } while (!CHECK_DOWS.includes(d.getDay())); return isoOf(d); }
export function checkDays(today) { const d1 = nextCheckAfter(today), d2 = nextCheckAfter(d1), d3 = nextCheckAfter(d2); return { d1, d2, d3 }; }
/** D1 stores `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC with no marker; make it a real instant. */
export function d1Instant(s) { if (!s) return null; const t = String(s); return t.includes('T') ? new Date(t) : new Date(t.replace(' ', 'T') + 'Z'); }
/** Local (farm) calendar date of a D1 timestamp. */
export function localDay(s, tz = 'America/Los_Angeles') {
  const d = d1Instant(s); if (!d || Number.isNaN(d.getTime())) return null;
  try { const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); return p; }
  catch { return d.toISOString().slice(0, 10); }
}

// ---------- normalisation of the free-text card fields ----------
export function num(s) { const m = String(s ?? '').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; }
export function parsePrice(s) { const m = String(s ?? '').match(/\$?\s*(\d*[.,]\d+|\d+)/); if (!m) return null; const v = parseFloat(m[1].replace(',', '.')); return Number.isFinite(v) ? v : null; }
export function deliveryDays(s) {
  const t = String(s ?? '').toLowerCase(); const n = num(t); if (n == null) return null;
  if (t.includes('week')) return Math.round(n * 7);
  if (t.includes('month')) return Math.round(n * 30);
  if (t.includes('-')) { const parts = t.match(/\d+/g); return parseInt(parts[parts.length - 1], 10); }
  return Math.round(n);
}
export function zoneOf(crumbtrail) {
  const s = String(crumbtrail ?? '').trim().replace(/\s+/g, ' ')
    .replace('Supplay', 'Supply').replace('FULFILLEMENT', 'FULFILLMENT').replace('FULFLLEMENT', 'FULFILLMENT')
    .replace(/\s*>\s*/g, ' > ').replace(/^[ >]+|[ >]+$/g, '');
  if (!s) return { zone: 'Unassigned', slot: '' };
  const parts = s.split('>').map(p => p.trim()); let zone = parts[0]; const slot = parts.slice(1).join(' > ');
  const zl = zone.toLowerCase();
  if (zl.includes('fulfillment') || zl.includes('shipping')) zone = 'Fulfillment';
  else if (zl.includes('cleaning')) zone = 'Cleaning rack';
  else if (zl.includes('supply rack')) zone = 'Supply rack';
  else if (zl.includes('supply room')) zone = 'Supply room';
  else if (zl.includes('grove')) zone = 'Grove bags rack';        // Koa: Grove Rack A-1 is the Grove Bags Rack
  else if (zl.includes('t-zero') && zl.includes('rack')) zone = 'T-Zero rack'; // Koa: the rack and the room are different places
  else if (zl.includes('t-zero')) zone = 'T-Zero room';
  else if (zl.includes('trim')) zone = 'Trim area';
  else if (zl.includes('bathroom')) zone = 'Bathroom';
  return { zone, slot };
}
export const ZONES = ['Supply rack', 'Supply room', 'Fulfillment', 'Cleaning rack', 'Grove bags rack', 'T-Zero room', 'T-Zero rack', 'Trim area', 'Bathroom', 'Unassigned'];

/** Koa: nitrile gloves are bought by the box of 100; the card price is per glove. */
export function packSizeOf(raw) {
  const perPiece = /\/\s*pc/i.test(raw.price || '');
  if (perPiece && /nitrile/i.test(raw.item || '') && /glove/i.test(raw.item || '')) return 100;
  return null;
}

export function normalizeCard(raw) {
  const { zone, slot } = zoneOf(raw.crumbtrail);
  const fill = num(raw.orderQty), reorder = num(raw.orderWhen);
  const numericLevels = /\d/.test(String(raw.orderWhen ?? ''));
  const packSize = packSizeOf(raw);
  const perUnit = parsePrice(raw.price);
  let model = null;
  const m = /\/([SH]-\d+[A-Z0-9-]*)/.exec(raw.url || '') || /([SH]-\d{3,}[A-Z0-9-]*)/.exec(raw.url || '');
  if (m && raw.supplier === 'Uline') model = m[1];
  const c = {
    id: raw.id, item: String(raw.item || '').trim(), vendor: String(raw.supplier || '').trim() || '(Unspecified)',
    zone, slot, crumbtrailRaw: raw.crumbtrail || '',
    fill, reorder, numericLevels, orderQtyRaw: raw.orderQty || '', orderWhenRaw: raw.orderWhen || '',
    leadDays: deliveryDays(raw.deliveryTime) || 1, deliveryRaw: raw.deliveryTime || '',
    unitPrice: perUnit == null ? null : (packSize ? Math.round(perUnit * packSize * 100) / 100 : perUnit), priceRaw: raw.price || '', packSize,
    url: raw.url || '', picture: raw.picture || '', imageFile: raw.imageFile || '', model,
  };
  if (c.vendor.toUpperCase() === 'ULINE') c.vendor = 'Uline';
  if (c.numericLevels && c.fill && c.reorder != null) {
    if (c.fill > c.reorder) { c.suggested = Math.round(c.fill - c.reorder); c.formula = `fill ${Math.round(c.fill)} − reorder ${Math.round(c.reorder)} = ${c.suggested}`; }
    else { c.suggested = Math.round(c.fill); c.formula = `fill ${Math.round(c.fill)} (equals reorder)`; }
  } else { c.suggested = c.fill ? Math.round(c.fill) : 1; c.formula = `card says ${c.orderQtyRaw}`; }
  return c;
}

/** Inverse of normalizeCard for the fields the editor owns; everything else is carried through from the raw row. */
export function toRawCard(c, raw = {}) {
  const orderQty = c.fill != null ? `x${Math.round(c.fill)}` : (raw.orderQty || 'x1');
  const orderWhen = c.numericLevels && c.reorder != null ? String(Math.round(c.reorder)) : 'Green Card Signal';
  const crumbtrail = c.zone === 'Unassigned' ? '' : (c.slot ? `${c.zone} > ${c.slot}` : c.zone);
  return {
    id: c.id, item: c.item, supplier: c.vendor, orderQty, orderWhen, crumbtrail,
    deliveryTime: c.deliveryRaw || (c.leadDays ? `${c.leadDays} Day${c.leadDays === 1 ? '' : 's'}` : ''),
    price: c.priceRaw || '', url: c.url || '', picture: c.picture || '', imageFile: c.imageFile || raw.imageFile || '',
  };
}

// ---------- the model ----------
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const VENDOR_LANES = { Grove: 'email', 'Sticker Mule': 'triggered' };
export const laneOf = v => VENDOR_LANES[v] || 'cart';

/**
 * @param {object} p
 * @param {Array} p.cards      raw rows from action=cards
 * @param {object} p.cart      `cart` object from action=getCart (grouped by vendor)
 * @param {Array} p.orders     `orders` from getOrderHistory
 * @param {Array} p.requests   `requests` from getReorderRequests (any status)
 * @param {string} p.today     ISO date
 * @param {object} p.levelsChanged  id → ISO date the levels last changed (desk memory)
 * @param {Array} [p.archived] ids hidden on this desk
 */
export function buildModel({ cards, cart, orders, requests, today, levelsChanged = {}, archived = [] }) {
  const { d1, d2, d3 } = checkDays(today);
  const inCart = {};
  for (const rows of Object.values(cart || {})) for (const r of rows) inCart[r.cardId] = { cartId: r.cartId, qty: r.qty, addedAt: r.addedAt, addedBy: r.addedBy || null, note: r.note || null };
  const days = {}, qtyHist = {};
  const norder = (orders || []).map(o => ({ ...o, vendor: String(o.vendor || '').toUpperCase() === 'ULINE' ? 'Uline' : o.vendor }));
  for (const o of norder) { const day = localDay(o.orderedAt); for (const it of o.items || []) { (days[it.cardId] ||= new Set()).add(day); (qtyHist[it.cardId] ||= []).push([day, it.qty]); } }
  const openReq = {}, lastReq = {};
  for (const r of requests || []) { if (r.status === 'open') openReq[r.cardId] = r; if (!lastReq[r.cardId] || r.requestedAt > lastReq[r.cardId].requestedAt) lastReq[r.cardId] = r; }
  const hidden = new Set(archived);
  const out = [];
  for (const raw of cards || []) {
    if (hidden.has(raw.id)) continue;
    const c = normalizeCard(raw);
    const ds = [...(days[c.id] || [])].filter(Boolean).sort(); const n = ds.length;
    const gaps = ds.slice(1).map((d, i) => daysBetween(ds[i], d));
    const med = median(gaps); const last = n ? ds[n - 1] : null;
    const lc = levelsChanged[c.id] || null;
    const stable = !(lc && n >= 2 && lc > ds[n - 2]);
    c.orderDays = ds; c.n = n; c.medianGap = med; c.lastOrderDay = last;
    c.expected = (n >= 3 && med && stable) ? addDays(last, Math.round(med)) : null;
    c.silent = !!(n >= 2 && med && daysBetween(last, today) > 2.5 * med);
    c.levelsChanged = lc; c.qtyHist = (qtyHist[c.id] || []).slice(-4);
    c.lane = laneOf(c.vendor);
    const ic = inCart[c.id]; c.inCart = ic || null;
    if (ic) {
      const tagScan = ic.addedBy && /^tag/.test(ic.addedBy);
      c.scanCount = tagScan ? 1 : Math.max(1, Math.round(ic.qty / (c.suggested || 1)));
      c.bumps = tagScan ? Math.max(0, ic.qty - c.suggested) : 0;
      c.redCard = /RED/i.test(ic.note || ''); c.urgent = /URGENT/i.test(ic.note || '');
    }
    c.openRequest = openReq[c.id] || null; c.lastRequest = lastReq[c.id] || null;
    out.push(c);
  }
  // vendor stats
  const vendors = {};
  for (const c of out) (vendors[c.vendor] ||= { lane: c.lane, cards: 0, orders: 0, orderDays: new Set(), items: 0 }).cards++;
  for (const o of norder) { const v = (vendors[o.vendor] ||= { lane: laneOf(o.vendor), cards: 0, orders: 0, orderDays: new Set(), items: 0 }); v.orders++; v.orderDays.add(localDay(o.orderedAt)); v.items += (o.items || []).length; }
  for (const v of Object.values(vendors)) { const ds = [...v.orderDays].filter(Boolean).sort(); const gaps = ds.slice(1).map((d, i) => daysBetween(ds[i], d)); v.orderDays = ds; v.avgGapDays = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length * 10) / 10 : null; v.lastOrder = ds[ds.length - 1] || null; v.itemsPerOrder = v.orders ? Math.round(v.items / v.orders * 10) / 10 : null; }
  // spend by month (estimate) and same-vendor orders within 3 days
  const byId = Object.fromEntries(out.map(c => [c.id, c])); const spend = {};
  for (const o of norder) { const mon = String(localDay(o.orderedAt) || '').slice(0, 7); for (const it of o.items || []) { const c = byId[it.cardId]; if (!c || c.unitPrice == null) continue; ((spend[mon] ||= {})[o.vendor] = (spend[mon][o.vendor] || 0) + c.unitPrice * it.qty); } }
  const frag = [];
  for (const [v, st] of Object.entries(vendors)) for (let i = 1; i < st.orderDays.length; i++) { const g = daysBetween(st.orderDays[i - 1], st.orderDays[i]); if (g > 0 && g <= 3) frag.push([v, st.orderDays[i - 1], st.orderDays[i]]); }
  return { today, d1, d2, d3, cards: out, byId, vendors, orders: norder, spend, fragmentation: frag };
}

// ---------- state of one card ----------
export const leadOf = c => c.leadDays || 1;
/** it must be on the NEXT check if it runs out before the check after that could restock it */
export const dueBy = (c, M) => addDays(M.d2, leadOf(c));
export const dueNextBy = (c, M) => addDays(M.d3, leadOf(c));
export function expectedOf(c, M, L) { const r = L.received?.[c.id]; if (r) { if (!c.medianGap || !c.expected) return null; return addDays(r, Math.round(c.medianGap)); } return c.expected; }
export function baseState(c, M, L) {
  if (L.received?.[c.id]) { const e = expectedOf(c, M, L); return (e && e <= dueNextBy(c, M)) ? 'due-next' : 'ok'; }
  if (c.silent) return 'check';
  if (c.expected && c.expected <= dueBy(c, M)) return 'due';
  if (c.expected && c.expected <= dueNextBy(c, M)) return 'due-next';
  return c.n ? 'ok' : 'no-history';
}
/**
 * @param {object} L desk memory slice: ordered {id: vendor}, groveOrdered {id}, backorder {id}, out {id}, dismissed {id: untilISO}, received {id: ISO}
 */
export function cardState(c, M, L = {}) {
  if (c.inCart) return 'queued';
  if (L.ordered?.[c.id] || L.groveOrdered?.[c.id]) return 'on-order';
  if (L.backorder?.[c.id] || L.out?.[c.id]) return 'due';
  if (L.dismissed?.[c.id] && L.dismissed[c.id] > M.today) return 'ok';
  if (c.openRequest) return 'requested';
  return baseState(c, M, L);
}

/** Desk memory receipts: which card ids are on order, by vendor. */
export function orderedMap(receipts = {}) { const m = {}; for (const [v, r] of Object.entries(receipts)) for (const id of r.open || []) m[id] = v; return m; }

/**
 * Uline Quick Order paste text: one "MODEL QTY" per line, the format the
 * "Paste Items Page" on uline.com/QuickOrder accepts ("Separate model number
 * and quantity by a space or comma"). Cards without a Uline model number
 * cannot be pasted and come back in `missing` so the desk can name them.
 */
export const ULINE_QUICK_ORDER_URL = 'https://www.uline.com/QuickOrder';
export function ulinePasteText(rows) {
  const lines = [], missing = [];
  for (const r of rows) { if (r.model) lines.push(`${r.model} ${r.qty}`); else missing.push(r); }
  return { text: lines.join('\n'), lines: lines.length, missing };
}
/** The Quick Order URL with the list in the fragment; the one-click helper (src/tools/uline-one-click.user.js) reads it on uline.com. Uline itself never sees a fragment. */
export function ulineQuickOrderUrl(text) { return text ? `${ULINE_QUICK_ORDER_URL}#ro=${encodeURIComponent(text)}` : ULINE_QUICK_ORDER_URL; }
export const ULINE_HELPER_URL = 'https://rogueff.github.io/rogue-origin-apps/src/tools/uline-one-click.user.js';
/** A bookmarklet with the same behaviour for browsers without a userscript manager: click it on the Uline page the desk opened. */
export const ULINE_BOOKMARKLET = "javascript:(function(){var m=location.hash.match(/ro=([^&]+)/);if(!m)return alert('Open Uline from the Supply Kanban desk first');var t=decodeURIComponent(m[1]);var L=t.split('\\n').map(function(l){return l.trim()}).filter(Boolean);if(!L.every(function(l){return /^[A-Z]{1,3}-[A-Z0-9-]{1,24} \\d{1,6}$/i.test(l)}))return;var ta=document.getElementById('txtPaste'),b=document.getElementById('btnAddPastedItemsToCart'),md=document.getElementById('IsPasteMode');if(!ta||!b)return;try{PageScript.ShowPaste()}catch(e){}ta.value=L.join('\\n');ta.classList.remove('empty');if(md)md.value='True';history.replaceState(null,'',location.pathname);setTimeout(function(){b.click()},400)})();";

/** What a Tag scan should do, decided from the cart alone (idempotent by construction). */
export function scanPlan(c, { red = false } = {}) {
  if (!c) return { outcome: 'unknown' };
  if (c.lane === 'email') return { outcome: 'requested', call: 'addToCart' }; // Grove → Damon lane (already_open re-sends)
  if (c.inCart) return red ? { outcome: 'out', call: 'note', note: 'RED CARD' } : { outcome: 'already' };
  return red ? { outcome: 'out', call: 'addToCart', qty: c.suggested, note: 'RED CARD' } : { outcome: 'queued', call: 'addToCart', qty: c.suggested };
}
