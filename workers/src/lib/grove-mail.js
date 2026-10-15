/**
 * Grove email parser — pure. Turns an order confirmation or shipping notice
 * from Grove into { kind, items, trackingNo, carrier, vendorRef, shippedAt,
 * expectedAt }. No I/O, no Date.now(): `receivedAt` is the only clock.
 *
 * Design: docs/plans/2026-10-14-grove-bins-design.md §9b. Fixtures and the
 * cases they settle: tests/grove-mail-parser.test.mjs.
 *
 * Shape it never guesses at: a bag size the ladder cannot place, a line with
 * no quantity, a mail with neither tracking nor line items. Those come back in
 * `missing` and the worker parks the mail for Koa instead of applying it.
 */
import { cardFor } from './grove-card-for.js';

const UPS = /\b1Z[0-9A-Z]{16}\b/i;
// USPS first among the digit forms: a 22-digit USPS number contains a 20-digit
// run, which would otherwise read as FedEx.
const USPS = /\b(9[2-5]\d{18,20}|\d{20,22})\b/;
const FEDEX = /\b(\d{20}|\d{15}|\d{12})\b/;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
// "Oct 12, 2026" · "October 12" · "12 Oct 2026" · "10/12/2026" · "2026-10-12"
const DATE_RE = new RegExp(`\\b(?:${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?|(\\d{1,2})\\s+${MONTH_RE},?(?:\\s+(\\d{4}))?|(\\d{1,2})/(\\d{1,2})/(\\d{2,4})|(\\d{4})-(\\d{2})-(\\d{2}))\\b`, 'i');

const UNIT_CASE = /\b(cases?|boxes?|cartons?|ctns?)\b/i;
const PER_CASE = /(?:case|box|carton)\s*of\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:\/|per)\s*(?:case|box|carton)/i;

/** Minimal HTML → text: block tags break lines, the rest is stripped, entities decoded. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|thead|tbody)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&times;/g, '×')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Lines of the body with runs of whitespace collapsed and blanks dropped. */
function lines(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * A loose date in `s` → 'YYYY-MM-DD', or null. A month-day with no year takes
 * the year of `ref` (an ISO stamp), rolling forward when the day would land
 * more than two months before it (a January ship date read in December).
 */
export function parseDateLoose(s, ref) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const refD = ref ? new Date(ref) : null;
  const refYear = refD && !isNaN(refD) ? refD.getUTCFullYear() : null;
  let y, mo, d;
  if (m[1]) { mo = MONTHS[m[1].toLowerCase()]; d = Number(m[2]); y = m[3] ? Number(m[3]) : null; }
  else if (m[5]) { d = Number(m[4]); mo = MONTHS[m[5].toLowerCase()]; y = m[6] ? Number(m[6]) : null; }
  else if (m[7]) { mo = Number(m[7]) - 1; d = Number(m[8]); y = Number(m[9]); if (y < 100) y += 2000; }
  else { y = Number(m[10]); mo = Number(m[11]) - 1; d = Number(m[12]); }
  if (y == null) {
    if (refYear == null) return null;
    y = refYear;
    const cand = Date.UTC(y, mo, d);
    if (cand < refD.getTime() - 60 * 86400000) y += 1;
    else if (cand > refD.getTime() + 300 * 86400000) y -= 1;
  }
  if (!(mo >= 0 && mo <= 11) || !(d >= 1 && d <= 31)) return null;
  const out = new Date(Date.UTC(y, mo, d));
  return isNaN(out) ? null : out.toISOString().slice(0, 10);
}

/** Tracking number + carrier from free text. Explicit carrier words settle the digit-only forms. */
export function findTracking(text) {
  const t = String(text || '');
  const low = t.toLowerCase();
  const ups = UPS.exec(t);
  if (ups) return { trackingNo: ups[0].toUpperCase(), carrier: 'ups' };
  const saysFedex = /fedex|fed ex/.test(low), saysUsps = /usps|postal service/.test(low);
  const usps = USPS.exec(t), fedex = FEDEX.exec(t);
  if (usps && !saysFedex) return { trackingNo: usps[1], carrier: 'usps' };
  if (fedex) return { trackingNo: fedex[1], carrier: saysUsps && !saysFedex ? 'usps' : 'fedex' };
  if (usps) return { trackingNo: usps[1], carrier: 'usps' };
  return { trackingNo: null, carrier: null };
}

