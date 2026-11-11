/**
 * Mock orders for the practice / demo mode (Koa 2026-11-11: "using mock data from
 * the last 90 days"). Pure and seeded, so a day replays the same every time.
 * No buyer fields exist anywhere in here: order number, time, lines, rush.
 *
 * generateDay() draws a day from the 90-day shape in the wiki log (2026-11-10
 * DATA entries):
 *   ~34 orders a weekday, ~25 on Sat/Sun; median 1 line / 1 unit, P90 3 lines / 4 units;
 *   27.5% of orders mix cultivars; ~11% ship expedited (Next Day / 2nd Day);
 *   most orders arrive overnight (the morning wave), the rest trickle in by day;
 *   the 2026 Sungrown Tops bag mix: 1 oz 220, 1/4 oz 142, 1/4 lb 104, 1 lb 93, 1/2 oz 58, 1/2 lb 28;
 *   the top cultivars: Rainbow GMO, Sour Lifter, Orange Fritter, Strawberry Doughnuts, ...
 *   Lines are mostly Tops (they go to a cell); some Smalls (bagging) and prerolls (pack),
 *   so every route shows. This is the planning load of §2c, not today's lighter one.
 *
 * parseShopifyExport() + replayDay() replay a real day exactly from Shopify's own
 * order export CSV (Orders > Export), reading ONLY: Name, Created at, Shipping
 * Method, Lineitem name, Lineitem quantity. Every other column (email, address,
 * prices...) is never read, so it can't reach the demo.
 */

export const CULTIVARS = [
  ['Rainbow GMO', 14], ['Sour Lifter', 13], ['Orange Fritter', 11], ['Strawberry Doughnuts', 10],
  ['Orange Pineapple', 8], ['Purple Snowman', 8], ['Mandarin Chocolate', 7], ['Lifter', 6],
  ['Strawberry Fritter', 5], ['Blue Pineapple', 4], ['Puff Pastries', 4], ['Tahitian Haze', 3],
  ['Mountain Apple', 3], ['Critical Berries', 2], ['Snickerdoodle', 2],
];
export const TOPS_BAGS = [['1 oz.', 220], ['1/4 oz.', 142], ['1/4 lb.', 104], ['1 lb.', 93], ['1/2 oz.', 58], ['1/2 lb.', 28]];
const SMALLS_BAGS = [['1 oz.', 5], ['1/4 lb.', 3], ['1 lb.', 2]];
const LINES = [[1, 62], [2, 20], [3, 10], [4, 5], [5, 3]];        // median 1, P90 3
const QTY = [[1, 76], [2, 14], [3, 6], [4, 4]];                     // median 1 unit
const KIND = [['tops', 70], ['smalls', 20], ['pack', 10]];

/** mulberry32: a small seeded random number generator. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, table) {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of table) { x -= w; if (x < 0) return v; }
  return table[table.length - 1][0];
}

/** Pacific wall clock on a date -> UTC ms (DST-safe through Intl). */
export function pacificMs(day, h, m = 0) {
  const [y, mo, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, mo - 1, d, h + 8, m);
  for (let i = 0; i < 2; i++) {
    const s = new Date(guess).toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
    const wall = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
    guess += Date.UTC(y, mo - 1, d, h, m) - wall;
  }
  return guess;
}

function line(kind, cultivar, bag, qty) {
  if (kind === 'pack') return { title: 'Hemp Pre-Rolls 5 pack', productType: 'Pre-Roll', options: {}, productTags: [], qty };
  return { title: `${cultivar} Hemp Flower`, options: { 'Bag Size': bag, 'Flower Type': kind === 'tops' ? 'Tops' : 'Smalls' }, productTags: ['retail-only'], qty };
}

/**
 * @param {{day:string, seed?:number, count?:number}} o  day = 'YYYY-MM-DD' (Pacific)
 * @returns {{simStartMs:number, orders:Array<{name, simAt, rush, lines}>}}
 */
