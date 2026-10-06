/**
 * /salida — the pure logic of the scan-out screen.
 *
 * Each function is written ONCE here, exported for node tests, and serialised
 * into the page via LOGIC_SOURCE (Function#toString). That is why every
 * function is self-contained: no imports, no module-level constants, only
 * calls to each other by name. Adding a function means adding it to the list
 * at the bottom too.
 */

// A tag is ONLY a two-digit season, a cultivar code and a number. Anything a
// QR can carry that is not that (wifi codes, other URLs, markup) is "not a
// tag" and is dropped silently — the regex is also what keeps attacker text
// out of every request and every DOM node.
export function parseTag(text) {
  if (typeof text !== 'string' || text.length > 300) return null;
  let s = text.trim();
  const m = /^https?:\/\/[^/\s]+\/s\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(s);
  if (m) s = m[1];
  s = s.toUpperCase();
  return /^\d{2}-[A-Z0-9]{1,10}-\d{1,5}$/.test(s) ? { id: s } : null;
}

// A handheld scanner "types" a whole tag in tens of milliseconds; a gloved
// person types a bag number at 100ms+ per key. Both end in Enter, so speed
// plus "is it a tag" is what tells them apart.
export function isScannerBurst(keys, maxAvgGapMs) {
  const gapLimit = maxAvgGapMs || 40;
  if (!Array.isArray(keys) || keys.length < 6) return false;
  const span = keys[keys.length - 1].t - keys[0].t;
  if (span / (keys.length - 1) > gapLimit) return false;
  return parseTag(keys.map((k) => k.ch).join('')) !== null;
}

// The camera sees the same tag on every frame; one sack must POST once.
export function debounceSeen(seen, id, now, windowMs) {
  const next = {};
  for (const k of Object.keys(seen || {})) if (now - seen[k] < windowMs) next[k] = seen[k];
  const accept = !(id in next);
  if (accept) next[id] = now;
  return { accept, seen: next };
}

// Offline queue. A localStorage copy can be corrupt; treat it as empty
// rather than letting one bad write stop every later scan.
export function queueReduce(queue, action) {
  const q = Array.isArray(queue) ? queue.filter((x) => x && x.key) : [];
  if (!action) return q;
  if (action.type === 'add') {
    if (q.some((x) => x.key === action.key)) return q;
    return q.concat([{ key: action.key, payload: action.payload, at: action.at, tries: 0 }]);
  }
  if (action.type === 'done') return q.filter((x) => x.key !== action.key);
  if (action.type === 'fail') return q.map((x) => (x.key === action.key ? Object.assign({}, x, { tries: (x.tries || 0) + 1 }) : x));
  return q;
}

export function pacificTime(stamp) {
  if (!stamp) return '';
  const d = new Date(String(stamp).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? '' : 'Z'));
  if (isNaN(d)) return '';
  const t = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true });
  return t.replace(/\s?([AP])M$/, (m, x) => ' ' + x.toLowerCase() + '.m.');
}

// "1 bolsa" / "3 bolsas". Orders need fractional sacks (14.1); nobody pulls
// 0.1 of a bag, so "of M" is always rounded UP to whole bags.
export function countText(n, m, s) {
  const k = Number(n) || 0;
  const one = (s.count1 || s.count).replace('{n}', k), many = s.count.replace('{n}', k);
  if (m == null || m === '') return k === 1 ? one : many;
  const whole = Math.ceil(Number(m) - 1e-9);
  return s.countOf.replace('{n}', k).replace('{m}', whole) + ' ' + (whole === 1 ? one : many).replace(/^\S+\s*/, '');
}

// `busy` = the sack is settling with Shopify. Retry after ~1.5 s, three times,
// then give up (amber). Returns the wait in ms, or null to stop.
export function busyRetry(tries) {
  return (Number(tries) || 0) < 3 ? 1500 : null;
}

// Row undo: inside the server's 60 s window one tap; older rows need a second
// confirming tap (a mis-tap would put a trimmed sack back in inventory).
export function undoNeedsConfirm(openedAt, now) {
  const t = Date.parse(String(openedAt || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(openedAt || '')) ? '' : 'Z'));
  return !(t && now - t < 60000);
}