/** Grove's own order / invoice number: "#12345", "Order 12345", "Invoice GB-1234", "PO 5567". */
export function findVendorRef(subject, body) {
  const hay = `${subject || ''}\n${body || ''}`;
  const m = /(?:order|invoice|confirmation|po|sales order|reference)\s*(?:#|no\.?|number|num\.?)?\s*:?\s*#?\s*([A-Z]{0,4}-?\d{3,}[A-Z0-9-]*)/i.exec(hay)
    || /#\s?(\d{3,})\b/.exec(hay);
  return m ? m[1].toUpperCase() : null;
}

/** First number in `s` written as digits with optional thousands commas. */
const num = (s) => { const m = /(\d[\d,]*)/.exec(s); return m ? Number(m[1].replace(/,/g, '')) : null; };

/**
 * Quantity on one line item line. Returns { qty (bags) | null, cases | null,
 * count, unit: 'cases'|'bags'|null, perBox }. `perBox` is the line's own
 * "case of 100" / "100/case" when it says one, else the lane's.
 */
export function lineQuantity(line, perBoxDefault) {
  const l = String(line || '');
  const perM = PER_CASE.exec(l);
  const perBox = perM ? num(perM[1] || perM[2]) : (perBoxDefault || null);
  // The "case of 100" phrase is not a quantity: take it out before looking for one.
  const rest = perM ? l.replace(perM[0], ' ') : l;
  let count = null, unit = null, m;
  if ((m = /(\d[\d,]*)\s*(cases?|boxes?|cartons?|ctns?)\b/i.exec(rest))) { count = num(m[1]); unit = 'cases'; }
  else if ((m = /(\d[\d,]*)\s*(bags?|pcs?|pieces?|units?)\b/i.exec(rest))) { count = num(m[1]); unit = 'bags'; }
  else if ((m = /(?:×|\bx|qty\.?:?|quantity:?)\s*(\d[\d,]*)\b/i.exec(rest))) { count = num(m[1]); }
  else if ((m = /\b(\d[\d,]*)\s*(?:×|x)\s/i.exec(rest))) { count = num(m[1]); }
  if (count == null) return { qty: null, cases: null, count: null, unit: null, perBox };
  // A bare count on a line that sells by the case is cases; otherwise bags.
  if (!unit) unit = (perM || UNIT_CASE.test(rest)) ? 'cases' : 'bags';
  if (unit === 'cases') return { qty: perBox ? count * perBox : null, cases: count, count, unit, perBox };
  return { qty: count, cases: perBox ? Math.ceil(count / perBox) : null, count, unit, perBox };
}

/**
 * @param {{subject?:string, text?:string, html?:string, from?:string, receivedAt?:string}} mail
 * @param {Array<{cardId:number, bagsPerBox?:number}>} lanes  bin config per card (perBox defaults)
 */
export function parseGroveMail(mail, lanes = []) {
  const perBoxOf = new Map(lanes.map(l => [Number(l.cardId), Number(l.bagsPerBox) || null]));
  const body = mail.text && String(mail.text).trim() ? String(mail.text) : htmlToText(mail.html);
  const subject = String(mail.subject || '').trim();
  const ls = lines(body);
  const receivedAt = mail.receivedAt || null;

  const { trackingNo, carrier } = findTracking(`${subject}\n${body}`);
  const vendorRef = findVendorRef(subject, body);

  // Line items: a line the size ladder can place. Its quantity is on the line,
  // or on one of the next two (Shopify's text template puts "Quantity: 6" below).
  const byCard = new Map();
  const unknownSizes = [];
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    if (/^(subtotal|shipping|tax|total|discount|payment|order summary)\b/i.test(line)) continue;
    const cardId = cardFor(line);
    if (!cardId) {
      if (/\bbags?\b/i.test(line) && /\b\d+\s*(oz|lb|lbs|g)\b/i.test(line)) unknownSizes.push(line);
      continue;
    }
    let q = lineQuantity(line, perBoxOf.get(cardId));
    for (let j = 1; j <= 2 && q.count == null && i + j < ls.length; j++) {
      const next = ls[i + j];
      if (cardFor(next)) break;                              // the next item: stop looking
      const nq = lineQuantity(next, q.perBox || perBoxOf.get(cardId));
      if (nq.count != null) { q = nq; i += j; break; }
    }
    const cur = byCard.get(cardId) || { cardId, qty: 0, cases: 0, perBox: q.perBox || perBoxOf.get(cardId) || null, lines: [], hasQty: false };
    if (q.qty != null) { cur.qty += q.qty; cur.cases += q.cases || 0; cur.hasQty = true; }
    else if (q.cases != null) cur.cases += q.cases;
    cur.lines.push(line);
    byCard.set(cardId, cur);
  }
  const items = [...byCard.values()].map(it => ({ cardId: it.cardId, qty: it.hasQty ? it.qty : null, cases: it.cases || null, perBox: it.perBox, lines: it.lines }));

  // Dates. A shipping notice with no ship date shipped when the mail arrived.
  const dateAfter = (re) => { for (const l of ls) { if (re.test(l)) { const d = parseDateLoose(l.replace(re, ''), receivedAt) || parseDateLoose(l, receivedAt); if (d) return d; } } return null; };
  const shipDate = dateAfter(/\b(shipped|ship date|shipping date|dispatched|sent on)\b/i);
  const expectDate = dateAfter(/\b(estimated|expected|arriv\w+|deliver(y|s|ed)? (by|on|date)|eta)\b/i);

  const kind = trackingNo ? 'shipping' : (items.length ? 'order' : 'unknown');
  const missing = [];
  if (kind === 'unknown') { missing.push('size'); if (unknownSizes.length) missing.push('size:unplaced'); }
  if (kind === 'order' && items.some(it => it.qty == null)) missing.push('qty');
  if (kind === 'shipping' && !items.length && !vendorRef) missing.push('size');

  return {
    kind, items, trackingNo, carrier, vendorRef,
    shippedAt: kind === 'shipping' ? (shipDate ? `${shipDate}T12:00:00.000Z` : receivedAt) : null,
    expectedAt: expectDate ? `${expectDate}T12:00:00.000Z` : null,
    orderedAt: kind === 'order' ? receivedAt : null,
    missing, unknownSizes,
  };
}