export function generateDay({ day, seed = 1, count } = {}) {
  const r = rng(seed + Number(day.replace(/-/g, '')));
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const n = count ?? Math.round((dow === 0 || dow === 6 ? 25 : 34) * (0.85 + r() * 0.3));
  const start = pacificMs(day, 6, 55);
  const orders = [];
  for (let i = 0; i < n; i++) {
    // ~55% overnight (in at the start), the rest from 7:00 to 3:30, more in the morning.
    const overnight = r() < 0.55;
    const simAt = overnight ? start : pacificMs(day, 7) + Math.floor(Math.pow(r(), 1.4) * 8.5 * 3600e3);
    const lines = [];
    const nl = pick(r, LINES);
    const mixed = nl > 1 && r() < 0.275 / 0.38;   // 38% of orders have >1 line; 27.5% mix cultivars
    const first = pick(r, CULTIVARS);
    for (let j = 0; j < nl; j++) {
      const kind = pick(r, KIND);
      const cultivar = j === 0 || mixed ? (j === 0 ? first : pick(r, CULTIVARS)) : first;
      const bag = pick(r, kind === 'smalls' ? SMALLS_BAGS : TOPS_BAGS);
      lines.push(line(kind, cultivar, bag, pick(r, QTY)));
    }
    orders.push({ name: `#D${String(1001 + i)}`, simAt, rush: r() < 0.11, lines });
  }
  orders.sort((a, b) => a.simAt - b.simAt);
  orders.forEach((o, i) => { o.name = `#D${1001 + i}`; });
  return { simStartMs: start, orders };
}

/** A minimal RFC 4180 CSV reader (quotes, doubled quotes, newlines in quotes). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

const BAG_RE = /^(1\/4|1\/2|1|10)\s*(oz|lbs?)\.?$|^\d+\s*kg\.?$/i;

/** "Sour Lifter Hemp Flower - 1 oz. / Tops" -> a mock line (product title + options). */
export function lineFromName(name, qty) {
  const s = String(name || '').trim();
  const cut = s.lastIndexOf(' - ');
  const title = cut > 0 ? s.slice(0, cut) : s;
  const parts = cut > 0 ? s.slice(cut + 3).split('/').map(x => x.trim()) : [];
  const options = {};
  for (const p of parts) {
    if (BAG_RE.test(p)) options['Bag Size'] = p;
    else if (/^(tops|smalls)$/i.test(p)) options['Flower Type'] = p[0].toUpperCase() + p.slice(1).toLowerCase();
  }
  if (!parts.length) return { title, custom: true, qty };
  // The export doesn't carry product tags. A title without a [year]/[Mids] prefix is
  // taken as the 2026 retail product, as the catalog read found.
  return { title, options, productTags: /^\s*\[/.test(title) ? [] : ['retail-only'], qty };
}

/** Shopify's order export -> orders. Only five columns are read; the rest are ignored. */
export function parseShopifyExport(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name.toLowerCase());
  const iName = col('Name'), iAt = col('Created at'), iShip = col('Shipping Method'), iLine = col('Lineitem name'), iQty = col('Lineitem quantity');
  if (iName < 0 || iLine < 0 || iQty < 0) throw new Error('Not a Shopify order export: needs Name, Lineitem name, Lineitem quantity');
  const byName = new Map();
  for (const r of rows.slice(1)) {
    const name = (r[iName] || '').trim();
    if (!name) continue;
    let o = byName.get(name);
    if (!o) { o = { name, createdAt: null, rush: false, lines: [] }; byName.set(name, o); }
    if (iAt >= 0 && r[iAt] && !o.createdAt) o.createdAt = Date.parse(r[iAt].replace(' ', 'T').replace(/ ([+-]\d{4})$/, '$1'));
    if (iShip >= 0 && r[iShip] && /next\s*day|2nd\s*day|second\s*day|overnight|express/i.test(r[iShip])) o.rush = true;
    const qty = Number(r[iQty]) || 0;
    if (r[iLine] && qty > 0) o.lines.push(lineFromName(r[iLine], qty));
  }
  return [...byName.values()].filter(o => o.lines.length && Number.isFinite(o.createdAt));
}

/**
 * One production day of a real export: every order created after the previous
 * production day's 4:30 PM and before this day's 4:30 PM (Mon looks back to Sat),
 * arriving at its real time, or at the day's start if it came in overnight.
 */
export function replayDay(orders, day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const prev = new Date(Date.parse(`${day}T12:00:00Z`) - (dow === 1 ? 2 : 1) * 86400e3).toISOString().slice(0, 10);
  const from = pacificMs(prev, 16, 30), to = pacificMs(day, 16, 30), start = pacificMs(day, 6, 55);
  const picked = orders.filter(o => o.createdAt >= from && o.createdAt < to).sort((a, b) => a.createdAt - b.createdAt);
  return { simStartMs: start, orders: picked.map(o => ({ name: o.name, simAt: Math.max(start, o.createdAt), rush: o.rush, lines: o.lines })) };
}