// Cultivar chips: most recently used first, then most bags in inventory.
export function orderChips(chips, recent) {
  const r = Array.isArray(recent) ? recent : [];
  const rank = (c) => { const i = r.indexOf(c.code); return i < 0 ? 1e9 : i; };
  return (Array.isArray(chips) ? chips.slice() : []).sort((a, b) =>
    rank(a) - rank(b) || (b.in_inventory || 0) - (a.in_inventory || 0) || String(a.cultivar || a.code).localeCompare(String(b.cultivar || b.code)));
}

export function rememberCode(recent, code) {
  return [code].concat((Array.isArray(recent) ? recent : []).filter((c) => c !== code)).slice(0, 30);
}

// The offline queue as stored in localStorage (a string) -> a clean queue.
export function queueLoad(raw) {
  let v = null;
  try { v = JSON.parse(raw); } catch (e) { v = null; }
  return queueReduce(v, null);
}

// Server state -> what the floor sees, hears and feels. Returns TEXT; the
// page writes it with textContent, never innerHTML.
export function feedbackFor(resp, s, fromOurQueue) {
  const r = resp || {};
  const sack = r.sack || {};
  const name = [sack.cultivar, sack.serial != null ? '#' + sack.serial : ''].filter(Boolean).join(' ');
  const dest = r.order ? (r.order.nickname || r.order.shopify_order_name || '') : s.stock;
  let state = r.state;
  if (state === 'already_out' && fromOurQueue) state = 'out';
  if (state === 'out') return { tone: 'ok', icon: '✓', vibrate: [90], beep: 'ok', line: name + ' → ' + dest };
  if (state === 'busy') return { tone: 'wait', icon: '…', vibrate: [], beep: '', line: s.wait };
  if (state === 'stuck') return { tone: 'warn', icon: '⚠', vibrate: [120, 80, 120], beep: 'warn', line: s.stuck };
  if (state === 'refused' || state === 'unknown_order') return { tone: 'bad', icon: '✕', vibrate: [500], beep: 'bad', line: String(r.message || s.error) };
  if (state === 'already_out') return { tone: 'warn', icon: '⚠', vibrate: [120, 80, 120], beep: 'warn', undoLive: Date.parse(r.undo_until || '') > Date.now(), line: s.already.replace('{name}', name).replace('{time}', pacificTime(sack.opened_at)) };
  if (state === 'ambiguous') return { tone: 'pick', icon: '?', vibrate: [60, 40, 60], beep: 'warn', line: s.ambiguous };
  const key = state === 'voided' || state === 'not_found' || state === 'not_a_tag' ? state : 'error';
  return { tone: 'bad', icon: '✕', vibrate: [500], beep: 'bad', line: s[key] };
}

// Today's list, grouped as the server sent it (cultivar x order), plus our
// own unsent scans so the water spider sees nothing went missing.
export function groupToday(today, pending, s) {
  const out = [];
  const groups = (today && Array.isArray(today.groups)) ? today.groups : [];
  for (const g of groups) {
    const dest = g.order ? (g.order.nickname || g.order.shopify_order_name || '') : s.stock;
    const n = g.sacks_today || 0;
    const need = g.sacks_needed != null ? Math.ceil(Number(g.sacks_needed) - 1e-9) : null;
    const count = countText(n, g.sacks_needed, s);
    out.push({ title: (g.cultivar || '') + ' · ' + dest, dest, cultivar: g.cultivar || '', n, need, count, pending: false,
      rows: (g.sacks || []).map((x) => ({ sack_id: x.sack_id, serial: x.serial, zone: x.zone || '',
        cut: x.cut_number != null ? s.cut + ' ' + x.cut_number : '', time: pacificTime(x.opened_at), opened_at: x.opened_at, can_undo: x.can_undo === true })) });
  }
  const p = Array.isArray(pending) ? pending : [];
  if (p.length) {
    out.push({ title: s.pending, count: countText(p.length, null, s), pending: true,
      rows: p.map((x) => ({ sack_id: x.key, serial: (x.payload && (x.payload.number || x.payload.q)) || '', zone: '', cut: '', time: '', can_undo: false })) });
  }
  return out;
}

export function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// JSON safe inside <script type="application/json">: no "</script", no "<!--",
// no raw U+2028/9. Still valid JSON — JSON.parse gives back the same value.
export function embedJson(value) {
  return JSON.stringify(value == null ? null : value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export const LOGIC_SOURCE = [parseTag, isScannerBurst, debounceSeen, queueReduce, pacificTime, countText, busyRetry,
  undoNeedsConfirm, orderChips, rememberCode, queueLoad,
  feedbackFor, groupToday, escapeHtml, embedJson].map((f) => f.toString()).join('\n');
